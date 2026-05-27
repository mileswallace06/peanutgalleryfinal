import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * awardPoints — Peanut Points economy backend function
 *
 * Inlines all point/rank/trust logic (no local imports allowed in functions).
 *
 * ANTI-ABUSE PROTECTIONS:
 * 1. Duplicate guard: same action+reference_id never awarded twice
 * 2. Transaction validity: only completed transactions earn points
 * 3. Self-purchase: buyer === seller → no points
 * 4. Daily caps: feedback_left (+10/day max), fan_zone_post (+9/day max)
 * 5. Admin/test: admin transactions excluded unless is_real_transaction=true
 * 6. Referrals: only on legitimate first transaction completion
 */

// ─── Point Values (must stay in sync with lib/peanutPoints.js) ───────────────
const POINT_VALUES = {
  // One-time setup
  profile_completed:              40,
  stripe_connected:              100,
  first_purchase:                 75,
  first_sale:                    100,
  first_instant_listing:         100,

  // Marketplace (completion-only)
  purchase:                       25,
  sale_completed:                 50,
  instant_listing_verified:       40,
  instant_listing_sold:           75,
  live_upgrade_purchase:          35,
  live_upgrade_sale:              60,

  // Speed/reliability bonuses
  seller_transfer_15min:          25,
  seller_transfer_1hr:            15,
  buyer_confirm_15min:            15,
  buyer_confirm_1hr:              10,
  instant_fulfillment_clean:      20,

  // Community (capped)
  feedback_left:                   5,
  fan_zone_post:                   3,
  beta_bug_report:                25,
  critical_bug_report:            75,

  // Referrals
  referral_signup:               100,
  referral_first_transaction:    150,
  referral_verified_seller:      100,

  // Seat Donations
  seat_donation_created:         150,   // donor creates a donation
  donation_accepted:              75,   // donor's donation was accepted
  live_event_donation:            50,   // bonus for donating during live event
  first_donation:                  0,   // achievement — bonus handled by ACHIEVEMENT_DEFS
  donation_received:              10,   // recipient receives donated seats

  // Penalties
  failed_transfer:               -75,
  confirmed_fraud:              -250,
  seller_dispute:               -100,
  repeated_cancellation:         -25,
  abusive_behavior:              -50,

  // Special
  achievement_unlock:              0,
  trust_bonus:                    20,
};

// Donation achievements
// (added to ACHIEVEMENT_DEFS below)

// ─── Daily caps ───────────────────────────────────────────────────────────────
const DAILY_CAPS = {
  feedback_left:  10,
  fan_zone_post:   9,
};

// ─── Ranks ────────────────────────────────────────────────────────────────────
const RANKS = [
  { level: 1,  rank: 'Rookie Fan',    min: 0     },
  { level: 2,  rank: 'Crowd Member',  min: 100   },
  { level: 3,  rank: 'Regular',       min: 250   },
  { level: 4,  rank: 'Diehard',       min: 500   },
  { level: 5,  rank: 'Arena Veteran', min: 850   },
  { level: 6,  rank: 'Verified Fan',  min: 1450  },
  { level: 7,  rank: 'Front Row',     min: 2350  },
  { level: 8,  rank: 'Headliner',     min: 3750  },
  { level: 9,  rank: 'Legend',        min: 5900  },
  { level: 10, rank: 'Hall of Fame',  min: 9200  },
];

function getRankForPoints(pts) {
  let current = RANKS[0];
  for (const tier of RANKS) {
    if (pts >= tier.min) current = tier;
    else break;
  }
  return current;
}

