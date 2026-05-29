/**
 * recordNotification
 * Creates an in-app Notification record AND sends push + email.
 * Called from other backend functions (fire-and-forget pattern).
 *
 * SECURITY MODEL:
 * - Must be called by an authenticated user OR carry x-base44-service-role: true
 * - A non-admin authenticated user may only create notifications for THEMSELVES
 * - Admin users and service-role calls may target any user_email
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const TYPE_DEFAULTS = {
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
  sale_created:       { icon: '🎟️', email: false },
  ai_verified:        { icon: '🤖', email: false },
  ai_rejected:        { icon: '🤖', email: true },
  admin_message:      { icon: '📢', email: true },
};

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    const isServiceRole = req.headers.get('x-base44-service-role') === 'true';
    const caller = await base44.auth.me().catch(() => null);

    if (!caller && !isServiceRole) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const {
      user_email, type, title, body,
      reference_id, reference_type, action_url,
      send_email = true, send_push = true,
    } = await req.json();

    if (!user_email || !type || !title) {
      return Response.json({ error: 'user_email, type, title required' }, { status: 400 });
    }

    // SECURITY: Non-admin authenticated users can only create notifications for themselves.
    // Service-role calls (from other backend functions) and admins may target any email.
    if (!isServiceRole && caller) {
      const isAdmin = caller.role === 'admin';
      if (!isAdmin && caller.email !== user_email) {
        console.warn(`[recordNotification] BLOCKED: ${caller.email} tried to notify ${user_email}`);
        return Response.json({ error: 'Forbidden: you may only create notifications for your own account' }, { status: 403 });
      }
    }

    const defaults = TYPE_DEFAULTS[type] || { icon: '🔔', email: true };
    const icon = defaults.icon;

    // 1. Create in-app notification record
    await base44.asServiceRole.entities.Notification.create({
      user_email,
      type,
      title,
      body: body || '',
      read: false,
      reference_id: reference_id || null,
      reference_type: reference_type || null,
      action_url: action_url || null,
      icon,
    }).catch(err => console.error('[recordNotification] DB insert failed:', err?.message));

    // 2. Push notification via sendUserNotification
    if (send_push) {
      base44.asServiceRole.functions.invoke('sendUserNotification', {
        user_email,
        title,
        body: body || '',
        type,
        purchase_id: reference_type === 'purchase' ? reference_id : null,
      }).catch(err => console.error('[recordNotification] push failed:', err?.message));
    }

    // 3. Email notification (only for high-value events)
    if (send_email && defaults.email && body) {
      base44.asServiceRole.functions.invoke('sendNotificationEmail', {
        to: user_email,
        subject: `${icon} ${title}`,
        body: `${body}\n\n${action_url ? `View details: https://peanutgallery.store${action_url}` : ''}\n\n— Peanut Gallery`,
      }).catch(err => console.error('[recordNotification] email failed:', err?.message));
    }

    return Response.json({ ok: true });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
});