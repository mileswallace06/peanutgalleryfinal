/**
 * sendNotificationEmail (PUBLIC) — admin-only, validated.
 *
 * Internal backend functions import the shared `notifications` module's
 * `sendTransactionalEmail` directly. This public endpoint is restricted to
 * authenticated administrators: a regular user cannot choose an arbitrary
 * recipient, subject, or body. Recipient format and content length are
 * validated; provider errors are never returned.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';
import { sendTransactionalEmail } from '../../shared/notifications.ts';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const caller = await base44.auth.me().catch(() => null);
    if (!caller) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    if (caller.role !== 'admin') return Response.json({ error: 'Admin only' }, { status: 403 });

    const { to, subject, body } = await req.json();
    const res = await sendTransactionalEmail(base44, to, subject, body);
    return Response.json(res);
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
});