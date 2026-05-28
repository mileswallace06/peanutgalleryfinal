import { format } from 'date-fns';

function StatCard({ label, value, sub, color }) {
  return (
    <div className="rounded-xl p-4" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
      <div className="text-xs text-muted-foreground mb-1">{label}</div>
      <div className="text-2xl font-black" style={{ color: color || 'hsl(var(--foreground))' }}>{value}</div>
      {sub && <div className="text-[10px] text-muted-foreground mt-1">{sub}</div>}
    </div>
  );
}

export default function MarketplaceHealth({ purchases, listings, events }) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const completed = purchases.filter(p => p.transfer_status === 'completed');
  const pending = purchases.filter(p => p.transfer_status === 'pending_transfer');
  const disputed = purchases.filter(p => p.transfer_status === 'disputed');
  const expired = purchases.filter(p => p.transfer_status === 'expired');
  const completedToday = completed.filter(p => new Date(p.updated_date) >= today);
  const gmvToday = completedToday.reduce((s, p) => s + (p.amount || 0), 0);
  const feesToday = completedToday.reduce((s, p) => s + (p.platform_fee || 0), 0);
  const gmvAll = completed.reduce((s, p) => s + (p.amount || 0), 0);
  const activeListings = listings.filter(l => l.status === 'active');
  const pendingVerification = listings.filter(l => l.proof_status === 'pending_review');
  const instantListings = listings.filter(l => l.listing_mode === 'instant');

  // Top events by volume
  const eventVolume = {};
  completed.forEach(p => {
    if (!p.event_id) return;
    eventVolume[p.event_id] = (eventVolume[p.event_id] || 0) + (p.amount || 0);
  });
  const topEvents = Object.entries(eventVolume)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([eid, vol]) => ({ event: events[eid], vol }));

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-bold text-foreground text-lg mb-4">Marketplace Health</h2>

        {/* Revenue metrics */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
          <StatCard label="GMV Today" value={`$${gmvToday.toFixed(0)}`} sub={`${completedToday.length} sales`} color="#00FF87" />
          <StatCard label="Fees Today" value={`$${feesToday.toFixed(0)}`} sub="Platform revenue" color="#00C8FF" />
          <StatCard label="Total GMV" value={`$${gmvAll.toFixed(0)}`} sub={`${completed.length} total sales`} color="#BF5FFF" />
          <StatCard label="Avg Order" value={completed.length ? `$${(gmvAll / completed.length).toFixed(0)}` : '—'} sub="Per completed sale" />
        </div>

        {/* Status breakdown */}
        <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">Purchase Status</h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
          <StatCard label="Completed" value={completed.length} color="#00FF87" />
          <StatCard label="Pending Transfer" value={pending.length} color="#FF8C00" />
          <StatCard label="Disputed" value={disputed.length} color="#FF2D78" />
          <StatCard label="Expired/Cancelled" value={expired.length} color="#888" />
        </div>

        {/* Listing health */}
        <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">Listings</h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
          <StatCard label="Active" value={activeListings.length} color="#00FF87" />
          <StatCard label="Pending Proof" value={pendingVerification.length} color="#FF8C00" />
          <StatCard label="Instant" value={instantListings.length} color="#BF5FFF" />
          <StatCard label="Total" value={listings.length} />
        </div>

        {/* Top events */}
        {topEvents.length > 0 && (
          <>
            <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">Top Events by GMV</h3>
            <div className="space-y-2">
              {topEvents.map(({ event, vol }, i) => (
                <div key={i} className="flex items-center justify-between px-4 py-3 rounded-xl"
                  style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
                  <div>
                    <div className="font-semibold text-foreground text-sm">{event?.title || 'Unknown Event'}</div>
                    <div className="text-xs text-muted-foreground">{event?.venue}</div>
                  </div>
                  <div className="font-black text-sm" style={{ color: '#00FF87' }}>${vol.toFixed(0)}</div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}