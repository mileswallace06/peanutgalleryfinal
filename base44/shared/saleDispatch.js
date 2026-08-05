/**
 * saleDispatch.js — Shared sale notification dispatch logic (deps-based).
 *
 * 7C.9C corrections 3 & 4:
 *   3. Eliminate legacy seller identity — require exactly one PurchasePrivate.
 *   4. Be honest about external at-most-once delivery — disable external push/email.
 *
 * EXTERNAL DELIVERY SUPPRESSION (correction 4):
 *   Base44 has no atomic claim primitive, and the current providers do not
 *   demonstrate durable idempotency for both channels. Therefore external
 *   push and email dispatch for `sale_created` is DISABLED.
 *   - The in-app Notification record IS preserved and marked 'dispatched'.
 *   - seller_push_status and seller_email_status are marked 'skipped' (valid schema value).
 *   - No sendUserNotification call is made — provider-call counters remain zero.
 *   - We do NOT claim strict at-most-once external delivery.
 *   - We never resend after a provider succeeds merely because a later DB write fails
 *     (there are no provider calls to resend).
 *
 * PURCHASEPRIVATE AUTHORITY (correction 3):
 *   - enqueueSaleNotificationDeps requires exactly one PurchasePrivate (4th arg).
 *   - Uses pp.seller_email — NEVER purchase.seller_email.
 *   - The PurchasePrivate argument cannot be treated as an options object.
 *   - dispatchSaleNotificationsDeps requires PP — no public Purchase fallback.
 *   - Missing or duplicate PP → no provider call, critical alert, retryable failure.
 */
import { getPurchasePrivate, upsertPurchasePrivate } from './orchestratorHelpers.js';

export function saleIdempotencyKey(purchaseId) {
  return `sale_created:${purchaseId}`;
}

// ── Enqueue — requires PurchasePrivate as 4th argument (not opts) ──────────
export async function enqueueSaleNotificationDeps(deps, purchase, listing, pp) {
  if (!pp || typeof pp !== 'object' || Array.isArray(pp)) {
    throw new Error('PurchasePrivate is required as the 4th argument');
  }
  if (!pp.purchase_id || pp.purchase_id !== purchase.id) {
    throw new Error('PurchasePrivate does not match the Purchase');
  }
  if (!pp.seller_email) {
    throw new Error('PurchasePrivate is missing seller_email');
  }

  const key = saleIdempotencyKey(purchase.id);
  const sellerEmail = pp.seller_email; // Authoritative — NEVER purchase.seller_email
  const title = '🎉 Your ticket sold!';
  const body = `Tap to transfer your tickets and receive payment. Sec ${listing?.section || ''}, Row ${listing?.row || ''}.`;

  // Best-effort dedup (NOT atomic — Base44 has no compare-and-set)
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
  } catch (_) { /* best-effort marker */ }
  try {
    await upsertPurchasePrivate(deps, purchase.id, { seller_notified_at: notifiedAt });
  } catch (_) { /* best-effort marker */ }

  return { enqueued: true, idempotency_key: key };
}

// ── Dispatch — external push/email DISABLED, in-app only ───────────────────
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

  const summary = { keys_processed: 0, superseded: 0, dispatched: 0, skipped: 0, push_sends: 0, email_sends: 0, errors: 0, pp_missing: 0, pp_duplicate: 0 };

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
        } catch (_) { summary.errors++; }
      }
    }

    if (canonical.dispatch_status === 'dispatching') { summary.skipped++; continue; }

    const [purchase] = await deps.entities.Purchase.filter({ id: canonical.reference_id }).catch(() => []);
    if (!purchase) {
      // Purchase missing — can't resolve PP, skip this key
      try {
        await deps.entities.Notification.update(canonical.id, { dispatch_status: 'superseded' });
        summary.superseded++;
      } catch (_) { summary.errors++; }
      continue;
    }

    // ── Require exactly ONE PurchasePrivate — no public fallback ────────────
    const ppRows = await deps.entities.PurchasePrivate.filter({ purchase_id: purchase.id }).catch(() => []);

    if (ppRows.length === 0) {
      // Missing PP — no provider call, critical alert, retryable
      summary.pp_missing++;
      try {
        await deps.entities.AdminAlert.create({
          alert_type: 'admin_action_required',
          priority: 'critical',
          title: `Sale notification skipped — missing PurchasePrivate — ${purchase.id}`,
          description: `Cannot dispatch sale_created notification for purchase ${purchase.id}: PurchasePrivate not found. No public fallback used. Notification remains pending for retry.`,
          reference_type: 'purchase',
          reference_id: purchase.id,
        });
      } catch (_) { summary.errors++; }
      // Leave notification as 'pending' for retry
      continue;
    }

    if (ppRows.length > 1) {
      // Duplicate PP — no provider call, critical alert, retryable
      summary.pp_duplicate++;
      try {
        await deps.entities.AdminAlert.create({
          alert_type: 'admin_action_required',
          priority: 'critical',
          title: `Sale notification skipped — duplicate PurchasePrivate — ${purchase.id}`,
          description: `Cannot dispatch sale_created notification for purchase ${purchase.id}: ${ppRows.length} PurchasePrivate records found. Data integrity issue. Notification remains pending for retry.`,
          reference_type: 'purchase',
          reference_id: purchase.id,
        });
      } catch (_) { summary.errors++; }
      continue;
    }

    const pp = ppRows[0];
    const authoritativeSellerEmail = pp.seller_email; // NEVER purchase.seller_email

    if (!authoritativeSellerEmail) {
      // PP exists but has no seller_email — integrity error
      summary.pp_missing++;
      try {
        await deps.entities.AdminAlert.create({
          alert_type: 'admin_action_required',
          priority: 'critical',
          title: `Sale notification skipped — PP missing seller_email — ${purchase.id}`,
          description: `PurchasePrivate for purchase ${purchase.id} has no seller_email. Cannot dispatch. Notification remains pending for retry.`,
          reference_type: 'purchase',
          reference_id: purchase.id,
        });
      } catch (_) { summary.errors++; }
      continue;
    }

    // ── EXTERNAL DELIVERY SUPPRESSED (correction 4) ──────────────────────────
    // No sendUserNotification call. No push. No email.
    // Mark both channels as 'skipped' (valid schema value).
    // The in-app Notification record IS the delivery.
    try {
      await deps.entities.Notification.update(canonical.id, { dispatch_status: 'dispatched' });
      summary.dispatched++;
    } catch (_) { summary.errors++; }

    // Mark channels as skipped on both Purchase and PurchasePrivate
    const channelUpdate = { seller_push_status: 'skipped', seller_email_status: 'skipped' };
    try {
      await deps.entities.Purchase.update(purchase.id, channelUpdate);
    } catch (_) { summary.errors++; }
    try {
      await upsertPurchasePrivate(deps, purchase.id, channelUpdate);
    } catch (_) { summary.errors++; }

    // Provider-call counters remain zero — no external calls made
    summary.keys_processed++;
  }

  return summary;
}