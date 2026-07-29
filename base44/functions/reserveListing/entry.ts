import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';
import { isMaintenanceActive, maintenance503 } from '../../shared/maintenance.ts';
import { upsertListingPrivate, getListingPrivate, alertPrivateWriteFailure } from '../../shared/privateData.ts';

const RESERVATION_MINUTES = 10;

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { listing_id } = await req.json().catch(() => ({}));
    if (!listing_id) return Response.json({ error: 'listing_id required' }, { status: 400 });

    // Phase 0 maintenance gate — fail-closed for all callers
    if (isMaintenanceActive()) return maintenance503('Reservations are temporarily unavailable for scheduled maintenance.');

    const listings = await base44.asServiceRole.entities.Listing.filter({ id: listing_id });
    const listing = listings[0];
    if (!listing) return Response.json({ error: 'Listing not found' }, { status: 404 });

    // Phase 1B: read reservation ownership/token/expiry from ListingPrivate first (legacy fallback)
    const lp = await getListingPrivate(base44, listing.id);
    const reservedBy = lp?.reserved_by_email ?? listing.reserved_by_email;
    const resToken = lp?.reservation_token ?? listing.reservation_token;
    const resExpiry = lp?.reservation_expires_at ?? listing.reservation_expires_at;

  // Must be active + approved
  if (listing.status === 'sold') {
    return Response.json({ error: 'This listing has sold', code: 'SOLD' }, { status: 409 });
  }
  if (listing.status !== 'active') {
    return Response.json({ error: 'Listing is no longer available', code: 'UNAVAILABLE' }, { status: 409 });
  }
  if (listing.proof_status !== 'approved') {
    return Response.json({ error: 'Listing is not yet approved', code: 'NOT_APPROVED' }, { status: 409 });
  }

  // Self-purchase guard
  if (listing.seller_email === user.email) {
    return Response.json({ error: 'You cannot reserve your own listing', code: 'SELF_PURCHASE' }, { status: 400 });
  }

  const now = Date.now();

  // Already reserved by current user (not expired) — return existing token
  if (reservedBy === user.email && resExpiry && new Date(resExpiry).getTime() > now) {
    return Response.json({
      reservation_token: resToken,
      reservation_expires_at: resExpiry,
      already_reserved: true,
    });
  }

  // Reserved by someone else (not expired) — block
  if (reservedBy && resExpiry && reservedBy !== user.email && new Date(resExpiry).getTime() > now) {
    return Response.json({
      error: 'This listing is currently reserved by another buyer. If they do not complete checkout, it may become available again shortly.',
      code: 'RESERVED_BY_OTHER',
    }, { status: 409 });
  }

  // ── One-per-buyer: check if user has any OTHER active reservation ───────
  const userReservations = await base44.asServiceRole.entities.Listing.filter({
    reserved_by_email: user.email,
    status: 'active',
  }).catch(() => []);

  for (const r of userReservations) {
    if (r.id === listing_id) continue;
    if (r.reservation_expires_at && new Date(r.reservation_expires_at).getTime() > now) {
      return Response.json({
        error: 'You already have a listing reserved. Complete or release that checkout before reserving another.',
        code: 'ALREADY_HAS_RESERVATION',
        existing_listing_id: r.id,
      }, { status: 409 });
    }
    // Expired — auto-release it
    await base44.asServiceRole.entities.Listing.update(r.id, {
      reserved_by_email: null,
      reservation_token: null,
      reservation_expires_at: null,
    }).catch(() => {});
  }

  // ── Reserve ─────────────────────────────────────────────────────────────
  const token = crypto.randomUUID();
  const expiresAt = new Date(now + RESERVATION_MINUTES * 60 * 1000).toISOString();

  await base44.asServiceRole.entities.Listing.update(listing.id, {
    reserved_by_email: user.email,
    reservation_token: token,
    reservation_expires_at: expiresAt,
  });
  // Phase 1B: mirror reservation to ListingPrivate (authoritative private destination)
  try {
    await upsertListingPrivate(base44, listing.id, {
      reserved_by_email: user.email,
      reservation_token: token,
      reservation_expires_at: expiresAt,
    });
  } catch (err) {
    // Required private write failed — safe compensation: revert Listing reservation, alert
    await base44.asServiceRole.entities.Listing.update(listing.id, {
      reserved_by_email: null, reservation_token: null, reservation_expires_at: null,
    }).catch(() => {});
    await alertPrivateWriteFailure(base44, { entity: 'ListingPrivate', reference_id: listing.id, reference_type: 'listing', error: err });
    return Response.json({ error: 'Failed to persist reservation. Please try again.' }, { status: 500 });
  }

  // ── Race condition: re-fetch and verify we own the reservation ──────────
  const [reservedListing] = await base44.asServiceRole.entities.Listing.filter({ id: listing.id });
  if (!reservedListing || reservedListing.reserved_by_email !== user.email || reservedListing.reservation_token !== token) {
    return Response.json({
      error: 'This listing was just reserved by another buyer. Please try another listing.',
      code: 'RACE_LOST',
    }, { status: 409 });
  }

    return Response.json({
      reservation_token: token,
      reservation_expires_at: expiresAt,
    });
  } catch (error) {
    console.error('[reserveListing] error:', error?.message);
    return Response.json({ error: error?.message || 'Internal server error' }, { status: 500 });
  }
});