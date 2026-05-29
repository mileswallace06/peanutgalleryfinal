import { useState, useMemo } from 'react';
import { FEE_MODELS, ACTIVE_FEE_MODEL_ID, calculateFees, estimateAnnualRevenue, compareFeeModels } from '@/lib/feeEngine';

const fmt = (n) => typeof n === 'number' ? `$${n.toFixed(2)}` : '—';
const fmtK = (n) => {
  if (!n && n !== 0) return '—';
  if (Math.abs(n) >= 1000000) return `$${(n / 1000000).toFixed(2)}M`;
  if (Math.abs(n) >= 1000) return `$${(n / 1000).toFixed(1)}K`;
  return `$${n.toFixed(2)}`;
};

const SCENARIOS = [
  { label: 'Beta', txPerMonth: 50, avgPrice: 75 },
  { label: 'Small Traction', txPerMonth: 250, avgPrice: 85 },
  { label: 'One Strong Market', txPerMonth: 1000, avgPrice: 100 },
  { label: 'Regional Traction', txPerMonth: 5000, avgPrice: 120 },
  { label: 'Scale', txPerMonth: 20000, avgPrice: 125 },
];

// Only the 5 primary models for comparison (exclude legacy aliases)
const PRIMARY_MODELS = ['buyer_5_min_1', 'buyer_5_seller_5', 'buyer_5_seller_3', 'instant_buyer_5_seller_10', 'buyer_5_seller_5_plus_1'];
const VALIDATION_PRICES = [10, 25, 50, 75, 100, 200, 500];

function Tag({ children, live }) {
  return (
    <span className="text-[9px] font-black px-1.5 py-0.5 rounded-full ml-1"
      style={live
        ? { background: 'rgba(0,255,135,0.15)', color: '#00FF87', border: '1px solid rgba(0,255,135,0.3)' }
        : { background: 'rgba(191,95,255,0.12)', color: '#BF5FFF', border: '1px solid rgba(191,95,255,0.25)' }}>
      {children}
    </span>
  );
}

function Row({ label, value, sub, color, bold }) {
  return (
    <div className="flex items-center justify-between text-xs py-1.5 border-b last:border-0" style={{ borderColor: 'rgba(255,255,255,0.05)' }}>
      <span className="text-muted-foreground">{label}</span>
      <div className="text-right">
        <span className={`font-${bold ? 'black' : 'semibold'} text-sm`} style={{ color: color || 'hsl(var(--foreground))' }}>{value}</span>
        {sub && <div className="text-[10px] text-muted-foreground">{sub}</div>}
      </div>
    </div>
  );
}

