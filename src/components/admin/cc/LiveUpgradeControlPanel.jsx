import { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { ArrowUpRight, Play, Pause, Trash2, RefreshCw } from 'lucide-react';

function MetricCard({ label, value, sub, color = '#BF5FFF', isDemo = false }) {
  return (
    <div className="rounded-2xl px-4 py-3"
      style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
      <div className="font-display text-2xl" style={{ color }}>{value}</div>
      <div className="text-[11px] font-semibold text-muted-foreground mt-0.5 flex items-center gap-1">
        {label}
        {isDemo && (
          <span className="text-[9px] px-1.5 py-0.5 rounded-full font-bold"
            style={{ background: 'rgba(191,95,255,0.15)', color: '#BF5FFF', border: '1px solid rgba(191,95,255,0.25)' }}>
            DEMO
          </span>
        )}
      </div>
      {sub && <div className="text-[10px] text-muted-foreground mt-0.5">{sub}</div>}
    </div>
  );
}

export default function LiveUpgradeControlPanel() {
  const [events, setEvents] = useState([]);
  const [listings, setListings] = useState([]);
  const [purchases, setPurchases] = useState([]);
  const [selectedEventId, setSelectedEventId] = useState('');
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [actionMsg, setActionMsg] = useState(null);

  const load = async () => {
    setLoading(true);
    const [evList, lList, pList] = await Promise.all([
      base44.entities.Event.list('date', 50),
      base44.entities.Listing.list('-created_date', 200),
      base44.entities.Purchase.list('-created_date', 200),
    ]);
    setEvents((evList || []).filter(e => e.status !== 'ended'));
    setListings(lList || []);
    setPurchases(pList || []);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const runAction = async (action) => {
    if (!selectedEventId) return;
    setActionLoading(true);
    setActionMsg(null);
    const res = await base44.functions.invoke('releaseDemoUpgrades', { action, event_id: selectedEventId });
    const d = res.data;
    if (d.success) {
      setActionMsg({ type: 'success', text: `✓ ${action === 'released' ? `Released ${d.created} demo upgrade listings` : action === 'reactivated' ? `Reactivated ${d.count} listings` : action === 'paused' ? `Paused ${d.count} listings` : `Deleted ${d.deleted} listings`}` });
    } else {
      setActionMsg({ type: 'error', text: d.error || 'Action failed' });
    }
    await load();
    setActionLoading(false);
  };

  // --- Metrics ---
  const UPGRADE_LISTING_TYPES = ['live_upgrade', 'venue_upgrade'];
  const upgradeListings = listings.filter(l => UPGRADE_LISTING_TYPES.includes(l.listing_type));
  const demoUpgradeListings = upgradeListings.filter(l => l.is_demo_listing);
  const activeUpgradeListings = upgradeListings.filter(l => l.status === 'active');
  const activeDemoUpgrades = demoUpgradeListings.filter(l => l.status === 'active');

  // Only purchases tied to upgrade listings (not resale tickets)
  const upgradeListingIds = new Set(upgradeListings.map(l => l.id));
  const upgradePurchases = purchases.filter(p => upgradeListingIds.has(p.listing_id));
  const demoUpgradeIds = new Set(demoUpgradeListings.map(l => l.id));
  const demoUpgradePurchases = upgradePurchases.filter(p => demoUpgradeIds.has(p.listing_id));

  const simRevenue = demoUpgradePurchases.reduce((s, p) => s + (p.subtotal || 0), 0);
  const avgPrice = demoUpgradePurchases.length > 0
    ? (demoUpgradePurchases.reduce((s, p) => s + (p.amount || 0), 0) / demoUpgradePurchases.length)
    : 0;
  const locationVerified = demoUpgradePurchases.filter(p => p.location_verified).length;
  const remoteBlocked = demoUpgradePurchases.filter(p => !p.location_verified && p.buyer_lat != null).length;
  const seatsReleased = demoUpgradeListings.reduce((s, l) => s + (l.quantity || 0), 0);
  const venueShare = seatsReleased > 0
    ? Math.round((demoUpgradePurchases.length / seatsReleased) * 100)
    : 0;

  // Selected event info
  const selectedEvent = events.find(e => e.id === selectedEventId);
  const selectedEventDemoUpgrades = demoUpgradeListings.filter(l => l.event_id === selectedEventId);
  const hasActiveDemoUpgrades = selectedEventDemoUpgrades.some(l => l.status === 'active');
  const hasAnyDemoUpgrades = selectedEventDemoUpgrades.length > 0;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
          style={{ background: 'rgba(255,140,0,0.12)', border: '1px solid rgba(255,140,0,0.3)' }}>
          <ArrowUpRight className="w-4 h-4" style={{ color: '#FF8C00' }} />
        </div>
        <div>
          <h2 className="font-bold text-sm text-foreground">Live Upgrade Control</h2>
          <p className="text-xs text-muted-foreground">Release, pause, or reset demo seat upgrades per event.</p>
        </div>
        <button onClick={load} disabled={loading}
          className="ml-auto p-1.5 rounded-lg hover:bg-muted transition-colors flex-shrink-0">
          <RefreshCw className={`w-4 h-4 text-muted-foreground ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* Metrics grid */}
      {loading ? (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[1,2,3,4,5,6,7].map(i => (
            <div key={i} className="h-16 rounded-2xl animate-pulse" style={{ background: 'rgba(255,255,255,0.06)' }} />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <MetricCard label="Active Upgrade Listings" value={activeUpgradeListings.length} color="#FF8C00" />
          <MetricCard label="Active Demo Upgrades" value={activeDemoUpgrades.length} color="#BF5FFF" isDemo />
          <MetricCard label="Demo Seats Released" value={seatsReleased} sub="across all demo upgrades" color="#00C8FF" isDemo />
          <MetricCard label="Simulated Revenue" value={`$${simRevenue.toFixed(0)}`} sub="demo purchases only" color="#00FF87" isDemo />
          <MetricCard label="Avg Demo Upgrade Price" value={avgPrice > 0 ? `$${avgPrice.toFixed(0)}` : '—'} color="#FFE600" isDemo />
          <MetricCard label="Location-Verified Buyers" value={locationVerified} sub="passed inside_venue check" color="#00FF87" isDemo />
          <MetricCard label="Remote Attempts Blocked" value={remoteBlocked} sub="location gate rejected" color="#FF2D78" isDemo />
          <MetricCard label="Venue Share Est." value={`${venueShare}%`} sub="purchases ÷ seats released" color="#BF5FFF" isDemo />
        </div>
      )}

      {/* Event control */}
      <div className="rounded-2xl p-4 space-y-4"
        style={{ background: 'rgba(255,140,0,0.05)', border: '1px solid rgba(255,140,0,0.2)' }}>
        <p className="text-xs font-bold text-muted-foreground uppercase tracking-widest">Demo Upgrade Controls</p>

        <div>
          <label className="block text-xs font-medium text-muted-foreground mb-1">Select Event</label>
          <select
            value={selectedEventId}
            onChange={e => { setSelectedEventId(e.target.value); setActionMsg(null); }}
            className="w-full px-3 py-2.5 rounded-xl text-sm text-foreground focus:outline-none"
            style={{ background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.12)' }}
          >
            <option value="">— choose an event —</option>
            {events.map(ev => (
              <option key={ev.id} value={ev.id}>{ev.title} · {ev.venue}</option>
            ))}
          </select>
        </div>

        {selectedEvent && (
          <div className="text-xs text-muted-foreground">
            Demo upgrades for this event: <strong className="text-foreground">{selectedEventDemoUpgrades.length}</strong>
            {hasActiveDemoUpgrades && <span className="ml-2 font-semibold" style={{ color: '#00FF87' }}>● Active</span>}
            {!hasActiveDemoUpgrades && hasAnyDemoUpgrades && <span className="ml-2 font-semibold" style={{ color: '#FF8C00' }}>● Paused</span>}
          </div>
        )}

        <div className="flex gap-2 flex-wrap">
          <button
            onClick={() => runAction('released')}
            disabled={!selectedEventId || actionLoading || hasActiveDemoUpgrades}
            className="flex items-center gap-1.5 px-4 py-2.5 rounded-full font-bold text-xs transition-all disabled:opacity-40"
            style={{ background: 'linear-gradient(135deg, #FF8C00, #FF2D78)', color: '#fff' }}
          >
            <Play className="w-3.5 h-3.5" />
            {hasAnyDemoUpgrades && !hasActiveDemoUpgrades ? 'Reactivate' : 'Release Demo Upgrades'}
          </button>

          <button
            onClick={() => runAction('pause')}
            disabled={!selectedEventId || actionLoading || !hasActiveDemoUpgrades}
            className="flex items-center gap-1.5 px-4 py-2.5 rounded-full font-bold text-xs transition-all disabled:opacity-40"
            style={{ background: 'rgba(255,200,0,0.12)', border: '1px solid rgba(255,200,0,0.3)', color: '#FFE600' }}
          >
            <Pause className="w-3.5 h-3.5" /> Pause
          </button>

          <button
            onClick={() => runAction('reset')}
            disabled={!selectedEventId || actionLoading || !hasAnyDemoUpgrades}
            className="flex items-center gap-1.5 px-4 py-2.5 rounded-full font-bold text-xs transition-all disabled:opacity-40"
            style={{ background: 'rgba(255,45,120,0.1)', border: '1px solid rgba(255,45,120,0.25)', color: '#FF2D78' }}
          >
            <Trash2 className="w-3.5 h-3.5" /> Reset / Delete All
          </button>
        </div>

        {actionLoading && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span className="w-3.5 h-3.5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
            Processing…
          </div>
        )}
        {actionMsg && (
          <p className="text-xs font-semibold" style={{ color: actionMsg.type === 'success' ? '#00FF87' : '#FF2D78' }}>
            {actionMsg.text}
          </p>
        )}
      </div>
    </div>
  );
}