/**
 * Peanut Points — fan loyalty & reputation engine
 * Central source of truth for point values, levels, ranks, trust logic, badges.
 *
 * DESIGN PRINCIPLES:
 * - Rewards marketplace value, trust, liquidity, speed/reliability
 * - Does NOT create cash-equivalent currency
 * - Anti-farming: daily caps, duplicate guards, completion-only rewards
 * - Negative behavior costs more than normal activity earns
 */

// ─── Point Values ────────────────────────────────────────────────────────────
export const POINT_VALUES = {
  // ── One-time setup
  profile_completed:              40,   // once
  stripe_connected:              100,   // once
  first_purchase:                 75,   // bonus on top of purchase
  first_sale:                    100,   // bonus on top of sale_completed
  first_instant_listing:         100,   // bonus on top of instant_listing_verified

  // ── Marketplace actions (completion-only)
  purchase:                       25,
  sale_completed:                 50,
  instant_listing_verified:       40,
  instant_listing_sold:           75,   // when an instant listing's purchase completes
  live_upgrade_purchase:          35,
  live_upgrade_sale:              60,

  // ── Speed / reliability bonuses
  seller_transfer_15min:          25,   // within 15 minutes
  seller_transfer_1hr:            15,   // within 1 hour (exclusive with 15min)
  buyer_confirm_15min:            15,   // within 15 minutes
  buyer_confirm_1hr:              10,   // within 1 hour (exclusive with 15min)
  instant_fulfillment_clean:      20,   // PG instant fulfillment completed without issue

  // ── Community / feedback (capped)
  feedback_left:                   5,   // max +10/day
  fan_zone_post:                   3,   // max +9/day
  beta_bug_report:                25,   // admin-verified only
  critical_bug_report:            75,   // admin-verified only

  // ── Referrals
  referral_signup:               100,   // referred user signs up
  referral_first_transaction:    150,   // referred user completes first purchase or sale
  referral_verified_seller:      100,   // referred user becomes verified seller

  // ── Penalties (negative)
  failed_transfer:               -75,
  confirmed_fraud:              -250,
  seller_dispute:               -100,
  repeated_cancellation:         -25,
  abusive_behavior:              -50,

  // ── Special
  achievement_unlock:              0,   // bonus handled separately via ACHIEVEMENT_DEFS
  trust_bonus:                    20,   // awarded on trust milestones
};

// ─── Daily caps ───────────────────────────────────────────────────────────────
export const DAILY_CAPS = {
  feedback_left:   10,   // max pts/day from feedback
  fan_zone_post:    9,   // max pts/day from fan zone posts
};

// ─── Level / Rank Tiers (based on lifetime_points) ───────────────────────────
// Progression: each tier ~1.55x harder than prior
export const RANKS = [
  { level: 1,  rank: 'Rookie Fan',      min: 0,     color: '#8a8a8a', emoji: '🎟️' },
  { level: 2,  rank: 'Crowd Member',    min: 100,   color: '#00C8FF', emoji: '👥' },
  { level: 3,  rank: 'Regular',         min: 250,   color: '#00FF87', emoji: '🎶' },
  { level: 4,  rank: 'Diehard',         min: 500,   color: '#BF5FFF', emoji: '🔥' },
  { level: 5,  rank: 'Arena Veteran',   min: 850,   color: '#FF8C00', emoji: '🏟️' },
  { level: 6,  rank: 'Verified Fan',    min: 1450,  color: '#FF2D78', emoji: '✅' },
  { level: 7,  rank: 'Front Row',       min: 2350,  color: '#00C8FF', emoji: '🎤' },
  { level: 8,  rank: 'Headliner',       min: 3750,  color: '#FFE600', emoji: '⭐' },
  { level: 9,  rank: 'Legend',          min: 5900,  color: '#BF5FFF', emoji: '💜' },
  { level: 10, rank: 'Hall of Fame',    min: 9200,  color: '#FFE600', emoji: '🏆' },
];

/**
 * Returns the current rank tier for a given lifetime_points value.
 */
export function getRankForPoints(lifetimePoints = 0) {
  const pts = lifetimePoints || 0;
  let current = RANKS[0];
  for (const tier of RANKS) {
    if (pts >= tier.min) current = tier;
    else break;
  }
  return current;
}

/**
 * Returns the next rank tier, or null if max level.
 */
export function getNextRank(lifetimePoints = 0) {
  const current = getRankForPoints(lifetimePoints);
  const idx = RANKS.findIndex(r => r.level === current.level);
  return RANKS[idx + 1] || null;
}

