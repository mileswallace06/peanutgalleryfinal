/**
 * sendUserNotification
 * ────────────────────
 * Unified notification dispatcher for Peanut Gallery.
 *
 * Payload: { user_email, title, body, type, purchase_id? }
 *
 * Routing:
 *   1. Push notification — if user has a push_token stored (FCM/APNs/Expo)
 *      ⚠️  BETA PLACEHOLDER: actual push delivery is stubbed.
 *          To activate, integrate Firebase Admin SDK or Expo Push API here.
 *          Providers: Firebase Cloud Messaging, Apple APNs, Expo Notifications, OneSignal
 *   2. Email fallback — always attempted via Core.SendEmail
 *
 * Push failures NEVER block email. Email failures NEVER throw.
 * Safe to call fire-and-forget from any payment/transfer function.
 */

import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

// Notification type → email subject + body builder
function buildEmail(title, body, type, purchaseId) {
  const ctaMap = {
    sale_created:      { cta: 'Open My Sales →', path: '/my-sales' },
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

// ─── Push stub ───────────────────────────────────────────────────────────────
// Replace this function body when a push provider is integrated.
// Expected: return { sent: true } on success, throw on failure.
async function sendPush(pushToken, title, body, data) {
  // TODO: Replace with real push provider, e.g.:
  //   Expo:     POST https://exp.host/--/api/v2/push/send
  //   FCM:      POST https://fcm.googleapis.com/v1/projects/{projectId}/messages:send
  //   OneSignal: POST https://onesignal.com/api/v1/notifications
  //
  // For now, log and return { sent: false, stub: true } so email fallback always fires.
  console.log('[sendUserNotification] PUSH STUB — token:', pushToken?.slice(0, 20) + '…', '| title:', title);
  return { sent: false, stub: true };
}

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);

  const { user_email, title, body, type, purchase_id } = await req.json();

  if (!user_email || !title || !body) {
    return Response.json({ error: 'user_email, title, body are required' }, { status: 400 });
  }

  const results = { push: null, email: null };

  // ── 1. Look up user preferences + push token ──────────────────────────────
  let pushToken = null;
  let prefKey = null;
  const prefMap = {
    sale_created:    'notif_listing_sold',
    seller_reminder: 'notif_transfer_updates',
    tickets_sent:    'notif_transfer_updates',
    buyer_reminder:  'notif_transfer_updates',
    sale_complete:   'notif_listing_sold',
  };
  prefKey = prefMap[type] || null;

  try {
    const users = await base44.asServiceRole.entities.User.filter({ email: user_email });
    const u = users[0];
    if (u) {
      // Respect notification preferences — if pref is explicitly false, skip entirely
      if (prefKey && u[prefKey] === false) {
        console.log('[sendUserNotification] user', user_email, 'has disabled pref', prefKey, '— skipping');
        return Response.json({ skipped: true, reason: 'user_preference' });
      }
      pushToken = u.push_token || null;
    }
  } catch (err) {
    console.warn('[sendUserNotification] could not load user prefs:', err?.message);
  }

  // ── 2. Try push ───────────────────────────────────────────────────────────
  if (pushToken) {
    try {
      const pushResult = await sendPush(pushToken, title, body, { type, purchase_id });
      results.push = pushResult;
      if (pushResult.sent) {
        console.log('[sendUserNotification] ✅ push sent to', user_email);
        // Push delivered — still send email for now during beta
        // When push is confirmed reliable, add `return Response.json({ ...results })` here
      }
    } catch (err) {
      console.error('[sendUserNotification] push failed:', err?.message);
      results.push = { sent: false, error: err?.message };
    }
  }

  // ── 3. Email fallback (always during beta) ────────────────────────────────
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