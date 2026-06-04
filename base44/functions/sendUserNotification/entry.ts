/**
 * sendUserNotification
 * ────────────────────
 * Unified notification dispatcher for Peanut Gallery.
 *
 * Payload: { user_email, title, body, type, purchase_id? }
 *
 * SECURITY MODEL:
 * - Must be called by an authenticated user OR carry x-base44-service-role: true
 * - A non-admin authenticated user may only send notifications to THEMSELVES
 * - Service-role and admin callers may target any user_email
 *
 * Routing:
 *   1. Push notification via OneSignal (external_id = email)
 *   2. Email fallback via Core.SendEmail
 *
 * Push failures NEVER block email. Email failures NEVER throw.
 * Safe to call fire-and-forget from any payment/transfer function.
 */

import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

function buildEmail(title, body, type, purchaseId) {
  const ctaMap = {
    sale_created:      { cta: 'Send Tickets Now →', path: purchaseId ? `/purchase/${purchaseId}` : '/my-sales' },
    seller_reminder:   { cta: 'Send Tickets Now →', path: purchaseId ? `/purchase/${purchaseId}` : '/my-sales' },
    tickets_sent:      { cta: 'Confirm Receipt →', path: purchaseId ? `/purchase/${purchaseId}` : '/my-tickets' },
    buyer_reminder:    { cta: 'Confirm Tickets →', path: purchaseId ? `/purchase/${purchaseId}` : '/my-tickets' },
    sale_complete:     { cta: 'View My Sales →', path: '/my-sales' },
  };
  const { cta = 'Open Peanut Gallery →', path = '/events' } = ctaMap[type] || {};
  const appUrl = `https://app.peanutgallery.app${path}`;
  return {
    subject: title,
    body: `${body}\n\n${cta}\n${appUrl}\n\n— Peanut Gallery\n\nTo manage notification preferences, visit your account settings.`,
  };
}

// ─── OneSignal push ───────────────────────────────────────────────────────────
const ONESIGNAL_APP_ID = '8c9896d6-d4d6-4cdf-a094-3ba25bdd4585';

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
    ...(data?.purchase_id && {
      url: `https://app.peanutgallery.app/purchase/${data.purchase_id}`,
    }),
  };

  const res = await fetch('https://onesignal.com/api/v1/notifications', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Key ${apiKey}`,
    },
    body: JSON.stringify(payload),
  });

  const json = await res.json();
  if (!res.ok || json.errors) {
    console.warn('[sendUserNotification] OneSignal push failed:', JSON.stringify(json));
    return { sent: false, error: json.errors || json };
  }

  console.log('[sendUserNotification] ✅ OneSignal push sent to', userEmail, '| id:', json.id);
  return { sent: true, id: json.id };
}

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);

  // ── Auth gate ─────────────────────────────────────────────────────────────
  const isServiceRole = req.headers.get('x-base44-service-role') === 'true';
  const caller = await base44.auth.me().catch(() => null);

  if (!caller && !isServiceRole) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { user_email, title, body, type, purchase_id } = await req.json();

  if (!user_email || !title || !body) {
    return Response.json({ error: 'user_email, title, body are required' }, { status: 400 });
  }

  // SECURITY: Non-admin users may only send push/email to themselves
  if (!isServiceRole && caller) {
    const isAdmin = caller.role === 'admin';
    if (!isAdmin && caller.email !== user_email) {
      console.warn(`[sendUserNotification] BLOCKED: ${caller.email} tried to notify ${user_email}`);
      return Response.json({ error: 'Forbidden: you may only send notifications to your own account' }, { status: 403 });
    }
  }

  const results = { push: null, email: null };

  // ── 1. Look up user preferences ───────────────────────────────────────────
  const prefMap = {
    sale_created:    'notif_listing_sold',
    seller_reminder: 'notif_transfer_updates',
    tickets_sent:    'notif_transfer_updates',
    buyer_reminder:  'notif_transfer_updates',
    sale_complete:   'notif_listing_sold',
  };
  const prefKey = prefMap[type] || null;

  try {
    const users = await base44.asServiceRole.entities.User.filter({ email: user_email });
    const u = users[0];
    if (u && prefKey && u[prefKey] === false) {
      console.log('[sendUserNotification] user', user_email, 'has disabled pref', prefKey, '— skipping');
      return Response.json({ skipped: true, reason: 'user_preference' });
    }
  } catch (err) {
    console.warn('[sendUserNotification] could not load user prefs:', err?.message);
  }

  // ── 2. Try OneSignal push ─────────────────────────────────────────────────
  try {
    const pushResult = await sendOneSignalPush(user_email, title, body, { type, purchase_id });
    results.push = pushResult;
  } catch (err) {
    console.error('[sendUserNotification] push failed:', err?.message);
    results.push = { sent: false, error: err?.message };
  }

  // ── 3. Email fallback ─────────────────────────────────────────────────────
  try {
    const { subject, body: emailBody } = buildEmail(title, body, type, purchase_id);
    await base44.asServiceRole.integrations.Core.SendEmail({
      from_name: 'Peanut Gallery',
      to: user_email,
      subject,
      body: emailBody,
    });
    results.email = { sent: true };
    console.log('[sendUserNotification] ✅ email sent to', user_email, '| type:', type);
  } catch (err) {
    console.error('[sendUserNotification] email failed to', user_email, '|', err?.message);
    results.email = { sent: false, error: err?.message };
  }

  return Response.json({ results });
});