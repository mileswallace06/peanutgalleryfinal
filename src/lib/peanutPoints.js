/**
 * Peanut Points — fan loyalty & reputation engine
 * Central source of truth for point values, levels, ranks, trust logic.
 */

// ─── Point Values ────────────────────────────────────────────────────────────
export const POINT_VALUES = {
  purchase:                   25,
  first_purchase:             50,   // bonus on top of purchase
  sale_completed:             40,
  instant_listing_verified:   75,
  quick_buyer_confirm:        10,   // confirmed within 2 hours
  quick_seller_fulfill:       15,   // fulfilled within 4 hours
  referral_success:          100,
  live_event_activity:        20,
  feedback_left:               5,
  achievement_unlock:          0,   // varies per achievement, bonus applied separately
  dispute_penalty:           -30,
  trust_bonus:                20,
};

// ─── Level / Rank Tiers (based on lifetime_points) ───────────────────────────
export const RANKS = [
  { level: 1,  rank: 'Rookie Fan',    min: 0,     color: '#8a8a8a', emoji: '🎟️' },
  { level: 2,  rank: 'Crowd Member',  min: 100,   color: '#00C8FF', emoji: '👥' },
  { level: 3,  rank: 'Regular',       min: 300,   color: '#00FF87', emoji: '🎶' },
  { level: 4,  rank: 'Diehard',       min: 750,   color: '#BF5FFF', emoji: '🔥' },
  { level: 5,  rank: 'Section Rep',   min: 1500,  color: '#FF8C00', emoji: '📣' },
  { level: 6,  rank: 'Arena Veteran', min: 3000,  color: '#FF2D78', emoji: '🏟️' },
  { level: 7,  rank: 'Season Pro',    min: 6000,  color: '#FFE600', emoji: '⭐' },
  { level: 8,  rank: 'Front Row',     min: 12000, color: '#00FF87', emoji: '🎤' },
  { level: 9,  rank: 'VIP',           min: 25000, color: '#BF5FFF', emoji: '💜' },
  { level: 10, rank: 'Hall of Fame',  min: 50000, color: '#FFE600', emoji: '🏆' },
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
  const earned = lifetimePoints - current.min;
  return Math.min(Math.max(earned / range, 0), 1);
}

// ─── Trust Badges ─────────────────────────────────────────────────────────────
export const TRUST_BADGE_DEFS = {
  trusted_seller:           { label: 'Trusted Seller',           emoji: '🛡️', color: '#00FF87',  desc: '3+ successful sales without disputes' },
  fast_fulfillment:         { label: 'Fast Fulfillment',         emoji: '⚡', color: '#00C8FF',  desc: 'Consistently fulfills tickets quickly' },
  verified_instant_seller:  { label: 'Verified Instant Seller',  emoji: '✅', color: '#BF5FFF',  desc: 'Has completed instant transfer listings' },
  reliable_buyer:           { label: 'Reliable Buyer',           emoji: '🤝', color: '#FF8C00',  desc: 'Quick to confirm ticket receipt' },
  top_fan:                  { label: 'Top Fan',                  emoji: '🏆', color: '#FFE600',  desc: 'Ranked in the top tier of Peanut Points' },
};

// ─── Achievements ─────────────────────────────────────────────────────────────
export const ACHIEVEMENT_DEFS = {
  first_purchase:         { label: 'First Purchase',        emoji: '🎟️', desc: 'Made your first ticket purchase',           bonus: 50 },
  first_sale:             { label: 'First Sale',            emoji: '💸', desc: 'Completed your first ticket sale',           bonus: 50 },
  instant_pioneer:        { label: 'Instant Pioneer',       emoji: '⚡', desc: 'Created your first Instant Transfer listing', bonus: 25 },
  five_sales:             { label: 'Crowd Pleaser',         emoji: '👏', desc: 'Completed 5 successful sales',               bonus: 100 },
  ten_sales:              { label: 'Volume Seller',         emoji: '📦', desc: 'Completed 10 successful sales',              bonus: 200 },
  referral_starter:       { label: 'Connector',             emoji: '🔗', desc: 'Referred your first fan',                   bonus: 50 },
  trust_milestone:        { label: 'Highly Trusted',        emoji: '🛡️', desc: 'Reached a trust score of 80+',              bonus: 75 },
  live_event_participant: { label: 'In the Moment',         emoji: '🎶', desc: 'Participated during a live event',           bonus: 30 },
  streak_5:               { label: 'On a Roll',             emoji: '🔥', desc: '5 successful sales in a row',               bonus: 50 },
};

// ─── Trust Score Logic ────────────────────────────────────────────────────────
export function recalcTrustScore(user) {
  let score = 50;

  const sales = user.total_sales || 0;
  const streak = user.seller_streak || 0;
  const instantListings = user.total_instant_listings || 0;
  const achievements = user.achievements || [];
  const lifetimePts = user.lifetime_points || 0;

  // Positive signals
  score += Math.min(sales * 3, 20);         // up to +20 for sales history
  score += Math.min(streak * 2, 15);        // up to +15 for streak
  score += Math.min(instantListings * 4, 12); // up to +12 for instant
  if (achievements.includes('trust_milestone')) score += 5;
  if (lifetimePts > 1000) score += 5;

  return Math.min(Math.max(Math.round(score), 0), 100);
}

/**
 * Determines which trust badges a user qualifies for.
 */
export function computeTrustBadges(user) {
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