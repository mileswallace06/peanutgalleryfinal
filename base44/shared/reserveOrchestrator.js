/**
 * reserveOrchestrator.js — Shared reservation creation logic.
 *
 * Used by:
 *   - base44/functions/reserveListing/entry.ts (Deno)
 *   - tests/mutation-paths.test.mjs (Node.js ESM)
 *
 * deps = { entities, now, user, isMaintenanceActive, hooks }
 * Returns: { status, body }
 */
import { getListingPrivate, upsertListingPrivate, alertPrivateWriteFailure } from './orchestratorHelpers.js';
import { isFailClosed } from './checkoutLogic.js';
import { applyReservationTuple, generateClearedRevision } from './tupleTransition.js';

const RESERVATION_MINUTES = 10;

export async function runReserveListing(deps, params) {
  const { entities, user, now, isMaintenanceActive, hooks } = deps;

  if (!user) return { status: 401, body: { error: 'Unauthorized' } };
  if (isMaintenanceActive && isMaintenanceActive()) return { status: 503, body: { error: 'Maintenance mode' } };

  const { listing_id } = params;
  if (!listing_id) return { status: 400, body: { error: 'listing_id required' } };

  const listings = await entities.Listing.filter({ id: listing_id });
  const listing = listings[0];
  if (!listing) return { status: 404, body: { error: 'Listing not found' } };

  const lp = await getListingPrivate(deps, listing.id);
  if (!lp) return { status: 500, body: { error: 'Listing integrity error: missing private record', code: 'INTEGRITY_ERROR' } };

  if (listing.status === 'sold') return { status: 409, body: { error: 'This listing has sold', code: 'SOLD' } };
  if (listing.status !== 'active') return { status: 409, body: { error: 'Listing is no longer available', code: 'UNAVAILABLE' } };
  if (lp.proof_status !== 'approved') return { status: 409, body: { error: 'Listing is not yet approved', code: 'NOT_APPROVED' } };
  if (isFailClosed(listing, lp)) return { status: 409, body: { error: 'This listing is under review. Please try another listing.', code: 'QUARANTINED' } };
  if (lp.seller_email === user.email) return { status: 400, body: { error: 'You cannot reserve your own listing', code: 'SELF_PURCHASE' } };

  const currentTime = now();
  const reservedBy = lp.reserved_by_email;
  const resExpiry = lp.reservation_expires_at;

  if (reservedBy === user.email && resExpiry && new Date(resExpiry).getTime() > currentTime) {
    return { status: 200, body: { reservation_expires_at: resExpiry, already_reserved: true } };
  }
  if (reservedBy && resExpiry && reservedBy !== user.email && new Date(resExpiry).getTime() > currentTime) {
    return { status: 409, body: { error: 'This listing is currently reserved by another buyer.', code: 'RESERVED_BY_OTHER' } };
  }

  // One-per-buyer: auto-release expired reservations on other listings
  let userReservations;
  try {
    userReservations = await entities.Listing.filter({ reserved_by_email: user.email, status: 'active' });
  } catch (err) {
    return { status: 500, body: { error: 'Failed to check existing reservations', code: 'RESERVATION_CHECK_FAILED' } };
  }
  for (const r of userReservations) {
    if (r.id === listing_id) continue;
    if (r.reservation_expires_at && new Date(r.reservation_expires_at).getTime() > currentTime) {
      return { status: 409, body: { error: 'You already have a listing reserved.', code: 'ALREADY_HAS_RESERVATION', existing_listing_id: r.id } };
    }
    // Auto-release expired — use cleared-state revision (non-null for active listing)
    const clearedRev = generateClearedRevision();
    await applyReservationTuple(deps, r.id, {
      status: 'active', token: null, buyer: null, expiration: null, revision: clearedRev,
    }, 'auto_release', `reserveListing:${listing_id}`);
  }

  // Generate reservation token, expiry, revision
  const token = (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : `tok_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  const expiresAt = new Date(currentTime + RESERVATION_MINUTES * 60 * 1000).toISOString();
  const revision = (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : `rev_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

  // Use applyReservationTuple for the dual-record write
  const tupleResult = await applyReservationTuple(deps, listing.id, {
    status: 'pending_transfer',
    token,
    buyer: user.email,
    expiration: expiresAt,
    revision,
    hidden_reason: null,
  }, 'reserve', `reserveListing:${listing.id}`);

  if (!tupleResult.ok) {
    // Check if Listing has a competing token (race lost)
    const [curListing] = await entities.Listing.filter({ id: listing.id });
    const curToken = curListing?.reservation_token ?? null;
    if (curToken && curToken !== token) {
      // Race lost — reconcile LP to Listing state using applyReservationTuple
      const competingRev = curListing?.reservation_revision ?? generateClearedRevision();
      await applyReservationTuple(deps, listing.id, {
        status: 'pending_transfer',
        token: curToken,
        buyer: curListing?.reserved_by_email ?? null,
        expiration: curListing?.reservation_expires_at ?? null,
        revision: competingRev,
      }, 'race_reconcile', `reserveListing:${listing.id}`);
      return { status: 409, body: { error: 'This listing was just reserved by another buyer. Please try another listing.', code: 'RACE_LOST' } };
    }
    // Check if Listing has our token but LP has a different buyer/expiry/revision (split-brain)
    if (curToken === token) {
      const curLP = await getListingPrivate(deps, listing.id);
      if (curLP?.reservation_token === token &&
          (curLP?.reserved_by_email !== user.email ||
           curLP?.reservation_expires_at !== expiresAt ||
           curLP?.reservation_revision !== revision)) {
        // Split-brain: Listing has our token but LP has different buyer/expiry/revision
        await alertPrivateWriteFailure(deps, { entity: 'Split-brain detected', reference_id: listing.id, reference_type: 'listing', error: new Error('Listing has token but LP has different buyer/expiry/revision') });
        return { status: 500, body: { error: 'Reservation could not be verified. Please try again.' } };
      }
    }
    await alertPrivateWriteFailure(deps, { entity: 'ReservationTuple', reference_id: listing.id, reference_type: 'listing', error: new Error(`applyReservationTuple failed: ${tupleResult.first_write_error || tupleResult.second_write_error || 'verification failed'}`) });
    return { status: 500, body: { error: 'Failed to persist reservation. Please try again.' } };
  }

  return { status: 200, body: { reservation_expires_at: expiresAt } };
}