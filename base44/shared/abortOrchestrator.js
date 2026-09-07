import { expirePurchaseSafely } from './purchaseExpiry.js';
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
import { getPurchasePrivate } from './orchestratorHelpers.js';


export async function runAbortCheckout(deps, params) {
  const { entities, user, isMaintenanceActive } = deps;

  if (!user) return { status: 401, body: { error: 'Unauthorized' } };
  if (isMaintenanceActive && isMaintenanceActive()) return { status: 503, body: { error: 'Maintenance mode' } };

  const { purchase_id } = params;
  if (!purchase_id) return { status: 400, body: { error: 'purchase_id is required' } };

  const [purchase] = await entities.Purchase.filter({ id: purchase_id });
  if (!purchase) return { status: 404, body: { error: 'Purchase not found' } };

  const pp = await getPurchasePrivate(deps, purchase.id);
  const authoritativeBuyerEmail = pp?.buyer_email ?? purchase.buyer_email;

  const authoritativePaymentCaptured = pp?.payment_captured ?? purchase.payment_captured;

  if (authoritativeBuyerEmail !== user.email && user.role !== 'admin') {
    return { status: 403, body: { error: 'Not authorized' } };
  }

  if (purchase.transfer_status === 'expired' && pp?.cleanup_completed_at) return { status: 200, body: { status: 'already_expired' } };
  if (purchase.transfer_status === 'disputed') return { status: 200, body: { status: 'already_disputed' } };
  if (authoritativePaymentCaptured || purchase.transfer_status === 'completed') {
    return { status: 409, body: { error: 'Cannot abort a completed purchase' } };
  }
  if (purchase.is_demo) return { status: 409, body: { error: 'Cannot abort a demo purchase' } };

  const result = await expirePurchaseSafely(deps, purchase.id, { allowRefund: false });
  return result;
}
