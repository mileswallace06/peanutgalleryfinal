import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

// ─── Point & rank config (inlined — no local imports in functions) ────────────
const POINT_VALUES = {
  purchase:                   25,
  first_purchase:             50,
  sale_completed:             40,
  instant_listing_verified:   75,
  quick_buyer_confirm:        10,
  quick_seller_fulfill:       15,
  referral_success:          100,
  live_event_activity:        20,
  feedback_left:               5,
  achievement_unlock:          0,
  dispute_penalty:           -30,
  trust_bonus:                20,
};

const RANKS = [
  { level: 1,  rank: 'Rookie Fan',    min: 0 },
  { level: 2,  rank: 'Crowd Member',  min: 100 },
  { level: 3,  rank: 'Regular',       min: 300 },
  { level: 4,  rank: 'Diehard',       min: 750 },
  { level: 5,  rank: 'Section Rep',   min: 1500 },
  { level: 6,  rank: 'Arena Veteran', min: 3000 },
  { level: 7,  rank: 'Season Pro',    min: 6000 },
  { level: 8,  rank: 'Front Row',     min: 12000 },
  { level: 9,  rank: 'VIP',           min: 25000 },
  { level: 10, rank: 'Hall of Fame',  min: 50000 },
];

const ACHIEVEMENT_DEFS = {
  first_purchase:         { bonus: 50 },
  first_sale:             { bonus: 50 },
  instant_pioneer:        { bonus: 25 },
  five_sales:             { bonus: 100 },
  ten_sales:              { bonus: 200 },
  referral_starter:       { bonus: 50 },
  trust_milestone:        { bonus: 75 },
  live_event_participant: { bonus: 30 },
  streak_5:               { bonus: 50 },
};

function getRankForPoints(pts) {
  let current = RANKS[0];
  for (const tier of RANKS) {
    if (pts >= tier.min) current = tier;
    else break;
  }
  return current;
}

function recalcTrustScore(user) {
  let score = 50;
  const sales = user.total_sales || 0;
  const streak = user.seller_streak || 0;
  const instant = user.total_instant_listings || 0;
  const achievements = user.achievements || [];
  const lifetimePts = user.lifetime_points || 0;
  score += Math.min(sales * 3, 20);
  score += Math.min(streak * 2, 15);
  score += Math.min(instant * 4, 12);
  if (achievements.includes('trust_milestone')) score += 5;
  if (lifetimePts > 1000) score += 5;
  return Math.min(Math.max(Math.round(score), 0), 100);
}

function computeTrustBadges(user) {
  const badges = [];
  const sales = user.total_sales || 0;
  const streak = user.seller_streak || 0;
  const instant = user.total_instant_listings || 0;
  const purchases = user.total_purchases || 0;
  const lifetimePts = user.lifetime_points || 0;
  if (sales >= 3 && streak >= 3) badges.push('trusted_seller');
  if (streak >= 5) badges.push('fast_fulfillment');
  if (instant >= 1) badges.push('verified_instant_seller');
  if (purchases >= 3) badges.push('reliable_buyer');
  if (lifetimePts >= 5000) badges.push('top_fan');
  return badges;
}

// ─── Anti-abuse: check if same action was logged recently for same reference ──
async function isDuplicate(base44, userEmail, action, referenceId) {
  if (!referenceId) return false;
  const existing = await base44.asServiceRole.entities.PointsActivity.filter({
    user_email: userEmail,
    action,
    reference_id: referenceId,
  });
  return existing.length > 0;
}

