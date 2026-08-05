/**
 * abortOrchestrator.js — Shared abort checkout logic.
 *
 * Used by:
 *   - base44/functions/abortCheckout/entry.ts (Deno)
 *   - tests/mutation-paths.test.mjs (Node.js ESM)
 *
 * deps = { entities, stripe, now, user, isMaintenanceActive, hooks }
 * Returns: { status, body }
 */
import { getPurchasePrivate, getListingPrivate, alertPrivateWriteFailure } from './orchestratorHelpers.js';
import { applyReservationTuple, generateClearedRevision } from './tupleTransition.js';

const CANCELLABLE_STATUSES = ['requires_payment_method', 'requires_confirmation', 'requires_action', 'processing', 'requires_capture'];

export async function runAbortCheckout(deps, params) {
  const { entities, stripe, user, isMaintenanceActive } = deps;

  if (!user) return { status: 401, body: { error: 'Unauthorized' } };
  if (isMaintenanceActive && isMaintenanceActive()) return { status: 503, body: { error: 'Maintenance mode' } };

  const { purchase_id } = params;
  if (!purchase_id) return { status: 400, body: { error: 'purchase_id is required' } };

  const [purchase] = await entities.Purchase.filter({ id: purchase_id });
  if (!purchase) return { status: 404, body: { error: 'Purchase not found' } };

  const pp = await getPurchasePrivate(deps, purchase.id);
  const authoritativeBuyerEmail = pp?.buyer_email ?? purchase.buyer_email;
  const authoritativePaymentIntentId = pp?.payment_intent_id ?? purchase.payment_intent_id;
  const authoritativePaymentCaptured = pp?.payment_captured ?? purchase.payment_captured;

  if (authoritativeBuyerEmail !== user.email && user.role !== 'admin') {
    return { status: 403, body: { error: 'Not authorized' } };
  }

  if (purchase.transfer_status === 'expired') return { status: 200, body: { status: 'already_expired' } };
  if (purchase.transfer_status === 'disputed') return { status: 200, body: { status: 'already_disputed' } };
  if (authoritativePaymentCaptured || purchase.transfer_status === 'completed') {
    return { status: 409, body: { error: 'Cannot abort a completed purchase' } };
  }
  if (purchase.is_demo) return { status: 409, body: { error: 'Cannot abort a demo purchase' } };

  // Cancel PI
  let piStatus = null;
  if (authoritativePaymentIntentId && stripe) {
    try {
      const pi = await stripe.paymentIntents.retrieve(authoritativePaymentIntentId);
      piStatus = pi.status;
      if (CANCELLABLE_STATUSES.includes(pi.status)) {
        try { await stripe.paymentIntents.cancel(authoritativePaymentIntentId); } catch (e) { /* already canceled */ }
      }
    } catch (err) { /* PI retrieve failed */ }
  }

  // Expire Purchase — must be proven
  try {
    await entities.Purchase.update(purchase.id, { transfer_status: 'expired' });
  } catch (err) {
    await alertPrivateWriteFailure(deps, { entity: 'Purchase', reference_id: purchase.id, reference_type: 'purchase', error: err });
    return { status: 500, body: { error: 'Failed to expire purchase. Please contact support.' } };
  }

  // Verify Purchase expired
  const [verifyPurchase] = await entities.Purchase.filter({ id: purchase.id });
  if (!verifyPurchase || verifyPurchase.transfer_status !== 'expired') {
    return { status: 500, body: { error: 'Purchase expiry could not be verified.' } };
  }

  // Release listing if it belongs to this purchase
  const [listing] = await entities.Listing.filter({ id: purchase.listing_id });
  const lp = listing ? await getListingPrivate(deps, listing.id) : null;
  const authoritativeReservedBy = lp?.reserved_by_email ?? listing?.reserved_by_email;
  const authoritativeResToken = lp?.reservation_token ?? listing?.reservation_token;
  const ownsByBuyer = authoritativeReservedBy === authoritativeBuyerEmail;
  const ownsByToken = !!(purchase.reservation_token && authoritativeResToken === purchase.reservation_token);

  if (listing && listing.status === 'pending_transfer' && (ownsByBuyer || ownsByToken)) {
    // Active-lifecycle clear: use non-null cleared-state revision
    const clearedRev = generateClearedRevision();
    const tupleResult = await applyReservationTuple(deps, listing.id, {
      status: 'active',
      token: null,
      buyer: null,
      expiration: null,
      revision: clearedRev,
      hidden_reason: null,
    }, 'abort', `abortCheckout:${purchase.id}`);

    if (!tupleResult.ok) {
      // LP cleared but Listing failed — durably block or quarantine
      await alertPrivateWriteFailure(deps, { entity: 'Listing (abort clear)', reference_id: listing.id, reference_type: 'listing', error: new Error(`abort clear failed: ${tupleResult.first_write_error || tupleResult.second_write_error}`) });
      return { status: 500, body: { error: 'Failed to release listing reservation. Please try again.' } };
    }
  }

  return { status: 200, body: { status: 'expired', pi_status: piStatus } };
}