/**
 * Returns progress 0–1 toward the next rank.
 */
export function getLevelProgress(lifetimePoints = 0) {
  const current = getRankForPoints(lifetimePoints);
  const next = getNextRank(lifetimePoints);
  if (!next) return 1;
  const range = next.min - current.min;
  const earned = (lifetimePoints || 0) - current.min;
  return Math.min(Math.max(earned / range, 0), 1);
}

// ─── Rank Unlocks (status/access only — never cash) ──────────────────────────
export const RANK_UNLOCKS = {
  2:  ['Profile badge', 'Leaderboard eligibility'],
  3:  ['Fan credibility badge'],
  4:  ['Trusted Fan badge', 'Profile flair'],
  5:  ['Arena Veteran badge', 'Higher community visibility'],
  6:  ['Verified Fan rank', 'Priority support visibility'],
  7:  ['Front Row rank', 'Priority Instant Listing review eligibility'],
  8:  ['Headliner rank', 'Featured seller eligibility'],
  9:  ['Legend rank', 'Premium profile badge', 'Top leaderboard styling'],
  10: ['Hall of Fame badge', 'Permanent all-time leaderboard recognition'],
};

// ─── Trust Badge Definitions ──────────────────────────────────────────────────
export const TRUST_BADGE_DEFS = {
  trusted_fan:              { label: 'Trusted Fan',             emoji: '🛡️', color: '#00FF87',  desc: 'Trust score ≥ 70' },
  verified_seller:          { label: 'Verified Seller',         emoji: '✅', color: '#00C8FF',  desc: 'Trust ≥ 85 with 3+ sales' },
  fast_transfer:            { label: 'Fast Transfer',           emoji: '⚡', color: '#FFE600',  desc: '3+ quick seller fulfillments' },
  instant_pro:              { label: 'Instant Pro',             emoji: '🚀', color: '#BF5FFF',  desc: '3+ verified instant listings' },
  reliable_buyer:           { label: 'Reliable Buyer',          emoji: '🤝', color: '#FF8C00',  desc: '5+ completed purchases, no disputes' },
  founding_fan:             { label: 'Founding Fan',            emoji: '🌟', color: '#FF2D78',  desc: 'Early beta user' },
  hall_of_fame:             { label: 'Hall of Fame',            emoji: '🏆', color: '#FFE600',  desc: 'Lifetime points ≥ 9,200' },
  bug_hunter:               { label: 'Bug Hunter',              emoji: '🐛', color: '#00FF87',  desc: 'Verified critical bug report' },
  live_upgrade_regular:     { label: 'Live Upgrade Regular',    emoji: '📈', color: '#00C8FF',  desc: '3+ live upgrade transactions' },
};

// ─── Achievements ─────────────────────────────────────────────────────────────
export const ACHIEVEMENT_DEFS = {
  first_purchase:           { label: 'First Purchase',        emoji: '🎟️', desc: 'Made your first ticket purchase',            bonus: 0 },  // first_purchase action already gives +75
  first_sale:               { label: 'First Sale',            emoji: '💸', desc: 'Completed your first ticket sale',            bonus: 0 },  // first_sale action already gives +100
  first_instant_listing:    { label: 'Instant Pioneer',       emoji: '⚡', desc: 'Created your first Instant Transfer listing',  bonus: 0 },
  stripe_onboarded:         { label: 'Payout Ready',          emoji: '🏦', desc: 'Connected Stripe payouts',                    bonus: 0 },
  five_sales:               { label: 'Crowd Pleaser',         emoji: '👏', desc: '5 successful sales',                          bonus: 75 },
  ten_sales:                { label: 'Volume Seller',         emoji: '📦', desc: '10 successful sales',                         bonus: 150 },
  twenty_sales:             { label: 'Pro Seller',            emoji: '💼', desc: '20 successful sales',                         bonus: 250 },
  five_purchases:           { label: 'Season Regular',        emoji: '🎫', desc: '5 completed purchases',                       bonus: 50 },
  ten_purchases:            { label: 'Venue Regular',         emoji: '🏟️', desc: '10 completed purchases',                      bonus: 100 },
  referral_starter:         { label: 'Connector',             emoji: '🔗', desc: 'Referred your first fan',                     bonus: 0 },
  three_instant_listings:   { label: 'Instant Pro',           emoji: '🚀', desc: '3 verified instant listings',                  bonus: 50 },
  three_live_upgrades:      { label: 'Upgrade Addict',        emoji: '📈', desc: '3+ live upgrade transactions',                 bonus: 50 },
  trust_milestone_70:       { label: 'Trusted Fan',           emoji: '🛡️', desc: 'Reached Trust Score of 70',                   bonus: 30 },
  trust_milestone_85:       { label: 'Verified Status',       emoji: '✅', desc: 'Reached Trust Score of 85',                   bonus: 50 },
  streak_5:                 { label: 'On a Roll',             emoji: '🔥', desc: '5 successful sales in a row',                  bonus: 75 },
  streak_10:                { label: 'Unstoppable',           emoji: '⚡', desc: '10 successful sales in a row',                 bonus: 150 },
  hall_of_fame_entry:       { label: 'Hall of Fame',          emoji: '🏆', desc: 'Reached 9,200 lifetime points',               bonus: 500 },
  critical_bug_hunter:      { label: 'Bug Hunter',            emoji: '🐛', desc: 'Verified critical bug report',                 bonus: 0 },
};

