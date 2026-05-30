import { useState, useMemo } from 'react';
import { FEE_MODELS, ACTIVE_FEE_MODEL_ID, calculateFees, estimateAnnualRevenue } from '@/lib/feeEngine';

// ── Competitor benchmark assumptions (adjustable) ────────────────────────────
const DEFAULT_COMPETITORS = {
  ticketmaster: {
    name: 'Ticketmaster',
    color: '#0066CC',
    buyer_fee_pct_low: 0.15,
    buyer_fee_pct_high: 0.30,
    seller_fee_pct_low: 0.00,
    seller_fee_pct_high: 0.00,
  },
  stubhub: {
    name: 'StubHub',
    color: '#E85D04',
    buyer_fee_pct_low: 0.10,
    buyer_fee_pct_high: 0.25,
    seller_fee_pct_low: 0.10,
    seller_fee_pct_high: 0.15,
  },
  seatgeek: {
    name: 'SeatGeek',
    color: '#00B4D8',
    buyer_fee_pct_low: 0.10,
    buyer_fee_pct_high: 0.20,
    seller_fee_pct_low: 0.00,
    seller_fee_pct_high: 0.05,
  },
  vivid: {
    name: 'Vivid Seats',
    color: '#7B2FBE',
    buyer_fee_pct_low: 0.10,
    buyer_fee_pct_high: 0.25,
    seller_fee_pct_low: 0.00,
    seller_fee_pct_high: 0.10,
  },
};

const PRIMARY_MODELS = [
  'buyer_5_min_1',
  'buyer_5_seller_3',
  'buyer_5_seller_5',
  'instant_buyer_5_seller_10',
  'buyer_5_seller_5_plus_1',
];

// ── Future real-data placeholders ────────────────────────────────────────────
// These will be pluggable once real analytics are collected:
// - listing_creation_rate
// - listing_abandonment_rate
// - checkout_conversion_rate
// - dispute_rate
// - seller_retention_30d
// - buyer_retention_30d
const FUTURE_METRICS_PLACEHOLDER = {
  listing_creation_rate: null,
  listing_abandonment_rate: null,
  checkout_conversion_rate: null,
  dispute_rate: null,
  seller_retention_30d: null,
  buyer_retention_30d: null,
};

const r2 = (n) => Math.round(n * 100) / 100;
const pct = (n) => `${(n * 100).toFixed(0)}%`;
const fmt = (n) => `$${r2(n).toFixed(2)}`;

// ── Competitor averages at a given ticket price ───────────────────────────────
function getCompetitorStats(ticketPrice, competitors) {
  const stats = Object.values(competitors).map(c => {
    const buyerFeeMid = (c.buyer_fee_pct_low + c.buyer_fee_pct_high) / 2;
    const sellerFeeMid = (c.seller_fee_pct_low + c.seller_fee_pct_high) / 2;
    return {
      name: c.name,
      color: c.color,
      buyerFee: r2(ticketPrice * buyerFeeMid),
      buyerTotal: r2(ticketPrice * (1 + buyerFeeMid)),
      sellerFee: r2(ticketPrice * sellerFeeMid),
      sellerPayout: r2(ticketPrice * (1 - sellerFeeMid)),
    };
  });
  const avgBuyerTotal = r2(stats.reduce((s, c) => s + c.buyerTotal, 0) / stats.length);
  const avgSellerPayout = r2(stats.reduce((s, c) => s + c.sellerPayout, 0) / stats.length);
  return { stats, avgBuyerTotal, avgSellerPayout };
}

