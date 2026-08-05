/**
 * saleNotification.ts — enqueue + dispatch for the seller "sale_created" notification.
 *
 * 7C.9B: Extended to ALSO process webhook-originated notifications.
 * The scheduled dispatcher (dispatchSaleNotifications) now calls BOTH:
 *   1. dispatchSaleNotificationsDeps (sale_created notifications with push/email)
 *   2. dispatchWebhookNotifications (webhook-originated notifications, in-app only)
 *
 * PRODUCTION WIRING: sendUserNotification receives the REAL base44 client
 * (wrapped in a deps adapter), NOT the dependency object used by tests.
 *
 * DELIVERY-INTEGRITY MODEL (Base44 has NO atomic compare-and-set — proven):
 *   confirmCheckoutAuthorized ENQUEUES a pending notification but NEVER sends.
 *   A single scheduled dispatcher is the ONLY sender. It selects ONE canonical
 *   record per deterministic idempotency key, marks every concurrent duplicate
 *   SUPERSEDED, and sends only the canonical — and only the channels not already
 *   marked 'sent'. This holds provider calls to <=1 push and <=1 email per
 *   logical sale notification even when N concurrent confirmCheckoutAuthorized
 *   calls each win the existence-check race and create N pending records.
 *
 *   A successful channel (status 'sent' or 'skipped') is never re-sent, so
 *   concurrent dispatches do not KNOWINGLY send the same successful channel twice.
 *   Failed channels remain independently retryable on the next run.
 *
 *   NEVER mark a notification fully dispatched when a provider failed — set
 *   dispatch_status back to 'pending' so the next run retries failed channels.
 */
import { sendUserNotification } from './notifications.ts';
import { dispatchSaleNotificationsDeps, saleIdempotencyKey, enqueueSaleNotificationDeps } from './saleDispatch.js';
import { dispatchWebhookNotifications } from './webhookNotifications.js';

export { saleIdempotencyKey };

/**
 * Enqueue a seller-sale notification. Creates a PENDING record and stamps
 * seller_notified_at. Does NOT send push or email.
 */
export async function enqueueSaleNotification(base44, purchase, listing, opts = {}) {
  const deps = {
    entities: base44.asServiceRole.entities,
    now: () => Date.now(),
  };
  return await enqueueSaleNotificationDeps(deps, purchase, listing, opts);
}

/**
 * The ONLY sender for sale_created AND webhook-originated notifications.
 * Scheduled every 1 minute.
 *
 * opts.keys  — restrict processing to these idempotency keys (used by tests).
 * opts.limit — max notifications scanned (default 500).
 */
export async function dispatchSaleNotifications(base44, opts = {}) {
  // ── 1. Process sale_created notifications (with external push/email) ──────
  // Pass the REAL base44 client to sendUserNotification via a wrapper.
  const saleDeps = {
    entities: base44.asServiceRole.entities,
    sendUserNotification: (notifOpts) => sendUserNotification(base44, notifOpts),
    now: () => Date.now(),
  };
  const saleResult = await dispatchSaleNotificationsDeps(saleDeps, opts);

  // ── 2. Process webhook-originated notifications (in-app only, no push/email) ──
  // External push/email is DISABLED for webhook-originated notifications.
  // The durable in-app Notification record IS the delivery mechanism.
  const webhookDeps = {
    entities: base44.asServiceRole.entities,
  };
  const webhookResult = await dispatchWebhookNotifications(webhookDeps, opts);

  return { sale: saleResult, webhook: webhookResult };
}