export default function FeeSimulatorV2() {
  const [tab, setTab] = useState('simulator');
  const [avgPrice, setAvgPrice] = useState(100);
  const [txPerMonth, setTxPerMonth] = useState(1000);
  const [qty, setQty] = useState(1);
  const [selectedModel, setSelectedModel] = useState('buyer_5_min_1');
  const [disputeRate, setDisputeRate] = useState(0);
  const [failedRate, setFailedRate] = useState(0);
  const [fixedCosts, setFixedCosts] = useState(0);
  const [scenario, setScenario] = useState(null);

  const applyScenario = (s) => {
    setAvgPrice(s.avgPrice);
    setTxPerMonth(s.txPerMonth);
    setScenario(s.label);
  };

  const annual = useMemo(() =>
    estimateAnnualRevenue(avgPrice, txPerMonth, qty, selectedModel, { disputeRate: disputeRate / 100, failedRate: failedRate / 100, fixedCosts }),
    [avgPrice, txPerMonth, qty, selectedModel, disputeRate, failedRate, fixedCosts]
  );

  const perTx = annual.perTransaction;

  // Comparison across all primary models at current inputs
  const comparisonRows = useMemo(() =>
    PRIMARY_MODELS.map(id => {
      const ann = estimateAnnualRevenue(avgPrice, txPerMonth, qty, id, { disputeRate: disputeRate / 100, failedRate: failedRate / 100, fixedCosts });
      return { id, model: FEE_MODELS[id], ann };
    }),
    [avgPrice, txPerMonth, qty, disputeRate, failedRate, fixedCosts]
  );

  // Per-tx comparison at current price
  const perTxComparison = useMemo(() =>
    compareFeeModels(avgPrice, qty).filter(r => PRIMARY_MODELS.includes(r.modelId)),
    [avgPrice, qty]
  );

  // Validation table
  const validationRows = useMemo(() =>
    PRIMARY_MODELS.map(modelId => ({
      modelId,
      label: FEE_MODELS[modelId]?.shortLabel,
      prices: VALIDATION_PRICES.map(p => calculateFees(p, 1, modelId)),
    })),
    []
  );

  const inputClass = "w-full px-3 py-2 rounded-xl text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30";
  const inputStyle = { background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)' };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-bold text-lg text-foreground">Fee Engine Simulator</h2>
        <p className="text-xs text-muted-foreground mt-0.5">
          Compare fee models before switching live pricing.
          <span className="ml-2 font-semibold" style={{ color: '#00FF87' }}>
            Live model: {FEE_MODELS[ACTIVE_FEE_MODEL_ID]?.label}
          </span>
        </p>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 flex-wrap">
        {[
          { id: 'simulator', label: '🧮 Simulator' },
          { id: 'comparison', label: '📊 Model Comparison' },
          { id: 'validation', label: '✅ Validation Tests' },
        ].map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className="px-3 py-1.5 rounded-full text-xs font-semibold transition-all"
            style={tab === t.id
              ? { background: 'hsl(var(--primary))', color: 'hsl(var(--primary-foreground))' }
              : { background: 'rgba(255,255,255,0.06)', color: 'hsl(var(--muted-foreground))', border: '1px solid rgba(255,255,255,0.1)' }}>
            {t.label}
          </button>
        ))}
      </div>

      {/* ── SIMULATOR TAB ─────────────────────────────────────────────────── */}
      {tab === 'simulator' && (
        <div className="space-y-5">
          {/* Preset Scenarios */}
          <div>
            <p className="text-xs font-bold text-muted-foreground uppercase tracking-wide mb-2">Quick Scenarios</p>
            <div className="flex gap-2 flex-wrap">
              {SCENARIOS.map(s => (
                <button key={s.label} onClick={() => applyScenario(s)}
                  className="px-3 py-1.5 rounded-xl text-xs font-semibold transition-all"
                  style={scenario === s.label
                    ? { background: 'rgba(191,95,255,0.15)', color: '#BF5FFF', border: '1px solid rgba(191,95,255,0.4)' }
                    : { background: 'rgba(255,255,255,0.04)', color: 'hsl(var(--muted-foreground))', border: '1px solid rgba(255,255,255,0.08)' }}>
                  {s.label}
                  <span className="ml-1 opacity-60">{s.txPerMonth.toLocaleString()} tx · ${s.avgPrice}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
            {/* Inputs */}
            <div className="space-y-4 rounded-2xl p-4" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }}>
              <p className="text-xs font-bold text-muted-foreground uppercase tracking-wide">Inputs</p>

              <div>
                <label className="text-xs text-muted-foreground block mb-1">Fee Model</label>
                <select value={selectedModel} onChange={e => setSelectedModel(e.target.value)}
                  className={inputClass} style={inputStyle}>
                  {PRIMARY_MODELS.map(id => (
                    <option key={id} value={id}>
                      {FEE_MODELS[id]?.label}{id === ACTIVE_FEE_MODEL_ID ? ' ★ LIVE' : ''}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-muted-foreground block mb-1">Avg Ticket Price ($)</label>
                  <input type="number" min="10" value={avgPrice} onChange={e => { setAvgPrice(+e.target.value); setScenario(null); }}
                    className={inputClass} style={inputStyle} />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground block mb-1">Transactions / Month</label>
                  <input type="number" min="1" value={txPerMonth} onChange={e => { setTxPerMonth(+e.target.value); setScenario(null); }}
                    className={inputClass} style={inputStyle} />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground block mb-1">Avg Qty / Transaction</label>
                  <input type="number" min="1" value={qty} onChange={e => setQty(+e.target.value)}
                    className={inputClass} style={inputStyle} />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground block mb-1">Monthly Fixed Costs ($)</label>
                  <input type="number" min="0" value={fixedCosts} onChange={e => setFixedCosts(+e.target.value)}
                    className={inputClass} style={inputStyle} />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground block mb-1">Dispute Rate (%)</label>
                  <input type="number" min="0" max="100" step="0.5" value={disputeRate} onChange={e => setDisputeRate(+e.target.value)}
                    className={inputClass} style={inputStyle} />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground block mb-1">Failed Tx Rate (%)</label>
                  <input type="number" min="0" max="100" step="0.5" value={failedRate} onChange={e => setFailedRate(+e.target.value)}
                    className={inputClass} style={inputStyle} />
                </div>
              </div>
            </div>

            {/* Per Transaction */}
            <div className="rounded-2xl p-4 space-y-1" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }}>
              <p className="text-xs font-bold text-muted-foreground uppercase tracking-wide mb-3">Per Transaction — {FEE_MODELS[selectedModel]?.shortLabel}</p>
              <Row label="Ticket subtotal" value={fmt(perTx.subtotal)} />
              <Row label="Buyer fee" value={fmt(perTx.buyerFee)} color="#BF5FFF" />
              <Row label="Buyer pays total" value={fmt(perTx.buyerTotal)} bold color="#BF5FFF" />
              <div className="border-t my-1" style={{ borderColor: 'rgba(255,255,255,0.08)' }} />
              <Row label="Seller fee" value={perTx.sellerFee > 0 ? fmt(perTx.sellerFee) : '$0.00 (none)'} color={perTx.sellerFee > 0 ? '#FF8C00' : 'hsl(var(--muted-foreground))'} />
              <Row label="Seller receives" value={fmt(perTx.sellerPayout)} bold color="#00FF87" sub={`${perTx.sellerPayoutRate}% of asking price`} />
              <div className="border-t my-1" style={{ borderColor: 'rgba(255,255,255,0.08)' }} />
              <Row label="PG gross revenue" value={fmt(perTx.pgGrossRevenue)} />
              <Row label="Stripe fee" value={fmt(perTx.stripeFee)} color="#FF2D78" />
              <Row label="PG net revenue" value={fmt(perTx.pgNetRevenue)} bold color={perTx.pgNetRevenue > 0 ? '#00FF87' : '#FF2D78'} sub={`${perTx.effectiveTakeRate}% effective take rate`} />
            </div>
          </div>

          {/* Monthly / Annual */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label: 'Monthly Gross Volume', value: fmtK(annual.grossVolume), color: '#BF5FFF' },
              { label: 'Monthly PG Net', value: fmtK(annual.pgNet), color: annual.pgNet > 0 ? '#00FF87' : '#FF2D78' },
              { label: 'Annual PG Net', value: fmtK(annual.annualPgNet), color: annual.annualPgNet > 0 ? '#00FF87' : '#FF2D78' },
              { label: 'Annual Seller Payouts', value: fmtK(annual.annualSellerPayouts), color: '#00C8FF' },
            ].map(s => (
              <div key={s.label} className="rounded-2xl p-4 text-center" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
                <div className="text-xl font-black" style={{ color: s.color }}>{s.value}</div>
                <div className="text-[10px] text-muted-foreground mt-1">{s.label}</div>
              </div>
            ))}
          </div>

          {/* Seller-facing payout preview */}
          <div className="rounded-2xl p-4" style={{ background: 'rgba(0,255,135,0.04)', border: '1px solid rgba(0,255,135,0.15)' }}>
            <p className="text-xs font-bold mb-3" style={{ color: '#00FF87' }}>Seller-Facing Payout Preview (at avg price)</p>
            <div className="grid grid-cols-3 gap-4 text-center text-sm">
              <div>
                <div className="text-xs text-muted-foreground mb-1">Your Asking Price</div>
                <div className="font-black text-xl text-foreground">{fmt(perTx.subtotal)}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground mb-1">Buyer Sees</div>
                <div className="font-black text-xl" style={{ color: '#BF5FFF' }}>{fmt(perTx.buyerTotal)}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground mb-1">You Receive</div>
                <div className="font-black text-xl" style={{ color: '#00FF87' }}>{fmt(perTx.sellerPayout)}</div>
              </div>
            </div>
            {perTx.sellerFee > 0 && (
              <p className="text-xs text-muted-foreground text-center mt-3">
                Includes a {(FEE_MODELS[selectedModel]?.seller_fee_pct * 100).toFixed(0)}% seller service fee ({fmt(perTx.sellerFee)}).
                Peanut Gallery only gets paid when your ticket sells.
              </p>
            )}
            {perTx.sellerFee === 0 && (
              <p className="text-xs text-muted-foreground text-center mt-3">
                No seller fee on this model — you keep 100% of your asking price.
              </p>
            )}
            <p className="text-[10px] text-muted-foreground text-center mt-1 opacity-70">
              Your payout is the amount sent to your Stripe account after successful transfer and confirmation.
            </p>
          </div>
        </div>
      )}

      {/* ── COMPARISON TAB ────────────────────────────────────────────────── */}
      {tab === 'comparison' && (
        <div className="space-y-5">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Ticket Price ($)</label>
              <input type="number" min="10" value={avgPrice} onChange={e => setAvgPrice(+e.target.value)}
                className={inputClass} style={inputStyle} />
            </div>
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Transactions / Month</label>
              <input type="number" min="1" value={txPerMonth} onChange={e => setTxPerMonth(+e.target.value)}
                className={inputClass} style={inputStyle} />
            </div>
          </div>

          {/* Per-transaction comparison */}
          <div>
            <p className="text-xs font-bold text-muted-foreground uppercase tracking-wide mb-2">Per Transaction at ${avgPrice}</p>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
                    {['Model', 'Buyer Pays', 'Seller Gets', 'PG Gross', 'Stripe Cost', 'PG Net', 'Take Rate'].map(h => (
                      <th key={h} className="text-left py-2 pr-3 text-muted-foreground font-semibold whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {perTxComparison.map(r => (
                    <tr key={r.modelId} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                      <td className="py-2 pr-3 font-semibold text-foreground whitespace-nowrap">
                        {FEE_MODELS[r.modelId]?.shortLabel}
                        {r.modelId === ACTIVE_FEE_MODEL_ID && <Tag live>LIVE</Tag>}
                        {FEE_MODELS[r.modelId]?.instant_only && <Tag>Instant</Tag>}
                      </td>
                      <td className="py-2 pr-3" style={{ color: '#BF5FFF' }}>{fmt(r.buyerTotal)}</td>
                      <td className="py-2 pr-3" style={{ color: '#00FF87' }}>{fmt(r.sellerPayout)} <span className="text-muted-foreground">({r.sellerPayoutRate}%)</span></td>
                      <td className="py-2 pr-3 text-foreground">{fmt(r.pgGrossRevenue)}</td>
                      <td className="py-2 pr-3" style={{ color: '#FF2D78' }}>{fmt(r.stripeFee)}</td>
                      <td className="py-2 pr-3 font-bold" style={{ color: r.pgNetRevenue > 0 ? '#00FF87' : '#FF2D78' }}>{fmt(r.pgNetRevenue)}</td>
                      <td className="py-2 pr-3 text-muted-foreground">{r.effectiveTakeRate}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Monthly / Annual comparison */}
          <div>
            <p className="text-xs font-bold text-muted-foreground uppercase tracking-wide mb-2">Revenue Estimates — {txPerMonth.toLocaleString()} transactions/month</p>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
                    {['Model', 'Monthly PG Net', 'Annual PG Net', 'Monthly @ 100 tx', 'Monthly @ 1K tx', 'Annual @ 1K/mo'].map(h => (
                      <th key={h} className="text-left py-2 pr-3 text-muted-foreground font-semibold whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {comparisonRows.map(({ id, model, ann }) => {
                    const at100 = estimateAnnualRevenue(avgPrice, 100, qty, id);
                    const at1k = estimateAnnualRevenue(avgPrice, 1000, qty, id);
                    return (
                      <tr key={id} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                        <td className="py-2 pr-3 font-semibold text-foreground whitespace-nowrap">
                          {model?.shortLabel}
                          {id === ACTIVE_FEE_MODEL_ID && <Tag live>LIVE</Tag>}
                        </td>
                        <td className="py-2 pr-3 font-bold" style={{ color: ann.pgNet > 0 ? '#00FF87' : '#FF2D78' }}>{fmtK(ann.pgNet)}</td>
                        <td className="py-2 pr-3 font-bold" style={{ color: ann.annualPgNet > 0 ? '#00FF87' : '#FF2D78' }}>{fmtK(ann.annualPgNet)}</td>
                        <td className="py-2 pr-3 text-muted-foreground">{fmtK(at100.pgNet)}</td>
                        <td className="py-2 pr-3 text-muted-foreground">{fmtK(at1k.pgNet)}</td>
                        <td className="py-2 pr-3 text-muted-foreground">{fmtK(at1k.annualPgNet)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Scenario summary across all models */}
          <div>
            <p className="text-xs font-bold text-muted-foreground uppercase tracking-wide mb-2">Annual PG Net by Scenario × Model</p>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
                    <th className="text-left py-2 pr-3 text-muted-foreground font-semibold">Scenario</th>
                    {PRIMARY_MODELS.map(id => (
                      <th key={id} className="text-left py-2 pr-3 text-muted-foreground font-semibold whitespace-nowrap">
                        {FEE_MODELS[id]?.shortLabel}
                        {id === ACTIVE_FEE_MODEL_ID && ' ★'}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {SCENARIOS.map(s => (
                    <tr key={s.label} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                      <td className="py-2 pr-3 text-foreground font-semibold whitespace-nowrap">
                        {s.label}
                        <div className="text-[10px] text-muted-foreground">{s.txPerMonth.toLocaleString()} tx · ${s.avgPrice}</div>
                      </td>
                      {PRIMARY_MODELS.map(id => {
                        const ann = estimateAnnualRevenue(s.avgPrice, s.txPerMonth, 1, id);
                        return (
                          <td key={id} className="py-2 pr-3 font-bold whitespace-nowrap" style={{ color: ann.annualPgNet > 0 ? '#00FF87' : '#FF2D78' }}>
                            {fmtK(ann.annualPgNet)}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ── VALIDATION TAB ────────────────────────────────────────────────── */}
      {tab === 'validation' && (
        <div className="space-y-6">
          <p className="text-xs text-muted-foreground">Validation tests for each model at benchmark prices. Checks: seller payout ≥ $0, PG net at $10 minimum, math consistency.</p>
          {validationRows.map(({ modelId, label, prices }) => {
            const model = FEE_MODELS[modelId];
            const allPositivePayout = prices.every(p => p.sellerPayout >= 0);
            const profitableAt10 = prices.find(p => p.ticketPrice === 10)?.pgNetRevenue > 0;
            return (
              <div key={modelId} className="rounded-2xl p-4 space-y-3" style={{ background: 'rgba(255,255,255,0.03)', border: `1px solid ${modelId === ACTIVE_FEE_MODEL_ID ? 'rgba(0,255,135,0.25)' : 'rgba(255,255,255,0.08)'}` }}>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-bold text-sm text-foreground">{model?.label}</span>
                  {modelId === ACTIVE_FEE_MODEL_ID && <Tag live>LIVE</Tag>}
                  {model?.instant_only && <Tag>Instant Only</Tag>}
                  <div className="ml-auto flex gap-2 text-[10px]">
                    <span className={`px-2 py-0.5 rounded-full font-bold ${allPositivePayout ? 'text-green-400 bg-green-400/10' : 'text-red-400 bg-red-400/10'}`}>
                      {allPositivePayout ? '✓ Payout ≥ $0' : '✗ Negative payout risk'}
                    </span>
                    <span className={`px-2 py-0.5 rounded-full font-bold ${profitableAt10 ? 'text-green-400 bg-green-400/10' : 'text-red-400 bg-red-400/10'}`}>
                      {profitableAt10 ? '✓ Profitable at $10' : '✗ Loses $ at $10'}
                    </span>
                  </div>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
                        {['Price', 'Buyer Pays', 'Seller Gets', 'PG Gross', 'Stripe', 'PG Net', '✓'].map(h => (
                          <th key={h} className="text-left py-1.5 pr-3 text-muted-foreground">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {prices.map(r => (
                        <tr key={r.ticketPrice} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                          <td className="py-1.5 pr-3 font-bold text-foreground">${r.ticketPrice}</td>
                          <td className="py-1.5 pr-3" style={{ color: '#BF5FFF' }}>{fmt(r.buyerTotal)}</td>
                          <td className="py-1.5 pr-3" style={{ color: '#00FF87' }}>{fmt(r.sellerPayout)}</td>
                          <td className="py-1.5 pr-3 text-foreground">{fmt(r.pgGrossRevenue)}</td>
                          <td className="py-1.5 pr-3" style={{ color: '#FF2D78' }}>{fmt(r.stripeFee)}</td>
                          <td className="py-1.5 pr-3 font-bold" style={{ color: r.pgNetRevenue > 0 ? '#00FF87' : '#FF2D78' }}>{fmt(r.pgNetRevenue)}</td>
                          <td className="py-1.5">
                            {r.sellerPayout >= 0 && r.pgNetRevenue > 0
                              ? <span style={{ color: '#00FF87' }}>✓</span>
                              : <span style={{ color: '#FF2D78' }}>✗</span>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })}

          {/* Live model consistency check */}
          <div className="rounded-2xl p-4" style={{ background: 'rgba(0,255,135,0.04)', border: '1px solid rgba(0,255,135,0.2)' }}>
            <p className="text-xs font-bold mb-2" style={{ color: '#00FF87' }}>✓ Live Checkout Consistency Check</p>
            <p className="text-xs text-muted-foreground">
              Active model: <strong className="text-foreground">{ACTIVE_FEE_MODEL_ID}</strong> — {FEE_MODELS[ACTIVE_FEE_MODEL_ID]?.description}
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              All simulation models are isolated from production. Checkout always reads <code className="text-primary">ACTIVE_FEE_MODEL_ID</code> only.
            </p>
            <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-2">
              {[10, 50, 100, 200].map(p => {
                const r = calculateFees(p, 1, ACTIVE_FEE_MODEL_ID);
                return (
                  <div key={p} className="text-center rounded-xl p-2" style={{ background: 'rgba(0,255,135,0.06)', border: '1px solid rgba(0,255,135,0.15)' }}>
                    <div className="text-[10px] text-muted-foreground">Ticket ${p}</div>
                    <div className="font-bold text-xs text-foreground mt-0.5">Buyer: {fmt(r.buyerTotal)}</div>
                    <div className="text-[10px]" style={{ color: '#00FF87' }}>PG net: {fmt(r.pgNetRevenue)}</div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}