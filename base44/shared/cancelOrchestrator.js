import { expirePurchaseSafely } from './purchaseExpiry.js';
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

export async function runCancelPurchase(deps, params) {
  const { entities, user, isMaintenanceActive, sendUserNotification } = deps;

  if (!user) return { status: 401, body: { error: 'Unauthorized' } };
  if (isMaintenanceActive && isMaintenanceActive()) return { status: 503, body: { error: 'Maintenance mode' } };

  const { purchase_id } = params;
  if (!purchase_id) return { status: 400, body: { error: 'purchase_id is required' } };

  const [purchase] = await entities.Purchase.filter({ id: purchase_id });
  if (!purchase) return { status: 404, body: { error: 'Purchase not found' } };

  const pp = await getPurchasePrivate(deps, purchase.id);
  const authoritativeBuyerEmail = pp?.buyer_email ?? purchase.buyer_email;
  const authoritativeSellerEmail = pp?.seller_email ?? purchase.seller_email;

  const authoritativePaymentCaptured = pp?.payment_captured ?? purchase.payment_captured;

  if (authoritativeBuyerEmail !== user.email && user.role !== 'admin') {
    return { status: 403, body: { error: 'Only the buyer can cancel a purchase' } };
  }

  if (purchase.is_demo) {
    await entities.Purchase.update(purchase.id, { transfer_status: 'expired' });
    return { status: 200, body: { status: 'cancelled' } };
  }

  const terminal = ['completed'];
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
      try { await sendUserNotification(deps, { user_email: authoritativeSellerEmail, title: 'Buyer cancelled after you confirmed', body: 'The buyer cancelled after you confirmed transfer.', type: 'listing_expired', purchase_id: purchase.id }); } catch {}
    }
    return { status: 200, body: { status: 'disputed', message: 'Dispute opened for admin review.' } };
  }

  const result = await expirePurchaseSafely(deps, purchase.id, { allowRefund: true });
  if (result.status === 200 && !result.body.already_completed && sendUserNotification) {
    try { await sendUserNotification(deps, { user_email: authoritativeSellerEmail, title: 'Purchase cancelled', body: 'Payment release was verified and your listing has been restored.', type: 'listing_expired', purchase_id: purchase.id }); } catch {}
  }
  if (result.status === 200) result.body.status = 'cancelled';
  return result;
}
