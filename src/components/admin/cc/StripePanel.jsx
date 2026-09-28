import { CreditCard, ExternalLink, AlertTriangle, CheckCircle, RefreshCw } from 'lucide-react';
import { format } from 'date-fns';

function StatCard({ label, value, color, sub }) {
  return (
    <div className="pg-operations-card rounded-xl p-4" style={{ background: 'var(--pg-surface)', border: '1px solid var(--pg-line)' }}>
      <div className="text-xs text-muted-foreground mb-1">{label}</div>
      <div className="pg-operations-status text-2xl font-black" style={{ '--pg-status-ink': color || 'var(--pg-text)' }}>{value}</div>
      {sub && <div className="text-[10px] text-muted-foreground mt-1">{sub}</div>}
    </div>
  );
}

export default function StripePanel({ purchases, stripeMode, onRefresh }) {
  const pending = purchases.filter(p => p.transfer_status === 'pending_transfer' && !p.payment_captured);
  const captured = purchases.filter(p => p.payment_captured);
  const failedCaptures = purchases.filter(p => p.payment_capture_failed);
  const disputed = purchases.filter(p => p.transfer_status === 'disputed');
  const totalEscrowed = pending.reduce((s, p) => s + (p.amount || 0), 0);
  const totalCaptured = captured.reduce((s, p) => s + (p.amount || 0), 0);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="font-bold text-foreground text-lg">Stripe / Payments</h2>
        <a href="https://dashboard.stripe.com" target="_blank" rel="noopener noreferrer"
          className="pg-operations-status text-xs flex items-center gap-1.5 px-3 py-1.5 rounded-lg"
          style={{ background: 'color-mix(in srgb, rgb(191 95 255) 10%, var(--pg-surface))', '--pg-status-ink': '#BF5FFF', border: '1px solid rgba(191,95,255,0.3)' }}>
          <ExternalLink className="w-3 h-3" /> Open Stripe Dashboard
        </a>
      </div>

      {/* Stripe mode status */}
      {stripeMode && (
        <div className="pg-operations-card rounded-2xl p-4" style={{ background: 'var(--pg-surface)', border: '1px solid var(--pg-line)' }}>
          <div className="flex items-center gap-2 mb-3">
            <CreditCard className="w-4 h-4 text-primary" />
            <span className="font-semibold text-sm">Stripe Mode</span>
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            {stripeMode.overallMode === 'live' ? (
              <span className="inline-flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-full bg-green-500/15 text-green-500 border border-green-500/30">
                <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" /> ✅ LIVE Mode
              </span>
            ) : stripeMode.overallMode === 'test' ? (
              <span className="inline-flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-full bg-amber-500/15 text-amber-500 border border-amber-500/30">
                🧪 TEST Mode — real cards rejected
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-full bg-red-500/15 text-red-400 border border-red-500/30">
                ⚠️ Key Mismatch
              </span>
            )}
            {!stripeMode.consistent && (
              <span className="text-xs text-destructive">Frontend + backend keys are in different modes!</span>
            )}
          </div>
          {stripeMode.overallMode === 'test' && (
            <div className="mt-3 text-xs text-amber-400 bg-amber-500/10 rounded-lg p-2.5 border border-amber-500/20">
              Switch to pk_live_ + sk_live_ in Dashboard → Settings → Environment Variables to enable real payments.
            </div>
          )}
        </div>
      )}

      {/* Payment metrics */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard label="In Escrow" value={`$${totalEscrowed.toFixed(0)}`} sub={`${pending.length} pending`} color="#FF8C00" />
        <StatCard label="Total Captured" value={`$${totalCaptured.toFixed(0)}`} sub={`${captured.length} captures`} color="#00FF87" />
        <StatCard label="Failed Captures" value={failedCaptures.length} sub="Needs retry" color={failedCaptures.length > 0 ? '#FF2D78' : '#888'} />
        <StatCard label="Disputes" value={disputed.length} sub="Payment frozen" color={disputed.length > 0 ? '#FFE600' : '#888'} />
      </div>

      {/* Failed captures */}
      {failedCaptures.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">Failed Captures — Action Required</h3>
          <div className="space-y-3">
            {failedCaptures.map(p => (
              <div key={p.id} className="pg-operations-card rounded-xl p-4 text-sm"
                style={{ background: 'color-mix(in srgb, rgb(255 45 120) 8%, var(--pg-surface))', border: '1px solid rgba(255,45,120,0.3)' }}>
                <div className="flex items-start justify-between gap-2 flex-wrap">
                  <div>
                    <div className="font-semibold text-foreground">${p.amount?.toFixed(2)} — {p.buyer_email}</div>
                    <div className="text-xs text-muted-foreground">Seller: {p.seller_email}</div>
                    <div className="text-xs text-muted-foreground">PI: {p.payment_intent_id}</div>
                  </div>
                  <a href={`https://dashboard.stripe.com/payments/${p.payment_intent_id}`}
                    target="_blank" rel="noopener noreferrer"
                    className="pg-operations-status text-xs flex items-center gap-1 px-2.5 py-1.5 rounded-lg"
                    style={{ background: 'color-mix(in srgb, rgb(191 95 255) 12%, var(--pg-surface))', '--pg-status-ink': '#BF5FFF', border: '1px solid rgba(191,95,255,0.3)' }}>
                    <ExternalLink className="w-3 h-3" /> Stripe
                  </a>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Pending transfers */}
      {pending.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">Pending Transfers ({pending.length})</h3>
          <div className="space-y-2">
            {pending.slice(0, 10).map(p => (
              <div key={p.id} className="pg-operations-card rounded-xl px-4 py-3 text-xs flex items-center justify-between gap-2"
                style={{ background: 'var(--pg-surface)', border: '1px solid var(--pg-line)' }}>
                <div>
                  <span className="font-semibold text-foreground">${p.amount?.toFixed(2)}</span>
                  <span className="text-muted-foreground ml-2">{p.buyer_email} → {p.seller_email}</span>
                </div>
                <span className="text-muted-foreground flex-shrink-0">
                  S:{p.seller_confirmed ? '✓' : '⏳'} B:{p.buyer_confirmed ? '✓' : '⏳'}
                </span>
              </div>
            ))}
            {pending.length > 10 && <div className="text-xs text-muted-foreground text-center">+{pending.length - 10} more</div>}
          </div>
        </div>
      )}
    </div>
  );
}