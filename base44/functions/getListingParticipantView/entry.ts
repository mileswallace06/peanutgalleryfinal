/**
 * getListingParticipantView — return an allowlisted listing view for the
 * calling participant (buyer / seller / admin). Sensitive internals are only
 * included for admins; reservation token is never exposed to non-admins.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';
import { getListingPrivate } from '../../shared/privateData.ts';

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  let user = null;
  try { user = await base44.auth.me(); } catch (_) { user = null; }

  const body = await req.json().catch(() => ({}));
  const listing_id = body?.listing_id;
  if (!listing_id) return Response.json({ error: 'listing_id required' }, { status: 400 });

  const rows = await base44.asServiceRole.entities.Listing.filter({ id: listing_id });
  const listing = rows[0];
  if (!listing) return Response.json({ error: 'Listing not found' }, { status: 404 });

  // Phase 1B: read authoritative seller_email from ListingPrivate
  const lp = await getListingPrivate(base44, listing.id);
  const authoritativeSellerEmail = lp?.seller_email ?? listing.seller_email;

  // ── Strict role-specific allowlists ──────────────────────────────────────
  // Never expose: emails, reservation tokens, payment IDs, proof storage
  // details, fraud data, or private notes — to any role in the participant view.

  const publicFields = {
    id: listing.id, event_id: listing.event_id, section: listing.section, row: listing.row,
    quantity: listing.quantity, tier: listing.tier,
    asking_price: listing.asking_price, original_price: listing.original_price,
    transfer_method: listing.transfer_method, status: listing.status,
    listing_mode: listing.listing_mode, listing_type: listing.listing_type,
    transfer_status: listing.transfer_status, listing_transfer_mode: listing.listing_transfer_mode,
  };

  // Unauthenticated: only active listings, only explicitly public fields
  if (!user) {
    if (listing.status !== 'active') return Response.json({ error: 'Listing not found' }, { status: 404 });
    return Response.json({ listing: publicFields });
  }

  const isSeller = authoritativeSellerEmail === user.email;
  const isAdmin = user.role === 'admin';

  // Authenticated buyer (not seller, not admin): public + verification status
  const buyerExtra = {
    proof_status: listing.proof_status,
    transfer_confidence_score: listing.transfer_confidence_score,
    is_demo_listing: listing.is_demo_listing,
  };

  // Seller: buyer fields + own listing management (no emails exposed)
  const sellerExtra = isSeller ? {
    seats: listing.seats,
    proof_rejection_reason: listing.proof_rejection_reason,
    notes: listing.notes,
    is_reserved: !!listing.reserved_by_email,
    reservation_expires_at: listing.reservation_expires_at,
  } : {};

  // Admin: seller fields + internal linkage (no emails, tokens, or fraud data)
  const adminExtra = isAdmin ? {
    seats: listing.seats,
    seat_inventory_id: listing.seat_inventory_id,
    transfer_verified_by: listing.transfer_verified_by,
  } : {};

  return Response.json({ listing: { ...publicFields, ...buyerExtra, ...sellerExtra, ...adminExtra } });
});