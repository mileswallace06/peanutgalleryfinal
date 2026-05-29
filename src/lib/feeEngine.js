/**
 * Peanut Gallery Fee Engine v2
 * ─────────────────────────────
 * Single source of truth for all fee logic.
 * Used by: Checkout, Admin Fee Simulator, Seller payout preview, Analytics.
 *
 * ⚠️  LIVE CHECKOUT USES ACTIVE_FEE_MODEL_ID ONLY.
 * All other models exist for simulation/comparison — they do NOT affect production.
 * To switch live pricing: change ACTIVE_FEE_MODEL_ID (and update STRIPE_ASSUMPTIONS if needed).
 */

// ── Stripe processing fee (always charged on buyer total) ────────────────────
export const STRIPE_ASSUMPTIONS = {
  pct: 0.029,   // 2.9%
  fixed: 0.30,  // $0.30 per transaction
};

// ── ACTIVE FEE MODEL — single switch to change live pricing ─────────────────
// ⚠️  DO NOT change this without testing the full checkout flow.
// Activated 2026-05-27: 5% buyer fee + $1 minimum (approved beta pricing).
export const ACTIVE_FEE_MODEL_ID = 'buyer_5_min_1';

// ── Minimum listing price (enforced at listing creation) ─────────────────────
export const MIN_LISTING_PRICE_CONFIG = {
  enabled: true,
  threshold: 10, // dollars — enforced 2026-05-27
};

// ── Fee Models ───────────────────────────────────────────────────────────────
// Each model defines:
//   buyer_fee_pct    — % added on top of subtotal (buyer pays)
//   buyer_fee_min    — minimum buyer fee floor
//   seller_fee_pct   — % deducted from subtotal (seller pays)
//   seller_fee_min   — minimum seller fee floor
//   instant_only     — true = only applies to instant/PG-custody listings
export const FEE_MODELS = {
  // ── Model A — CURRENT LIVE MODEL ──────────────────────────────────────────
  buyer_5_min_1: {
    id: 'buyer_5_min_1',
    label: 'Current: Buyer 5% + $1 min',
    shortLabel: '5% min $1',
    description: 'Buyer pays 5% (min $1). Seller pays nothing. Live model since 2026-05-27.',
    isLive: true,
    buyer_fee_pct: 0.05,
    buyer_fee_min: 1.00,
    seller_fee_pct: 0.00,
    seller_fee_min: 0.00,
  },

  // ── Model B — Proposed: Split 5%/5% ───────────────────────────────────────
  buyer_5_seller_5: {
    id: 'buyer_5_seller_5',
    label: 'Proposed: Buyer 5% + Seller 5%',
    shortLabel: 'B5% + S5%',
    description: 'Buyer pays 5% (min $1). Seller pays 5%. PG earns both sides.',
    buyer_fee_pct: 0.05,
    buyer_fee_min: 1.00,
    seller_fee_pct: 0.05,
    seller_fee_min: 0.00,
  },

  // ── Model C — Conservative: Buyer 5% + Seller 3% ─────────────────────────
  buyer_5_seller_3: {
    id: 'buyer_5_seller_3',
    label: 'Conservative: Buyer 5% + Seller 3%',
    shortLabel: 'B5% + S3%',
    description: 'Buyer pays 5% (min $1). Seller pays 3%. Lower seller friction.',
    buyer_fee_pct: 0.05,
    buyer_fee_min: 1.00,
    seller_fee_pct: 0.03,
    seller_fee_min: 0.00,
  },

  // ── Model D — Instant Transfer Premium ────────────────────────────────────
  instant_buyer_5_seller_10: {
    id: 'instant_buyer_5_seller_10',
    label: 'Instant Premium: Buyer 5% + Seller 10%',
    shortLabel: 'B5% + S10%',
    description: 'Buyer pays 5% (min $1). Seller pays 10%. For PG-custody/instant listings only.',
    instant_only: true,
    buyer_fee_pct: 0.05,
    buyer_fee_min: 1.00,
    seller_fee_pct: 0.10,
    seller_fee_min: 0.00,
  },

  // ── Model E — Flat Plus Percent ───────────────────────────────────────────
  buyer_5_seller_5_plus_1: {
    id: 'buyer_5_seller_5_plus_1',
    label: 'Premium: Buyer 5% + Seller 5% + $1 floor',
    shortLabel: 'B5% + S5% $1',
    description: 'Buyer pays 5% (min $1). Seller pays 5% (min $1). Highest take rate.',
    buyer_fee_pct: 0.05,
    buyer_fee_min: 1.00,
    seller_fee_pct: 0.05,
    seller_fee_min: 1.00,
  },

  // ── Legacy aliases (keep backward compat with old model IDs) ─────────────
  current_5pct: {
    id: 'current_5pct',
    label: 'Legacy: 5% buyer only',
    shortLabel: '5%',
    description: 'Legacy alias — identical to buyer_5_min_1 without $1 floor.',
    buyer_fee_pct: 0.05,
    buyer_fee_min: 0.00,
    seller_fee_pct: 0.00,
    seller_fee_min: 0.00,
  },
  pct5_min1: {
    id: 'pct5_min1',
    label: 'Legacy alias: 5% + $1 min',
    shortLabel: '5% min $1',
    description: 'Legacy alias for buyer_5_min_1.',
    buyer_fee_pct: 0.05,
    buyer_fee_min: 1.00,
    seller_fee_pct: 0.00,
    seller_fee_min: 0.00,
  },
};

