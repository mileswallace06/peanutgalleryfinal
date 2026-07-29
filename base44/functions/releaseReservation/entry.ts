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

  // Capture previous token to distinguish old vs new during verify
  const prevResToken = lp?.reservation_token ?? listing.reservation_token ?? null;
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
      // Legacy mirror failed — reconcile ListingPrivate to current Listing state (never restore old blindly)
      const [failListing] = await base44.asServiceRole.entities.Listing.filter({ id: listing.id });
      try {
        await upsertListingPrivate(base44, listing.id, {
          reserved_by_email: failListing?.reserved_by_email ?? null,
          reservation_token: failListing?.reservation_token ?? null,
          reservation_expires_at: failListing?.reservation_expires_at ?? null,
        });
      } catch (_) {}
      await alertPrivateWriteFailure(base44, { entity: 'Listing (legacy mirror)', reference_id: listing.id, reference_type: 'listing', error: err });
      return Response.json({ error: 'Failed to release reservation. Please try again.' }, { status: 500 });
    }

    // ── Verify: re-fetch current Listing (source of truth) ──────────────────
    // If a new reservation token appeared while release was finishing, preserve it.
    const [curListing] = await base44.asServiceRole.entities.Listing.filter({ id: listing.id });
    const curToken = curListing?.reservation_token ?? null;

    if (!curToken) {
      // Listing is cleared — reconcile ListingPrivate to cleared, return success
      const curLp = await getListingPrivate(base44, listing.id);
      if (curLp?.reservation_token) {
        try {
          await upsertListingPrivate(base44, listing.id, {
            reserved_by_email: null, reservation_token: null, reservation_expires_at: null,
          });
        } catch (_) {}
      }
      return Response.json({ status: 'released' });
    }

    if (curToken !== prevResToken) {
      // A new reservation appeared while release was finishing — preserve it.
      // Reconcile ListingPrivate to the current winning Listing state.
      try {
        await upsertListingPrivate(base44, listing.id, {
          reserved_by_email: curListing.reserved_by_email ?? null,
          reservation_token: curToken,
          reservation_expires_at: curListing.reservation_expires_at ?? null,
        });
      } catch (_) {}
      return Response.json({ status: 'released', superseded: true });
    }

    // Listing still holds the old token — our release did not take.
    // Reconcile ListingPrivate to the current Listing state, alert, return 500.
    try {
      await upsertListingPrivate(base44, listing.id, {
        reserved_by_email: curListing?.reserved_by_email ?? null,
        reservation_token: curToken,
        reservation_expires_at: curListing?.reservation_expires_at ?? null,
      });
    } catch (_) {}
    await alertPrivateWriteFailure(base44, { entity: 'ListingPrivate (release not applied)', reference_id: listing.id, reference_type: 'listing', error: new Error('Listing still holds the old reservation after release') });
    return Response.json({ error: 'Failed to release reservation. Please try again.' }, { status: 500 });
  } catch (error) {
    console.error('[releaseReservation] error:', error?.message);
    return Response.json({ error: error?.message || 'Internal server error' }, { status: 500 });
  }
});