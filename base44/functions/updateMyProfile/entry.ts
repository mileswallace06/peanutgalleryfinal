/**
 * updateMyProfile — authenticated user updates their own public profile.
 * Only an explicit allowlist of editable public fields is accepted.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const EDITABLE = ['display_name', 'avatar_url', 'banner_url', 'bio', 'persona_name', 'persona_style'];

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  let user;
  try { user = await base44.auth.me(); } catch (_) { return Response.json({ error: 'Unauthorized' }, { status: 401 }); }
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const allowed = {};
  for (const k of EDITABLE) if (k in body) allowed[k] = body[k];
  allowed.updated_at = new Date().toISOString();

  const rows = await base44.asServiceRole.entities.PublicProfile.filter({ user_id: user.id });
  const profile = rows[0];
  if (!profile) {
    await base44.asServiceRole.entities.PublicProfile.create({
      user_id: user.id, public_profile_id: `pp_${crypto.randomUUID()}`, ...allowed,
    });
  } else {
    await base44.asServiceRole.entities.PublicProfile.update(profile.id, allowed);
  }
  return Response.json({ success: true });
});