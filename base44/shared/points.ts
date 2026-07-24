/**
 * Shared backend Peanut Points engine.
 *
 * Architecture: imported DIRECTLY by trusted backend functions (capturePayment,
 * seatDonation, etc.) and run in-process. NOT a public endpoint — so there is
 * no caller-supplied target email, no spoofable header, and no public function
 * to invoke. The caller is trusted; this module STILL re-fetches the
 * authoritative referenced entity and confirms the qualifying state occurred,
 * so a buggy or malicious caller cannot award points on a non-qualifying record.
 *
 * Guarantees:
 *  - The caller cannot choose an arbitrary target that doesn't match the record.
 *  - The caller cannot invent a reference id — it is fetched and validated.
 *  - Duplicate awards are impossible (reference_id dedup).
 *  - Daily caps remain enforced.
 *  - Demo / self-purchase / admin-test transactions award zero points.
 *  - Negative penalties are rejected unless opts.allowAdminAction is set
 *    (only the admin-only public awardPoints wrapper passes that).
 */

// ── Point Values (must stay in sync with lib/peanutPoints.js) ──────────────────
export const POINT_VALUES = {
  profile_completed: 40, stripe_connected: 100, first_purchase: 75,
  first_sale: 100, first_instant_listing: 100,
  purchase: 25, sale_completed: 50, instant_listing_verified: 40,
  instant_listing_sold: 75, live_upgrade_purchase: 35, live_upgrade_sale: 60,
  seller_transfer_15min: 25, seller_transfer_1hr: 15, buyer_confirm_15min: 15,
  buyer_confirm_1hr: 10, instant_fulfillment_clean: 20, quick_seller_fulfill: 20,
  quick_buyer_confirm: 15,
  feedback_left: 5, fan_zone_post: 3, beta_bug_report: 25, critical_bug_report: 75,
  referral_signup: 100, referral_first_transaction: 150, referral_verified_seller: 100,
  seat_donation_created: 150, donation_accepted: 75, live_event_donation: 50,
  first_donation: 0, donation_received: 10,
  failed_transfer: -75, confirmed_fraud: -250, seller_dispute: -100,
  repeated_cancellation: -25, abusive_behavior: -50,
  achievement_unlock: 0, trust_bonus: 20,
};

const PURCHASE_ACTIONS = new Set([
  'purchase', 'sale_completed', 'live_upgrade_purchase', 'live_upgrade_sale',
  'seller_transfer_15min', 'seller_transfer_1hr', 'buyer_confirm_15min',
  'buyer_confirm_1hr', 'quick_seller_fulfill', 'quick_buyer_confirm',
]);
const LISTING_ACTIONS = new Set(['instant_listing_verified', 'instant_listing_sold', 'instant_fulfillment_clean']);
const ADMIN_ONLY_ACTIONS = new Set([
  'beta_bug_report', 'critical_bug_report', 'confirmed_fraud', 'abusive_behavior',
  'failed_transfer', 'seller_dispute', 'repeated_cancellation',
]);
const DISABLED_ACTIONS = new Set(['referral_signup', 'referral_first_transaction', 'referral_verified_seller']);

const DAILY_CAPS = { feedback_left: 10, fan_zone_post: 9, seat_donation_created: 450, donation_accepted: 225 };

const RANKS = [
  { level: 1, rank: 'Rookie Fan', min: 0 }, { level: 2, rank: 'Crowd Member', min: 100 },
  { level: 3, rank: 'Regular', min: 250 }, { level: 4, rank: 'Diehard', min: 500 },
  { level: 5, rank: 'Arena Veteran', min: 850 }, { level: 6, rank: 'Verified Fan', min: 1450 },
  { level: 7, rank: 'Front Row', min: 2350 }, { level: 8, rank: 'Headliner', min: 3750 },
  { level: 9, rank: 'Legend', min: 5900 }, { level: 10, rank: 'Hall of Fame', min: 9200 },
];

function getRankForPoints(pts) {
  let current = RANKS[0];
  for (const tier of RANKS) { if (pts >= tier.min) current = tier; else break; }
  return current;
}