// ─── Main handler ─────────────────────────────────────────────────────────────
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json();
    const {
      action,
      reference_id,
      reference_type,
      target_email, // optional: award to a different user (admin use)
      description: customDesc,
    } = body;

    if (!action) return Response.json({ error: 'action required' }, { status: 400 });

    // Only admins can award points to other users
    const recipientEmail = target_email && user.role === 'admin' ? target_email : user.email;

    // Look up current recipient profile
    const [recipient] = await base44.asServiceRole.entities.User.filter({ email: recipientEmail });
    if (!recipient) return Response.json({ error: 'User not found' }, { status: 404 });

    // Anti-abuse: block duplicate awards for same reference
    const dupeCheck = await isDuplicate(base44, recipientEmail, action, reference_id);
    if (dupeCheck) {
      return Response.json({ success: false, reason: 'duplicate_action' });
    }

    // Determine base points — undefined means unknown action, 0 is valid (achievement_unlock)
    const pts = POINT_VALUES[action];
    if (pts === undefined) {
      return Response.json({ error: `Unknown action: ${action}` }, { status: 400 });
    }

    // Build description
    const DEFAULT_DESCS = {
      purchase:                  'Bought tickets',
      first_purchase:            'First ticket purchase — welcome bonus!',
      sale_completed:            'Completed a successful ticket sale',
      instant_listing_verified:  'Instant Transfer listing verified by Peanut Gallery',
      quick_buyer_confirm:       'Confirmed ticket receipt quickly',
      quick_seller_fulfill:      'Fulfilled ticket transfer quickly',
      referral_success:          'Referred a new fan',
      live_event_activity:       'Active during a live event',
      feedback_left:             'Left helpful feedback',
      dispute_penalty:           'Dispute filed against this account',
      trust_bonus:               'Earned a trust milestone',
    };
    const description = customDesc || DEFAULT_DESCS[action] || action;

    // Compute new totals — lifetime never decrements on penalties
    const currentPts = recipient.peanut_points || 0;
    const currentLifetime = recipient.lifetime_points || 0;
    const newPts = Math.max(0, currentPts + pts);
    const newLifetime = pts > 0 ? currentLifetime + pts : currentLifetime;

    // Check for achievement unlocks
    const achievements = [...(recipient.achievements || [])];
    const newAchievements = [];
    const currentSales = (recipient.total_sales || 0) + (action === 'sale_completed' ? 1 : 0);
    const currentPurchases = (recipient.total_purchases || 0) + (action === 'purchase' ? 1 : 0);

    const checkAchieve = (key, condition) => {
      if (condition && !achievements.includes(key)) {
        achievements.push(key);
        newAchievements.push(key);
      }
    };

    checkAchieve('first_purchase', action === 'purchase' && currentPurchases === 1);
    checkAchieve('first_sale', action === 'sale_completed' && currentSales === 1);
    checkAchieve('instant_pioneer', action === 'instant_listing_verified');
    checkAchieve('five_sales', currentSales >= 5);
    checkAchieve('ten_sales', currentSales >= 10);
    checkAchieve('referral_starter', action === 'referral_success');
    checkAchieve('live_event_participant', action === 'live_event_activity');

    // Add bonus points for newly unlocked achievements
    let achievementBonus = 0;
    for (const key of newAchievements) {
      achievementBonus += ACHIEVEMENT_DEFS[key]?.bonus || 0;
    }

    const finalPts = newPts + achievementBonus;
    const finalLifetime = newLifetime + achievementBonus;

    // Determine new rank
    const newRankTier = getRankForPoints(finalLifetime);

    // Update seller streak
    let sellerStreak = recipient.seller_streak || 0;
    if (action === 'sale_completed') sellerStreak = sellerStreak + 1;
    if (action === 'dispute_penalty') sellerStreak = 0;
    checkAchieve('streak_5', sellerStreak >= 5);

    // Recompute trust
    const updatedUser = {
      ...recipient,
      total_purchases: currentPurchases,
      total_sales: currentSales,
      total_instant_listings: (recipient.total_instant_listings || 0) + (action === 'instant_listing_verified' ? 1 : 0),
      lifetime_points: finalLifetime,
      achievements,
      seller_streak: sellerStreak,
    };
    if (finalLifetime >= 8000) checkAchieve('trust_milestone', true);

    const trustScore = recalcTrustScore(updatedUser);
    const trustBadges = computeTrustBadges(updatedUser);

    // Persist: update user
    await base44.asServiceRole.entities.User.update(recipient.id, {
      peanut_points: finalPts,
      lifetime_points: finalLifetime,
      peanut_level: newRankTier.level,
      peanut_rank: newRankTier.rank,
      trust_score: trustScore,
      trust_badges: trustBadges,
      achievements,
      seller_streak: sellerStreak,
      total_purchases: currentPurchases,
      total_sales: currentSales,
      total_instant_listings: updatedUser.total_instant_listings,
      points_last_updated: new Date().toISOString(),
    });

    // Log activity
    await base44.asServiceRole.entities.PointsActivity.create({
      user_email: recipientEmail,
      action,
      points: pts + achievementBonus,
      description,
      reference_id: reference_id || null,
      reference_type: reference_type || null,
    });

    return Response.json({
      success: true,
      points_awarded: pts + achievementBonus,
      new_balance: finalPts,
      new_lifetime: finalLifetime,
      new_rank: newRankTier.rank,
      new_level: newRankTier.level,
      new_achievements: newAchievements,
      trust_score: trustScore,
      trust_badges: trustBadges,
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});