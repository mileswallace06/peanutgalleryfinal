import { useState, useMemo } from 'react';
import { calculateFees, FEE_MODELS, BENCHMARK_PRICES, buildBenchmarkTable, findBreakeven, generateRecommendations, STRIPE_ASSUMPTIONS } from '@/lib/feeEngine';
import { TrendingUp, TrendingDown, Minus, ChevronDown, ChevronUp } from 'lucide-react';

function ProfitBadge({ row }) {
  if (!row.profitable) {
    return <span className="text-[10px] font-black px-2 py-0.5 rounded-full" style={{ background: 'rgba(255,45,120,0.12)', color: '#FF2D78', border: '1px solid rgba(255,45,120,0.3)' }}>LOSS</span>;
  }
  if (row.thin) {
    return <span className="text-[10px] font-black px-2 py-0.5 rounded-full" style={{ background: 'rgba(255,200,0,0.12)', color: '#FFE600', border: '1px solid rgba(255,200,0,0.3)' }}>THIN</span>;
  }
  return <span className="text-[10px] font-black px-2 py-0.5 rounded-full" style={{ background: 'rgba(0,255,135,0.12)', color: '#00FF87', border: '1px solid rgba(0,255,135,0.3)' }}>✓ OK</span>;
}

function NetCell({ val }) {
  const color = val > 0.5 ? '#00FF87' : val > 0 ? '#FFE600' : '#FF2D78';
  return <span className="font-bold" style={{ color }}>${val.toFixed(2)}</span>;
}

