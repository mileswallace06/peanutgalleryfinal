/**
 * Peanut Gallery Fee Engine
 * ─────────────────────────
 * Single source of truth for all fee logic.
 * Used by: Fee Simulator, Transaction Analytics, Checkout, Comparison Report.
 *
 * LIVE PAYMENT ARCHITECTURE IS UNTOUCHED.
 * To change pricing: update ACTIVE_FEE_MODEL_ID only.
 * Everything else reads from it automatically.
 */

// ── Stripe processing fee assumptions ───────────────────────────────────────
export const STRIPE_ASSUMPTIONS = {
  pct: 0.029,    // 2.9%
  fixed: 0.30,   // $0.30 per transaction
};

// ── ACTIVE FEE MODEL — single switch to change live pricing ─────────────────
// Change this string to instantly switch the checkout fee model.
// Options: any key in FEE_MODELS below.
// Activated 2026-05-27: 5% + $1 minimum (approved beta pricing)
// Rollback: change back to 'current_5pct'
export const ACTIVE_FEE_MODEL_ID = 'pct5_min1';

// ── Minimum listing price configuration ─────────────────────────────────────
// Set to null to disable. Set to a number to enforce a floor.
// This is configurable in admin — not enforced by default.
export const MIN_LISTING_PRICE_CONFIG = {
  enabled: true,
  threshold: 10, // dollars — enforced 2026-05-27
};

// ── Fee Models ───────────────────────────────────────────────────────────────
export const FEE_MODELS = {
  current_5pct: {
    id: 'current_5pct',
    label: 'Current: 5%',
    shortLabel: '5%',
    description: '5% of subtotal — what PG charges today',
    isLive: true,
    calc: (subtotal) => Math.round(subtotal * 0.05 * 100) / 100,
  },
  pct5_min1: {
    id: 'pct5_min1',
    label: '5% + $1 minimum',
    shortLabel: '5% min $1',
    description: '5% with a $1 floor — candidate for beta pricing',
    isCandidate: true,
    calc: (subtotal) => Math.max(1.00, Math.round(subtotal * 0.05 * 100) / 100),
  },
  pct_10: {
    id: 'pct_10',
    label: '10%',
    shortLabel: '10%',
    description: '10% of subtotal',
    calc: (subtotal) => Math.round(subtotal * 0.10 * 100) / 100,
  },
  flat_1: {
    id: 'flat_1',
    label: '$1 Flat Fee',
    shortLabel: '$1 flat',
    description: 'Fixed $1 per transaction',
    calc: () => 1.00,
  },
  flat_2: {
    id: 'flat_2',
    label: '$2 Flat Fee',
    shortLabel: '$2 flat',
    description: 'Fixed $2 per transaction',
    calc: () => 2.00,
  },
  pct10_min2: {
    id: 'pct10_min2',
    label: '10% + $2 minimum',
    shortLabel: '10% min $2',
    description: '10% with a $2 floor',
    calc: (subtotal) => Math.max(2.00, Math.round(subtotal * 0.10 * 100) / 100),
  },
  pct5_cap25: {
    id: 'pct5_cap25',
    label: '5% capped at $25',
    shortLabel: '5% cap $25',
    description: '5% but never more than $25',
    calc: (subtotal) => Math.min(25.00, Math.round(subtotal * 0.05 * 100) / 100),
  },
  tiered: {
    id: 'tiered',
    label: 'Tiered Pricing',
    shortLabel: 'Tiered',
    description: '<$50 = $2 flat · $50–$200 = 5% · $200+ = 3%',
    calc: (subtotal) => {
      if (subtotal < 50) return 2.00;
      if (subtotal <= 200) return Math.round(subtotal * 0.05 * 100) / 100;
      return Math.round(subtotal * 0.03 * 100) / 100;
    },
  },
};

// ── Core calculator ──────────────────────────────────────────────────────────
export function calculateFees(ticketPrice, quantity = 1, modelId = ACTIVE_FEE_MODEL_ID, stripeOpts = STRIPE_ASSUMPTIONS) {
  const model = FEE_MODELS[modelId] || FEE_MODELS[ACTIVE_FEE_MODEL_ID];
  const subtotal = Math.round(ticketPrice * quantity * 100) / 100;
  const pgFee = model.calc(subtotal);
  const buyerTotal = Math.round((subtotal + pgFee) * 100) / 100;
  const stripeFee = Math.round((buyerTotal * stripeOpts.pct + stripeOpts.fixed) * 100) / 100;
  const pgNetRevenue = Math.round((pgFee - stripeFee) * 100) / 100;
  const sellerPayout = subtotal;
  const marginPct = pgFee > 0 ? Math.round((pgNetRevenue / pgFee) * 100) : 0;
  const profitable = pgNetRevenue > 0;
  const thin = pgNetRevenue > 0 && pgNetRevenue < 0.50;

  return {
    ticketPrice, quantity, subtotal, pgFee, buyerTotal, stripeFee,
    sellerPayout, pgGrossRevenue: pgFee, pgNetRevenue,
    marginPct, profitable, thin,
    model: model.label, modelId,
  };
}

