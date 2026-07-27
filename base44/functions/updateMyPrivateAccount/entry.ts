/**
 * updateMyPrivateAccount — authenticated user updates their own private
 * account record. Only an explicit allowlist is accepted.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const EDITABLE = ['phone', 'has_seen_onboarding', 'preferences'];

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  let user;
  try { user = await base44.auth.me(); } catch (_) { return Response.json({ error: 'Unauthorized' }, { status: 401 }); }
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const allowed = {};
  for (const k of EDITABLE) if (k in body) allowed[k] = body[k];
  allowed.updated_at = new Date().toISOString();

  const rows = await base44.asServiceRole.entities.UserPrivate.filter({ user_email: user.email });
  const priv = rows[0];
  if (!priv) {
    await base44.asServiceRole.entities.UserPrivate.create({
      user_id: user.id, user_email: user.email, ...allowed,
    });
  } else {
    await base44.asServiceRole.entities.UserPrivate.update(priv.id, allowed);
  }
  return Response.json({ success: true });
});