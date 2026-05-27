/**
 * FeeComparisonReport
 * ───────────────────
 * Side-by-side analysis: current 5% vs 5% + $1 minimum.
 * Read-only analytics — zero impact on live payment flow.
 */
import { useMemo, useState } from 'react';
import {
  buildComparison, analyzeUXRisk, analyzeMinListingPriceImpact,
  findBreakeven, FEE_MODELS, calculateFees,
} from '@/lib/feeEngine';

const RISK_COLORS = {
  none: { bg: 'rgba(0,255,135,0.08)', border: 'rgba(0,255,135,0.2)', text: '#00FF87', label: '✓ OK' },
  low:  { bg: 'rgba(0,200,255,0.08)', border: 'rgba(0,200,255,0.2)', text: '#00C8FF', label: '↑ Minor' },
  medium: { bg: 'rgba(255,200,0,0.08)', border: 'rgba(255,200,0,0.2)', text: '#FFE600', label: '⚠ Noticeable' },
  high: { bg: 'rgba(255,45,120,0.08)', border: 'rgba(255,45,120,0.2)', text: '#FF2D78', label: '🔴 Risk' },
};

function ProfitPill({ row }) {
  if (!row.profitable) return <span className="text-[10px] font-black px-2 py-0.5 rounded-full" style={{ background: 'rgba(255,45,120,0.12)', color: '#FF2D78' }}>LOSS</span>;
  if (row.thin)        return <span className="text-[10px] font-black px-2 py-0.5 rounded-full" style={{ background: 'rgba(255,200,0,0.12)', color: '#FFE600' }}>THIN</span>;
  return                      <span className="text-[10px] font-black px-2 py-0.5 rounded-full" style={{ background: 'rgba(0,255,135,0.12)', color: '#00FF87' }}>✓</span>;
}