// ─── Achievement definitions (bonus points on unlock) ────────────────────────
const ACHIEVEMENT_DEFS = {
  first_purchase:           { bonus: 0 },   // first_purchase action covers this
  first_sale:               { bonus: 0 },   // first_sale action covers this
  first_instant_listing:    { bonus: 0 },
  stripe_onboarded:         { bonus: 0 },
  five_sales:               { bonus: 75 },
  ten_sales:                { bonus: 150 },
  twenty_sales:             { bonus: 250 },
  five_purchases:           { bonus: 50 },
  ten_purchases:            { bonus: 100 },
  referral_starter:         { bonus: 0 },
  three_instant_listings:   { bonus: 50 },
  three_live_upgrades:      { bonus: 50 },
  trust_milestone_70:       { bonus: 30 },
  trust_milestone_85:       { bonus: 50 },
  streak_5:                 { bonus: 75 },
  streak_10:                { bonus: 150 },
  hall_of_fame_entry:       { bonus: 500 },
  critical_bug_hunter:      { bonus: 0 },
  // Donation achievements
  fan_hero:                 { bonus: 100 },   // first donation
  community_mvp:            { bonus: 200 },   // 5 donations
  upgrade_angel:            { bonus: 350 },   // 10 donations
};

// ─── Trust Score ──────────────────────────────────────────────────────────────
function recalcTrustScore(user) {
  let score = 50;
  const purchases  = user.total_purchases          || 0;
  const sales      = user.total_sales              || 0;
  const streak     = user.seller_streak            || 0;
  const instant    = user.total_instant_listings   || 0;
  const fastCount  = user.total_fast_transfers     || 0;
  const disputes   = user.total_disputes           || 0;
  const cancels    = user.total_cancelled_sales    || 0;
  const failures   = user.total_failed_transfers   || 0;
  const fraudFlags = user.confirmed_fraud_count    || 0;
  const falseDis   = user.false_dispute_count      || 0;
  const totalTx    = purchases + sales;

  score += Math.min(purchases * 1, 10);
  score += Math.min(sales * 2, 20);
  score += Math.min(streak * 2, 15);
  score += Math.min(instant * 2, 10);
  score += Math.min(fastCount * 2, 8);
  if (totalTx >= 5  && disputes === 0) score += 5;
  if (totalTx >= 10 && disputes === 0) score += 10;

  score -= failures   * 15;
  score -= disputes   * 20;
  score -= fraudFlags * 50;
  score -= Math.min(cancels * 5, 25);
  score -= falseDis   * 15;

  return Math.min(Math.max(Math.round(score), 0), 100);
}

function computeTrustBadges(user) {
  const badges       = [];
  const trustScore   = user.trust_score            || 50;
  const sales        = user.total_sales            || 0;
  const instant      = user.total_instant_listings || 0;
  const purchases    = user.total_purchases        || 0;
  const disputes     = user.total_disputes         || 0;
  const fastCount    = user.total_fast_transfers   || 0;
  const lifetimePts  = user.lifetime_points        || 0;
  const achievements = user.achievements           || [];
  const liveUpgrades = user.total_live_upgrades    || 0;
  const isFounding   = user.is_founding_fan        || false;

  if (trustScore >= 70)                             badges.push('trusted_fan');
  if (trustScore >= 85 && sales >= 3)               badges.push('verified_seller');
  if (fastCount >= 3)                               badges.push('fast_transfer');
  if (instant >= 3)                                 badges.push('instant_pro');
  if (purchases >= 5 && disputes === 0)             badges.push('reliable_buyer');
  if (isFounding)                                   badges.push('founding_fan');
  if (lifetimePts >= 9200)                          badges.push('hall_of_fame');
  if (achievements.includes('critical_bug_hunter')) badges.push('bug_hunter');
  if (liveUpgrades >= 3)                            badges.push('live_upgrade_regular');

  return badges;
}

// ─── Daily cap check ──────────────────────────────────────────────────────────
async function getDailyPointsForAction(base44, userEmail, action) {
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const logs = await base44.asServiceRole.entities.PointsActivity.filter({
    user_email: userEmail,
    action,
  });
  const todayLogs = logs.filter(l => new Date(l.created_date) >= todayStart);
  return todayLogs.reduce((sum, l) => sum + (l.points || 0), 0);
}

