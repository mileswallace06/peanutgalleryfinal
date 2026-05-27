import { useMemo } from 'react';
import { buildPurchaseAnalytics, analyzePurchase } from '@/lib/feeEngine';
import { TrendingUp, TrendingDown, AlertTriangle, DollarSign } from 'lucide-react';

function StatCard({ label, value, sub, color }) {
  return (
    <div className="rounded-xl p-3 text-center" style={{ background: 'hsl(var(--secondary))', border: '1px solid hsl(var(--border))' }}>
      <div className="text-[10px] text-muted-foreground uppercase tracking-wide mb-1">{label}</div>
      <div className="font-black text-lg" style={{ color: color || 'hsl(var(--foreground))' }}>{value}</div>
      {sub && <div className="text-[10px] text-muted-foreground mt-0.5">{sub}</div>}
    </div>
  );
}

export default function TransactionAnalytics({ purchases }) {
  const analytics = useMemo(() => buildPurchaseAnalytics(purchases), [purchases]);

  if (!analytics) {
    return (
      <div className="bg-card border border-border rounded-2xl p-5 mb-6">
        <div className="flex items-center gap-2 mb-3">
          <TrendingUp className="w-5 h-5 text-primary" />
          <h2 className="font-bold text-lg">Transaction Economics</h2>
        </div>
        <p className="text-sm text-muted-foreground">No completed transactions yet to analyze.</p>
      </div>
    );
  }

  const { total, totalRevenue, totalNet, avgNetPerOrder, avgMarginPct, unprofitableCount, unprofitablePct, enriched } = analytics;

  const netColor = totalNet >= 0 ? '#00FF87' : '#FF2D78';
  const marginColor = avgMarginPct > 30 ? '#00FF87' : avgMarginPct > 0 ? '#FFE600' : '#FF2D78';

  // Sort by net revenue to find best/worst
  const sorted = [...enriched].sort((a, b) => a._pgNetRevenue - b._pgNetRevenue);
  const lowestMargin = sorted.slice(0, 3);
  const highestMargin = sorted.slice(-3).reverse();

  return (
    <div className="bg-card border border-border rounded-2xl p-5 mb-6">
      <div className="flex items-center gap-2 mb-4">
        <TrendingUp className="w-5 h-5 text-primary" />
        <div>
          <h2 className="font-bold text-lg">Transaction Economics</h2>
          <p className="text-xs text-muted-foreground">{total} completed transactions · live Stripe estimates</p>
        </div>
      </div>

      {/* Summary stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-5">
        <StatCard label="Total Fee Revenue" value={`$${totalRevenue.toFixed(2)}`} color="#BF5FFF" />
        <StatCard label="PG Net (after Stripe)" value={`$${totalNet.toFixed(2)}`} color={netColor} />
        <StatCard label="Avg Net / Order" value={`$${avgNetPerOrder.toFixed(2)}`} color={netColor} />
        <StatCard label="Avg Margin" value={`${avgMarginPct}%`} color={marginColor} />
      </div>

      {/* Profitability summary */}
      <div className="grid grid-cols-2 gap-3 mb-5">
        <div className="rounded-xl p-3" style={{ background: 'rgba(0,255,135,0.06)', border: '1px solid rgba(0,255,135,0.2)' }}>
          <div className="text-xs text-muted-foreground mb-1">Profitable Orders</div>
          <div className="font-black text-base" style={{ color: '#00FF87' }}>{total - unprofitableCount} / {total}</div>
          <div className="text-xs text-muted-foreground">{100 - unprofitablePct}% of orders</div>
        </div>
        <div className="rounded-xl p-3" style={{ background: unprofitableCount > 0 ? 'rgba(255,45,120,0.06)' : 'rgba(0,255,135,0.04)', border: unprofitableCount > 0 ? '1px solid rgba(255,45,120,0.2)' : '1px solid rgba(0,255,135,0.15)' }}>
          <div className="text-xs text-muted-foreground mb-1">Unprofitable Orders</div>
          <div className="font-black text-base" style={{ color: unprofitableCount > 0 ? '#FF2D78' : '#00FF87' }}>{unprofitableCount} / {total}</div>
          <div className="text-xs text-muted-foreground">{unprofitablePct}% of orders</div>
        </div>
      </div>

      {/* Worst margin orders */}
      {lowestMargin.length > 0 && (
        <div className="mb-4">
          <div className="text-xs font-black uppercase tracking-widest text-muted-foreground mb-2 flex items-center gap-1">
            <TrendingDown className="w-3 h-3" /> Lowest Margin Orders
          </div>
          <div className="space-y-1.5">
            {lowestMargin.map(p => (
              <div key={p.id} className="flex items-center justify-between text-xs px-3 py-2 rounded-lg"
                style={{ background: 'hsl(var(--secondary))', border: '1px solid hsl(var(--border))' }}>
                <div className="text-muted-foreground truncate mr-2">{p.buyer_email?.split('@')[0]} · ${p.amount?.toFixed(2)} total</div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <span className="text-muted-foreground">PG fee: ${p._pgFee?.toFixed(2)}</span>
                  <span style={{ color: p._pgNetRevenue >= 0 ? '#FFE600' : '#FF2D78' }}>
                    Net: ${p._pgNetRevenue?.toFixed(2)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Best margin orders */}
      {highestMargin.length > 0 && (
        <div>
          <div className="text-xs font-black uppercase tracking-widest text-muted-foreground mb-2 flex items-center gap-1">
            <TrendingUp className="w-3 h-3" /> Best Margin Orders
          </div>
          <div className="space-y-1.5">
            {highestMargin.map(p => (
              <div key={p.id} className="flex items-center justify-between text-xs px-3 py-2 rounded-lg"
                style={{ background: 'hsl(var(--secondary))', border: '1px solid hsl(var(--border))' }}>
                <div className="text-muted-foreground truncate mr-2">{p.buyer_email?.split('@')[0]} · ${p.amount?.toFixed(2)} total</div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <span className="text-muted-foreground">PG fee: ${p._pgFee?.toFixed(2)}</span>
                  <span style={{ color: '#00FF87' }}>Net: ${p._pgNetRevenue?.toFixed(2)}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}