// ── Scoring engine ────────────────────────────────────────────────────────────
function scoreModel(modelId, ticketPrice, txPerMonth, competitors) {
  const fees = calculateFees(ticketPrice, 1, modelId);
  const annual = estimateAnnualRevenue(ticketPrice, txPerMonth, 1, modelId);
  const { avgBuyerTotal, avgSellerPayout } = getCompetitorStats(ticketPrice, competitors);

  // ── Revenue Score (35%) ──
  // Based on pg net revenue per tx, relative across all models
  const pgNet = fees.pgNetRevenue;
  // Will be normalized later relative to all models

  // ── Buyer Value Score (25%) ──
  // How much cheaper is PG for buyers vs competitor avg
  const buyerSavingsPct = (avgBuyerTotal - fees.buyerTotal) / avgBuyerTotal;
  // >15% cheaper = 100, 10-15% = 80, 5-10% = 60, 0-5% = 40, worse = 10
  let buyerScore;
  if (buyerSavingsPct >= 0.15) buyerScore = 100;
  else if (buyerSavingsPct >= 0.10) buyerScore = 80;
  else if (buyerSavingsPct >= 0.05) buyerScore = 65;
  else if (buyerSavingsPct >= 0.00) buyerScore = 45;
  else buyerScore = 20; // PG is more expensive

  // ── Seller Value Score (25%) ──
  // How much more does seller receive vs competitor avg
  const sellerGainPct = (fees.sellerPayout - avgSellerPayout) / avgSellerPayout;
  // >10% more = 100, 5-10% = 80, 0-5% = 60, slightly worse = 35, much worse = 10
  let sellerScore;
  if (sellerGainPct >= 0.10) sellerScore = 100;
  else if (sellerGainPct >= 0.05) sellerScore = 80;
  else if (sellerGainPct >= 0.00) sellerScore = 65;
  else if (sellerGainPct >= -0.05) sellerScore = 40;
  else sellerScore = 15;

  // ── Growth Potential Score (15%) ──
  // Lower combined fee burden = higher growth friendliness
  const totalFeePct = (fees.buyerFee + fees.sellerFee) / ticketPrice;
  let growthScore;
  let frictionLabel;
  if (totalFeePct <= 0.05) { growthScore = 100; frictionLabel = 'Very Low Friction'; }
  else if (totalFeePct <= 0.08) { growthScore = 80; frictionLabel = 'Low Friction'; }
  else if (totalFeePct <= 0.12) { growthScore = 55; frictionLabel = 'Moderate Friction'; }
  else { growthScore = 25; frictionLabel = 'High Friction'; }

  return {
    modelId,
    fees,
    annual,
    buyerScore,
    sellerScore,
    growthScore,
    pgNet,
    frictionLabel,
    buyerSavingsPct,
    sellerGainPct,
    totalFeePct,
    // revenueScore computed after normalization
  };
}

function computeAllScores(ticketPrice, txPerMonth, competitors) {
  const raw = PRIMARY_MODELS.map(id => scoreModel(id, ticketPrice, txPerMonth, competitors));

  // Normalize revenue score relative to max pg net across models
  const maxPgNet = Math.max(...raw.map(r => r.pgNet));
  const minPgNet = Math.min(...raw.map(r => r.pgNet));
  const range = maxPgNet - minPgNet || 1;

  return raw.map(r => {
    const revenueScore = Math.round(((r.pgNet - minPgNet) / range) * 100);
    const healthScore = Math.round(
      revenueScore * 0.35 +
      r.buyerScore * 0.25 +
      r.sellerScore * 0.25 +
      r.growthScore * 0.15
    );
    return { ...r, revenueScore, healthScore };
  }).sort((a, b) => b.healthScore - a.healthScore);
}

