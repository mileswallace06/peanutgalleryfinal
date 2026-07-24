/**
 * Shared backend notification + transactional-email utilities.
 *
 * Architecture: these helpers are imported DIRECTLY by trusted backend
 * functions and run in-process via the SDK client the caller passes in. They
 * are NOT exposed as generally-callable public endpoints, so there is no
 * spoofable HTTP header or public function-to-function auth to bypass.
 *
 * The importing function is responsible for authenticating the user and
 * verifying marketplace state before calling these. These helpers:
 *   - validate the notification type against an allowlist
 *   - validate action_url is an internal path only (never external)
 *   - create the Notification record via service role
 *   - dispatch OneSignal push + transactional email (with preference checks)
 *   - validate/length-limit email recipients and content
 *   - never leak provider errors or credentials in returned values
 */

const APP_URL = 'https://app.peanutgallery.store';
const ONESIGNAL_APP_ID = '8c9896d6-d4d6-4cdf-a094-3ba25bdd4585';
const FROM_NAME = 'Peanut Gallery';

// ── Allowed notification types ────────────────────────────────────────────────
export const NOTIFICATION_TYPES = new Set([
  'purchase_confirmed', 'tickets_sent', 'transfer_verified', 'transfer_rejected',
  'buyer_confirmed', 'sale_complete', 'payout_processing', 'dispute_opened',
  'dispute_resolved', 'donation_won', 'donation_accepted', 'donation_expired',
  'listing_hidden', 'listing_approved', 'listing_rejected', 'listing_expired',
  'sale_created', 'ai_verified', 'ai_rejected', 'admin_message',
  'seller_reminder', 'buyer_reminder', 'authorization_confirmed',
]);

export const TYPE_DEFAULTS = {
  purchase_confirmed: { icon: '🎉', email: true },
  tickets_sent:       { icon: '🚀', email: true },
  transfer_verified:  { icon: '✅', email: false },
  transfer_rejected:  { icon: '⚠️', email: true },
  buyer_confirmed:    { icon: '✓',  email: false },
  sale_complete:      { icon: '💸', email: true },
  payout_processing:  { icon: '🏦', email: true },
  dispute_opened:     { icon: '⚖️', email: true },
  dispute_resolved:   { icon: '✅', email: true },
  donation_won:       { icon: '🎁', email: true },
  donation_accepted:  { icon: '❤️', email: false },
  donation_expired:   { icon: '⏰', email: true },
  listing_hidden:     { icon: '🚫', email: true },
  listing_approved:   { icon: '✅', email: true },
  listing_rejected:   { icon: '❌', email: true },
  listing_expired:    { icon: '⏱',  email: false },
  sale_created:       { icon: '🎟️', email: true },
  ai_verified:        { icon: '🤖', email: false },
  ai_rejected:        { icon: '🤖', email: true },
  admin_message:      { icon: '📢', email: true },
  seller_reminder:    { icon: '⏰', email: true },
  buyer_reminder:     { icon: '⏰', email: true },
  authorization_confirmed: { icon: '🎟️', email: true },
};