// ── Core calculator ──────────────────────────────────────────────────────────
/**
 * Calculate all fee components for a given ticket price, quantity, and model.
 * @returns {{
 *   ticketPrice, quantity, subtotal,
 *   buyerFee, buyerTotal,
 *   sellerFee, sellerPayout,
 *   pgGrossRevenue, stripeFee, pgNetRevenue,
 *   effectiveTakeRate, sellerPayoutRate,
 *   profitable, breakeven,
 *   model, modelId
 * }}
 */
export function calculateFees(ticketPrice, quantity = 1, modelId = ACTIVE_FEE_MODEL_ID, stripeOpts = STRIPE_ASSUMPTIONS) {
  const model = FEE_MODELS[modelId] || FEE_MODELS[ACTIVE_FEE_MODEL_ID];
  const r = (n) => Math.round(n * 100) / 100;

  const subtotal = r(ticketPrice * quantity);

  const buyerFee = r(Math.max(model.buyer_fee_min, subtotal * model.buyer_fee_pct));
  const sellerFee = r(Math.max(model.seller_fee_min, subtotal * model.seller_fee_pct));

  const buyerTotal = r(subtotal + buyerFee);
  const sellerPayout = r(Math.max(0, subtotal - sellerFee)); // never negative

  const pgGrossRevenue = r(buyerFee + sellerFee);
  const stripeFee = r(buyerTotal * stripeOpts.pct + stripeOpts.fixed);
  const pgNetRevenue = r(pgGrossRevenue - stripeFee);

  const effectiveTakeRate = subtotal > 0 ? r((pgNetRevenue / subtotal) * 100) : 0;
  const sellerPayoutRate = subtotal > 0 ? r((sellerPayout / subtotal) * 100) : 0;
  const profitable = pgNetRevenue > 0;

  // Legacy compat fields
  const pgFee = buyerFee; // buyer-facing fee (used in old checkout)
  const amount = buyerTotal;

  return {
    ticketPrice, quantity, subtotal,
    buyerFee, buyerTotal,
    sellerFee, sellerPayout,
    pgGrossRevenue, stripeFee, pgNetRevenue,
    effectiveTakeRate, sellerPayoutRate,
    profitable,
    model: model.label, modelId,
    // Legacy compat
    pgFee, amount, pgNetRevenue,
    sellerPayout, pgGrossRevenue,
    marginPct: pgGrossRevenue > 0 ? r((pgNetRevenue / pgGrossRevenue) * 100) : 0,
  };
}

// ── Active model shortcut (used by live checkout — DO NOT change signature) ──
export function calculateActiveFees(ticketPrice, quantity = 1) {
  return calculateFees(ticketPrice, quantity, ACTIVE_FEE_MODEL_ID);
}

// ── Buyer-facing fee breakdown (used at checkout) ────────────────────────────
export function formatFeeBreakdown(ticketPrice, quantity = 1) {
  const r = calculateActiveFees(ticketPrice, quantity);
  const model = FEE_MODELS[ACTIVE_FEE_MODEL_ID];
  return {
    subtotalLabel: quantity > 1 ? `${quantity} tickets × $${ticketPrice}` : 'Ticket',
    subtotal: r.subtotal,
    feeLabel: `Service fee (${model.shortLabel})`,
    fee: r.buyerFee,
    total: r.buyerTotal,
    _raw: r,
  };
}

