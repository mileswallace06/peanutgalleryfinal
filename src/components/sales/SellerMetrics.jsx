import { Zap, Clock, CheckCircle2, XCircle } from 'lucide-react';
import { differenceInMinutes, differenceInHours } from 'date-fns';

function formatDuration(minutes) {
  if (minutes == null) return '—';
  if (minutes < 60) return `${Math.round(minutes)}m`;
  const h = (minutes / 60).toFixed(1);
  return `${h}h`;
}

// A seller is "fast" if avg seller-confirm time < 2 hours
const FAST_THRESHOLD_MINUTES = 120;

export default function SellerMetrics({ purchases }) {
  const completed = purchases.filter(p => p.transfer_status === 'completed' && p.seller_confirmed);
  const expired = purchases.filter(p => p.transfer_status === 'expired' && !p.seller_confirmed);

  // Time from purchase created → seller_confirmed (proxy: updated_date when seller_confirmed first set)
  // We use updated_date as the best available timestamp for when seller confirmed
  const sellerConfirmTimes = completed
    .map(p => {
      if (!p.created_date || !p.updated_date) return null;
      return differenceInMinutes(new Date(p.updated_date), new Date(p.created_date));
    })
    .filter(v => v !== null && v > 0);

  const avgSellerConfirm = sellerConfirmTimes.length
    ? sellerConfirmTimes.reduce((a, b) => a + b, 0) / sellerConfirmTimes.length
    : null;

  // Time from purchase created → completed (buyer confirmed)
  const fullTransferTimes = completed
    .map(p => {
      if (!p.created_date || !p.updated_date) return null;
      return differenceInMinutes(new Date(p.updated_date), new Date(p.created_date));
    })
    .filter(v => v !== null && v > 0);

  const avgFullTransfer = fullTransferTimes.length
    ? fullTransferTimes.reduce((a, b) => a + b, 0) / fullTransferTimes.length
    : null;

  const failedCount = expired.length;
  const isFastSeller = avgSellerConfirm !== null && avgSellerConfirm < FAST_THRESHOLD_MINUTES;

  if (purchases.length === 0) return null;

  return (
    <div className="bg-white border border-border rounded-2xl p-5 mb-8">
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-bold text-base flex items-center gap-2">
          <Zap className="w-4 h-4 text-primary" /> Seller Performance
        </h2>
        {isFastSeller && (
          <span className="inline-flex items-center gap-1 bg-amber-100 text-amber-700 border border-amber-200 text-xs font-bold px-2.5 py-1 rounded-full">
            ⚡ Fast Seller
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
          sub="purchase → buyer confirms"
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

      {!isFastSeller && avgSellerConfirm !== null && (
        <p className="text-xs text-muted-foreground mt-3">
          Confirm within <span className="font-medium">2 hours</span> of a sale to earn the ⚡ Fast Seller badge.
        </p>
      )}
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