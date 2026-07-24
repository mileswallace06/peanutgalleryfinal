/**
 * awardPoints (PUBLIC) — admin-only manual point grant.
 *
 * Internal backend functions import the shared `points` module directly
 * (in-process) and never call this endpoint, so there is no spoofable internal
 * call flag or service-role request header to bypass. This public
 * endpoint is restricted to authenticated administrators; a regular user cannot
 * award points to anyone. Admins may target any user and may grant penalty /
 * admin-gated actions. The shared engine re-fetches the referenced entity and
 * enforces duplicate guards, daily caps, demo/self-purchase exclusion.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';
import { awardPointsInternal } from '../../shared/points.ts';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch(() => null);
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    if (user.role !== 'admin') return Response.json({ error: 'Admin only' }, { status: 403 });

    const { action, reference_id, reference_type, target_email, description } = await req.json();
    const recipient = target_email || user.email;
    const res = await awardPointsInternal(base44, recipient, action, reference_id, reference_type, {
      allowAdminAction: true,
      description,
    });
    if (!res.success && res.reason === 'unknown_action') return Response.json({ error: 'Unknown action' }, { status: 400 });
    return Response.json(res);
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
});