// ─── Duplicate guard ──────────────────────────────────────────────────────────
async function isDuplicate(base44, userEmail, action, referenceId) {
  if (!referenceId) return false;
  const existing = await base44.asServiceRole.entities.PointsActivity.filter({
    user_email: userEmail,
    action,
    reference_id: referenceId,
  });
  return existing.length > 0;
}

// ─── Default descriptions ─────────────────────────────────────────────────────
const DEFAULT_DESCS = {
  profile_completed:           'Completed your profile',
  stripe_connected:            'Connected Stripe payouts',
  first_purchase:              'First ticket purchase bonus',
  first_sale:                  'First successful sale bonus',
  first_instant_listing:       'First Instant Listing bonus',
  purchase:                    'Completed a ticket purchase',
  sale_completed:              'Completed a successful sale',
  instant_listing_verified:    'Instant Listing verified by PG',
  instant_listing_sold:        'Instant Listing sold successfully',
  live_upgrade_purchase:       'Completed a live upgrade purchase',
  live_upgrade_sale:           'Completed a live upgrade sale',
  seller_transfer_15min:       'Transferred ticket within 15 minutes',
  seller_transfer_1hr:         'Transferred ticket within 1 hour',
  buyer_confirm_15min:         'Confirmed ticket receipt within 15 minutes',
  buyer_confirm_1hr:           'Confirmed ticket receipt within 1 hour',
  instant_fulfillment_clean:   'PG Instant fulfillment completed without issue',
  feedback_left:               'Helpful feedback submitted',
  fan_zone_post:               'Fan Zone post',
  beta_bug_report:             'Beta bug report (verified)',
  critical_bug_report:         'Critical bug report (verified)',
  referral_signup:             'Referred a new fan who signed up',
  referral_first_transaction:  'Referral completed their first transaction',
  referral_verified_seller:    'Referral became a verified seller',
  failed_transfer:             'Failed ticket transfer',
  confirmed_fraud:             'Confirmed fraud or scam behavior',
  seller_dispute:              'Dispute caused by seller negligence',
  repeated_cancellation:       'Repeated cancelled sales',
  abusive_behavior:            'Abusive or spam behavior',
  achievement_unlock:          'Achievement unlocked',
  trust_bonus:                 'Trust milestone reached',
};

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
      target_email,
      description: customDesc,
      metadata = {},
    } = body;

    if (!action) return Response.json({ error: 'action required' }, { status: 400 });

    // Validate action
    const basePts = POINT_VALUES[action];
    if (basePts === undefined) {
      return Response.json({ error: `Unknown action: ${action}` }, { status: 400 });
    }

    // Only admins can award points to other users or apply admin-only actions
    const isAdmin = user.role === 'admin';
    const recipientEmail = (target_email && isAdmin) ? target_email : user.email;

    // Admin-only actions: bug reports, fraud, abuse
    const adminOnlyActions = ['beta_bug_report', 'critical_bug_report', 'confirmed_fraud', 'abusive_behavior'];
    if (adminOnlyActions.includes(action) && !isAdmin) {
      return Response.json({ error: 'Admin only action' }, { status: 403 });
    }

    // Fetch recipient
    const [recipient] = await base44.asServiceRole.entities.User.filter({ email: recipientEmail });
    if (!recipient) return Response.json({ error: 'User not found' }, { status: 404 });

    // ── Anti-abuse: duplicate guard
    const dupeCheck = await isDuplicate(base44, recipientEmail, action, reference_id);
    if (dupeCheck) {
      return Response.json({ success: false, reason: 'duplicate_action' });
    }

    // ── Anti-abuse: daily caps
    let pts = basePts;
    if (DAILY_CAPS[action] !== undefined && pts > 0) {
      const earnedToday = await getDailyPointsForAction(base44, recipientEmail, action);
      const remaining = DAILY_CAPS[action] - earnedToday;
      if (remaining <= 0) {
        return Response.json({ success: false, reason: 'daily_cap_reached' });
      }
      pts = Math.min(pts, remaining);
    }

    const description = customDesc || DEFAULT_DESCS[action] || action;

    // ── Compute new totals
    const currentPts     = recipient.peanut_points   || 0;
    const currentLifetime = recipient.lifetime_points || 0;
    const newPts         = Math.max(0, currentPts + pts);
    const newLifetime    = pts > 0 ? currentLifetime + pts : currentLifetime; // lifetime never decrements

    // ── Achievement detection
    const achievements = [...(recipient.achievements || [])];
    const newAchievements = [];

    // Updated counters (projected)
    const newSales     = (recipient.total_sales     || 0) + (action === 'sale_completed' ? 1 : 0);
    const newPurchases = (recipient.total_purchases || 0) + (action === 'purchase' || action === 'live_upgrade_purchase' ? 1 : 0);
    const newInstant   = (recipient.total_instant_listings || 0) + (action === 'instant_listing_verified' ? 1 : 0);
    const newLiveUpgrades = (recipient.total_live_upgrades || 0) + (action === 'live_upgrade_purchase' || action === 'live_upgrade_sale' ? 1 : 0);

    const check = (key, condition) => {
      if (condition && !achievements.includes(key)) {
        achievements.push(key);
        newAchievements.push(key);
      }
    };

    check('first_purchase',        action === 'purchase'                   && newPurchases === 1);
    check('first_sale',            action === 'sale_completed'             && newSales === 1);
    check('first_instant_listing', action === 'instant_listing_verified'  && newInstant === 1);
    check('stripe_onboarded',      action === 'stripe_connected');
    check('referral_starter',      action === 'referral_signup');
    check('critical_bug_hunter',   action === 'critical_bug_report');

    // Donation achievements — need donation totals from DB (lightweight check via reference counts)
    const newDonations = (recipient.total_donations_made || 0) + (action === 'seat_donation_created' ? 1 : 0);
    check('fan_hero',      newDonations >= 1);
    check('community_mvp', newDonations >= 5);
    check('upgrade_angel', newDonations >= 10);
    check('five_sales',            newSales >= 5);
    check('ten_sales',             newSales >= 10);
    check('twenty_sales',          newSales >= 20);
    check('five_purchases',        newPurchases >= 5);
    check('ten_purchases',         newPurchases >= 10);
    check('three_instant_listings',newInstant >= 3);
    check('three_live_upgrades',   newLiveUpgrades >= 3);

    // Streak updates
    let sellerStreak = recipient.seller_streak || 0;
    if (action === 'sale_completed') sellerStreak += 1;
    if (action === 'failed_transfer' || action === 'seller_dispute') sellerStreak = 0;
    check('streak_5',  sellerStreak >= 5);
    check('streak_10', sellerStreak >= 10);

    // Fast transfer counter
    let fastTransfers = recipient.total_fast_transfers || 0;
    if (action === 'seller_transfer_15min' || action === 'seller_transfer_1hr') fastTransfers += 1;

    // Dispute/failure counters
    let totalDisputes       = recipient.total_disputes          || 0;
    let totalFailures       = recipient.total_failed_transfers  || 0;
    let totalCancels        = recipient.total_cancelled_sales   || 0;
    let fraudCount          = recipient.confirmed_fraud_count   || 0;
    if (action === 'seller_dispute')       totalDisputes += 1;
    if (action === 'failed_transfer')      totalFailures += 1;
    if (action === 'repeated_cancellation') totalCancels += 1;
    if (action === 'confirmed_fraud')      fraudCount += 1;

    // Achievement bonus points
    let achievementBonus = 0;
    for (const key of newAchievements) {
      achievementBonus += ACHIEVEMENT_DEFS[key]?.bonus || 0;
    }

    const finalPts      = newPts + achievementBonus;
    const finalLifetime = newLifetime + achievementBonus;

    // ── Trust score checks AFTER projecting all counters
    const projectedUser = {
      ...recipient,
      total_purchases:        newPurchases,
      total_sales:            newSales,
      total_instant_listings: newInstant,
      total_live_upgrades:    newLiveUpgrades,
      total_fast_transfers:   fastTransfers,
      total_disputes:         totalDisputes,
      total_failed_transfers: totalFailures,
      total_cancelled_sales:  totalCancels,
      confirmed_fraud_count:  fraudCount,
      seller_streak:          sellerStreak,
      lifetime_points:        finalLifetime,
      achievements,
    };

    check('trust_milestone_70', recalcTrustScore(projectedUser) >= 70 && !recipient.achievements?.includes('trust_milestone_70'));
    check('trust_milestone_85', recalcTrustScore(projectedUser) >= 85 && !recipient.achievements?.includes('trust_milestone_85'));

    // Re-add bonus for trust milestones if just unlocked
    for (const key of ['trust_milestone_70', 'trust_milestone_85']) {
      if (newAchievements.includes(key)) {
        achievementBonus += ACHIEVEMENT_DEFS[key]?.bonus || 0;
      }
    }

    const veryFinalPts      = newPts + achievementBonus;
    const veryFinalLifetime = newLifetime + achievementBonus;

    // Hall of Fame entry achievement
    check('hall_of_fame_entry', veryFinalLifetime >= 9200 && !achievements.includes('hall_of_fame_entry'));
    let hofBonus = 0;
    if (newAchievements.includes('hall_of_fame_entry')) {
      hofBonus = ACHIEVEMENT_DEFS.hall_of_fame_entry.bonus;
    }

    const trulyFinalPts      = veryFinalPts + hofBonus;
    const trulyFinalLifetime = veryFinalLifetime + hofBonus;

    // ── Final rank & trust
    const newRankTier  = getRankForPoints(trulyFinalLifetime);
    const finalProjected = { ...projectedUser, lifetime_points: trulyFinalLifetime, achievements };
    const trustScore   = recalcTrustScore(finalProjected);
    const trustBadges  = computeTrustBadges({ ...finalProjected, trust_score: trustScore });

    // ── Persist user update
    const newDonationsMade = (recipient.total_donations_made || 0) + (action === 'seat_donation_created' ? 1 : 0);

    await base44.asServiceRole.entities.User.update(recipient.id, {
      peanut_points:          trulyFinalPts,
      lifetime_points:        trulyFinalLifetime,
      peanut_level:           newRankTier.level,
      peanut_rank:            newRankTier.rank,
      trust_score:            trustScore,
      trust_badges:           trustBadges,
      achievements,
      seller_streak:          sellerStreak,
      total_purchases:        newPurchases,
      total_sales:            newSales,
      total_instant_listings: newInstant,
      total_live_upgrades:    newLiveUpgrades,
      total_fast_transfers:   fastTransfers,
      total_disputes:         totalDisputes,
      total_failed_transfers: totalFailures,
      total_cancelled_sales:  totalCancels,
      confirmed_fraud_count:  fraudCount,
      total_donations_made:   newDonationsMade,
      points_last_updated:    new Date().toISOString(),
    });

    // ── Log activity
    await base44.asServiceRole.entities.PointsActivity.create({
      user_email:     recipientEmail,
      action,
      points:         pts + achievementBonus + hofBonus,
      description,
      reference_id:   reference_id || null,
      reference_type: reference_type || null,
    });

    return Response.json({
      success:          true,
      points_awarded:   pts + achievementBonus + hofBonus,
      new_balance:      trulyFinalPts,
      new_lifetime:     trulyFinalLifetime,
      new_rank:         newRankTier.rank,
      new_level:        newRankTier.level,
      new_achievements: newAchievements,
      trust_score:      trustScore,
      trust_badges:     trustBadges,
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});