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
import { getListingPrivate } from './orchestratorHelpers.js';
import { assertNoPurchaseForReservation } from './purchaseExpiry.js';
import { requireMission1Authority, hashReservationToken } from './mission1Authority.js';

export async function runReleaseReservation(deps, params) {
  const { entities, user, isMaintenanceActive } = deps;

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

  try { await assertNoPurchaseForReservation(entities, listing); }
  catch (err) { return { status: 409, body: { error: err.message, code: 'PAYMENT_RELEASE_REQUIRED' } }; }
  try {
    const authority = requireMission1Authority(deps);
    const state = await authority.getState(listing.id);
    // The stored function locks the SAME authority row used by beginCheckout
    // and bindPaymentIntent, then checks durable intent/bindings transactionally.
    const hash = await hashReservationToken(listing.reservation_token || '');
    const buyerId = user.role === 'admin' ? state.buyer_user_id : user.id;
    const released = await authority.releaseReservation(listing.id, state.version, `m1-unpaid:${listing.id}:${hash}`,
      buyerId, hash);
    // Ordered mirror projection is a deployment dependency; do not report a
    // public reservation released until that worker supplies a verified receipt.
    if (!deps.projectReservationRelease) return { status: 503, body: { code: 'ORDERED_PROJECTION_REQUIRED' } };
    const receipt = await deps.projectReservationRelease(listing, released.context);
    if (receipt?.verified !== true || receipt.operation_id !== released.context.operation_id ||
        receipt.version !== released.context.authority_version) throw new Error('PROJECTION_UNVERIFIED');
    if ((await authority.operationContext(receipt.operation_id)).context?.phase !== 'completed') {
      await authority.acknowledgeOperation(receipt.operation_id, receipt.version);
    }
  } catch (error) {
    return { status: 409, body: { code: error.message, error: 'Reservation release requires authority reconciliation.' } };
  }

  return { status: 200, body: { status: 'released' } };
}