function getRecommendationTags(scores, txPerMonth) {
  const sorted = [...scores].sort((a, b) => b.healthScore - a.healthScore);
  const byGrowth = [...scores].sort((a, b) => b.growthScore - a.growthScore);
  const byRevenue = [...scores].sort((a, b) => b.revenueScore - a.revenueScore);
  const bySeller = [...scores].sort((a, b) => b.sellerScore - a.sellerScore);
  const byBuyer = [...scores].sort((a, b) => b.buyerScore - a.buyerScore);

  const tags = {};
  if (sorted[0]) tags[sorted[0].modelId] = [...(tags[sorted[0].modelId] || []), '🏆 Best Long-Term Balance'];
  if (byGrowth[0]) tags[byGrowth[0].modelId] = [...(tags[byGrowth[0].modelId] || []), '🚀 Best for Rapid Growth'];
  if (byRevenue[0]) tags[byRevenue[0].modelId] = [...(tags[byRevenue[0].modelId] || []), '💰 Best for Profitability'];
  if (bySeller[0]) tags[bySeller[0].modelId] = [...(tags[bySeller[0].modelId] || []), '🤝 Best for Sellers'];
  if (byBuyer[0]) tags[byBuyer[0].modelId] = [...(tags[byBuyer[0].modelId] || []), '🛒 Best for Buyers'];

  // Instant model always gets its tag
  tags['instant_buyer_5_seller_10'] = [...(tags['instant_buyer_5_seller_10'] || []), '⚡ Best for Instant Listings'];

  // Beta / scale recommendations
  if (txPerMonth < 500) {
    const betaBest = byGrowth[0];
    if (betaBest) tags[betaBest.modelId] = [...(tags[betaBest.modelId] || []), '🌱 Best for Beta Testing'];
  } else if (txPerMonth >= 5000) {
    // Balance profitability + competitiveness
    const scaleBest = sorted.find(s => s.revenueScore >= 60 && s.buyerScore >= 40);
    if (scaleBest) tags[scaleBest.modelId] = [...(tags[scaleBest.modelId] || []), '📈 Best at Scale'];
  }

  return tags;
}

function ScoreBar({ value, color }) {
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 rounded-full" style={{ background: 'rgba(255,255,255,0.08)' }}>
        <div className="h-full rounded-full transition-all" style={{ width: `${value}%`, background: color || '#BF5FFF' }} />
      </div>
      <span className="text-xs font-bold w-7 text-right" style={{ color: color || '#BF5FFF' }}>{value}</span>
    </div>
  );
}

function HealthRing({ score }) {
  const color = score >= 75 ? '#00FF87' : score >= 55 ? '#FFE600' : score >= 35 ? '#FF8C00' : '#FF2D78';
  return (
    <div className="flex flex-col items-center">
      <div className="text-3xl font-black" style={{ color }}>{score}</div>
      <div className="text-[9px] text-muted-foreground">/100</div>
    </div>
  );
}

