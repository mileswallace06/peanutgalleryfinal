/**
 * releaseOrchestrator.js — Shared reservation release logic.
 *
 * Used by:
 *   - base44/functions/releaseReservation/entry.ts (Deno)
 *   - tests/mutation-paths.test.mjs (Node.js ESM)
 *
 * deps = { entities, now, user, isMaintenanceActive, hooks }
 * Returns: { status, body }
 */
import { getListingPrivate, alertPrivateWriteFailure } from './orchestratorHelpers.js';
import { applyReservationTuple, generateClearedRevision } from './tupleTransition.js';

export async function runReleaseReservation(deps, params) {
  const { entities, user, now, isMaintenanceActive } = deps;

  if (!user) return { status: 401, body: { error: 'Unauthorized' } };
  if (isMaintenanceActive && isMaintenanceActive()) return { status: 503, body: { error: 'Maintenance mode' } };

  const { listing_id } = params;
  if (!listing_id) return { status: 400, body: { error: 'listing_id required' } };

  const listings = await entities.Listing.filter({ id: listing_id });
  const listing = listings[0];
  if (!listing) return { status: 404, body: { error: 'Listing not found' } };

  const lp = await getListingPrivate(deps, listing.id);
  const reservedBy = lp?.reserved_by_email ?? listing.reserved_by_email;

  if (reservedBy !== user.email && user.role !== 'admin') {
    return { status: 403, body: { error: 'Not authorized' } };
  }

  if (listing.status === 'sold') {
    return { status: 409, body: { error: 'Cannot release a sold listing' } };
  }

  const prevResToken = lp?.reservation_token ?? listing.reservation_token ?? null;
  const prevStatus = listing.status;

  // Active-lifecycle clear: use non-null cleared-state revision
  const clearedRev = generateClearedRevision();
  const intendedStatus = prevStatus === 'pending_transfer' ? 'active' : prevStatus;

  const tupleResult = await applyReservationTuple(deps, listing.id, {
    status: intendedStatus,
    token: null,
    buyer: null,
    expiration: null,
    revision: clearedRev,
    hidden_reason: null,
  }, 'release', `releaseReservation:${listing.id}`);

  if (!tupleResult.ok) {
    // Check if a new reservation appeared (superseded)
    const [curListing] = await entities.Listing.filter({ id: listing.id });
    const curToken = curListing?.reservation_token ?? null;

    if (curToken && curToken !== prevResToken) {
      // New reservation appeared — reconcile LP to Listing state
      const competingRev = curListing?.reservation_revision ?? generateClearedRevision();
      const supersedeResult = await applyReservationTuple(deps, listing.id, {
        status: curListing?.status || 'pending_transfer',
        token: curToken,
        buyer: curListing?.reserved_by_email ?? null,
        expiration: curListing?.reservation_expires_at ?? null,
        revision: competingRev,
      }, 'release_supersede', `releaseReservation:${listing.id}`);

      if (!supersedeResult.ok) {
        // Superseded reconcile failed — must NOT return normal success
        await alertPrivateWriteFailure(deps, { entity: 'ListingPrivate (superseded reconcile)', reference_id: listing.id, reference_type: 'listing', error: new Error(`supersede failed: ${supersedeResult.first_write_error || supersedeResult.second_write_error}`) });
        return { status: 500, body: { error: 'Failed to release reservation. Please try again.' } };
      }
      return { status: 200, body: { status: 'released', superseded: true } };
    }

    // Listing still holds old token — release did not take
    await alertPrivateWriteFailure(deps, { entity: 'ListingPrivate (release not applied)', reference_id: listing.id, reference_type: 'listing', error: new Error('Listing still holds the old reservation after release') });
    return { status: 500, body: { error: 'Failed to release reservation. Please try again.' } };
  }

  return { status: 200, body: { status: 'released' } };
}