/**
 * getListingParticipantView — return an allowlisted listing view for the
 * calling participant (buyer / seller / admin). Sensitive internals are only
 * included for admins; reservation token is never exposed to non-admins.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  let user;
  try { user = await base44.auth.me(); } catch (_) { return Response.json({ error: 'Unauthorized' }, { status: 401 }); }
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const listing_id = body?.listing_id;
  if (!listing_id) return Response.json({ error: 'listing_id required' }, { status: 400 });

  const rows = await base44.asServiceRole.entities.Listing.filter({ id: listing_id });
  const listing = rows[0];
  if (!listing) return Response.json({ error: 'Listing not found' }, { status: 404 });

  const isSeller = listing.seller_email === user.email;
  const isAdmin = user.role === 'admin';

  const base = {
    id: listing.id, event_id: listing.event_id, section: listing.section, row: listing.row,
    seats: listing.seats, quantity: listing.quantity, tier: listing.tier,
    asking_price: listing.asking_price, original_price: listing.original_price,
    transfer_method: listing.transfer_method, status: listing.status,
    listing_mode: listing.listing_mode, listing_type: listing.listing_type,
    transfer_status: listing.transfer_status, transfer_confidence_score: listing.transfer_confidence_score,
    proof_status: listing.proof_status, is_demo_listing: listing.is_demo_listing,
    listing_transfer_mode: listing.listing_transfer_mode,
  };
  const sellerExtra = isSeller ? {
    reserved_by_email: listing.reserved_by_email,
    reservation_expires_at: listing.reservation_expires_at,
    proof_rejection_reason: listing.proof_rejection_reason,
    notes: listing.notes,
  } : {};
  const adminExtra = isAdmin ? {
    seller_email: listing.seller_email,
    reservation_token: listing.reservation_token,
    seat_inventory_id: listing.seat_inventory_id,
    transfer_verified_by: listing.transfer_verified_by,
  } : {};

  return Response.json({ listing: { ...base, ...sellerExtra, ...adminExtra } });
});