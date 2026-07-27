/**
 * updateMyProfile — authenticated user updates their own public profile.
 * The user_id ↔ public_profile_id mapping lives in UserPrivate (private).
 * PublicProfile itself never stores or returns user_id.
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

  // Resolve the opaque public_profile_id from the private mapping (UserPrivate).
  let privRows = await base44.asServiceRole.entities.UserPrivate.filter({ user_email: user.email });
  let priv = privRows[0];
  let public_profile_id = priv?.public_profile_id;

  if (!public_profile_id) {
    public_profile_id = `pp_${crypto.randomUUID()}`;
    if (priv) {
      await base44.asServiceRole.entities.UserPrivate.update(priv.id, { public_profile_id });
    } else {
      await base44.asServiceRole.entities.UserPrivate.create({
        user_id: user.id, user_email: user.email, public_profile_id,
        phone: null, has_seen_onboarding: false, preferences: {}, updated_at: new Date().toISOString(),
      });
    }
  }

  const pubRows = await base44.asServiceRole.entities.PublicProfile.filter({ public_profile_id });
  const profile = pubRows[0];
  if (!profile) {
    await base44.asServiceRole.entities.PublicProfile.create({ public_profile_id, ...allowed });
  } else {
    await base44.asServiceRole.entities.PublicProfile.update(profile.id, allowed);
  }
  return Response.json({ success: true, public_profile_id });
});