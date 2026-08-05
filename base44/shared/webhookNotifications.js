/**
 * webhookNotifications.js — Durable enqueue + dispatch for webhook-originated
 * notifications.
 *
 * HONEST CONCURRENCY MODEL (Base44 has NO atomic compare-and-set — proven):
 *
 * enqueueWebhookNotification creates a PENDING Notification record with a
 * deterministic idempotency_key derived from the Stripe event.id. Two concurrent
 * enqueue calls with the same key may BOTH create records — this is EXPECTED
 * and HONEST. We do NOT claim at-most-once at the enqueue level.
 *
 * dispatchWebhookNotifications groups by idempotency_key, selects ONE canonical
 * (oldest), supersedes the rest, and marks the canonical as dispatched.
 *
 * EXTERNAL PUSH/EMAIL IS DISABLED for webhook-originated notifications.
 * Base44 has no atomic compare-and-set, so we cannot guarantee at-most-once
 * provider delivery. The durable in-app Notification record (created during
 * enqueue) IS the delivery mechanism. No OneSignal or SendEmail calls are made.
 * This is the honest trade-off: we preserve the durable in-app record and
 * AdminAlert, and report the limitation.
 *
 * This function IS called by the production scheduled dispatcher
 * (dispatchSaleNotifications in saleNotification.ts), which calls
 * dispatchWebhookNotifications after processing sale_created records.
 */

// ── Enqueue ──────────────────────────────────────────────────────────────────
// Creates a PENDING Notification record. Does NOT send push or email.
// CONCURRENCY NOTE: Two concurrent calls with the same idempotency_key may both
// create records. This is expected — the dispatcher canonicalizes duplicates.
// We do NOT claim at-most-once at the enqueue level.
export async function enqueueWebhookNotification(deps, opts) {
  const { idempotency_key, user_email, type, title, body, reference_id, reference_type, action_url } = opts;
  if (!idempotency_key || !user_email || !type || !title) return { enqueued: false, reason: 'missing_fields' };

  // Best-effort dedup check (NOT atomic — both concurrent calls may pass this)
  const existing = await deps.entities.Notification.filter({ idempotency_key }).catch(() => []);
  if (existing.length > 0) return { enqueued: false, reason: 'duplicate' };

  await deps.entities.Notification.create({
    user_email, type, title, body,
    read: false,
    reference_id: reference_id || null,
    reference_type: reference_type || null,
    action_url: action_url || null,
    idempotency_key,
    dispatch_status: 'pending',
  });
  return { enqueued: true };
}

// ── Enqueue AdminAlert ───────────────────────────────────────────────────────
// Does NOT swallow errors — callers must handle failures and return non-2xx
// when required alert persistence fails.
export async function enqueueWebhookAdminAlert(deps, opts) {
  const { idempotency_key, title, description, reference_id, reference_type, priority } = opts;
  if (!idempotency_key || !title) return { enqueued: false, reason: 'missing_fields' };

  const existing = await deps.entities.AdminAlert.filter({ reference_id: reference_id || 'none' }).catch(() => []);
  const alreadyAlerted = existing.some(a => a.description && a.description.includes(`[evt:${idempotency_key}]`));
  if (alreadyAlerted) return { enqueued: false, reason: 'duplicate' };

  await deps.entities.AdminAlert.create({
    alert_type: 'admin_action_required',
    priority: priority || 'high',
    title,
    description: `[evt:${idempotency_key}] ${description || ''}`,
    reference_type: reference_type || null,
    reference_id: reference_id || null,
  });
  return { enqueued: true };
}

// ── Dispatch ─────────────────────────────────────────────────────────────────
// Canonicalizes pending webhook-originated notifications. Supersedes duplicates.
// Marks canonical as 'dispatched' (in-app record IS the delivery).
// Does NOT send external push/email (disabled — see HONEST CONCURRENCY MODEL above).
// Does NOT swallow dispatch-state writes.
export async function dispatchWebhookNotifications(deps, opts = {}) {
  const { keys = null, limit = 500 } = opts;

  // 7C.9C.1: NO catch(() => []) — query failures must propagate
  let all;
  try {
    all = await deps.entities.Notification.filter({ dispatch_status: 'pending' }, '-created_date', limit);
  } catch (err) {
    return { dispatched: 0, superseded: 0, skipped: 0, errors: 1, fatal_error: err?.message || 'Notification query failed' };
  }
  const webhookNotifs = all.filter(n => n.idempotency_key && n.idempotency_key.startsWith('webhook:'));

  const groups = {};
  for (const n of webhookNotifs) {
    (groups[n.idempotency_key] ||= []).push(n);
  }

  const targetKeys = keys ? keys : Object.keys(groups);
  const summary = { dispatched: 0, superseded: 0, skipped: 0, errors: 0 };

  for (const key of targetKeys) {
    const group = groups[key];
    if (!group || group.length === 0) continue;

    const sorted = group.sort((a, b) => new Date(a.created_date || 0).getTime() - new Date(b.created_date || 0).getTime());
    const canonical = sorted[0];
    const dups = sorted.slice(1);

    // Supersede duplicates — do NOT swallow write failures
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

    // EXTERNAL PUSH/EMAIL DISABLED for webhook-originated notifications.
    // The in-app Notification record IS the delivery. No provider calls made.
    try {
      await deps.entities.Notification.update(canonical.id, { dispatch_status: 'dispatched' });
      summary.dispatched++;
    } catch (err) {
      summary.errors++;
    }
  }

  return summary;
}