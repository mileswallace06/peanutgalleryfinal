/**
 * getPublicProfile — return an explicitly-allowlisted public profile.
 * Public fields only; never email, Stripe, fraud, location, or internals.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  let user;
  try { user = await base44.auth.me(); } catch (_) { return Response.json({ error: 'Unauthorized' }, { status: 401 }); }
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  const url = new URL(req.url);
  const user_id = url.searchParams.get('user_id');
  const public_profile_id = url.searchParams.get('public_profile_id');

  let rows;
  if (public_profile_id) rows = await base44.asServiceRole.entities.PublicProfile.filter({ public_profile_id });
  else if (user_id) rows = await base44.asServiceRole.entities.PublicProfile.filter({ user_id });
  else return Response.json({ error: 'user_id or public_profile_id required' }, { status: 400 });

  const profile = rows[0];
  if (!profile) return Response.json({ error: 'Profile not found' }, { status: 404 });

  return Response.json({
    profile: {
      user_id: profile.user_id,
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