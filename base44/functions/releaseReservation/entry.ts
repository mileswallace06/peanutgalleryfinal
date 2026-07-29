import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';
import { isMaintenanceActive, maintenance503 } from '../../shared/maintenance.ts';
import { upsertListingPrivate, getListingPrivate, alertPrivateWriteFailure } from '../../shared/privateData.ts';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { listing_id } = await req.json().catch(() => ({}));
    if (!listing_id) return Response.json({ error: 'listing_id required' }, { status: 400 });

    // Phase 0 maintenance gate — fail-closed for all callers
    if (isMaintenanceActive()) return maintenance503('Reservation release is temporarily unavailable for scheduled maintenance.');

    const listings = await base44.asServiceRole.entities.Listing.filter({ id: listing_id });
    const listing = listings[0];
    if (!listing) return Response.json({ error: 'Listing not found' }, { status: 404 });

    // Phase 1B: read reservation ownership from ListingPrivate first (legacy fallback)
    const lp = await getListingPrivate(base44, listing.id);
    const reservedBy = lp?.reserved_by_email ?? listing.reserved_by_email;

  // Only the reserver or admin can release
  if (reservedBy !== user.email && user.role !== 'admin') {
    return Response.json({ error: 'Not authorized' }, { status: 403 });
  }

  // Never release a sold listing
  if (listing.status === 'sold') {
    return Response.json({ error: 'Cannot release a sold listing' }, { status: 409 });
  }

  // Capture exact previous reservation values for compensation
  const prevReservedBy = reservedBy ?? null;
  const prevResToken = lp?.reservation_token ?? listing.reservation_token ?? null;
  const prevResExpiry = lp?.reservation_expires_at ?? listing.reservation_expires_at ?? null;
  const prevStatus = listing.status;

  // Clear reservation fields. If pending_transfer (payment was started), restore to active.
  const legacyUpdate = {
    reserved_by_email: null,
    reservation_token: null,
    reservation_expires_at: null,
  };
  if (prevStatus === 'pending_transfer') {
    legacyUpdate.status = 'active';
  }

    // Write authoritative ListingPrivate FIRST, then legacy Listing mirror
    try {
      await upsertListingPrivate(base44, listing.id, {
        reserved_by_email: null,
        reservation_token: null,
        reservation_expires_at: null,
      });
    } catch (err) {
      // Authoritative private write failed — legacy not yet updated; alert + 500
      await alertPrivateWriteFailure(base44, { entity: 'ListingPrivate', reference_id: listing.id, reference_type: 'listing', error: err });
      return Response.json({ error: 'Failed to release reservation. Please try again.' }, { status: 500 });
    }
    try {
      await base44.asServiceRole.entities.Listing.update(listing.id, legacyUpdate);
    } catch (err) {
      // Legacy mirror failed — restore authoritative ListingPrivate to exact previous values
      try {
        await upsertListingPrivate(base44, listing.id, {
          reserved_by_email: prevReservedBy, reservation_token: prevResToken, reservation_expires_at: prevResExpiry,
        });
      } catch (_) {}
      await alertPrivateWriteFailure(base44, { entity: 'Listing (legacy mirror)', reference_id: listing.id, reference_type: 'listing', error: err });
      return Response.json({ error: 'Failed to release reservation. Please try again.' }, { status: 500 });
    }

    // Verify private and legacy records match (both cleared)
    const [verifyListing] = await base44.asServiceRole.entities.Listing.filter({ id: listing.id });
    const verifyLp = await getListingPrivate(base44, listing.id);
    const legacyCleared = !verifyListing?.reserved_by_email && !verifyListing?.reservation_token;
    const privateCleared = !verifyLp?.reserved_by_email && !verifyLp?.reservation_token;
    if (!legacyCleared || !privateCleared) {
      // Records diverged — restore exact previous values on both, alert, 500
      await base44.asServiceRole.entities.Listing.update(listing.id, {
        status: prevStatus,
        reserved_by_email: prevReservedBy, reservation_token: prevResToken, reservation_expires_at: prevResExpiry,
      }).catch(() => {});
      await upsertListingPrivate(base44, listing.id, {
        reserved_by_email: prevReservedBy, reservation_token: prevResToken, reservation_expires_at: prevResExpiry,
      }).catch(() => {});
      await alertPrivateWriteFailure(base44, { entity: 'ListingPrivate (divergence)', reference_id: listing.id, reference_type: 'listing', error: new Error('private and legacy release records diverged after write') });
      return Response.json({ error: 'Reservation release could not be verified. Please try again.' }, { status: 500 });
    }

    return Response.json({ status: 'released' });
  } catch (error) {
    console.error('[releaseReservation] error:', error?.message);
    return Response.json({ error: error?.message || 'Internal server error' }, { status: 500 });
  }
});