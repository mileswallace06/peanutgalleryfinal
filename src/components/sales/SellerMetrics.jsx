import { Zap, Clock, CheckCircle2, XCircle } from 'lucide-react';
import { differenceInMinutes, differenceInHours } from 'date-fns';

function formatDuration(minutes) {
  if (minutes == null) return '—';
  if (minutes < 60) return `${Math.round(minutes)}m`;
  const h = (minutes / 60).toFixed(1);
  return `${h}h`;
}

function getSellerTier(avgMinutes) {
  if (avgMinutes === null) return null;
  if (avgMinutes < 2)  return { label: '🏆 Elite Seller',    className: 'bg-purple-100 text-purple-700 border-purple-200' };
  if (avgMinutes < 5)  return { label: '⚡ Fast Seller',     className: 'bg-amber-100 text-amber-700 border-amber-200' };
  if (avgMinutes < 15) return { label: '✅ Reliable Seller', className: 'bg-green-100 text-green-700 border-green-200' };
  return                       { label: '🐢 Slow Seller',    className: 'bg-muted text-muted-foreground border-border' };
}

export default function SellerMetrics({ purchases }) {
  const completed = purchases.filter(p => p.transfer_status === 'completed' && p.seller_confirmed);
  const expired = purchases.filter(p => p.transfer_status === 'expired' && !p.seller_confirmed);

  // Time from purchase created → seller_confirmed_at (actual seller confirmation timestamp)
  const sellerConfirmTimes = completed
    .map(p => {
      if (!p.created_date || !p.seller_confirmed_at) return null;
      return differenceInMinutes(new Date(p.seller_confirmed_at), new Date(p.created_date));
    })
    .filter(v => v !== null && v > 0);

  const avgSellerConfirm = sellerConfirmTimes.length
    ? sellerConfirmTimes.reduce((a, b) => a + b, 0) / sellerConfirmTimes.length
    : null;

  // Time from seller_confirmed_at → completed (buyer confirms receipt)
  const fullTransferTimes = completed
    .map(p => {
      if (!p.seller_confirmed_at || !p.updated_date) return null;
      return differenceInMinutes(new Date(p.updated_date), new Date(p.seller_confirmed_at));
    })
    .filter(v => v !== null && v > 0);

  const avgFullTransfer = fullTransferTimes.length
    ? fullTransferTimes.reduce((a, b) => a + b, 0) / fullTransferTimes.length
    : null;

  const failedCount = expired.length;
  const tier = getSellerTier(avgSellerConfirm);

  if (purchases.length === 0) return null;

  return (
    <div className="bg-white border border-border rounded-2xl p-5 mb-8">
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-bold text-base flex items-center gap-2">
          <Zap className="w-4 h-4 text-primary" /> Seller Performance
        </h2>
        {tier && (
          <span className={`inline-flex items-center gap-1 border text-xs font-bold px-2.5 py-1 rounded-full ${tier.className}`}>
            {tier.label}
          </span>
        )}
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <MetricTile
          icon={<Clock className="w-4 h-4 text-amber-500" />}
          label="Avg. Time to Send"
          value={formatDuration(avgSellerConfirm)}
          sub="purchase → seller confirms"
        />
        <MetricTile
          icon={<CheckCircle2 className="w-4 h-4 text-green-500" />}
          label="Avg. Time to Receipt"
          value={formatDuration(avgFullTransfer)}
          sub="seller sends → buyer confirms"
        />
        <MetricTile
          icon={<CheckCircle2 className="w-4 h-4 text-primary" />}
          label="Completed Sales"
          value={completed.length}
          sub="fully confirmed"
        />
        <MetricTile
          icon={<XCircle className="w-4 h-4 text-destructive" />}
          label="Failed Transfers"
          value={failedCount}
          sub="expired without seller action"
          highlight={failedCount > 0}
        />
      </div>

      <p className="text-xs text-muted-foreground mt-3">
        Tiers: <span className="font-medium">🏆 Elite</span> &lt;2m · <span className="font-medium">⚡ Fast</span> &lt;5m · <span className="font-medium">✅ Reliable</span> &lt;15m · <span className="font-medium">🐢 Slow</span> 15m+
      </p>
    </div>
  );
}

function MetricTile({ icon, label, value, sub, highlight }) {
  return (
    <div className={`rounded-xl p-3 border ${highlight ? 'bg-destructive/5 border-destructive/20' : 'bg-secondary border-border'}`}>
      <div className="flex items-center gap-1.5 mb-1">{icon}<span className="text-xs text-muted-foreground font-medium">{label}</span></div>
      <div className={`text-xl font-bold ${highlight ? 'text-destructive' : 'text-foreground'}`}>{value}</div>
      <div className="text-xs text-muted-foreground mt-0.5">{sub}</div>
    </div>
  );
}