// ── Seller-facing payout preview (used in listing creation UI) ───────────────
export function formatSellerPayout(ticketPrice, quantity = 1, modelId = ACTIVE_FEE_MODEL_ID) {
  const r = calculateFees(ticketPrice, quantity, modelId);
  const model = FEE_MODELS[modelId];
  return {
    askingPrice: r.subtotal,
    buyerSees: r.buyerTotal,
    sellerReceives: r.sellerPayout,
    pgFee: r.buyerFee,
    sellerFee: r.sellerFee,
    hasSellerFee: model.seller_fee_pct > 0 || model.seller_fee_min > 0,
    sellerFeeLabel: model.seller_fee_pct > 0
      ? `${(model.seller_fee_pct * 100).toFixed(0)}% seller service fee`
      : null,
  };
}

// ── Compare all models at a single price point ───────────────────────────────
export function compareFeeModels(ticketPrice, quantity = 1) {
  return Object.keys(FEE_MODELS).map(id => calculateFees(ticketPrice, quantity, id));
}

// ── Monthly revenue estimate ─────────────────────────────────────────────────
export function estimateMonthlyRevenue(avgTicketPrice, transactionsPerMonth, avgQuantity = 1, modelId = ACTIVE_FEE_MODEL_ID, opts = {}) {
  const { disputeRate = 0, failedRate = 0, fixedCosts = 0 } = opts;
  const perTx = calculateFees(avgTicketPrice, avgQuantity, modelId);
  const successRate = 1 - disputeRate - failedRate;
  const successfulTx = Math.round(transactionsPerMonth * successRate);

  const grossVolume = Math.round(perTx.subtotal * transactionsPerMonth * 100) / 100;
  const pgGross = Math.round(perTx.pgGrossRevenue * successfulTx * 100) / 100;
  const stripeCost = Math.round(perTx.stripeFee * successfulTx * 100) / 100;
  const pgNet = Math.round((perTx.pgNetRevenue * successfulTx - fixedCosts) * 100) / 100;
  const sellerPayouts = Math.round(perTx.sellerPayout * successfulTx * 100) / 100;

  return {
    transactionsPerMonth, successfulTx, avgTicketPrice, avgQuantity,
    grossVolume, pgGross, stripeCost, pgNet, sellerPayouts,
    effectiveTakeRate: perTx.effectiveTakeRate,
    perTransaction: perTx,
  };
}

// ── Annual revenue estimate ──────────────────────────────────────────────────
export function estimateAnnualRevenue(avgTicketPrice, transactionsPerMonth, avgQuantity = 1, modelId = ACTIVE_FEE_MODEL_ID, opts = {}) {
  const monthly = estimateMonthlyRevenue(avgTicketPrice, transactionsPerMonth, avgQuantity, modelId, opts);
  return {
    ...monthly,
    annualGrossVolume: Math.round(monthly.grossVolume * 12 * 100) / 100,
    annualPgGross: Math.round(monthly.pgGross * 12 * 100) / 100,
    annualStripeCost: Math.round(monthly.stripeCost * 12 * 100) / 100,
    annualPgNet: Math.round(monthly.pgNet * 12 * 100) / 100,
    annualSellerPayouts: Math.round(monthly.sellerPayouts * 12 * 100) / 100,
  };
}

// ── Breakeven finder ─────────────────────────────────────────────────────────
export function findBreakeven(modelId = ACTIVE_FEE_MODEL_ID, quantity = 1, stripeOpts = STRIPE_ASSUMPTIONS) {
  for (let price = 1; price <= 500; price += 0.01) {
    const r = calculateFees(price, quantity, modelId, stripeOpts);
    if (r.profitable) return Math.round(price * 100) / 100;
  }
  return null;
}

// ── Benchmark table ──────────────────────────────────────────────────────────
export const BENCHMARK_PRICES = [1, 5, 10, 15, 20, 25, 50, 75, 100, 150, 200, 250, 500, 1000];
export function buildBenchmarkTable(modelId, quantity = 1) {
  return BENCHMARK_PRICES.map(price => calculateFees(price, quantity, modelId));
}

// ── Side-by-side comparison ───────────────────────────────────────────────────
export const COMPARISON_PRICES = [1, 5, 10, 15, 20, 25, 50, 100, 250, 500];
export function buildComparison(modelAId, modelBId, quantity = 1) {
  return COMPARISON_PRICES.map(price => {
    const a = calculateFees(price, quantity, modelAId);
    const b = calculateFees(price, quantity, modelBId);
    return {
      price, a, b,
      buyerImpact: Math.round((b.buyerTotal - a.buyerTotal) * 100) / 100,
      sellerImpact: Math.round((b.sellerPayout - a.sellerPayout) * 100) / 100,
      pgNetImpact: Math.round((b.pgNetRevenue - a.pgNetRevenue) * 100) / 100,
    };
  });
}

