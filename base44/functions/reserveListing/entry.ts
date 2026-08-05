import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';
import { isMaintenanceActive, maintenance503 } from '../../shared/maintenance.ts';
import { upsertListingPrivate, getListingPrivate, alertPrivateWriteFailure } from '../../shared/privateData.ts';
import { isFailClosed } from '../../shared/checkoutLogic.js';

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

    // Phase 1B: ListingPrivate is required and authoritative — no legacy fallback
    const lp = await getListingPrivate(base44, listing.id);
    if (!lp) {
      return Response.json({ error: 'Listing integrity error: missing private record', code: 'INTEGRITY_ERROR' }, { status: 500 });
    }
    const reservedBy = lp.reserved_by_email;
    const resToken = lp.reservation_token;
    const resExpiry = lp.reservation_expires_at;

  // Must be active + approved
  if (listing.status === 'sold') {
    return Response.json({ error: 'This listing has sold', code: 'SOLD' }, { status: 409 });
  }
  if (listing.status !== 'active') {
    return Response.json({ error: 'Listing is no longer available', code: 'UNAVAILABLE' }, { status: 409 });
  }
  if (lp.proof_status !== 'approved') {
    return Response.json({ error: 'Listing is not yet approved', code: 'NOT_APPROVED' }, { status: 409 });
  }

  // 7C.7 fix #6: Check quarantine before reservation writes
  if (isFailClosed(listing, lp)) {
    return Response.json({ error: 'This listing is under review. Please try another listing.', code: 'QUARANTINED' }, { status: 409 });
  }

  // Self-purchase guard
  if (lp.seller_email === user.email) {
    return Response.json({ error: 'You cannot reserve your own listing', code: 'SELF_PURCHASE' }, { status: 400 });
  }

  const now = Date.now();

  // Already reserved by current user (not expired) — return existing token
  if (reservedBy === user.email && resExpiry && new Date(resExpiry).getTime() > now) {
    return Response.json({
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
    try {
      await base44.asServiceRole.entities.Listing.update(r.id, {
        reserved_by_email: null,
        reservation_token: null,
        reservation_expires_at: null,
        reservation_revision: null,
      });
      try {
        await upsertListingPrivate(base44, r.id, {
          reserved_by_email: null,
          reservation_token: null,
          reservation_expires_at: null,
          reservation_revision: null,
        });
      } catch (lpErr) {
        await alertPrivateWriteFailure(base44, { entity: 'ListingPrivate (auto-release)', reference_id: r.id, reference_type: 'listing', error: lpErr });
      }
    } catch (listErr) {
      await alertPrivateWriteFailure(base44, { entity: 'Listing (auto-release)', reference_id: r.id, reference_type: 'listing', error: listErr });
    }
  }

  // ── Reserve ─────────────────────────────────────────────────────────────
  const token = crypto.randomUUID();
  const expiresAt = new Date(now + RESERVATION_MINUTES * 60 * 1000).toISOString();
  const revision = crypto.randomUUID();

  // Write authoritative ListingPrivate FIRST, then legacy Listing mirror
  try {
    await upsertListingPrivate(base44, listing.id, {
      reserved_by_email: user.email,
      reservation_token: token,
      reservation_expires_at: expiresAt,
      reservation_revision: revision,
    });
  } catch (err) {
    await alertPrivateWriteFailure(base44, { entity: 'ListingPrivate', reference_id: listing.id, reference_type: 'listing', error: err });
    return Response.json({ error: 'Failed to persist reservation. Please try again.' }, { status: 500 });
  }
  try {
    await base44.asServiceRole.entities.Listing.update(listing.id, {
      reserved_by_email: user.email,
      reservation_token: token,
      reservation_expires_at: expiresAt,
      reservation_revision: revision,
    });
  } catch (err) {
    // Legacy mirror failed — reconcile ListingPrivate to current Listing state (never restore old blindly)
    const [failListing] = await base44.asServiceRole.entities.Listing.filter({ id: listing.id });
    try {
      await upsertListingPrivate(base44, listing.id, {
        reserved_by_email: failListing?.reserved_by_email ?? null,
        reservation_token: failListing?.reservation_token ?? null,
        reservation_expires_at: failListing?.reservation_expires_at ?? null,
        reservation_revision: failListing?.reservation_revision ?? null,
      });
      // Verify reconciliation persisted
      const verifyLp = await getListingPrivate(base44, listing.id);
      if (verifyLp?.reservation_token !== (failListing?.reservation_token ?? null)) {
        await alertPrivateWriteFailure(base44, { entity: 'ListingPrivate (reconcile verify)', reference_id: listing.id, reference_type: 'listing', error: new Error('LP reconciliation did not persist after Listing mirror failure') });
      }
    } catch (reconcileErr) {
      await alertPrivateWriteFailure(base44, { entity: 'ListingPrivate (reconcile)', reference_id: listing.id, reference_type: 'listing', error: reconcileErr });
    }
    await alertPrivateWriteFailure(base44, { entity: 'Listing (legacy mirror)', reference_id: listing.id, reference_type: 'listing', error: err });
    return Response.json({ error: 'Failed to persist reservation. Please try again.' }, { status: 500 });
  }

  // ── Verify: re-fetch current Listing (source of truth for the winner) ─────
  // If another buyer's token is present, that is the winner — copy it into
  // ListingPrivate and return 409. Never overwrite another request's token.
  const [curListing] = await base44.asServiceRole.entities.Listing.filter({ id: listing.id });
  const curLp = await getListingPrivate(base44, listing.id);
  const curToken = curListing?.reservation_token ?? null;
  const curLpToken = curLp?.reservation_token ?? null;

  // 7C.7 fix #6: Check quarantine after reservation writes
  if (isFailClosed(curListing, curLp)) {
    return Response.json({ error: 'This listing was quarantined during your request. Please try another listing.', code: 'QUARANTINED' }, { status: 409 });
  }

  if (curToken !== token) {
    // Listing contains another buyer's token (or none) — we lost the race.
    // Copy the current winning Listing state into ListingPrivate (never overwrite Listing).
    if (curListing) {
      try {
        await upsertListingPrivate(base44, listing.id, {
          reserved_by_email: curListing.reserved_by_email ?? null,
          reservation_token: curToken,
          reservation_expires_at: curListing.reservation_expires_at ?? null,
          reservation_revision: curListing.reservation_revision ?? null,
        });
        // Verify reconciliation persisted
        const verifyLp = await getListingPrivate(base44, listing.id);
        if (verifyLp?.reservation_token !== curToken) {
          await alertPrivateWriteFailure(base44, { entity: 'ListingPrivate (race-lost reconcile verify)', reference_id: listing.id, reference_type: 'listing', error: new Error('LP reconcile did not persist after race loss') });
        }
      } catch (reconcileErr) {
        await alertPrivateWriteFailure(base44, { entity: 'ListingPrivate (race-lost reconcile)', reference_id: listing.id, reference_type: 'listing', error: reconcileErr });
      }
    }
    return Response.json({
      error: 'This listing was just reserved by another buyer. Please try another listing.',
      code: 'RACE_LOST',
    }, { status: 409 });
  }

  // Listing still has our token. Ensure ListingPrivate matches (reconcile only, never restore old values).
  if (curLpToken !== token) {
    try {
      await upsertListingPrivate(base44, listing.id, {
        reserved_by_email: user.email,
        reservation_token: token,
        reservation_expires_at: expiresAt,
        reservation_revision: revision,
      });
      // Verify reconciliation persisted
      const verifyLp = await getListingPrivate(base44, listing.id);
      if (verifyLp?.reservation_token !== token) {
        await alertPrivateWriteFailure(base44, { entity: 'ListingPrivate (reconcile verify)', reference_id: listing.id, reference_type: 'listing', error: new Error('LP reconcile did not persist') });
        return Response.json({ error: 'Reservation could not be verified. Please try again.' }, { status: 500 });
      }
    } catch (err) {
      await alertPrivateWriteFailure(base44, { entity: 'ListingPrivate (reconcile)', reference_id: listing.id, reference_type: 'listing', error: err });
      return Response.json({ error: 'Reservation could not be verified. Please try again.' }, { status: 500 });
    }
  }

    return Response.json({
      reservation_expires_at: expiresAt,
    });
  } catch (error) {
    console.error('[reserveListing] error:', error?.message);
    return Response.json({ error: error?.message || 'Internal server error' }, { status: 500 });
  }
});