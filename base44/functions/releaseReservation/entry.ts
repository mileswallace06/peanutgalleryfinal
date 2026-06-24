import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { listing_id } = await req.json().catch(() => ({}));
    if (!listing_id) return Response.json({ error: 'listing_id required' }, { status: 400 });

    const listings = await base44.asServiceRole.entities.Listing.filter({ id: listing_id });
    const listing = listings[0];
    if (!listing) return Response.json({ error: 'Listing not found' }, { status: 404 });

  // Only the reserver or admin can release
  if (listing.reserved_by_email !== user.email && user.role !== 'admin') {
    return Response.json({ error: 'Not authorized' }, { status: 403 });
  }

  // Never release a sold listing
  if (listing.status === 'sold') {
    return Response.json({ error: 'Cannot release a sold listing' }, { status: 409 });
  }

  // Clear reservation fields. If pending_transfer (payment was started), restore to active.
  const update = {
    reserved_by_email: null,
    reservation_token: null,
    reservation_expires_at: null,
  };
  if (listing.status === 'pending_transfer') {
    update.status = 'active';
  }

    await base44.asServiceRole.entities.Listing.update(listing.id, update);

    return Response.json({ status: 'released' });
  } catch (error) {
    console.error('[releaseReservation] error:', error?.message);
    return Response.json({ error: error?.message || 'Internal server error' }, { status: 500 });
  }
});