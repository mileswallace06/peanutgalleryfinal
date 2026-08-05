/**
 * saleNotification.ts — enqueue + dispatch for the seller "sale_created" notification.
 *
 * 7C.9C: External push/email delivery DISABLED for sale_created.
 * The scheduled dispatcher now calls BOTH:
 *   1. dispatchSaleNotificationsDeps (sale_created — in-app only, no push/email)
 *   2. dispatchWebhookNotifications (webhook-originated — in-app only)
 *
 * DELIVERY-INTEGRITY MODEL (7C.9C correction 4):
 *   Base44 has no atomic claim primitive, and the current providers do not
 *   demonstrate durable idempotency for both push and email channels.
 *
 *   Therefore, EXTERNAL push and email dispatch for `sale_created` is DISABLED.
 *   - confirmCheckoutAuthorized ENQUEUES a pending in-app notification but
 *     NEVER sends external push or email.
 *   - The scheduled dispatcher canonicalizes duplicates (supersedes concurrent
 *     duplicates) and marks the canonical as 'dispatched' (in-app delivery).
 *   - seller_push_status and seller_email_status are marked 'skipped' (valid
 *     schema value) — deliberately suppressed, not failed.
 *   - No sendUserNotification call is made — provider-call counters remain zero.
 *   - We do NOT claim strict at-most-once external delivery.
 *   - We never resend after a provider succeeds merely because a later DB write
 *     fails (there are no provider calls to resend).
 *   - The durable in-app Notification record IS the delivery mechanism.
 */
import { dispatchSaleNotificationsDeps, saleIdempotencyKey, enqueueSaleNotificationDeps } from './saleDispatch.js';
import { dispatchWebhookNotifications } from './webhookNotifications.js';
import { getPurchasePrivate } from './privateData.ts';

export { saleIdempotencyKey };

/**
 * Enqueue a seller-sale notification. Creates a PENDING in-app record and
 * stamps seller_notified_at. Does NOT send push or email.
 *
 * 7C.9C correction 3: Requires exactly one PurchasePrivate. Uses pp.seller_email.
 */
export async function enqueueSaleNotification(base44, purchase, listing) {
  const deps = {
    entities: base44.asServiceRole.entities,
    now: () => Date.now(),
  };
  // Fetch the authoritative PurchasePrivate — no public fallback
  const pp = await getPurchasePrivate(base44, purchase.id);
  if (!pp) {
    throw new Error('PurchasePrivate not found — cannot enqueue sale notification');
  }
  return await enqueueSaleNotificationDeps(deps, purchase, listing, pp);
}

/**
 * The ONLY sender for sale_created AND webhook-originated notifications.
 * Scheduled every 1 minute.
 *
 * 7C.9C: External push/email is DISABLED. No sendUserNotification call.
 * The in-app Notification record IS the delivery mechanism.
 *
 * opts.keys  — restrict processing to these idempotency keys (used by tests).
 * opts.limit — max notifications scanned (default 500).
 */
export async function dispatchSaleNotifications(base44, opts = {}) {
  // ── 1. Process sale_created notifications (in-app only, no push/email) ────
  // No sendUserNotification needed — external delivery is suppressed.
  const saleDeps = {
    entities: base44.asServiceRole.entities,
    now: () => Date.now(),
  };
  const saleResult = await dispatchSaleNotificationsDeps(saleDeps, opts);

  // ── 2. Process webhook-originated notifications (in-app only) ──────────────
  const webhookDeps = {
    entities: base44.asServiceRole.entities,
  };
  const webhookResult = await dispatchWebhookNotifications(webhookDeps, opts);

  return { sale: saleResult, webhook: webhookResult };
}