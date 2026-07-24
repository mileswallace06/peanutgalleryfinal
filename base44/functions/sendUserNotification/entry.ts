/**
 * sendUserNotification (PUBLIC) — admin-only.
 *
 * Internal backend functions import the shared `notifications` module directly.
 * This public endpoint is restricted to authenticated administrators (used by
 * the admin fulfillment console). Regular users cannot send push/email to
 * anyone; admins may target a user, with notification preferences respected.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';
import { sendUserNotification } from '../../shared/notifications.ts';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const caller = await base44.auth.me().catch(() => null);
    if (!caller) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    if (caller.role !== 'admin') return Response.json({ error: 'Admin only' }, { status: 403 });

    const body = await req.json();
    const results = await sendUserNotification(base44, body);
    return Response.json({ results });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
});