export default function FeeComparisonReport() {
  const [minThreshold, setMinThreshold] = useState(10);

  const comparison = useMemo(() => buildComparison('current_5pct', 'pct5_min1'), []);
  const uxRisk     = useMemo(() => analyzeUXRisk('pct5_min1'), []);
  const minImpact  = useMemo(() => analyzeMinListingPriceImpact(minThreshold), [minThreshold]);
  const breakevenCurrent  = findBreakeven('current_5pct');
  const breakevenCandidate = findBreakeven('pct5_min1');

  // Buyer fee increase at the $1 minimum crossover
  const crossoverPrice = 20; // 5% of $20 = $1.00 exactly
  const sampleLow  = calculateFees(5, 1, 'pct5_min1');
  const sampleMid  = calculateFees(20, 1, 'pct5_min1');
  const sampleHigh = calculateFees(100, 1, 'pct5_min1');

  return (
    <div className="bg-card border border-border rounded-2xl p-5 mb-6 space-y-6">
      {/* Header */}
      <div className="flex items-start gap-3">
        <span className="text-2xl">⚖️</span>
        <div>
          <h2 className="font-bold text-lg">Fee Model Comparison Report</h2>
          <p className="text-xs text-muted-foreground">Current 5% vs candidate 5% + $1 minimum · Analysis only · Live pricing unchanged</p>
        </div>
      </div>

      {/* Breakeven summary */}
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-xl p-3 text-center" style={{ background: 'rgba(255,45,120,0.06)', border: '1px solid rgba(255,45,120,0.2)' }}>
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1">Current 5% — Breakeven</div>
          <div className="font-black text-xl" style={{ color: '#FF2D78' }}>${breakevenCurrent?.toFixed(2) ?? '—'}</div>
          <div className="text-[10px] text-muted-foreground mt-0.5">per ticket (qty 1)</div>
        </div>
        <div className="rounded-xl p-3 text-center" style={{ background: 'rgba(0,255,135,0.06)', border: '1px solid rgba(0,255,135,0.2)' }}>
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1">5% + $1 min — Breakeven</div>
          <div className="font-black text-xl" style={{ color: '#00FF87' }}>${breakevenCandidate?.toFixed(2) ?? '—'}</div>
          <div className="text-[10px] text-muted-foreground mt-0.5">per ticket (qty 1)</div>
        </div>
      </div>

      {/* Side-by-side comparison table */}
      <div>
        <div className="text-xs font-black uppercase tracking-widest text-muted-foreground mb-2">Full Comparison Table</div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-muted-foreground">
                <th className="pb-2 pr-2 font-semibold">Price</th>
                <th className="pb-2 pr-2 font-semibold" style={{ color: 'rgba(191,95,255,0.7)' }}>Fee (5%)</th>
                <th className="pb-2 pr-2 font-semibold" style={{ color: 'rgba(191,95,255,0.7)' }}>Net (5%)</th>
                <th className="pb-2 pr-2 font-semibold" style={{ color: '#00C8FF' }}>Fee (min$1)</th>
                <th className="pb-2 pr-2 font-semibold" style={{ color: '#00C8FF' }}>Net (min$1)</th>
                <th className="pb-2 pr-2 font-semibold">Buyer Δ</th>
                <th className="pb-2 pr-2 font-semibold">PG Δ</th>
                <th className="pb-2 font-semibold">Status</th>
              </tr>
            </thead>
            <tbody>
              {comparison.map(({ price, a, b, feeImpact, netImpact }) => (
                <tr key={price} className="border-t border-border"
                  style={{ background: !b.profitable ? 'rgba(255,45,120,0.04)' : b.thin ? 'rgba(255,200,0,0.04)' : 'transparent' }}>
                  <td className="py-1.5 pr-2 font-bold text-foreground">${price}</td>
                  {/* Current 5% */}
                  <td className="py-1.5 pr-2 text-muted-foreground">${a.pgFee.toFixed(2)}</td>
                  <td className="py-1.5 pr-2 font-semibold" style={{ color: a.profitable ? (a.thin ? '#FFE600' : '#00FF87') : '#FF2D78' }}>
                    ${a.pgNetRevenue.toFixed(2)}
                  </td>
                  {/* Candidate */}
                  <td className="py-1.5 pr-2" style={{ color: '#00C8FF' }}>${b.pgFee.toFixed(2)}</td>
                  <td className="py-1.5 pr-2 font-semibold" style={{ color: b.profitable ? (b.thin ? '#FFE600' : '#00FF87') : '#FF2D78' }}>
                    ${b.pgNetRevenue.toFixed(2)}
                  </td>
                  {/* Deltas */}
                  <td className="py-1.5 pr-2" style={{ color: feeImpact > 0 ? '#FFE600' : '#00FF87' }}>
                    {feeImpact > 0 ? `+$${feeImpact.toFixed(2)}` : '—'}
                  </td>
                  <td className="py-1.5 pr-2 font-bold" style={{ color: netImpact > 0 ? '#00FF87' : netImpact < 0 ? '#FF2D78' : 'hsl(var(--muted-foreground))' }}>
                    {netImpact > 0 ? `+$${netImpact.toFixed(2)}` : netImpact < 0 ? `-$${Math.abs(netImpact).toFixed(2)}` : '—'}
                  </td>
                  <td className="py-1.5"><ProfitPill row={b} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* UX Risk Analysis */}
      <div>
        <div className="text-xs font-black uppercase tracking-widest text-muted-foreground mb-2">Buyer UX Risk (5% + $1 min)</div>
        <div className="space-y-1.5">
          {uxRisk.map(({ price, currentFee, candidateFee, feeIncrease, feeRatio, uxRisk: risk, uxNote }) => {
            const c = RISK_COLORS[risk];
            return (
              <div key={price} className="flex items-center gap-3 px-3 py-2 rounded-xl text-xs"
                style={{ background: c.bg, border: `1px solid ${c.border}` }}>
                <span className="font-black w-8 text-foreground">${price}</span>
                <span className="text-muted-foreground w-20">Fee: <strong style={{ color: c.text }}>${candidateFee.toFixed(2)}</strong></span>
                <span className="text-muted-foreground w-20">Ratio: <strong style={{ color: feeRatio > 0.1 ? '#FFE600' : 'inherit' }}>{Math.round(feeRatio * 100)}%</strong></span>
                <span className="font-semibold w-16" style={{ color: c.text }}>{c.label}</span>
                <span className="text-muted-foreground flex-1 text-[10px]">{uxNote}</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Minimum listing price simulator */}
      <div>
        <div className="text-xs font-black uppercase tracking-widest text-muted-foreground mb-2">Min Listing Price Impact Preview</div>
        <div className="flex items-center gap-3 mb-3">
          <label className="text-xs text-muted-foreground whitespace-nowrap">Block listings under:</label>
          <input
            type="number" min="1" max="50" step="1"
            value={minThreshold}
            onChange={e => setMinThreshold(parseInt(e.target.value) || 1)}
            className="w-24 px-3 py-1.5 rounded-xl text-sm font-bold text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
            style={{ background: 'hsl(var(--input))', border: '1px solid hsl(var(--border))' }}
          />
          <span className="text-xs text-muted-foreground">dollars</span>
        </div>
        <div className="flex flex-wrap gap-2 text-xs mb-2">
          {minImpact.blocked.length > 0 && (
            <span className="px-2 py-1 rounded-lg" style={{ background: 'rgba(255,45,120,0.1)', color: '#FF2D78', border: '1px solid rgba(255,45,120,0.2)' }}>
              🚫 Blocked: {minImpact.blocked.map(p => `$${p}`).join(', ')}
            </span>
          )}
          <span className="px-2 py-1 rounded-lg" style={{ background: 'rgba(0,255,135,0.08)', color: '#00FF87', border: '1px solid rgba(0,255,135,0.2)' }}>
            ✓ Allowed from: ${minImpact.lowestAllowed} → PG net ${minImpact.lowestAllowedFees.pgNetRevenue.toFixed(2)}
          </span>
        </div>
        <p className="text-[10px] text-muted-foreground">
          Note: this is a preview only. Enforcement requires enabling min price in admin config and wiring into CreateListing validation.
        </p>
      </div>

      {/* Verdict cards */}
      <div>
        <div className="text-xs font-black uppercase tracking-widest text-muted-foreground mb-2">Findings & Recommendations</div>
        <div className="space-y-2">
          {[
            { icon: '💡', type: 'tip', text: `5% + $1 minimum breaks even at $${breakevenCandidate?.toFixed(2)} vs $${breakevenCurrent?.toFixed(2)} for pure 5% — a major improvement.` },
            { icon: '⚠️', type: 'warning', text: `At $5 tickets, the $1 fee = 20% of ticket price. Buyers may feel overcharged. Consider blocking listings under $10.` },
            { icon: '✅', type: 'ok', text: `Above $20, the $1 minimum has no buyer impact — 5% of $20 already equals $1.00. Zero UX risk.` },
            { icon: '🚫', type: 'warning', text: `Listings under $5 lose money on BOTH models. These should be blocked regardless of fee model chosen.` },
            { icon: '💡', type: 'tip', text: `Recommended rollout: enforce $10 minimum listing price + switch to 5% + $1 min simultaneously.` },
            { icon: '✅', type: 'ok', text: `Live Stripe Connect architecture, capturePayment, escrow, and seller payout logic are fully untouched.` },
          ].map((r, i) => {
            const color = r.type === 'warning' ? '#FFE600' : r.type === 'ok' ? '#00FF87' : '#00C8FF';
            return (
              <div key={i} className="flex items-start gap-2.5 text-xs px-3 py-2.5 rounded-xl"
                style={{ background: `${color}0D`, border: `1px solid ${color}25` }}>
                <span className="flex-shrink-0 text-sm">{r.icon}</span>
                <span style={{ color }}>{r.text}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}