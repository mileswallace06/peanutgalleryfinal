/**
 * saleNotification.ts — enqueue + dispatch for the seller "sale_created" notification.
 *
 * DELIVERY-INTEGRITY MODEL (Base44 has NO atomic compare-and-set — proven):
 *   confirmCheckoutAuthorized ENQUEUES a pending notification but NEVER sends.
 *   A single scheduled dispatcher (dispatchSaleNotifications, every 1 min) is the
 *   ONLY sender. It selects ONE canonical record per deterministic idempotency key
 *   (sale_created:<purchase_id>), marks every concurrent duplicate SUPERSEDED
 *   (superseded records never dispatch), and sends only the canonical — and only
 *   the channels not already marked 'sent'. This holds provider calls to <=1 push
 *   and <=1 email per logical sale notification even when N concurrent
 *   confirmCheckoutAuthorized calls each win the existence-check race and create
 *   N pending records. Reconciliation can dedupe DB records but cannot un-send a
 *   push/email already delivered to the provider, so delivery is WITHHELD until
 *   canonical selection.
 *
 * The claim (dispatch_status -> 'dispatching') is best-effort and non-atomic on
 * this platform; the only concurrency is overlapping scheduled runs (rare, since
 * one run completes in seconds and the cadence is 1 min). A successful channel
 * (status 'sent' or 'skipped') is never re-sent, so concurrent dispatches do not
 * KNOWINGLY send the same successful channel twice. Failed channels remain
 * independently retryable on the next run.
 */
import { sendUserNotification } from './notifications.ts';

export function saleIdempotencyKey(purchaseId) {
  return `sale_created:${purchaseId}`;
}

/**
 * Enqueue a seller-sale notification. Creates a PENDING record and stamps
 * seller_notified_at. Does NOT send push or email. Safe to call concurrently —
 * duplicate pending records are later canonicalized by dispatchSaleNotifications.
 */
export async function enqueueSaleNotification(base44, purchase, listing, opts = {}) {
  const key = opts.idempotency_key || saleIdempotencyKey(purchase.id);
  const title = '🎉 Your ticket sold!';
  const body = `Tap to transfer your tickets and receive payment. Sec ${listing?.section || ''}, Row ${listing?.row || ''}.`;
  await base44.asServiceRole.entities.Notification.create({
    user_email: purchase.seller_email,
    type: 'sale_created',
    title,
    body,
    read: false,
    reference_type: 'purchase',
    reference_id: purchase.id,
    action_url: `/purchase/${purchase.id}`,
    icon: '🎟️',
    idempotency_key: key,
    dispatch_status: 'pending',
  });
  // Idempotent marker: the durable record exists. (Dispatch happens later.)
  await base44.asServiceRole.entities.Purchase.update(purchase.id, {
    seller_notified_at: new Date().toISOString(),
  }).catch(() => {});
  return { enqueued: true, idempotency_key: key };
}

/**
 * The ONLY sender for sale_created notifications. Selects one canonical record
 * per idempotency key, supersedes the rest, and dispatches unsent channels.
 *
 * opts.keys  — restrict processing to these idempotency keys (used by tests to
 *              isolate test records from the production scheduler).
 * opts.limit — max notifications scanned (default 500).
 */
export async function dispatchSaleNotifications(base44, opts = {}) {
  const { keys = null, limit = 500 } = opts;

  const all = await base44.asServiceRole.entities.Notification.filter(
    { type: 'sale_created' }, '-created_date', limit
  ).catch(() => []);

  // Group by idempotency_key (fallback to reference_id then id), excluding superseded.
  const groups = {};
  for (const n of all) {
    if (n.dispatch_status === 'superseded') continue;
    const k = n.idempotency_key || n.reference_id || n.id;
    (groups[k] ||= []).push(n);
  }

  // Production: ignore test-prefixed keys so the scheduler never dispatches
  // transient test records. Tests pass opts.keys to process only their own key.
  const targetKeys = keys
    ? keys
    : Object.keys(groups).filter((k) => !k.startsWith('test:'));

  const summary = {
    keys_processed: 0,
    superseded: 0,
    dispatched: 0,
    skipped: 0,
    push_sends: 0,
    email_sends: 0,
  };

  for (const key of targetKeys) {
    const group = groups[key];
    if (!group || group.length === 0) continue;

    // canonical = oldest non-superseded record
    const sorted = group.sort(
      (a, b) => new Date(a.created_date || 0).getTime() - new Date(b.created_date || 0).getTime()
    );
    const canonical = sorted[0];
    const dups = sorted.slice(1);

    // Mark every concurrent duplicate SUPERSEDED — they must never dispatch.
    for (const d of dups) {
      if (d.dispatch_status !== 'superseded') {
        await base44.asServiceRole.entities.Notification.update(d.id, {
          dispatch_status: 'superseded',
        }).catch(() => {});
        summary.superseded++;
      }
    }

    // A canonical already in-flight is left for its owning run (or the reconciler
    // unsticks a crashed 'dispatching' after 5 min). Do not double-send.
    if (canonical.dispatch_status === 'dispatching') {
      summary.skipped++;
      continue;
    }

    const [purchase] = await base44.asServiceRole.entities.Purchase.filter({
      id: canonical.reference_id,
    }).catch(() => []);
    if (!purchase) {
      // Orphan (purchase deleted) — supersede so we stop retrying.
      await base44.asServiceRole.entities.Notification.update(canonical.id, {
        dispatch_status: 'superseded',
      }).catch(() => {});
      summary.superseded++;
      continue;
    }

    const pushDone = purchase.seller_push_status === 'sent' || purchase.seller_push_status === 'skipped';
    const emailDone = purchase.seller_email_status === 'sent' || purchase.seller_email_status === 'skipped';
    const needPush = !pushDone;
    const needEmail = !emailDone;

    if (!needPush && !needEmail) {
      if (canonical.dispatch_status !== 'dispatched') {
        await base44.asServiceRole.entities.Notification.update(canonical.id, {
          dispatch_status: 'dispatched',
        }).catch(() => {});
      }
      summary.skipped++;
      continue;
    }

    // Claim (best-effort, non-atomic) before sending.
    await base44.asServiceRole.entities.Notification.update(canonical.id, {
      dispatch_status: 'dispatching',
    }).catch(() => {});

    const dispatch = await sendUserNotification(base44, {
      user_email: purchase.seller_email,
      title: canonical.title,
      body: canonical.body,
      type: 'sale_created',
      purchase_id: purchase.id,
      sendPush: needPush,
      sendEmail: needEmail,
    }).catch(() => ({}));

    const upd = {};
    if (needPush) {
      const sent = dispatch?.push?.sent === true;
      upd.seller_push_status = sent ? 'sent' : 'failed';
      if (sent) summary.push_sends++;
    }
    if (needEmail) {
      const sent = dispatch?.email?.sent === true;
      upd.seller_email_status = sent ? 'sent' : 'failed';
      if (sent) summary.email_sends++;
    }
    if (Object.keys(upd).length) {
      await base44.asServiceRole.entities.Purchase.update(purchase.id, upd).catch(() => {});
    }

    await base44.asServiceRole.entities.Notification.update(canonical.id, {
      dispatch_status: 'dispatched',
    }).catch(() => {});

    summary.dispatched++;
    summary.keys_processed++;
  }

  return summary;
}