// ── Real purchase analytics (used by TransactionAnalytics) ───────────────────
export function analyzePurchase(purchase, stripeOpts = STRIPE_ASSUMPTIONS) {
  const subtotal = purchase.subtotal || (purchase.amount - (purchase.platform_fee || 0));
  const pgFee = purchase.platform_fee || 0;
  const buyerTotal = purchase.amount || 0;
  const stripeFee = Math.round((buyerTotal * stripeOpts.pct + stripeOpts.fixed) * 100) / 100;
  const pgNetRevenue = Math.round((pgFee - stripeFee) * 100) / 100;
  const marginPct = pgFee > 0 ? Math.round((pgNetRevenue / pgFee) * 100) : 0;
  return {
    ...purchase,
    _subtotal: subtotal, _pgFee: pgFee, _stripeFee: stripeFee,
    _pgNetRevenue: pgNetRevenue, _marginPct: marginPct,
    _profitable: pgNetRevenue > 0, _thin: pgNetRevenue > 0 && pgNetRevenue < 0.50,
  };
}

export function buildPurchaseAnalytics(purchases) {
  const completed = purchases.filter(p => p.transfer_status === 'completed' && p.amount > 0);
  if (completed.length === 0) return null;
  const enriched = completed.map(analyzePurchase);
  const totalRevenue = enriched.reduce((s, p) => s + p._pgFee, 0);
  const totalNet = enriched.reduce((s, p) => s + p._pgNetRevenue, 0);
  const unprofitable = enriched.filter(p => !p._profitable);
  const avgNet = totalNet / enriched.length;
  const avgMargin = enriched.reduce((s, p) => s + p._marginPct, 0) / enriched.length;
  return {
    total: enriched.length,
    totalRevenue: Math.round(totalRevenue * 100) / 100,
    totalNet: Math.round(totalNet * 100) / 100,
    avgNetPerOrder: Math.round(avgNet * 100) / 100,
    avgMarginPct: Math.round(avgMargin),
    unprofitableCount: unprofitable.length,
    unprofitablePct: Math.round((unprofitable.length / enriched.length) * 100),
    enriched,
  };
}

// ── UX risk (legacy compat) ───────────────────────────────────────────────────
export function analyzeUXRisk(modelId = 'buyer_5_seller_5') {
  return COMPARISON_PRICES.map(price => {
    const current = calculateFees(price, 1, 'buyer_5_min_1');
    const candidate = calculateFees(price, 1, modelId);
    const feeIncrease = Math.round((candidate.buyerFee - current.buyerFee) * 100) / 100;
    const feeRatio = price > 0 ? candidate.buyerFee / price : 0;
    let uxRisk = 'none', uxNote = '';
    if (feeRatio > 0.20) { uxRisk = 'high'; uxNote = 'Buyer fee exceeds 20% of ticket — likely abandonment'; }
    else if (feeRatio > 0.10) { uxRisk = 'medium'; uxNote = 'Fee noticeable relative to ticket price'; }
    else if (feeIncrease > 0) { uxRisk = 'low'; uxNote = `Buyer pays $${feeIncrease.toFixed(2)} more vs current model`; }
    else { uxNote = 'No buyer impact vs current model'; }
    return { price, currentFee: current.buyerFee, candidateFee: candidate.buyerFee, feeIncrease, feeRatio, uxRisk, uxNote };
  });
}

export function analyzeMinListingPriceImpact(threshold) {
  const blocked = COMPARISON_PRICES.filter(p => p < threshold);
  const allowed = COMPARISON_PRICES.filter(p => p >= threshold);
  const lowestAllowed = Math.min(...allowed);
  const lowestAllowedFees = calculateFees(lowestAllowed, 1, 'buyer_5_min_1');
  return { blocked, allowed, lowestAllowed, lowestAllowedFees };
}

export function generateRecommendations(modelId = ACTIVE_FEE_MODEL_ID) {
  const breakeven = findBreakeven(modelId);
  const recs = [];
  if (breakeven !== null) {
    recs.push({ type: breakeven > 10 ? 'warning' : 'info', text: `Transactions under $${breakeven.toFixed(2)} lose money under "${FEE_MODELS[modelId]?.label}".` });
  }
  recs.push({ type: 'info', text: 'Stripe always charges 2.9% + $0.30 per transaction, regardless of ticket price.' });
  return recs;
}