// ─── Trust Score Logic ────────────────────────────────────────────────────────
/**
 * Fully recalculates a user's trust score from their stored counters.
 * Returns a number 0–100.
 *
 * Positive signals (max contributions shown):
 *   purchases       +1 each, up to +10
 *   sales           +2 each, up to +20
 *   seller_streak   +2 each, up to +15
 *   instant         +2 each, up to +10
 *   fast_transfers  +2 each, up to +8
 *   No disputes after 5 tx: +5, after 10 tx: +10 (cumulative)
 *
 * Negative signals:
 *   failed_transfers   -15 each (tracked via trust_deductions)
 *   seller_disputes    -20 each
 *   confirmed_fraud    -50 each
 *   repeated_cancels   -5 each
 *   false_disputes     -15 each
 */
export function recalcTrustScore(user) {
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

  // Positive
  score += Math.min(purchases * 1, 10);
  score += Math.min(sales * 2, 20);
  score += Math.min(streak * 2, 15);
  score += Math.min(instant * 2, 10);
  score += Math.min(fastCount * 2, 8);
  if (totalTx >= 5  && disputes === 0) score += 5;
  if (totalTx >= 10 && disputes === 0) score += 10;  // cumulative (+15 total)

  // Negative
  score -= failures  * 15;
  score -= disputes  * 20;
  score -= fraudFlags * 50;
  score -= Math.min(cancels * 5, 25);
  score -= falseDis  * 15;

  return Math.min(Math.max(Math.round(score), 0), 100);
}

/**
 * Trust label for a given score.
 */
export function getTrustLabel(score) {
  if (score >= 95) return 'Elite Trust';
  if (score >= 85) return 'Verified Seller / Reliable Buyer';
  if (score >= 70) return 'Trusted Fan';
  if (score >= 50) return 'Standard User';
  if (score >= 30) return 'New / Limited History';
  return 'Risk Flag';
}

/**
 * Trust label color.
 */
export function getTrustColor(score) {
  if (score >= 85) return '#00FF87';
  if (score >= 70) return '#00C8FF';
  if (score >= 50) return '#FFE600';
  if (score >= 30) return '#FF8C00';
  return '#FF2D78';
}

/**
 * Determines which trust badges a user qualifies for.
 */
export function computeTrustBadges(user) {
  const badges = [];
  const trustScore  = user.trust_score             || 50;
  const sales       = user.total_sales             || 0;
  const instant     = user.total_instant_listings  || 0;
  const purchases   = user.total_purchases         || 0;
  const disputes    = user.total_disputes          || 0;
  const fastCount   = user.total_fast_transfers    || 0;
  const lifetimePts = user.lifetime_points         || 0;
  const achievements = user.achievements           || [];
  const liveUpgrades = user.total_live_upgrades    || 0;
  const isFounding  = user.is_founding_fan         || false;

  if (trustScore >= 70)                            badges.push('trusted_fan');
  if (trustScore >= 85 && sales >= 3)              badges.push('verified_seller');
  if (fastCount >= 3)                              badges.push('fast_transfer');
  if (instant >= 3)                                badges.push('instant_pro');
  if (purchases >= 5 && disputes === 0)            badges.push('reliable_buyer');
  if (isFounding)                                  badges.push('founding_fan');
  if (lifetimePts >= 9200)                         badges.push('hall_of_fame');
  if (achievements.includes('critical_bug_hunter')) badges.push('bug_hunter');
  if (liveUpgrades >= 3)                           badges.push('live_upgrade_regular');

  return badges;
}