// ── Active model shortcut (used by checkout) ─────────────────────────────────
export function calculateActiveFees(ticketPrice, quantity = 1) {
  return calculateFees(ticketPrice, quantity, ACTIVE_FEE_MODEL_ID);
}

// ── Buyer-facing fee breakdown formatter ─────────────────────────────────────
// Use this in checkout to display a clean, trust-building breakdown.
export function formatFeeBreakdown(ticketPrice, quantity = 1) {
  const r = calculateActiveFees(ticketPrice, quantity);
  const model = FEE_MODELS[ACTIVE_FEE_MODEL_ID];
  return {
    subtotalLabel: `${quantity > 1 ? `${quantity} tickets × $${ticketPrice}` : `Ticket`}`,
    subtotal: r.subtotal,
    feeLabel: `Service fee (${model.shortLabel})`,
    fee: r.pgFee,
    total: r.buyerTotal,
    // Raw result available if needed
    _raw: r,
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
    const feeImpact = Math.round((b.pgFee - a.pgFee) * 100) / 100;    // buyer impact
    const netImpact = Math.round((b.pgNetRevenue - a.pgNetRevenue) * 100) / 100; // PG improvement
    return { price, a, b, feeImpact, netImpact };
  });
}

// ── UX risk analysis for minimum fee ─────────────────────────────────────────
export function analyzeUXRisk(modelId = 'pct5_min1') {
  return COMPARISON_PRICES.map(price => {
    const current = calculateFees(price, 1, 'current_5pct');
    const candidate = calculateFees(price, 1, modelId);
    const feeIncrease = Math.round((candidate.pgFee - current.pgFee) * 100) / 100;
    const feeRatio = price > 0 ? candidate.pgFee / price : 0; // fee as % of ticket price

    let uxRisk = 'none';
    let uxNote = '';
    if (feeRatio > 0.20) { uxRisk = 'high'; uxNote = 'Fee exceeds 20% of ticket price — likely to cause abandonment'; }
    else if (feeRatio > 0.10) { uxRisk = 'medium'; uxNote = 'Fee is noticeable relative to ticket price'; }
    else if (feeIncrease > 0) { uxRisk = 'low'; uxNote = `Buyer pays $${feeIncrease.toFixed(2)} more vs current model`; }
    else { uxNote = 'No buyer impact vs current model'; }

    return { price, currentFee: current.pgFee, candidateFee: candidate.pgFee, feeIncrease, feeRatio, uxRisk, uxNote };
  });
}

// ── Minimum listing price impact ─────────────────────────────────────────────
export function analyzeMinListingPriceImpact(threshold) {
  const blocked = COMPARISON_PRICES.filter(p => p < threshold);
  const allowed = COMPARISON_PRICES.filter(p => p >= threshold);
  const lowestAllowed = Math.min(...allowed);
  const lowestAllowedFees = calculateFees(lowestAllowed, 1, 'pct5_min1');
  return { blocked, allowed, lowestAllowed, lowestAllowedFees };
}

// ── Recommendations engine ────────────────────────────────────────────────────
export function generateRecommendations(modelId = ACTIVE_FEE_MODEL_ID) {
  const breakeven = findBreakeven(modelId);
  const recs = [];

  if (breakeven !== null) {
    recs.push({
      type: breakeven > 10 ? 'warning' : 'info',
      text: `Transactions under $${breakeven.toFixed(2)} lose money under the "${FEE_MODELS[modelId]?.label}" model.`,
    });
  }

  const current = calculateFees(20, 1, 'current_5pct');
  const min1 = calculateFees(20, 1, 'pct5_min1');
  const improvement = Math.round((min1.pgNetRevenue - current.pgNetRevenue) * 100) / 100;
  if (improvement > 0) {
    recs.push({
      type: 'tip',
      text: `Adding a $1 minimum fee improves PG net by $${improvement} on $20 tickets.`,
    });
  }

  const breakeven_pct5min1 = findBreakeven('pct5_min1');
  if (breakeven_pct5min1 !== null) {
    recs.push({
      type: 'tip',
      text: `"5% + $1 min" breaks even at $${breakeven_pct5min1.toFixed(2)}/ticket vs ~$20 for pure 5%.`,
    });
  }

  recs.push({
    type: 'info',
    text: `Stripe always charges 2.9% + $0.30 per transaction, regardless of ticket price.`,
  });

  return recs;
}

// ── Real purchase analytics ──────────────────────────────────────────────────
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