export default function FeeSimulator() {
  const [price, setPrice] = useState(50);
  const [qty, setQty] = useState(1);
  const [modelId, setModelId] = useState('current_5pct');
  const [showTable, setShowTable] = useState(true);
  const [stripePct, setStripePct] = useState(STRIPE_ASSUMPTIONS.pct * 100);
  const [stripeFixed, setStripeFixed] = useState(STRIPE_ASSUMPTIONS.fixed);

  const stripeOpts = { pct: stripePct / 100, fixed: stripeFixed };
  const result = useMemo(() => calculateFees(price, qty, modelId, stripeOpts), [price, qty, modelId, stripePct, stripeFixed]);
  const benchmarkRows = useMemo(() => buildBenchmarkTable(modelId, qty), [modelId, qty]);
  const breakeven = useMemo(() => findBreakeven(modelId, qty, stripeOpts), [modelId, qty, stripeOpts]);
  const recs = useMemo(() => generateRecommendations(modelId), [modelId]);

  const profitColor = !result.profitable ? '#FF2D78' : result.thin ? '#FFE600' : '#00FF87';
  const profitLabel = !result.profitable ? '🔴 Losing Money' : result.thin ? '🟡 Thin Margin' : '🟢 Profitable';

  return (
    <div className="bg-card border border-border rounded-2xl p-5 mb-6">
      {/* Header */}
      <div className="flex items-center gap-2 mb-5">
        <span className="text-xl">💰</span>
        <div>
          <h2 className="font-bold text-lg">Fee Simulator</h2>
          <p className="text-xs text-muted-foreground">Internal analysis only — live pricing is unchanged</p>
        </div>
      </div>

      {/* Controls */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
        <div>
          <label className="text-xs text-muted-foreground block mb-1">Ticket Price ($)</label>
          <input
            type="number" min="1" step="1"
            value={price}
            onChange={e => setPrice(Math.max(1, parseFloat(e.target.value) || 1))}
            className="w-full px-3 py-2 rounded-xl text-sm font-bold text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
            style={{ background: 'hsl(var(--input))', border: '1px solid hsl(var(--border))' }}
          />
        </div>
        <div>
          <label className="text-xs text-muted-foreground block mb-1">Quantity</label>
          <input
            type="number" min="1" max="20" step="1"
            value={qty}
            onChange={e => setQty(Math.max(1, parseInt(e.target.value) || 1))}
            className="w-full px-3 py-2 rounded-xl text-sm font-bold text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
            style={{ background: 'hsl(var(--input))', border: '1px solid hsl(var(--border))' }}
          />
        </div>
        <div>
          <label className="text-xs text-muted-foreground block mb-1">Stripe % (e.g. 2.9)</label>
          <input
            type="number" min="0" max="10" step="0.1"
            value={stripePct}
            onChange={e => setStripePct(parseFloat(e.target.value) || 2.9)}
            className="w-full px-3 py-2 rounded-xl text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
            style={{ background: 'hsl(var(--input))', border: '1px solid hsl(var(--border))' }}
          />
        </div>
        <div>
          <label className="text-xs text-muted-foreground block mb-1">Stripe Fixed ($)</label>
          <input
            type="number" min="0" max="2" step="0.01"
            value={stripeFixed}
            onChange={e => setStripeFixed(parseFloat(e.target.value) || 0.30)}
            className="w-full px-3 py-2 rounded-xl text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
            style={{ background: 'hsl(var(--input))', border: '1px solid hsl(var(--border))' }}
          />
        </div>
      </div>

      {/* Fee Model Selector */}
      <div className="mb-5">
        <label className="text-xs text-muted-foreground block mb-2">Fee Model</label>
        <div className="flex flex-wrap gap-2">
          {Object.values(FEE_MODELS).map(m => (
            <button
              key={m.id}
              onClick={() => setModelId(m.id)}
              className="text-xs px-3 py-1.5 rounded-xl font-semibold transition-all"
              style={{
                background: modelId === m.id ? 'rgba(191,95,255,0.15)' : 'hsl(var(--muted))',
                border: modelId === m.id ? '1px solid rgba(191,95,255,0.4)' : '1px solid hsl(var(--border))',
                color: modelId === m.id ? '#BF5FFF' : 'hsl(var(--muted-foreground))',
              }}
            >
              {m.id === modelId && m.isLive ? '⚡ ' : ''}{m.label}
            </button>
          ))}
        </div>
        <p className="text-xs text-muted-foreground mt-1.5">{FEE_MODELS[modelId]?.description}</p>
      </div>

      {/* Result Card */}
      <div className="rounded-2xl p-4 mb-5 grid grid-cols-2 sm:grid-cols-3 gap-3"
        style={{ background: 'hsl(var(--secondary))', border: `1px solid ${profitColor}33` }}>
        {[
          { label: 'Subtotal', val: `$${result.subtotal.toFixed(2)}`, color: 'hsl(var(--foreground))' },
          { label: 'PG Fee Charged', val: `$${result.pgFee.toFixed(2)}`, color: '#BF5FFF' },
          { label: 'Buyer Pays', val: `$${result.buyerTotal.toFixed(2)}`, color: '#00C8FF' },
          { label: 'Seller Gets', val: `$${result.sellerPayout.toFixed(2)}`, color: '#00FF87' },
          { label: 'Stripe Takes', val: `$${result.stripeFee.toFixed(2)}`, color: '#FF8C00' },
          { label: 'PG Net', val: `$${result.pgNetRevenue.toFixed(2)}`, color: profitColor },
        ].map(({ label, val, color }) => (
          <div key={label}>
            <div className="text-[10px] text-muted-foreground uppercase tracking-wide mb-0.5">{label}</div>
            <div className="text-lg font-black" style={{ color }}>{val}</div>
          </div>
        ))}
        <div className="col-span-2 sm:col-span-3 pt-2 border-t border-border flex items-center gap-3 flex-wrap">
          <span className="text-sm font-black" style={{ color: profitColor }}>{profitLabel}</span>
          <span className="text-xs text-muted-foreground">Margin: {result.marginPct}%</span>
          {breakeven !== null && (
            <span className="text-xs text-muted-foreground">Breakeven: ${breakeven.toFixed(2)}/ticket</span>
          )}
        </div>
      </div>

      {/* Benchmark Table toggle */}
      <button
        onClick={() => setShowTable(v => !v)}
        className="flex items-center gap-2 text-xs font-semibold text-muted-foreground hover:text-foreground transition-colors mb-3"
      >
        {showTable ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
        {showTable ? 'Hide' : 'Show'} Benchmark Table (all price points)
      </button>

      {showTable && (
        <div className="overflow-x-auto mb-5">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-muted-foreground">
                {['Price', 'Subtotal', 'PG Fee', 'Buyer Total', 'Stripe', 'PG Net', 'Margin', 'Status'].map(h => (
                  <th key={h} className="pb-2 pr-3 font-semibold whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {benchmarkRows.map(row => (
                <tr key={row.ticketPrice}
                  className="border-t border-border"
                  style={{ background: !row.profitable ? 'rgba(255,45,120,0.04)' : row.thin ? 'rgba(255,200,0,0.04)' : 'transparent' }}>
                  <td className="py-1.5 pr-3 font-bold text-foreground">${row.ticketPrice}</td>
                  <td className="py-1.5 pr-3 text-muted-foreground">${row.subtotal.toFixed(2)}</td>
                  <td className="py-1.5 pr-3" style={{ color: '#BF5FFF' }}>${row.pgFee.toFixed(2)}</td>
                  <td className="py-1.5 pr-3" style={{ color: '#00C8FF' }}>${row.buyerTotal.toFixed(2)}</td>
                  <td className="py-1.5 pr-3" style={{ color: '#FF8C00' }}>${row.stripeFee.toFixed(2)}</td>
                  <td className="py-1.5 pr-3"><NetCell val={row.pgNetRevenue} /></td>
                  <td className="py-1.5 pr-3 text-muted-foreground">{row.marginPct}%</td>
                  <td className="py-1.5"><ProfitBadge row={row} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Recommendations */}
      <div className="space-y-2">
        <div className="text-xs font-black uppercase tracking-widest text-muted-foreground mb-1">Insights</div>
        {recs.map((r, i) => {
          const color = r.type === 'warning' ? '#FF2D78' : r.type === 'tip' ? '#00FF87' : '#00C8FF';
          const icon = r.type === 'warning' ? '⚠️' : r.type === 'tip' ? '💡' : 'ℹ️';
          return (
            <div key={i} className="flex items-start gap-2 text-xs px-3 py-2 rounded-xl"
              style={{ background: `${color}0D`, border: `1px solid ${color}25` }}>
              <span className="flex-shrink-0">{icon}</span>
              <span style={{ color }}>{r.text}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}