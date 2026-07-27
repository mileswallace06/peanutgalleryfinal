/**
 * getPublicProfile — return an explicitly-allowlisted public profile.
 * Lookup is by public_profile_id ONLY (never user_id). user_id is never
 * present on the public entity and never returned.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  let user;
  try { user = await base44.auth.me(); } catch (_) { return Response.json({ error: 'Unauthorized' }, { status: 401 }); }
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const public_profile_id = body?.public_profile_id;
  if (!public_profile_id) return Response.json({ error: 'public_profile_id required' }, { status: 400 });

  const rows = await base44.asServiceRole.entities.PublicProfile.filter({ public_profile_id });
  const profile = rows[0];
  if (!profile) return Response.json({ error: 'Profile not found' }, { status: 404 });

  return Response.json({
    profile: {
      public_profile_id: profile.public_profile_id,
      display_name: profile.display_name,
      avatar_url: profile.avatar_url,
      banner_url: profile.banner_url,
      bio: profile.bio,
      persona_name: profile.persona_name,
      persona_style: profile.persona_style,
      verified_fan: profile.verified_fan,
      is_founding_fan: profile.is_founding_fan,
      peanut_level: profile.peanut_level,
      peanut_rank: profile.peanut_rank,
      trust_badges: profile.trust_badges,
      achievements: profile.achievements,
      public_trust_summary: profile.public_trust_summary,
      referral_code: profile.referral_code,
    },
  });
});