// action_url must be an internal path only — never an arbitrary external URL.
function isInternalActionUrl(u) {
  if (u === null || u === undefined || u === '') return true;
  if (typeof u !== 'string') return false;
  if (/^https?:\/\//i.test(u)) return false;
  return u.startsWith('/') || u.startsWith('./');
}

function clamp(str, max) {
  if (str === null || str === undefined) return '';
  return String(str).slice(0, max);
}

// ── recordNotification: in-app record + push + email ──────────────────────────
export async function recordNotification(base44, opts) {
  const {
    user_email, type, title, body,
    reference_id = null, reference_type = null, action_url = null,
    send_email = true, send_push = true,
  } = opts || {};

  if (!user_email || !type || !title) {
    return { ok: false, reason: 'missing_fields' };
  }
  if (!NOTIFICATION_TYPES.has(type)) {
    console.warn('[notifications] rejected unknown notification type:', type);
    return { ok: false, reason: 'unknown_type' };
  }
  if (!isInternalActionUrl(action_url)) {
    console.warn('[notifications] rejected external action_url:', action_url);
    return { ok: false, reason: 'external_action_url' };
  }

  const defaults = TYPE_DEFAULTS[type] || { icon: '🔔', email: false };
  const icon = defaults.icon;
  const safeTitle = clamp(title, 140);
  const safeBody = clamp(body, 1000);

  // 1. In-app record
  try {
    await base44.asServiceRole.entities.Notification.create({
      user_email,
      type,
      title: safeTitle,
      body: safeBody,
      read: false,
      reference_id: reference_id || null,
      reference_type: reference_type || null,
      action_url: action_url || null,
      icon,
    });
  } catch (err) {
    console.error('[notifications] DB insert failed:', err?.message);
  }

  // 2. Push (+ email fallback handled inside sendUserNotification)
  if (send_push) {
    sendUserNotification(base44, {
      user_email,
      title: safeTitle,
      body: safeBody,
      type,
      purchase_id: reference_type === 'purchase' ? reference_id : null,
    }).catch(err => console.error('[notifications] push failed:', err?.message));
  } else if (send_email && defaults.email && safeBody) {
    // push suppressed but email still desired
    sendTransactionalEmail(base44, user_email, `${icon} ${safeTitle}`,
      `${safeBody}\n\n${action_url ? `View details: ${APP_URL}${action_url}` : ''}\n\n— Peanut Gallery`
    ).catch(err => console.error('[notifications] email failed:', err?.message));
  }

  return { ok: true };
}

// ── sendUserNotification: OneSignal push + email fallback (with prefs) ─────────
const PUSH_PREF_MAP = {
  sale_created: 'notif_listing_sold',
  seller_reminder: 'notif_transfer_updates',
  tickets_sent: 'notif_transfer_updates',
  buyer_reminder: 'notif_transfer_updates',
  sale_complete: 'notif_listing_sold',
};

export async function sendUserNotification(base44, opts) {
  const { user_email, title, body, type, purchase_id, sendPush = true, sendEmail = true } = opts || {};
  if (!user_email || !title || !body) return { skipped: 'missing' };

  // Preference check
  const prefKey = PUSH_PREF_MAP[type] || null;
  if (prefKey) {
    try {
      const users = await base44.asServiceRole.entities.User.filter({ email: user_email });
      const u = users[0];
      if (u && u[prefKey] === false) {
        return { skipped: 'user_preference' };
      }
    } catch (err) {
      console.warn('[sendUserNotification] could not load user prefs:', err?.message);
    }
  }

  // Per-channel send control: callers (e.g. reconciliation retry) can request
  // push-only or email-only so a successful channel is NOT re-sent when only
  // the other channel failed.
  const results = { push: null, email: null };

  if (sendPush) {
    try {
      results.push = await sendOneSignalPush(user_email, clamp(title, 140), clamp(body, 1000), { type, purchase_id });
    } catch (err) {
      console.error('[sendUserNotification] push failed:', err?.message);
      results.push = { sent: false };
    }
  } else {
    results.push = { skipped: 'sendPush_false' };
  }

  if (sendEmail) {
    try {
      const { subject, body: emailBody } = buildEmail(title, body, type, purchase_id);
      results.email = await sendTransactionalEmail(base44, user_email, subject, emailBody);
    } catch (err) {
      console.error('[sendUserNotification] email failed:', err?.message);
      results.email = { sent: false };
    }
  } else {
    results.email = { skipped: 'sendEmail_false' };
  }

  return results;
}

// ── sendTransactionalEmail: validated, length-limited Core.SendEmail ─────────
export async function sendTransactionalEmail(base44, to, subject, body) {
  if (!to || !subject || !body) return { sent: false, error: 'missing fields' };
  const safeTo = clamp(to, 200);
  const safeSubject = clamp(subject, 200);
  const safeBody = clamp(body, 8000);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(safeTo)) {
    return { sent: false, error: 'invalid recipient' };
  }
  try {
    await base44.asServiceRole.integrations.Core.SendEmail({
      from_name: FROM_NAME,
      to: safeTo,
      subject: safeSubject,
      body: safeBody,
    });
    return { sent: true };
  } catch (err) {
    // Never leak provider errors / credentials to callers.
    console.error('[sendTransactionalEmail] failed to', safeTo, '|', err?.message);
    return { sent: false, error: 'send_failed' };
  }
}

// ── OneSignal push ────────────────────────────────────────────────────────────
async function sendOneSignalPush(userEmail, title, body, data) {
  const apiKey = Deno.env.get('ONESIGNAL_REST_API_KEY');
  if (!apiKey) {
    console.warn('[sendUserNotification] ONESIGNAL_REST_API_KEY not set — skipping push');
    return { sent: false, reason: 'no_api_key' };
  }
  const payload = {
    app_id: ONESIGNAL_APP_ID,
    include_aliases: { external_id: [userEmail] },
    target_channel: 'push',
    headings: { en: title },
    contents: { en: body },
    data: data || {},
    ...(data?.purchase_id && { url: `${APP_URL}/purchase/${data.purchase_id}` }),
  };
  const res = await fetch('https://onesignal.com/api/v1/notifications', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Key ${apiKey}` },
    body: JSON.stringify(payload),
  });
  const json = await res.json();
  if (!res.ok || json.errors) {
    console.warn('[sendUserNotification] OneSignal push failed:', JSON.stringify(json));
    return { sent: false };
  }
  return { sent: true, id: json.id };
}

function buildEmail(title, body, type, purchaseId) {
  const ctaMap = {
    sale_created:      { cta: 'Send Tickets Now →', path: purchaseId ? `/purchase/${purchaseId}` : '/my-sales' },
    seller_reminder:   { cta: 'Send Tickets Now →', path: purchaseId ? `/purchase/${purchaseId}` : '/my-sales' },
    tickets_sent:      { cta: 'Confirm Receipt →', path: purchaseId ? `/purchase/${purchaseId}` : '/my-tickets' },
    buyer_reminder:    { cta: 'Confirm Tickets →', path: purchaseId ? `/purchase/${purchaseId}` : '/my-tickets' },
    sale_complete:     { cta: 'View My Sales →', path: '/my-sales' },
    authorization_confirmed: { cta: 'Send Tickets Now →', path: purchaseId ? `/purchase/${purchaseId}` : '/my-sales' },
  };
  const { cta = 'Open Peanut Gallery →', path = '/events' } = ctaMap[type] || {};
  const appUrl = `${APP_URL}${path}`;
  return {
    subject: clamp(title, 200),
    body: `${clamp(body, 4000)}\n\n${cta}\n${appUrl}\n\n— Peanut Gallery\n\nTo manage notification preferences, visit your account settings.`,
  };
}