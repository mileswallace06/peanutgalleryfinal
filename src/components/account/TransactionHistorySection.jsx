import '@/components/member-surfaces.css';
import { useState } from 'react';
import { CreditCard, TrendingUp, ChevronDown, ChevronUp } from 'lucide-react';
import { format, isValid } from 'date-fns';
import { summarizeSellerHistory, formatRecordedAmount, salePaymentStatus, SELLER_HISTORY_SCOPE } from '@/lib/salesPresentation';

const STATUS_CONFIG = {
  completed:        { label: 'Transfer Complete', color: 'var(--neon-green)' },
  pending_transfer: { label: 'Pending Transfer', color: 'var(--neon-purple)' },
  disputed:         { label: 'Dispute Open', color: 'var(--neon-pink)' },
  expired:          { label: 'Expired', color: 'var(--neon-orange)' },
};

function statusBadge(s) {
  const cfg = STATUS_CONFIG[s] || { label: (s || 'Unknown').replace(/_/g, ' '), color: 'var(--neon-purple)' };
  return (
    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full capitalize"
      style={{ background: `color-mix(in srgb, ${cfg.color} 9%, transparent)`, color: cfg.color, border: `1px solid color-mix(in srgb, ${cfg.color} 20%, transparent)` }}>
      {cfg.label}
    </span>
  );
}

function PurchaseRow({ p, type }) {
  const label = type === 'purchase' ? `Bought · #${p.id?.slice(-6)}` : `Sold · #${p.id?.slice(-6)}`;
  const amount = type === 'purchase' ? p.amount : p.seller_payout;
  const color = type === 'purchase' ? 'var(--neon-pink)' : 'var(--neon-green)';
  const sign = type === 'purchase' ? '-' : '';

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
          {type === 'sale' && <span className="text-[10px] text-muted-foreground">{salePaymentStatus(p).label} · Bank payout unconfirmed</span>}
          {p.created_date && isValid(new Date(p.created_date)) && <span className="text-[10px] text-muted-foreground">{format(new Date(p.created_date), 'MMM d')}</span>}
        </div>
      </div>
      <span className="text-sm font-bold" style={{ color }}>
        {typeof amount === 'number' ? sign : ''}{formatRecordedAmount(amount)}
      </span>
    </div>
  );
}

export default function TransactionHistorySection({ purchases = [], sales = [], status = 'loading', onRetry }) {
  const [tab, setTab] = useState('purchases');
  const [open, setOpen] = useState(false);

  const totalPurchased = purchases.filter(p => !p.is_demo).reduce((sum, p) => sum + (typeof p.amount === 'number' ? p.amount : 0), 0);
  const purchaseAmountMissing = purchases.some(p => !p.is_demo && typeof p.amount !== 'number');
  const summary = summarizeSellerHistory(sales);
  const unavailable = status === 'loading' ? 'Loading…' : 'Unavailable';

  return (
    <section className="pg-member-section">
      <h3 className="text-xs font-black tracking-widest uppercase text-muted-foreground mb-3">Purchases &amp; Sales</h3>
      <p className="text-xs text-muted-foreground mb-3">{SELLER_HISTORY_SCOPE} Seller amounts are recorded amounts owed for completed transfers, not confirmed bank payouts. Order amounts include pending, expired and disputed orders; they are not verified spending.</p>
      {status === 'error' && <p role="alert">Transaction history could not be loaded. <button type="button" className="underline" onClick={onRetry}>Retry transaction history</button></p>}
      <div className="rounded-xl overflow-hidden" style={{ background: 'var(--pg-surface)', border: '1px solid var(--pg-line)' }}>
        {/* Summary row */}
        <button
          className="flex items-center gap-3 px-4 py-3.5 w-full text-left"
          aria-expanded={open}
          onClick={() => setOpen(o => !o)}
        >
          <CreditCard className="w-4 h-4 flex-shrink-0 text-muted-foreground" />
          <div className="flex-1 flex gap-5">
            <div>
              <p className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wide">Recorded order amounts</p>
              <p className="text-sm font-bold" style={{ color: 'var(--neon-pink)' }}>{status !== 'ready' ? unavailable : purchaseAmountMissing ? 'Amount incomplete' : formatRecordedAmount(totalPurchased)}</p>
            </div>
            <div>
              <p className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wide">Completed seller amounts</p>
              <p className="text-sm font-bold" style={{ color: 'var(--neon-green)' }}>{status !== 'ready' ? unavailable : summary.missingAmounts ? 'Amount incomplete' : formatRecordedAmount(summary.recordedAmount)}</p>
            </div>
          </div>
          {open ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
        </button>

        {open && status === 'ready' && (
          <div className="border-t border-border">
            {/* Tab switcher */}
            <div className="flex px-4 pt-3 pb-1 gap-2">
              {['purchases', 'sales'].map(t => (
                <button
                  key={t}
                  onClick={() => setTab(t)}
                  className="px-3 py-1.5 rounded-lg text-xs font-bold capitalize transition-all"
                  style={tab === t
                    ? { background: 'rgba(var(--neon-purple-rgb), 0.15)', color: 'var(--neon-purple)', border: '1px solid rgba(var(--neon-purple-rgb), 0.3)' }
                    : { background: 'var(--pg-surface-raised)', color: 'hsl(var(--muted-foreground))', border: '1px solid var(--pg-line)' }
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