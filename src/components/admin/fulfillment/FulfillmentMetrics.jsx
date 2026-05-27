/**
 * FulfillmentMetrics — lightweight analytics bar for the Instant Fulfillment Center
 */
import { Zap, Clock, CheckCircle, AlertTriangle, TrendingUp } from 'lucide-react';

function formatDuration(ms) {
  if (!ms || ms <= 0) return '—';
  const mins = Math.round(ms / 60000);
  if (mins < 60) return `${mins}m`;
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

export default function FulfillmentMetrics({ listings, purchases }) {
  const instantListings = listings.filter(l => l.listing_mode === 'instant');
  const instantPurchases = purchases.filter(p => {
    const listing = listings.find(l => l.id === p.listing_id);
    return listing?.listing_mode === 'instant';
  });

  // Conversion: instant listings that sold
  const soldInstant = instantListings.filter(l => l.status === 'sold' || l.status === 'pending_transfer');
  const conversionRate = instantListings.length > 0
    ? Math.round((soldInstant.length / instantListings.length) * 100)
    : 0;

  // Fulfillment: purchases with fulfillment_status = 'fulfilled' or 'buyer_confirmed'
  const fulfilled = instantPurchases.filter(p => p.fulfillment_status === 'fulfilled' || p.fulfillment_status === 'buyer_confirmed' || p.transfer_status === 'completed');
  const fulfillmentRate = instantPurchases.length > 0
    ? Math.round((fulfilled.length / instantPurchases.length) * 100)
    : 0;

  // Avg fulfillment time (started → completed)
  const timed = instantPurchases.filter(p => p.fulfillment_started_at && p.fulfillment_completed_at);
  const avgMs = timed.length > 0
    ? timed.reduce((acc, p) => acc + (new Date(p.fulfillment_completed_at) - new Date(p.fulfillment_started_at)), 0) / timed.length
    : null;

  // Pending fulfillment
  const pendingFulfillment = instantPurchases.filter(p => p.fulfillment_status === 'awaiting_pg_transfer' || p.fulfillment_status === 'transfer_in_progress');

  // Issues
  const issues = instantPurchases.filter(p => p.fulfillment_status === 'issue_reported' || p.transfer_status === 'disputed');

  const stats = [
    { icon: Zap, label: 'Instant Listings', value: instantListings.length, color: '#00C8FF' },
    { icon: TrendingUp, label: 'Conversion Rate', value: `${conversionRate}%`, color: '#00FF87' },
    { icon: Clock, label: 'Pending Fulfillment', value: pendingFulfillment.length, color: pendingFulfillment.length > 0 ? '#FF8C00' : '#00FF87' },
    { icon: CheckCircle, label: 'Fulfillment Rate', value: `${fulfillmentRate}%`, color: '#00FF87' },
    { icon: Clock, label: 'Avg Fulfill Time', value: formatDuration(avgMs), color: '#BF5FFF' },
    { icon: AlertTriangle, label: 'Issues', value: issues.length, color: issues.length > 0 ? '#FF2D78' : '#00FF87' },
  ];

  return (
    <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 mb-6">
      {stats.map(({ icon: Icon, label, value, color }) => (
        <div key={label} className="rounded-xl p-3 text-center"
          style={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))' }}>
          <Icon className="w-4 h-4 mx-auto mb-1" style={{ color }} />
          <div className="font-black text-base" style={{ color }}>{value}</div>
          <div className="text-[9px] text-muted-foreground leading-tight mt-0.5">{label}</div>
        </div>
      ))}
    </div>
  );
}