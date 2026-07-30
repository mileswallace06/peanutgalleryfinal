/**
 * getListingParticipantView — return an allowlisted listing view for the
 * calling participant (buyer / seller / admin / public).
 *
 * Two modes:
 *   1. Single record:  { listing_id }
 *   2. List by event:  { action: "list_active_by_event", event_id }
 *
 * Both paths use the same safe serializer so privacy rules cannot drift.
 *
 * ListingPrivate is required (Phase 1A migration is complete). No legacy
 * fallback for sensitive fields. Listings with missing sidecars are omitted
 * (list) or fail closed (single).
 *
 * Never exposed to any role: seller_email, reserved_by_email,
 * reservation_token, proof_url, ticket_file_url, notes, private file/storage
 * identifiers, custody internals, fraud fields, admin-only identifiers.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';
import { getListingPrivate } from '../../shared/privateData.ts';

// ── Shared safe serializer ──────────────────────────────────────────────────
function serializeListing(listing, lp, viewerEmail, role, isConfirmedBuyer) {
  // ListingPrivate is authoritative — NO legacy fallback for sensitive fields
  const authoritativeSellerEmail = lp?.seller_email ?? null;
  const authoritativeProofStatus = lp?.proof_status ?? null;
  const authoritativeSeats = lp?.seats ?? null;
  const authoritativeIsDemo = lp?.is_demo_listing ?? false;
  const authoritativeCustodyStatus = lp?.custody_status ?? null;
  const authoritativeReservedBy = lp?.reserved_by_email ?? null;
  const authoritativeReservationExpiresAt = lp?.reservation_expires_at ?? null;

  const isSeller = !!(viewerEmail && authoritativeSellerEmail === viewerEmail);
  const isAdmin = role === 'admin';

  // Reservation state (authoritative from ListingPrivate)
  const now = Date.now();
  const isReservationActive = !!(authoritativeReservedBy &&
    authoritativeReservationExpiresAt &&
    new Date(authoritativeReservationExpiresAt).getTime() > now);

  let reservationState = 'available';
  if (isReservationActive) {
    if (authoritativeReservedBy === viewerEmail) {
      reservationState = 'reserved_for_you';
    } else {
      reservationState = 'reserved_by_other';
    }
  }

  // ── Base display fields (always returned) ──
  const out = {
    id: listing.id,
    event_id: listing.event_id,
    section: listing.section,
    row: listing.row,
    quantity: listing.quantity,
    tier: listing.tier,
    asking_price: listing.asking_price,
    original_price: listing.original_price,
    transfer_method: listing.transfer_method,
    status: listing.status,
    listing_mode: listing.listing_mode,
    listing_type: listing.listing_type,
    transfer_status: listing.transfer_status,
    listing_transfer_mode: listing.listing_transfer_mode,
    transfer_confidence_score: listing.transfer_confidence_score,
    last_transfer_verification: listing.last_transfer_verification,
    requires_location: listing.requires_location,
    location_requirement: listing.location_requirement,
    requires_existing_ticket: listing.requires_existing_ticket,
    is_demo_listing: !!authoritativeIsDemo,
    is_verified: authoritativeProofStatus === 'approved',
    is_instant_ready: listing.listing_mode === 'instant' && authoritativeCustodyStatus === 'verified',
    viewer_is_seller: isSeller,
    reservation_state: reservationState,
  };

  // seats: only for seller, confirmed buyer, or admin
  if (isSeller || isConfirmedBuyer || isAdmin) {
    out.seats = authoritativeSeats;
  }

  // reservation_expires_at: only for reservation holder, seller, or admin
  if (reservationState === 'reserved_for_you' || isSeller || isAdmin) {
    out.reservation_expires_at = authoritativeReservationExpiresAt;
  }

  return out;
}

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  let user = null;
  try { user = await base44.auth.me(); } catch (_) { user = null; }

  const body = await req.json().catch(() => ({}));
  const action = body?.action;
  const sr = base44.asServiceRole;
  const viewerEmail = user?.email || null;
  const role = user?.role || null;

  // ── List action: list_active_by_event ──
  if (action === 'list_active_by_event') {
    const event_id = body?.event_id;
    if (!event_id) {
      return Response.json({ error: 'event_id required' }, { status: 400 });
    }

    // Fetch active listings (limit 200, stable sort by asking_price)
    const listings = await sr.entities.Listing.filter(
      { event_id, status: 'active' },
      'asking_price',
      200
    ).catch(() => []);

    if (listings.length === 0) {
      return Response.json({ listings: [] });
    }

    // Batch fetch ListingPrivate sidecars (stable sort + limit 500, no N+1)
    const listingPrivates = await sr.entities.ListingPrivate.filter(
      { event_id }, 'id', 500
    ).catch(() => []);
    const lpMap = new Map();
    for (const lp of listingPrivates) {
      if (lp.listing_id) lpMap.set(lp.listing_id, lp);
    }

    // Batch fetch confirmed buyer purchases (stable sort + limit 500)
    const confirmedListingIds = new Set();
    if (viewerEmail) {
      const buyerPurchases = await sr.entities.PurchasePrivate.filter(
        { event_id, buyer_email: viewerEmail }, 'id', 500
      ).catch(() => []);
      for (const pp of buyerPurchases) {
        if (pp.listing_id) confirmedListingIds.add(pp.listing_id);
      }
    }

    // Filter + serialize
    const now = Date.now();
    const result = [];
    for (const listing of listings) {
      const lp = lpMap.get(listing.id);

      // Phase 1A migration complete — ListingPrivate is required.
      // Omit listings with missing sidecars and log the integrity failure.
      if (!lp) {
        console.warn(`[getListingParticipantView] integrity failure: ListingPrivate missing for listing ${listing.id}`);
        continue;
      }

      // Authoritative proof_status from ListingPrivate (no legacy fallback)
      if (lp.proof_status !== 'approved') continue;

      // Reservation check (authoritative from ListingPrivate)
      const reservedBy = lp.reserved_by_email;
      const reservationExpiresAt = lp.reservation_expires_at;
      const isReservationActive = !!(reservedBy && reservationExpiresAt &&
        new Date(reservationExpiresAt).getTime() > now);

      const isSeller = !!(viewerEmail && lp.seller_email === viewerEmail);
      const isAdmin = role === 'admin';

      // Omit listings actively reserved by another user
      // (unless viewer is the seller, the reservation holder, or admin)
      if (isReservationActive && reservedBy !== viewerEmail && !isSeller && !isAdmin) {
        continue;
      }

      const isConfirmedBuyer = confirmedListingIds.has(listing.id);
      result.push(serializeListing(listing, lp, viewerEmail, role, isConfirmedBuyer));
    }

    return Response.json({ listings: result });
  }

  // ── Unknown action → 400 ──
  if (action) {
    return Response.json({ error: 'Unknown action' }, { status: 400 });
  }

  // ── Single record ──
  const listing_id = body?.listing_id;
  if (!listing_id) {
    return Response.json({ error: 'listing_id required' }, { status: 400 });
  }

  const rows = await sr.entities.Listing.filter({ id: listing_id });
  const listing = rows[0];
  if (!listing) return Response.json({ error: 'Listing not found' }, { status: 404 });

  const lp = await getListingPrivate(base44, listing.id);

  // ── ListingPrivate integrity check ──
  // Phase 1A migration is complete — sidecar is required. Never expose
  // legacy sensitive fields from the Listing entity.
  if (!lp) {
    // Admin gets a clear integrity error (not a 404)
    if (role === 'admin') {
      console.error(`[getListingParticipantView] integrity failure: ListingPrivate missing for listing ${listing.id} (admin view)`);
      return Response.json({ error: 'Listing integrity error: private record missing', code: 'INTEGRITY_ERROR' }, { status: 500 });
    }
    // Confirmed buyer gets a clear integrity error
    if (viewerEmail) {
      const buyerPurchases = await sr.entities.PurchasePrivate.filter(
        { listing_id: listing.id, buyer_email: viewerEmail }, 'id', 500
      ).catch(() => []);
      if (buyerPurchases.length > 0) {
        console.error(`[getListingParticipantView] integrity failure: ListingPrivate missing for listing ${listing.id} (confirmed buyer view)`);
        return Response.json({ error: 'Listing integrity error: private record missing', code: 'INTEGRITY_ERROR' }, { status: 500 });
      }
    }
    // Public/unrelated viewer → 404 (fail closed)
    return Response.json({ error: 'Listing not found' }, { status: 404 });
  }

  // ── Determine seller/admin/confirmed-buyer status ──
  const authoritativeSellerEmail = lp.seller_email;
  const isSeller = !!(viewerEmail && authoritativeSellerEmail === viewerEmail);
  const isAdmin = role === 'admin';

  let isConfirmedBuyer = false;
  if (!isSeller && !isAdmin && viewerEmail) {
    const buyerPurchases = await sr.entities.PurchasePrivate.filter(
      { listing_id: listing.id, buyer_email: viewerEmail }, 'id', 500
    ).catch(() => []);
    isConfirmedBuyer = buyerPurchases.length > 0;
  }

  // ── Authorized viewers: seller, confirmed buyer, admin ──
  if (isSeller || isConfirmedBuyer || isAdmin) {
    return Response.json({ listing: serializeListing(listing, lp, viewerEmail, role, isConfirmedBuyer) });
  }

  // ── Public/unrelated viewer: strict visibility gate ──
  // 1. status must be active
  if (listing.status !== 'active') {
    return Response.json({ error: 'Listing not found' }, { status: 404 });
  }
  // 2. authoritative ListingPrivate proof_status must be approved
  if (lp.proof_status !== 'approved') {
    return Response.json({ error: 'Listing not found' }, { status: 404 });
  }
  // 3. must not be actively reserved by another user
  const now = Date.now();
  const reservedBy = lp.reserved_by_email;
  const reservationExpiresAt = lp.reservation_expires_at;
  const isReservationActive = !!(reservedBy && reservationExpiresAt &&
    new Date(reservationExpiresAt).getTime() > now);
  if (isReservationActive && reservedBy !== viewerEmail) {
    return Response.json({ error: 'Listing not found' }, { status: 404 });
  }

  return Response.json({ listing: serializeListing(listing, lp, viewerEmail, role, false) });
});