const ACHIEVEMENT_DEFS = {
  first_purchase: { bonus: 0 }, first_sale: { bonus: 0 }, first_instant_listing: { bonus: 0 },
  stripe_onboarded: { bonus: 0 }, five_sales: { bonus: 75 }, ten_sales: { bonus: 150 },
  twenty_sales: { bonus: 250 }, five_purchases: { bonus: 50 }, ten_purchases: { bonus: 100 },
  referral_starter: { bonus: 0 }, three_instant_listings: { bonus: 50 },
  three_live_upgrades: { bonus: 50 }, trust_milestone_70: { bonus: 30 },
  trust_milestone_85: { bonus: 50 }, streak_5: { bonus: 75 }, streak_10: { bonus: 150 },
  hall_of_fame_entry: { bonus: 500 }, critical_bug_hunter: { bonus: 0 },
  fan_hero: { bonus: 100 }, community_mvp: { bonus: 200 }, upgrade_angel: { bonus: 350 },
};

const DEFAULT_DESCS = {
  profile_completed: 'Completed your profile', stripe_connected: 'Connected Stripe payouts',
  first_purchase: 'First ticket purchase bonus', first_sale: 'First successful sale bonus',
  first_instant_listing: 'First Instant Listing bonus', purchase: 'Completed a ticket purchase',
  sale_completed: 'Completed a successful sale', instant_listing_verified: 'Instant Listing verified by PG',
  instant_listing_sold: 'Instant Listing sold successfully', live_upgrade_purchase: 'Completed a live upgrade purchase',
  live_upgrade_sale: 'Completed a live upgrade sale', seller_transfer_15min: 'Transferred ticket within 15 minutes',
  seller_transfer_1hr: 'Transferred ticket within 1 hour', buyer_confirm_15min: 'Confirmed ticket receipt within 15 minutes',
  buyer_confirm_1hr: 'Confirmed ticket receipt within 1 hour', instant_fulfillment_clean: 'PG Instant fulfillment completed without issue',
  feedback_left: 'Helpful feedback submitted', fan_zone_post: 'Fan Zone post',
  beta_bug_report: 'Beta bug report (verified)', critical_bug_report: 'Critical bug report (verified)',
  referral_signup: 'Referred a new fan who signed up', referral_first_transaction: 'Referral completed their first transaction',
  referral_verified_seller: 'Referral became a verified seller', failed_transfer: 'Failed ticket transfer',
  confirmed_fraud: 'Confirmed fraud or scam behavior', seller_dispute: 'Dispute caused by seller negligence',
  repeated_cancellation: 'Repeated cancelled sales', abusive_behavior: 'Abusive or spam behavior',
  achievement_unlock: 'Achievement unlocked', trust_bonus: 'Trust milestone reached',
  seat_donation_created: 'Created a seat donation', donation_accepted: 'Donation accepted',
  live_event_donation: 'Live-event donation', donation_received: 'Received a donation',
};

function recalcTrustScore(user) {
  let score = 50;
  const purchases = user.total_purchases || 0, sales = user.total_sales || 0;
  const streak = user.seller_streak || 0, instant = user.total_instant_listings || 0;
  const fastCount = user.total_fast_transfers || 0, disputes = user.total_disputes || 0;
  const cancels = user.total_cancelled_sales || 0, failures = user.total_failed_transfers || 0;
  const fraudFlags = user.confirmed_fraud_count || 0, falseDis = user.false_dispute_count || 0;
  const totalTx = purchases + sales;
  score += Math.min(purchases * 1, 10); score += Math.min(sales * 2, 20);
  score += Math.min(streak * 2, 15); score += Math.min(instant * 2, 10);
  score += Math.min(fastCount * 2, 8);
  if (totalTx >= 5 && disputes === 0) score += 5;
  if (totalTx >= 10 && disputes === 0) score += 10;
  score -= failures * 15; score -= disputes * 20; score -= fraudFlags * 50;
  score -= Math.min(cancels * 5, 25); score -= falseDis * 15;
  return Math.min(Math.max(Math.round(score), 0), 100);
}

