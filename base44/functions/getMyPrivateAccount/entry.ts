/**
 * getMyPrivateAccount — return the authenticated user's own private account
 * record with an explicit allowlist. Never returns the full sidecar.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  let user;
  try { user = await base44.auth.me(); } catch (_) { return Response.json({ error: 'Unauthorized' }, { status: 401 }); }
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  const rows = await base44.asServiceRole.entities.UserPrivate.filter({ user_email: user.email });
  const priv = rows[0];
  return Response.json({
    account: {
      user_id: user.id,
      user_email: user.email,
      phone: priv?.phone,
      has_seen_onboarding: priv?.has_seen_onboarding,
      points_last_updated: priv?.points_last_updated,
      referred_by: priv?.referred_by,
      preferences: priv?.preferences,
    },
  });
});