export default function PricingStrategyAnalyzer() {
  const [ticketPrice, setTicketPrice] = useState(100);
  const [txPerMonth, setTxPerMonth] = useState(1000);
  const [competitors, setCompetitors] = useState(DEFAULT_COMPETITORS);
  const [showCompetitorEdit, setShowCompetitorEdit] = useState(false);
  const [editComp, setEditComp] = useState(null);

  const scores = useMemo(() => computeAllScores(ticketPrice, txPerMonth, competitors), [ticketPrice, txPerMonth, competitors]);
  const tags = useMemo(() => getRecommendationTags(scores, txPerMonth), [scores, txPerMonth]);
  const compStats = useMemo(() => getCompetitorStats(ticketPrice, competitors), [ticketPrice, competitors]);

  const isBeta = txPerMonth < 500;
  const isScale = txPerMonth >= 5000;

  const updateComp = (key, field, value) => {
    setCompetitors(prev => ({ ...prev, [key]: { ...prev[key], [field]: parseFloat(value) / 100 } }));
  };

  const inputClass = "w-full px-3 py-2 rounded-xl text-sm text-foreground focus:outline-none";
  const inputStyle = { background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)' };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="font-bold text-lg text-foreground">Marketplace Pricing Strategy Analyzer</h2>
        <p className="text-xs text-muted-foreground mt-0.5">
          Read-only decision-support tool. Does not modify live pricing, checkout, or fee models.
          <span className="ml-2 font-semibold" style={{ color: '#00FF87' }}>Live: {FEE_MODELS[ACTIVE_FEE_MODEL_ID]?.label}</span>
        </p>
      </div>

      {/* Inputs */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 p-4 rounded-2xl" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }}>
        <div>
          <label className="text-xs text-muted-foreground block mb-1">Avg Ticket Price ($)</label>
          <input type="number" min="10" value={ticketPrice} onChange={e => setTicketPrice(+e.target.value)} className={inputClass} style={inputStyle} />
        </div>
        <div>
          <label className="text-xs text-muted-foreground block mb-1">Transactions / Month</label>
          <input type="number" min="1" value={txPerMonth} onChange={e => setTxPerMonth(+e.target.value)} className={inputClass} style={inputStyle} />
        </div>
        <div className="col-span-2 flex items-end gap-2">
          {isBeta && (
            <span className="text-xs px-3 py-2 rounded-xl font-semibold" style={{ background: 'rgba(0,255,135,0.08)', color: '#00FF87', border: '1px solid rgba(0,255,135,0.25)' }}>
              🌱 Beta Mode — Optimizing for adoption
            </span>
          )}
          {isScale && (
            <span className="text-xs px-3 py-2 rounded-xl font-semibold" style={{ background: 'rgba(191,95,255,0.08)', color: '#BF5FFF', border: '1px solid rgba(191,95,255,0.25)' }}>
              📈 Scale Mode — Optimizing for profitability + competitiveness
            </span>
          )}
          {!isBeta && !isScale && (
            <span className="text-xs px-3 py-2 rounded-xl font-semibold" style={{ background: 'rgba(255,255,255,0.04)', color: 'hsl(var(--muted-foreground))', border: '1px solid rgba(255,255,255,0.08)' }}>
              Growth Stage
            </span>
          )}
          <button onClick={() => setShowCompetitorEdit(v => !v)}
            className="ml-auto text-xs px-3 py-2 rounded-xl font-semibold transition-all"
            style={{ background: 'rgba(255,255,255,0.06)', color: 'hsl(var(--muted-foreground))', border: '1px solid rgba(255,255,255,0.1)' }}>
            ⚙️ Competitor Assumptions
          </button>
        </div>
      </div>

      {/* Competitor Assumption Editor */}
      {showCompetitorEdit && (
        <div className="rounded-2xl p-4 space-y-4" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.1)' }}>
          <p className="text-xs font-bold text-muted-foreground uppercase tracking-wide">Competitor Benchmark Assumptions (adjustable)</p>
          <p className="text-xs text-muted-foreground">These are directional estimates, not exact figures. Adjust to reflect current market knowledge.</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {Object.entries(competitors).map(([key, c]) => (
              <div key={key} className="rounded-xl p-3 space-y-2" style={{ background: 'rgba(255,255,255,0.03)', border: `1px solid ${c.color}30` }}>
                <div className="font-semibold text-xs text-foreground" style={{ color: c.color }}>{c.name}</div>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div>
                    <label className="text-muted-foreground block mb-1">Buyer Fee Low (%)</label>
                    <input type="number" min="0" max="100" step="1" value={Math.round(c.buyer_fee_pct_low * 100)}
                      onChange={e => updateComp(key, 'buyer_fee_pct_low', e.target.value)}
                      className="w-full px-2 py-1.5 rounded-lg text-xs text-foreground focus:outline-none"
                      style={inputStyle} />
                  </div>
                  <div>
                    <label className="text-muted-foreground block mb-1">Buyer Fee High (%)</label>
                    <input type="number" min="0" max="100" step="1" value={Math.round(c.buyer_fee_pct_high * 100)}
                      onChange={e => updateComp(key, 'buyer_fee_pct_high', e.target.value)}
                      className="w-full px-2 py-1.5 rounded-lg text-xs text-foreground focus:outline-none"
                      style={inputStyle} />
                  </div>
                  <div>
                    <label className="text-muted-foreground block mb-1">Seller Fee Low (%)</label>
                    <input type="number" min="0" max="100" step="1" value={Math.round(c.seller_fee_pct_low * 100)}
                      onChange={e => updateComp(key, 'seller_fee_pct_low', e.target.value)}
                      className="w-full px-2 py-1.5 rounded-lg text-xs text-foreground focus:outline-none"
                      style={inputStyle} />
                  </div>
                  <div>
                    <label className="text-muted-foreground block mb-1">Seller Fee High (%)</label>
                    <input type="number" min="0" max="100" step="1" value={Math.round(c.seller_fee_pct_high * 100)}
                      onChange={e => updateComp(key, 'seller_fee_pct_high', e.target.value)}
                      className="w-full px-2 py-1.5 rounded-lg text-xs text-foreground focus:outline-none"
                      style={inputStyle} />
                  </div>
                </div>
              </div>
            ))}
          </div>
          <button onClick={() => setCompetitors(DEFAULT_COMPETITORS)}
            className="text-xs text-muted-foreground hover:text-foreground underline">
            Reset to defaults
          </button>
        </div>
      )}

      {/* Competitor baseline at current price */}
      <div className="rounded-2xl p-4 space-y-3" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }}>
        <p className="text-xs font-bold text-muted-foreground uppercase tracking-wide">Competitor Baseline at ${ticketPrice} ticket (midpoint estimates)</p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {compStats.stats.map(c => (
            <div key={c.name} className="rounded-xl p-3 space-y-1 text-center" style={{ background: 'rgba(255,255,255,0.03)', border: `1px solid ${c.color}30` }}>
              <div className="text-xs font-bold" style={{ color: c.color }}>{c.name}</div>
              <div className="text-xs text-muted-foreground">Buyer pays <span className="text-foreground font-semibold">{fmt(c.buyerTotal)}</span></div>
              <div className="text-xs text-muted-foreground">Seller gets <span className="text-foreground font-semibold">{fmt(c.sellerPayout)}</span></div>
            </div>
          ))}
        </div>
        <div className="flex gap-6 text-xs pt-1">
          <span className="text-muted-foreground">Avg competitor buyer total: <strong className="text-foreground">{fmt(compStats.avgBuyerTotal)}</strong></span>
          <span className="text-muted-foreground">Avg competitor seller payout: <strong className="text-foreground">{fmt(compStats.avgSellerPayout)}</strong></span>
        </div>
      </div>

      {/* Health Score Cards */}
      <div>
        <p className="text-xs font-bold text-muted-foreground uppercase tracking-wide mb-3">Marketplace Health Scores — Ranked</p>
        <p className="text-xs text-muted-foreground mb-3">
          Weights: Revenue 35% · Buyer Value 25% · Seller Value 25% · Growth 15%
        </p>
        <div className="space-y-3">
          {scores.map((s, i) => {
            const modelTags = tags[s.modelId] || [];
            const isLive = s.modelId === ACTIVE_FEE_MODEL_ID;
            return (
              <div key={s.modelId} className="rounded-2xl p-4"
                style={{
                  background: isLive ? 'rgba(0,255,135,0.04)' : 'rgba(255,255,255,0.03)',
                  border: isLive ? '1px solid rgba(0,255,135,0.25)' : '1px solid rgba(255,255,255,0.08)',
                }}>
                <div className="flex items-start gap-4">
                  {/* Rank */}
                  <div className="text-2xl font-black text-muted-foreground w-6 flex-shrink-0 mt-1">
                    {i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `#${i + 1}`}
                  </div>

                  {/* Health Ring */}
                  <div className="flex-shrink-0">
                    <HealthRing score={s.healthScore} />
                  </div>

                  {/* Main content */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center flex-wrap gap-1.5 mb-2">
                      <span className="font-bold text-sm text-foreground">{FEE_MODELS[s.modelId]?.label}</span>
                      {isLive && (
                        <span className="text-[9px] font-black px-1.5 py-0.5 rounded-full" style={{ background: 'rgba(0,255,135,0.15)', color: '#00FF87', border: '1px solid rgba(0,255,135,0.3)' }}>★ LIVE</span>
                      )}
                      {FEE_MODELS[s.modelId]?.instant_only && (
                        <span className="text-[9px] font-black px-1.5 py-0.5 rounded-full" style={{ background: 'rgba(191,95,255,0.12)', color: '#BF5FFF', border: '1px solid rgba(191,95,255,0.25)' }}>Instant Only</span>
                      )}
                    </div>

                    {/* Tags */}
                    {modelTags.length > 0 && (
                      <div className="flex flex-wrap gap-1 mb-3">
                        {modelTags.map(t => (
                          <span key={t} className="text-[10px] px-2 py-0.5 rounded-full font-semibold"
                            style={{ background: 'rgba(255,230,0,0.1)', color: '#FFE600', border: '1px solid rgba(255,230,0,0.2)' }}>
                            {t}
                          </span>
                        ))}
                      </div>
                    )}

                    {/* Fee summary */}
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3 text-xs">
                      <div>
                        <div className="text-muted-foreground">Buyer pays</div>
                        <div className="font-bold" style={{ color: '#BF5FFF' }}>{fmt(s.fees.buyerTotal)}</div>
                        <div className="text-[10px] text-muted-foreground">
                          {s.buyerSavingsPct >= 0
                            ? <span style={{ color: '#00FF87' }}>↓ {(s.buyerSavingsPct * 100).toFixed(0)}% vs competitors</span>
                            : <span style={{ color: '#FF2D78' }}>↑ {Math.abs(s.buyerSavingsPct * 100).toFixed(0)}% above competitors</span>}
                        </div>
                      </div>
                      <div>
                        <div className="text-muted-foreground">Seller gets</div>
                        <div className="font-bold" style={{ color: '#00FF87' }}>{fmt(s.fees.sellerPayout)}</div>
                        <div className="text-[10px] text-muted-foreground">
                          {s.sellerGainPct >= 0
                            ? <span style={{ color: '#00FF87' }}>↑ {(s.sellerGainPct * 100).toFixed(0)}% vs competitors</span>
                            : <span style={{ color: '#FF2D78' }}>↓ {Math.abs(s.sellerGainPct * 100).toFixed(0)}% below competitors</span>}
                        </div>
                      </div>
                      <div>
                        <div className="text-muted-foreground">PG net / tx</div>
                        <div className="font-bold text-foreground">{fmt(s.fees.pgNetRevenue)}</div>
                        <div className="text-[10px] text-muted-foreground">{s.fees.effectiveTakeRate}% take rate</div>
                      </div>
                      <div>
                        <div className="text-muted-foreground">Friction</div>
                        <div className="font-bold text-foreground text-xs">{s.frictionLabel}</div>
                        <div className="text-[10px] text-muted-foreground">{(s.totalFeePct * 100).toFixed(0)}% combined fees</div>
                      </div>
                    </div>

                    {/* Score bars */}
                    <div className="grid grid-cols-2 gap-x-6 gap-y-1.5">
                      <div>
                        <div className="text-[10px] text-muted-foreground mb-0.5">Revenue Score</div>
                        <ScoreBar value={s.revenueScore} color="#FFE600" />
                      </div>
                      <div>
                        <div className="text-[10px] text-muted-foreground mb-0.5">Buyer Value Score</div>
                        <ScoreBar value={s.buyerScore} color="#BF5FFF" />
                      </div>
                      <div>
                        <div className="text-[10px] text-muted-foreground mb-0.5">Seller Value Score</div>
                        <ScoreBar value={s.sellerScore} color="#00FF87" />
                      </div>
                      <div>
                        <div className="text-[10px] text-muted-foreground mb-0.5">Growth Potential Score</div>
                        <ScoreBar value={s.growthScore} color="#00C8FF" />
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Recommendation Summary */}
      <div className="rounded-2xl p-4 space-y-3" style={{ background: 'rgba(255,230,0,0.04)', border: '1px solid rgba(255,230,0,0.2)' }}>
        <p className="text-xs font-bold uppercase tracking-wide" style={{ color: '#FFE600' }}>Recommendation Engine</p>

        {isBeta && (
          <div className="rounded-xl p-3 text-xs" style={{ background: 'rgba(0,255,135,0.06)', border: '1px solid rgba(0,255,135,0.2)' }}>
            <div className="font-bold mb-1" style={{ color: '#00FF87' }}>🌱 Beta Stage ({txPerMonth} tx/month)</div>
            <p className="text-muted-foreground">
              At this transaction volume, prioritize <strong className="text-foreground">seller adoption and buyer conversion</strong> over revenue.
              The model with the lowest combined fee burden will drive the most listings and first-time purchases.
              <strong className="text-foreground ml-1">{FEE_MODELS[scores.sort((a,b) => b.growthScore - a.growthScore)[0]?.modelId]?.shortLabel}</strong> maximizes growth potential.
            </p>
          </div>
        )}

        {isScale && (
          <div className="rounded-xl p-3 text-xs" style={{ background: 'rgba(191,95,255,0.06)', border: '1px solid rgba(191,95,255,0.2)' }}>
            <div className="font-bold mb-1" style={{ color: '#BF5FFF' }}>📈 Scale Stage ({txPerMonth.toLocaleString()} tx/month)</div>
            <p className="text-muted-foreground">
              At this volume, a seller fee becomes meaningful revenue without killing marketplace competitiveness.
              <strong className="text-foreground ml-1">buyer_5_seller_3</strong> or <strong className="text-foreground">buyer_5_seller_5</strong> balances profitability
              with competitive buyer/seller pricing. Run A/B test before full rollout.
            </p>
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {[
            { tag: '🏆 Best Long-Term Balance', note: 'Highest composite marketplace health score.' },
            { tag: '🚀 Best for Rapid Growth', note: 'Lowest friction — maximizes listing creation and buyer conversion.' },
            { tag: '💰 Best for Profitability', note: 'Highest PG net revenue per transaction.' },
            { tag: '🤝 Best for Sellers', note: 'Sellers receive the highest payout relative to competitors.' },
            { tag: '🛒 Best for Buyers', note: 'Buyers pay the least compared to competing platforms.' },
            { tag: '⚡ Best for Instant Listings', note: 'Premium take rate justified by PG custody/fulfillment service.' },
          ].map(rec => {
            const winner = Object.entries(tags).find(([, ts]) => ts.includes(rec.tag));
            if (!winner) return null;
            return (
              <div key={rec.tag} className="rounded-xl p-3 text-xs flex gap-2" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}>
                <span className="text-base flex-shrink-0">{rec.tag.split(' ')[0]}</span>
                <div>
                  <div className="font-semibold text-foreground">{rec.tag.replace(/^\S+\s/, '')}</div>
                  <div className="text-muted-foreground mt-0.5">{FEE_MODELS[winner[0]]?.shortLabel} — {rec.note}</div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Future metrics placeholder */}
      <div className="rounded-2xl p-4" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }}>
        <p className="text-xs font-bold text-muted-foreground uppercase tracking-wide mb-2">Future Real-Data Integration (Placeholders)</p>
        <p className="text-xs text-muted-foreground mb-3">These signals will automatically improve scoring accuracy once connected to real analytics.</p>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {Object.entries(FUTURE_METRICS_PLACEHOLDER).map(([key]) => (
            <div key={key} className="flex items-center gap-2 text-xs px-3 py-2 rounded-lg"
              style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
              <div className="w-1.5 h-1.5 rounded-full bg-muted-foreground opacity-30 flex-shrink-0" />
              <span className="text-muted-foreground capitalize">{key.replace(/_/g, ' ')}</span>
              <span className="ml-auto text-muted-foreground opacity-50 text-[10px]">not connected</span>
            </div>
          ))}
        </div>
      </div>

      {/* Read-only confirmation */}
      <div className="rounded-xl px-4 py-3 flex items-center gap-3 text-xs"
        style={{ background: 'rgba(0,255,135,0.04)', border: '1px solid rgba(0,255,135,0.15)' }}>
        <span style={{ color: '#00FF87' }}>🔒</span>
        <span className="text-muted-foreground">
          This tool is <strong className="text-foreground">read-only</strong>. It does not modify{' '}
          <code className="text-primary">ACTIVE_FEE_MODEL_ID</code>, checkout, listing creation, seller payouts, or any production pricing.
          To change live pricing, update <code className="text-primary">lib/feeEngine.js → ACTIVE_FEE_MODEL_ID</code>.
        </span>
      </div>
    </div>
  );
}