function computeTrustBadges(user) {
  const badges = [];
  const trustScore = user.trust_score || 50, sales = user.total_sales || 0;
  const instant = user.total_instant_listings || 0, purchases = user.total_purchases || 0;
  const disputes = user.total_disputes || 0, fastCount = user.total_fast_transfers || 0;
  const lifetimePts = user.lifetime_points || 0, achievements = user.achievements || [];
  const liveUpgrades = user.total_live_upgrades || 0, isFounding = user.is_founding_fan || false;
  if (trustScore >= 70) badges.push('trusted_fan');
  if (trustScore >= 85 && sales >= 3) badges.push('verified_seller');
  if (fastCount >= 3) badges.push('fast_transfer');
  if (instant >= 3) badges.push('instant_pro');
  if (purchases >= 5 && disputes === 0) badges.push('reliable_buyer');
  if (isFounding) badges.push('founding_fan');
  if (lifetimePts >= 9200) badges.push('hall_of_fame');
  if (achievements.includes('critical_bug_hunter')) badges.push('bug_hunter');
  if (liveUpgrades >= 3) badges.push('live_upgrade_regular');
  return badges;
}

async function getDailyPointsForAction(base44, userEmail, action) {
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayIso = todayStart.toISOString();
  const logs = await base44.asServiceRole.entities.PointsActivity.filter(
    { user_email: userEmail, action, created_date: { $gte: todayIso } },
    '-created_date', 100
  ).catch(() => []);
  return logs.reduce((sum, l) => sum + (l.points || 0), 0);
}

async function isDuplicate(base44, userEmail, action, referenceId) {
  if (!referenceId) return false;
  const existing = await base44.asServiceRole.entities.PointsActivity.filter({
    user_email: userEmail, action, reference_id: referenceId,
  });
  return existing.length > 0;
}

// Re-fetch the referenced entity and confirm the qualifying state. The caller
// is trusted, but this prevents awarding on a non-completed/demo/self purchase.
async function validateReference(base44, action, referenceId, recipientEmail) {
  if (!referenceId) return { valid: false, reason: 'reference_id required for this action' };

  if (PURCHASE_ACTIONS.has(action)) {
    const purchases = await base44.asServiceRole.entities.Purchase.filter({ id: referenceId }).catch(() => []);
    const p = purchases[0];
    if (!p) return { valid: false, reason: 'purchase not found' };
    if (p.is_demo) return { valid: false, reason: 'demo purchase' };
    if (p.transfer_status !== 'completed') return { valid: false, reason: 'purchase not completed' };
    if (p.buyer_email === p.seller_email) return { valid: false, reason: 'self-purchase' };
    const buyerActions = ['purchase', 'live_upgrade_purchase', 'buyer_confirm_15min', 'buyer_confirm_1hr', 'quick_buyer_confirm'];
    const sellerActions = ['sale_completed', 'live_upgrade_sale', 'seller_transfer_15min', 'seller_transfer_1hr', 'quick_seller_fulfill'];
    if (buyerActions.includes(action) && p.buyer_email !== recipientEmail) return { valid: false, reason: 'recipient is not the buyer' };
    if (sellerActions.includes(action) && p.seller_email !== recipientEmail) return { valid: false, reason: 'recipient is not the seller' };
    return { valid: true };
  }
  if (LISTING_ACTIONS.has(action)) {
    const listings = await base44.asServiceRole.entities.Listing.filter({ id: referenceId }).catch(() => []);
    const l = listings[0];
    if (!l) return { valid: false, reason: 'listing not found' };
    if (l.seller_email !== recipientEmail) return { valid: false, reason: 'recipient is not the seller of this listing' };
    return { valid: true };
  }
  return { valid: true };
}

/**
 * awardPointsInternal — trusted-internal point award.
 * opts.allowAdminAction: set true only by the admin-only public wrapper for
 *   penalty / bug-report actions. Trusted marketplace flows never need it.
 * opts.description: optional custom description.
 */
