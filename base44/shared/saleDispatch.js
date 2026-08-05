/**
 * saleDispatch.js — Shared sale notification dispatch logic (deps-based).
 *
 * Extracted from saleNotification.ts so it can be imported and tested directly
 * in Node.js. The production saleNotification.ts wraps this with Deno-specific
 * deps (real base44 client, real sendUserNotification).
 *
 * KEY PRINCIPLES:
 *   1. Pass the real base44-compatible sendUserNotification via deps — NOT the
 *      deps object itself. The caller wraps it: deps.sendUserNotification = (opts) => sendUserNotification(base44, opts)
 *   2. Preserve independent push/email delivery states.
 *   3. NEVER mark a notification fully dispatched when a provider failed —
 *      set dispatch_status back to 'pending' so the next run retries failed channels.
 *   4. Do NOT swallow dispatch-state writes.
 */
import { getPurchasePrivate, upsertPurchasePrivate } from './orchestratorHelpers.js';

export function saleIdempotencyKey(purchaseId) {
  return `sale_created:${purchaseId}`;
}

export async function enqueueSaleNotificationDeps(deps, purchase, listing, opts = {}) {
  const key = opts.idempotency_key || saleIdempotencyKey(purchase.id);
  const title = '🎉 Your ticket sold!';
  const body = `Tap to transfer your tickets and receive payment. Sec ${listing?.section || ''}, Row ${listing?.row || ''}.`;
  const sellerEmail = purchase.seller_email;

  // Best-effort dedup (NOT atomic)
  const existing = await deps.entities.Notification.filter({ idempotency_key: key }).catch(() => []);
  if (existing.length > 0) return { enqueued: false, reason: 'duplicate', idempotency_key: key };

  await deps.entities.Notification.create({
    user_email: sellerEmail,
    type: 'sale_created',
    title, body,
    read: false,
    reference_type: 'purchase',
    reference_id: purchase.id,
    action_url: `/purchase/${purchase.id}`,
    icon: '🎟️',
    idempotency_key: key,
    dispatch_status: 'pending',
  });

  const notifiedAt = new Date(deps.now()).toISOString();
  try {
    await deps.entities.Purchase.update(purchase.id, { seller_notified_at: notifiedAt });
  } catch (err) { /* best-effort marker */ }
  try {
    await upsertPurchasePrivate(deps, purchase.id, { seller_notified_at: notifiedAt });
  } catch (err) { /* best-effort marker */ }

  return { enqueued: true, idempotency_key: key };
}

export async function dispatchSaleNotificationsDeps(deps, opts = {}) {
  const { keys = null, limit = 500 } = opts;

  const all = await deps.entities.Notification.filter({ type: 'sale_created' }, '-created_date', limit).catch(() => []);

  const groups = {};
  for (const n of all) {
    if (n.dispatch_status === 'superseded') continue;
    const k = n.idempotency_key || n.reference_id || n.id;
    (groups[k] ||= []).push(n);
  }

  const targetKeys = keys ? keys : Object.keys(groups).filter(k => !k.startsWith('test:'));

  const summary = { keys_processed: 0, superseded: 0, dispatched: 0, skipped: 0, push_sends: 0, email_sends: 0, errors: 0 };

  for (const key of targetKeys) {
    const group = groups[key];
    if (!group || group.length === 0) continue;

    const sorted = group.sort((a, b) => new Date(a.created_date || 0).getTime() - new Date(b.created_date || 0).getTime());
    const canonical = sorted[0];
    const dups = sorted.slice(1);

    for (const d of dups) {
      if (d.dispatch_status !== 'superseded') {
        try {
          await deps.entities.Notification.update(d.id, { dispatch_status: 'superseded' });
          summary.superseded++;
        } catch (err) {
          summary.errors++;
        }
      }
    }

    if (canonical.dispatch_status === 'dispatching') { summary.skipped++; continue; }

    const [purchase] = await deps.entities.Purchase.filter({ id: canonical.reference_id }).catch(() => []);
    if (!purchase) {
      try {
        await deps.entities.Notification.update(canonical.id, { dispatch_status: 'superseded' });
        summary.superseded++;
      } catch (err) { summary.errors++; }
      continue;
    }

    const pp = await getPurchasePrivate(deps, purchase.id);
    const authoritativeSellerEmail = pp?.seller_email ?? purchase.seller_email;
    const pushStatus = pp?.seller_push_status ?? purchase.seller_push_status;
    const emailStatus = pp?.seller_email_status ?? purchase.seller_email_status;

    const pushDone = pushStatus === 'sent' || pushStatus === 'skipped';
    const emailDone = emailStatus === 'sent' || emailStatus === 'skipped';
    const needPush = !pushDone;
    const needEmail = !emailDone;

    if (!needPush && !needEmail) {
      if (canonical.dispatch_status !== 'dispatched') {
        try {
          await deps.entities.Notification.update(canonical.id, { dispatch_status: 'dispatched' });
        } catch (err) { summary.errors++; }
      }
      summary.skipped++;
      continue;
    }

    // Claim (best-effort, non-atomic)
    try {
      await deps.entities.Notification.update(canonical.id, { dispatch_status: 'dispatching' });
    } catch (err) {
      summary.errors++;
      continue;
    }

    // Call sendUserNotification — the caller wraps the REAL base44 client
    const dispatch = await deps.sendUserNotification({
      user_email: authoritativeSellerEmail,
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
      try {
        await deps.entities.Purchase.update(purchase.id, upd);
      } catch (err) { summary.errors++; }
      try {
        await upsertPurchasePrivate(deps, purchase.id, upd);
      } catch (err) { summary.errors++; }
    }

    // ONLY mark fully dispatched if ALL attempted channels succeeded
    const pushSucceeded = !needPush || dispatch?.push?.sent === true;
    const emailSucceeded = !needEmail || dispatch?.email?.sent === true;
    const allSucceeded = pushSucceeded && emailSucceeded;

    try {
      await deps.entities.Notification.update(canonical.id, {
        dispatch_status: allSucceeded ? 'dispatched' : 'pending',
      });
    } catch (err) { summary.errors++; }

    if (allSucceeded) summary.dispatched++;
    summary.keys_processed++;
  }

  return summary;
}