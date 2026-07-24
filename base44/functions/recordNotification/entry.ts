/**
 * recordNotification (PUBLIC) — admin-only.
 *
 * Internal backend functions import the shared `notifications` module directly
 * (in-process) and never call this endpoint. This public endpoint exists only
 * for admin dashboard actions (e.g. notifying a seller on listing review) and
 * is restricted to authenticated administrators. The shared module validates the
 * notification type and rejects external action_url values regardless of caller.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';
import { recordNotification } from '../../shared/notifications.ts';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const caller = await base44.auth.me().catch(() => null);
    if (!caller) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    if (caller.role !== 'admin') return Response.json({ error: 'Admin only' }, { status: 403 });

    const body = await req.json();
    const res = await recordNotification(base44, body);
    return Response.json(res);
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
});