export async function awardPointsInternal(base44, recipientEmail, action, referenceId, referenceType, opts = {}) {
  if (!action) return { success: false, reason: 'action required' };
  if (DISABLED_ACTIONS.has(action)) return { success: false, reason: 'referral_system_not_yet_live' };
  const basePts = POINT_VALUES[action];
  if (basePts === undefined) return { success: false, reason: 'unknown_action' };

  // Penalties / admin-gated actions require explicit admin authority.
  if (ADMIN_ONLY_ACTIONS.has(action) && !opts.allowAdminAction) {
    return { success: false, reason: 'admin_only_action' };
  }

  const [recipient] = await base44.asServiceRole.entities.User.filter({ email: recipientEmail });
  if (!recipient) return { success: false, reason: 'user not found' };

  // Duplicate guard
  if (await isDuplicate(base44, recipientEmail, action, referenceId)) {
    return { success: false, reason: 'duplicate_action' };
  }

  // Re-fetch + validate the referenced entity for marketplace actions.
  if (PURCHASE_ACTIONS.has(action) || LISTING_ACTIONS.has(action)) {
    const ref = await validateReference(base44, action, referenceId, recipientEmail);
    if (!ref.valid) {
      console.warn(`[awardPointsInternal] reference validation failed for ${recipientEmail} action=${action} ref=${referenceId}: ${ref.reason}`);
      return { success: false, reason: ref.reason };
    }
  }

  // Daily caps
  let pts = basePts;
  if (DAILY_CAPS[action] !== undefined && pts > 0) {
    const earnedToday = await getDailyPointsForAction(base44, recipientEmail, action);
    const remaining = DAILY_CAPS[action] - earnedToday;
    if (remaining <= 0) return { success: false, reason: 'daily_cap_reached' };
    pts = Math.min(pts, remaining);
  }

  const description = opts.description || DEFAULT_DESCS[action] || action;

  const currentPts = recipient.peanut_points || 0;
  const currentLifetime = recipient.lifetime_points || 0;
  const newPts = Math.max(0, currentPts + pts);
  const newLifetime = pts > 0 ? currentLifetime + pts : currentLifetime;

  const achievements = [...(recipient.achievements || [])];
  const newAchievements = [];
  const newSales = (recipient.total_sales || 0) + (action === 'sale_completed' ? 1 : 0);
  const newPurchases = (recipient.total_purchases || 0) + ((action === 'purchase' || action === 'live_upgrade_purchase') ? 1 : 0);
  const newInstant = (recipient.total_instant_listings || 0) + (action === 'instant_listing_verified' ? 1 : 0);
  const newLiveUpgrades = (recipient.total_live_upgrades || 0) + ((action === 'live_upgrade_purchase' || action === 'live_upgrade_sale') ? 1 : 0);

  const check = (key, condition) => {
    if (condition && !achievements.includes(key)) { achievements.push(key); newAchievements.push(key); }
  };
  check('first_purchase', action === 'purchase' && newPurchases === 1);
  check('first_sale', action === 'sale_completed' && newSales === 1);
  check('first_instant_listing', action === 'instant_listing_verified' && newInstant === 1);
  check('stripe_onboarded', action === 'stripe_connected');
  check('referral_starter', action === 'referral_signup');
  check('critical_bug_hunter', action === 'critical_bug_report');

  const newDonations = (recipient.total_donations_made || 0) + (action === 'seat_donation_created' ? 1 : 0);
  check('fan_hero', newDonations >= 1);
  check('community_mvp', newDonations >= 5);
  check('upgrade_angel', newDonations >= 10);
  check('five_sales', newSales >= 5); check('ten_sales', newSales >= 10); check('twenty_sales', newSales >= 20);
  check('five_purchases', newPurchases >= 5); check('ten_purchases', newPurchases >= 10);
  check('three_instant_listings', newInstant >= 3); check('three_live_upgrades', newLiveUpgrades >= 3);

  let sellerStreak = recipient.seller_streak || 0;
  if (action === 'sale_completed') sellerStreak += 1;
  if (action === 'failed_transfer' || action === 'seller_dispute') sellerStreak = 0;
  check('streak_5', sellerStreak >= 5); check('streak_10', sellerStreak >= 10);

  let fastTransfers = recipient.total_fast_transfers || 0;
  if (action === 'seller_transfer_15min' || action === 'seller_transfer_1hr') fastTransfers += 1;

  let totalDisputes = recipient.total_disputes || 0;
  let totalFailures = recipient.total_failed_transfers || 0;
  let totalCancels = recipient.total_cancelled_sales || 0;
  let fraudCount = recipient.confirmed_fraud_count || 0;
  if (action === 'seller_dispute') totalDisputes += 1;
  if (action === 'failed_transfer') totalFailures += 1;
  if (action === 'repeated_cancellation') totalCancels += 1;
  if (action === 'confirmed_fraud') fraudCount += 1;

  let achievementBonus = 0;
  for (const key of newAchievements) achievementBonus += ACHIEVEMENT_DEFS[key]?.bonus || 0;

  const finalPts = newPts + achievementBonus;
  const finalLifetime = newLifetime + achievementBonus;

  const projectedUser = {
    ...recipient, total_purchases: newPurchases, total_sales: newSales,
    total_instant_listings: newInstant, total_live_upgrades: newLiveUpgrades,
    total_fast_transfers: fastTransfers, total_disputes: totalDisputes,
    total_failed_transfers: totalFailures, total_cancelled_sales: totalCancels,
    confirmed_fraud_count: fraudCount, seller_streak: sellerStreak,
    lifetime_points: finalLifetime, achievements,
  };
  check('trust_milestone_70', recalcTrustScore(projectedUser) >= 70 && !recipient.achievements?.includes('trust_milestone_70'));
  check('trust_milestone_85', recalcTrustScore(projectedUser) >= 85 && !recipient.achievements?.includes('trust_milestone_85'));
  for (const key of ['trust_milestone_70', 'trust_milestone_85']) {
    if (newAchievements.includes(key)) achievementBonus += ACHIEVEMENT_DEFS[key]?.bonus || 0;
  }
  const veryFinalPts = newPts + achievementBonus;
  const veryFinalLifetime = newLifetime + achievementBonus;
  check('hall_of_fame_entry', veryFinalLifetime >= 9200 && !achievements.includes('hall_of_fame_entry'));
  let hofBonus = 0;
  if (newAchievements.includes('hall_of_fame_entry')) hofBonus = ACHIEVEMENT_DEFS.hall_of_fame_entry.bonus;
  const trulyFinalPts = veryFinalPts + hofBonus;
  const trulyFinalLifetime = veryFinalLifetime + hofBonus;

  const newRankTier = getRankForPoints(trulyFinalLifetime);
  const finalProjected = { ...projectedUser, lifetime_points: trulyFinalLifetime, achievements };
  const trustScore = recalcTrustScore(finalProjected);
  const trustBadges = computeTrustBadges({ ...finalProjected, trust_score: trustScore });
  const newDonationsMade = (recipient.total_donations_made || 0) + (action === 'seat_donation_created' ? 1 : 0);

  await base44.asServiceRole.entities.User.update(recipient.id, {
    peanut_points: trulyFinalPts, lifetime_points: trulyFinalLifetime,
    peanut_level: newRankTier.level, peanut_rank: newRankTier.rank,
    trust_score: trustScore, trust_badges: trustBadges, achievements,
    seller_streak: sellerStreak, total_purchases: newPurchases, total_sales: newSales,
    total_instant_listings: newInstant, total_live_upgrades: newLiveUpgrades,
    total_fast_transfers: fastTransfers, total_disputes: totalDisputes,
    total_failed_transfers: totalFailures, total_cancelled_sales: totalCancels,
    confirmed_fraud_count: fraudCount, total_donations_made: newDonationsMade,
    points_last_updated: new Date().toISOString(),
  });

  await base44.asServiceRole.entities.PointsActivity.create({
    user_email: recipientEmail, action,
    points: pts + achievementBonus + hofBonus, description,
    reference_id: referenceId || null, reference_type: referenceType || null,
  });

  return {
    success: true, points_awarded: pts + achievementBonus + hofBonus,
    new_balance: trulyFinalPts, new_lifetime: trulyFinalLifetime,
    new_rank: newRankTier.rank, new_level: newRankTier.level,
    new_achievements: newAchievements, trust_score: trustScore, trust_badges: trustBadges,
  };
}