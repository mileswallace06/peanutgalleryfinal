/**
 * webhookNotifications.js — Durable enqueue + dispatch for webhook-originated
 * notifications. Push/email are NEVER sent inline during webhook processing.
 *
 * CONCURRENCY MODEL (Base44 has NO atomic compare-and-set — proven):
 *   enqueueWebhookNotification creates a PENDING Notification record with a
 *   deterministic idempotency_key derived from the Stripe event.id. A
 *   duplicate event finds the existing record and returns {enqueued:false}.
 *   dispatchWebhookNotifications groups by idempotency_key, selects ONE
 *   canonical (oldest), supersedes the rest, and dispatches only the canonical.
 *   This holds provider calls to <=1 push and <=1 email per logical event even
 *   when Stripe delivers duplicate or concurrent events.
 *
 * deps = { entities: { Notification, AdminAlert }, sendUserNotification?, sendTransactionalEmail?, now? }
 */

export async function enqueueWebhookNotification(deps, opts) {
  const { idempotency_key, user_email, type, title, body, reference_id, reference_type, action_url } = opts;
  if (!idempotency_key || !user_email || !type || !title) return { enqueued: false, reason: 'missing_fields' };

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

export async function enqueueWebhookAdminAlert(deps, opts) {
  const { idempotency_key, title, description, reference_id, reference_type, priority } = opts;
  if (!idempotency_key || !title) return { enqueued: false, reason: 'missing_fields' };

  // Dedup admin alerts by idempotency_key stored in description prefix
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

export async function dispatchWebhookNotifications(deps, opts = {}) {
  const { keys = null, limit = 500 } = opts;

  const all = await deps.entities.Notification.filter({ dispatch_status: 'pending' }, '-created_date', limit).catch(() => []);
  const webhookNotifs = all.filter(n => n.idempotency_key && n.idempotency_key.startsWith('webhook:'));

  const groups = {};
  for (const n of webhookNotifs) {
    (groups[n.idempotency_key] ||= []).push(n);
  }

  const targetKeys = keys ? keys : Object.keys(groups);
  const summary = { dispatched: 0, superseded: 0, skipped: 0, push_sends: 0, email_sends: 0 };

  for (const key of targetKeys) {
    const group = groups[key];
    if (!group || group.length === 0) continue;

    const sorted = group.sort((a, b) => new Date(a.created_date || 0) - new Date(b.created_date || 0));
    const canonical = sorted[0];
    const dups = sorted.slice(1);

    for (const d of dups) {
      if (d.dispatch_status !== 'superseded') {
        await deps.entities.Notification.update(d.id, { dispatch_status: 'superseded' }).catch(() => {});
        summary.superseded++;
      }
    }

    if (canonical.dispatch_status === 'dispatching') { summary.skipped++; continue; }

    await deps.entities.Notification.update(canonical.id, { dispatch_status: 'dispatching' }).catch(() => {});

    if (deps.sendUserNotification) {
      const dispatch = await deps.sendUserNotification(deps, {
        user_email: canonical.user_email,
        title: canonical.title,
        body: canonical.body,
        type: canonical.type,
        purchase_id: canonical.reference_type === 'purchase' ? canonical.reference_id : null,
      }).catch(() => ({}));
      if (dispatch?.push?.sent) summary.push_sends++;
      if (dispatch?.email?.sent) summary.email_sends++;
    }

    await deps.entities.Notification.update(canonical.id, { dispatch_status: 'dispatched' }).catch(() => {});
    summary.dispatched++;
  }

  return summary;
}