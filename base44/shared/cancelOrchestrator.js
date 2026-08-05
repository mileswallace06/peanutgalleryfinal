/**
 * cancelOrchestrator.js — Shared purchase cancellation logic.
 *
 * Used by:
 *   - base44/functions/cancelPurchase/entry.ts (Deno)
 *   - tests/mutation-paths.test.mjs (Node.js ESM)
 *
 * deps = { entities, stripe, now, user, isMaintenanceActive, hooks, sendUserNotification }
 * Returns: { status, body }
 */
import { getPurchasePrivate, upsertPurchasePrivate, alertPrivateWriteFailure } from './orchestratorHelpers.js';
import { applyReservationTuple, generateClearedRevision } from './tupleTransition.js';

export async function runCancelPurchase(deps, params) {
  const { entities, stripe, user, isMaintenanceActive, sendUserNotification } = deps;

  if (!user) return { status: 401, body: { error: 'Unauthorized' } };
  if (isMaintenanceActive && isMaintenanceActive()) return { status: 503, body: { error: 'Maintenance mode' } };

  const { purchase_id } = params;
  if (!purchase_id) return { status: 400, body: { error: 'purchase_id is required' } };

  const [purchase] = await entities.Purchase.filter({ id: purchase_id });
  if (!purchase) return { status: 404, body: { error: 'Purchase not found' } };

  const pp = await getPurchasePrivate(deps, purchase.id);
  const authoritativeBuyerEmail = pp?.buyer_email ?? purchase.buyer_email;
  const authoritativeSellerEmail = pp?.seller_email ?? purchase.seller_email;
  const authoritativePaymentIntentId = pp?.payment_intent_id ?? purchase.payment_intent_id;
  const authoritativePaymentCaptured = pp?.payment_captured ?? purchase.payment_captured;

  if (authoritativeBuyerEmail !== user.email && user.role !== 'admin') {
    return { status: 403, body: { error: 'Only the buyer can cancel a purchase' } };
  }

  if (purchase.is_demo) {
    await entities.Purchase.update(purchase.id, { transfer_status: 'expired' });
    return { status: 200, body: { status: 'cancelled' } };
  }

  const terminal = ['completed', 'expired'];
  if (terminal.includes(purchase.transfer_status)) {
    return { status: 409, body: { error: `Cannot cancel a ${purchase.transfer_status} purchase` } };
  }
  if (authoritativePaymentCaptured) {
    return { status: 409, body: { error: 'Payment already captured' } };
  }

  // If seller confirmed, open dispute instead
  if (purchase.seller_confirmed) {
    const disputeReason = 'Buyer cancelled after seller confirmed transfer';
    await entities.Purchase.update(purchase.id, { transfer_status: 'disputed', dispute_reason: disputeReason });
    try {
      await upsertPurchasePrivate(deps, purchase.id, { dispute_reason: disputeReason });
    } catch (err) {
      await alertPrivateWriteFailure(deps, { entity: 'PurchasePrivate', reference_id: purchase.id, reference_type: 'purchase', error: err });
      return { status: 500, body: { error: 'Failed to record dispute. Please try again.' } };
    }
    if (sendUserNotification) {
      try { await sendUserNotification(deps, { user_email: authoritativeSellerEmail, title: 'Buyer cancelled after you confirmed', body: 'The buyer cancelled after you confirmed transfer.', type: 'listing_expired', purchase_id: purchase.id }); } catch (_) {}
    }
    return { status: 200, body: { status: 'disputed', message: 'Dispute opened for admin review.' } };
  }

  // Safe cancellation — refund/cancel PI
  if (stripe && authoritativePaymentIntentId) {
    try {
      const pi = await stripe.paymentIntents.retrieve(authoritativePaymentIntentId);
      if (pi.status === 'requires_capture') {
        await stripe.paymentIntents.cancel(authoritativePaymentIntentId);
      } else if (pi.status === 'succeeded') {
        await stripe.refunds.create({ payment_intent: authoritativePaymentIntentId });
      }
    } catch (err) { /* PI operation failed */ }
  }

  // Expire Purchase — must be proven
  try {
    await entities.Purchase.update(purchase.id, { transfer_status: 'expired' });
  } catch (err) {
    await alertPrivateWriteFailure(deps, { entity: 'Purchase', reference_id: purchase.id, reference_type: 'purchase', error: err });
    return { status: 500, body: { error: 'Failed to cancel purchase. Please contact support.' } };
  }

  // Verify Purchase expired
  const [verifyPurchase] = await entities.Purchase.filter({ id: purchase.id });
  if (!verifyPurchase || verifyPurchase.transfer_status !== 'expired') {
    return { status: 500, body: { error: 'Purchase cancellation could not be verified.' } };
  }

  // Restore listing if pending_transfer
  const [currentListing] = await entities.Listing.filter({ id: purchase.listing_id });
  if (currentListing && currentListing.status === 'pending_transfer') {
    // Active-lifecycle clear: use non-null cleared-state revision
    const clearedRev = generateClearedRevision();
    const tupleResult = await applyReservationTuple(deps, purchase.listing_id, {
      status: 'active',
      token: null,
      buyer: null,
      expiration: null,
      revision: clearedRev,
      hidden_reason: null,
    }, 'cancel', `cancelPurchase:${purchase.id}`);

    if (!tupleResult.ok) {
      await alertPrivateWriteFailure(deps, { entity: 'Listing (cancel clear)', reference_id: purchase.listing_id, reference_type: 'listing', error: new Error(`cancel clear failed: ${tupleResult.first_write_error || tupleResult.second_write_error}`) });
      return { status: 500, body: { error: 'Failed to restore listing. Please contact support.' } };
    }
  }

  if (sendUserNotification) {
    try { await sendUserNotification(deps, { user_email: authoritativeSellerEmail, title: 'Purchase cancelled', body: 'The buyer cancelled their purchase. Your listing has been restored.', type: 'listing_expired', purchase_id: purchase.id }); } catch (_) {}
  }

  return { status: 200, body: { status: 'cancelled' } };
}