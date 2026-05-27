/**
 * Peanut Gallery Fee Engine
 * ─────────────────────────
 * Pure utility — no side effects, no API calls.
 * Used by: Fee Simulator, Transaction Analytics, checkout preview.
 *
 * LIVE PAYMENT ARCHITECTURE IS UNTOUCHED.
 * This is analysis/simulation only.
 */

// ── Stripe processing fee assumptions ───────────────────────────────────────
export const STRIPE_ASSUMPTIONS = {
  pct: 0.029,      // 2.9%
  fixed: 0.30,     // $0.30 per transaction
};

// ── Fee Models ───────────────────────────────────────────────────────────────
export const FEE_MODELS = {
  current_5pct: {
    id: 'current_5pct',
    label: 'Current: 5% (live)',
    description: '5% of subtotal — what PG charges today',
    isLive: true,
    calc: (subtotal) => Math.round(subtotal * 0.05 * 100) / 100,
  },
  pct_10: {
    id: 'pct_10',
    label: '10% Percentage',
    description: '10% of subtotal',
    calc: (subtotal) => Math.round(subtotal * 0.10 * 100) / 100,
  },
  flat_1: {
    id: 'flat_1',
    label: '$1 Flat Fee',
    description: 'Fixed $1 per transaction',
    calc: () => 1.00,
  },
  flat_2: {
    id: 'flat_2',
    label: '$2 Flat Fee',
    description: 'Fixed $2 per transaction',
    calc: () => 2.00,
  },
  pct5_min1: {
    id: 'pct5_min1',
    label: '5% + $1 minimum',
    description: '5% with a $1 floor',
    calc: (subtotal) => Math.max(1.00, Math.round(subtotal * 0.05 * 100) / 100),
  },
  pct10_min2: {
    id: 'pct10_min2',
    label: '10% + $2 minimum',
    description: '10% with a $2 floor',
    calc: (subtotal) => Math.max(2.00, Math.round(subtotal * 0.10 * 100) / 100),
  },
  pct5_cap25: {
    id: 'pct5_cap25',
    label: '5% capped at $25',
    description: '5% but never more than $25',
    calc: (subtotal) => Math.min(25.00, Math.round(subtotal * 0.05 * 100) / 100),
  },
  tiered: {
    id: 'tiered',
    label: 'Tiered Pricing',
    description: '<$50 = $2 flat, $50–$200 = 5%, $200+ = 3%',
    calc: (subtotal) => {
      if (subtotal < 50) return 2.00;
      if (subtotal <= 200) return Math.round(subtotal * 0.05 * 100) / 100;
      return Math.round(subtotal * 0.03 * 100) / 100;
    },
  },
};

// ── Core calculator ──────────────────────────────────────────────────────────
/**
 * Calculate full fee breakdown for a transaction.
 *
 * @param {number} ticketPrice - per-ticket asking price
 * @param {number} quantity    - number of tickets
 * @param {string} modelId     - key from FEE_MODELS
 * @param {object} stripeOpts  - optional override for { pct, fixed }
 * @returns {object} full breakdown
 */
export function calculateFees(ticketPrice, quantity = 1, modelId = 'current_5pct', stripeOpts = STRIPE_ASSUMPTIONS) {
  const model = FEE_MODELS[modelId] || FEE_MODELS.current_5pct;
  const subtotal = Math.round(ticketPrice * quantity * 100) / 100;
  const pgFee = model.calc(subtotal);
  const buyerTotal = Math.round((subtotal + pgFee) * 100) / 100;

  // Stripe takes their cut from what PG receives (the application_fee_amount)
  // Stripe fee = (buyerTotal * 2.9%) + $0.30 — applied to the full charge
  const stripeFee = Math.round((buyerTotal * stripeOpts.pct + stripeOpts.fixed) * 100) / 100;

  // PG gross = pgFee (application_fee_amount)
  // PG net   = pgFee - stripeFee (Stripe fees come from PG's application fee)
  const pgNetRevenue = Math.round((pgFee - stripeFee) * 100) / 100;
  const sellerPayout = subtotal; // seller always receives subtotal

  const marginPct = pgFee > 0 ? Math.round((pgNetRevenue / pgFee) * 100) : 0;
  const profitable = pgNetRevenue > 0;
  const thin = pgNetRevenue > 0 && pgNetRevenue < 0.50;

  return {
    ticketPrice,
    quantity,
    subtotal,
    pgFee,
    buyerTotal,
    stripeFee,
    sellerPayout,
    pgGrossRevenue: pgFee,
    pgNetRevenue,
    marginPct,
    profitable,
    thin,
    model: model.label,
    modelId,
  };
}

// ── Breakeven finder ─────────────────────────────────────────────────────────
/**
 * Find the minimum ticket price at which PG breaks even for a given model.
 */
export function findBreakeven(modelId = 'current_5pct', quantity = 1, stripeOpts = STRIPE_ASSUMPTIONS) {
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

// ── Real purchase analytics ──────────────────────────────────────────────────
/**
 * Enrich a real Purchase record with fee analytics.
 * Uses actual amounts from the purchase, estimates Stripe fee.
 */
export function analyzePurchase(purchase, stripeOpts = STRIPE_ASSUMPTIONS) {
  const subtotal = purchase.subtotal || (purchase.amount - (purchase.platform_fee || 0));
  const pgFee = purchase.platform_fee || 0;
  const buyerTotal = purchase.amount || 0;
  const stripeFee = Math.round((buyerTotal * stripeOpts.pct + stripeOpts.fixed) * 100) / 100;
  const pgNetRevenue = Math.round((pgFee - stripeFee) * 100) / 100;
  const marginPct = pgFee > 0 ? Math.round((pgNetRevenue / pgFee) * 100) : 0;

  return {
    ...purchase,
    _subtotal: subtotal,
    _pgFee: pgFee,
    _stripeFee: stripeFee,
    _pgNetRevenue: pgNetRevenue,
    _marginPct: marginPct,
    _profitable: pgNetRevenue > 0,
    _thin: pgNetRevenue > 0 && pgNetRevenue < 0.50,
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

// ── Recommendations ──────────────────────────────────────────────────────────
export function generateRecommendations(modelId = 'current_5pct') {
  const breakeven = findBreakeven(modelId);
  const recs = [];

  if (breakeven !== null) {
    recs.push({
      type: breakeven > 10 ? 'warning' : 'info',
      text: `Transactions under $${breakeven.toFixed(2)} lose money under the "${FEE_MODELS[modelId]?.label}" model.`,
    });
  }

  // Compare models at $20
  const current = calculateFees(20, 1, 'current_5pct');
  const min1 = calculateFees(20, 1, 'pct5_min1');
  const improvement = Math.round((min1.pgNetRevenue - current.pgNetRevenue) * 100) / 100;
  if (improvement > 0) {
    recs.push({
      type: 'tip',
      text: `Adding a $1 minimum fee improves PG net by $${improvement} on $20 tickets.`,
    });
  }

  const breakeven10 = findBreakeven('pct10_min2');
  if (breakeven10 !== null) {
    recs.push({
      type: 'tip',
      text: `The "10% + $2 minimum" model breaks even at $${breakeven10.toFixed(2)}.`,
    });
  }

  recs.push({
    type: 'info',
    text: `Stripe always charges 2.9% + $0.30. On a $10 ticket with 5% fee ($0.50 PG fee), Stripe takes ~$0.59 — PG loses $0.09.`,
  });

  return recs;
}