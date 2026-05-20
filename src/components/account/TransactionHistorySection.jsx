import { useState } from 'react';
import { CreditCard, TrendingUp, ChevronDown, ChevronUp } from 'lucide-react';
import { format } from 'date-fns';

const STATUS_CONFIG = {
  completed:        { label: 'Transfer Complete', color: '#00FF87' },
  pending_transfer: { label: 'Pending Transfer', color: '#BF5FFF' },
  disputed:         { label: 'Dispute Open', color: '#FF2D78' },
  expired:          { label: 'Expired', color: '#FF8C00' },
};

function statusBadge(s) {
  const cfg = STATUS_CONFIG[s] || { label: (s || 'Unknown').replace(/_/g, ' '), color: '#BF5FFF' };
  return (
    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full capitalize"
      style={{ background: `${cfg.color}18`, color: cfg.color, border: `1px solid ${cfg.color}33` }}>
      {cfg.label}
    </span>
  );
}

function PurchaseRow({ p, type }) {
  const label = type === 'purchase' ? `Bought · #${p.id?.slice(-6)}` : `Sold · #${p.id?.slice(-6)}`;
  const amount = type === 'purchase' ? p.amount : p.seller_payout;
  const color = type === 'purchase' ? '#FF2D78' : '#00FF87';
  const sign = type === 'purchase' ? '-' : '+';

  return (
    <div className="flex items-center gap-3 px-4 py-3.5">
      {type === 'purchase'
        ? <CreditCard className="w-4 h-4 text-muted-foreground flex-shrink-0" />
        : <TrendingUp className="w-4 h-4 text-muted-foreground flex-shrink-0" />
      }
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-foreground truncate">{label}</p>
        <div className="flex items-center gap-2 mt-0.5 flex-wrap">
          {statusBadge(p.transfer_status)}
          {p.created_date && <span className="text-[10px] text-muted-foreground">{format(new Date(p.created_date), 'MMM d')}</span>}
        </div>
      </div>
      <span className="text-sm font-bold" style={{ color }}>
        {sign}${(amount || 0).toFixed(2)}
      </span>
    </div>
  );
}

export default function TransactionHistorySection({ purchases, sales }) {
  const [tab, setTab] = useState('purchases');
  const [open, setOpen] = useState(false);

  const totalPurchased = purchases.reduce((s, p) => s + (p.amount || 0), 0);
  const totalEarned = sales.reduce((s, p) => s + (p.seller_payout || 0), 0);

  return (
    <section>
      <h3 className="text-xs font-black tracking-widest uppercase text-muted-foreground mb-3">Purchases, Sales &amp; Payouts</h3>
      <div className="rounded-2xl overflow-hidden" style={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))' }}>
        {/* Summary row */}
        <button
          className="flex items-center gap-3 px-4 py-3.5 w-full text-left"
          onClick={() => setOpen(o => !o)}
        >
          <CreditCard className="w-4 h-4 flex-shrink-0 text-muted-foreground" />
          <div className="flex-1 flex gap-5">
            <div>
              <p className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wide">Spent</p>
              <p className="text-sm font-bold" style={{ color: '#FF2D78' }}>${totalPurchased.toFixed(2)}</p>
            </div>
            <div>
              <p className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wide">Earned</p>
              <p className="text-sm font-bold" style={{ color: '#00FF87' }}>${totalEarned.toFixed(2)}</p>
            </div>
          </div>
          {open ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
        </button>

        {open && (
          <div className="border-t border-border">
            {/* Tab switcher */}
            <div className="flex px-4 pt-3 pb-1 gap-2">
              {['purchases', 'sales'].map(t => (
                <button
                  key={t}
                  onClick={() => setTab(t)}
                  className="px-3 py-1.5 rounded-full text-xs font-bold capitalize transition-all"
                  style={tab === t
                    ? { background: 'rgba(191,95,255,0.15)', color: '#BF5FFF', border: '1px solid rgba(191,95,255,0.3)' }
                    : { background: 'hsl(var(--muted))', color: 'hsl(var(--muted-foreground))', border: '1px solid hsl(var(--border))' }
                  }
                >
                  {t} ({t === 'purchases' ? purchases.length : sales.length})
                </button>
              ))}
            </div>

            <div className="divide-y divide-border">
              {tab === 'purchases' && (
                purchases.length === 0
                  ? <div className="px-4 py-6 text-center">
                      <p className="text-2xl mb-2">🎟️</p>
                      <p className="text-sm font-medium text-foreground">No purchases yet</p>
                      <p className="text-xs text-muted-foreground mt-1">Your ticket purchases will appear here.</p>
                    </div>
                  : purchases.slice(0, 10).map(p => <PurchaseRow key={p.id} p={p} type="purchase" />)
              )}
              {tab === 'sales' && (
                sales.length === 0
                  ? <div className="px-4 py-6 text-center">
                      <p className="text-2xl mb-2">💸</p>
                      <p className="text-sm font-medium text-foreground">No sales yet</p>
                      <p className="text-xs text-muted-foreground mt-1">Your sold tickets and payouts will appear here.</p>
                    </div>
                  : sales.slice(0, 10).map(p => <PurchaseRow key={p.id} p={p} type="sale" />)
              )}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}