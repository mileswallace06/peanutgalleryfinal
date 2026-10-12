import { useState, useEffect, useId } from 'react';
import { base44 } from '@/api/base44Client';
import { ArrowUpRight, Play, Pause, Trash2, RefreshCw } from 'lucide-react';
import { UPGRADE_LISTING_TYPES } from '@/lib/listingTypes';
import { markEventIdentityAmbiguity } from '@/lib/eventIdentity';
import { eventChoiceLabel } from '@/lib/eventChoiceLabel';

function MetricCard({ label, value, sub, color = '#BF5FFF', isDemo = false }) {
  return (
    <div className="pg-operations-card rounded-2xl px-4 py-3"
      style={{ background: 'var(--pg-surface)', border: '1px solid var(--pg-line)' }}>
      <div className="pg-operations-status font-display text-2xl" style={{ '--pg-status-ink': color }}>{value}</div>
      <div className="text-[11px] font-semibold text-muted-foreground mt-0.5 flex items-center gap-1">
        {label}
        {isDemo && (
          <span className="pg-operations-status text-[9px] px-1.5 py-0.5 rounded-full font-bold"
            style={{ background: 'color-mix(in srgb, rgb(191 95 255) 15%, var(--pg-surface))', '--pg-status-ink': '#BF5FFF', border: '1px solid rgba(191,95,255,0.25)' }}>
            DEMO
          </span>
        )}
      </div>
      {sub && <div className="text-[10px] text-muted-foreground mt-0.5">{sub}</div>}
    </div>
  );
}

export default function LiveUpgradeControlPanel() {
  const eventSelectId = useId();
  const [events, setEvents] = useState([]);
  const [listings, setListings] = useState([]);
  const [purchases, setPurchases] = useState([]);
  const [selectedEventId, setSelectedEventId] = useState('');
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [actionMsg, setActionMsg] = useState(null);
  const [loadError, setLoadError] = useState(false);

  const load = async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const [evList, lList, pList] = await Promise.all([
        base44.entities.Event.list('date', 50),
        base44.entities.Listing.list('-created_date', 200),
        base44.entities.Purchase.list('-created_date', 200),
      ]);
      // Operational actions target one exact local record. Keep alias records
      // separate here: presentation equivalence must never retarget a release.
      setEvents(markEventIdentityAmbiguity((evList || []).filter(e => e.status !== 'ended')));
      setListings(lList || []);
      setPurchases(pList || []);
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const runAction = async (action) => {
    if (!selectedEventId || loading || loadError || actionLoading || !selectedEvent) return;
    if (action === 'reset') {
      if (!window.confirm('Delete ALL demo upgrade listings for this event?\n\nThis will permanently remove all demo listings. This action cannot be undone.')) return;
    } else if (action === 'pause') {
      if (!window.confirm('Pause all demo upgrade listings for this event?\n\nListings will be hidden from the marketplace. You can reactivate them later.')) return;
    }
    setActionLoading(true);
    setActionMsg(null);
    try {
      const res = await base44.functions.invoke('releaseDemoUpgrades', { action, event_id: selectedEventId });
      const d = res.data;
      if (d.success) {
        setActionMsg({ type: 'success', text: `✓ ${action === 'released' ? `Released ${d.created} demo upgrade listings` : action === 'reactivated' ? `Reactivated ${d.count} listings` : action === 'paused' ? `Paused ${d.count} listings` : `Deleted ${d.deleted} listings`}` });
      } else {
        setActionMsg({ type: 'error', text: d.error || 'Action failed' });
      }
      await load();
    } catch {
      setActionMsg({ type: 'error', text: 'The action could not be confirmed. Refresh the event controls before trying again.' });
      setLoadError(true);
    } finally {
      setActionLoading(false);
    }
  };

  // --- Metrics ---
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
        <div className="pg-operations-card w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
          style={{ background: 'color-mix(in srgb, rgb(255 140 0) 12%, var(--pg-surface))', border: '1px solid rgba(255,140,0,0.3)' }}>
          <ArrowUpRight className="pg-operations-status w-4 h-4" style={{ '--pg-status-ink': '#FF8C00' }} />
        </div>
        <div>
          <h2 className="font-bold text-sm text-foreground">Live Upgrade Control</h2>
          <p className="text-xs text-muted-foreground">Release, pause, or reset demo seat upgrades per event.</p>
        </div>
        <button type="button" onClick={load} disabled={loading || actionLoading} aria-label="Refresh live upgrades" aria-busy={loading}
          className="ml-auto p-1.5 rounded-lg hover:bg-muted transition-colors flex-shrink-0 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary focus-visible:outline-offset-2 disabled:opacity-50">
          <RefreshCw className={`w-4 h-4 text-muted-foreground ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* Metrics grid */}
      {loading ? (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[1,2,3,4,5,6,7].map(i => (
            <div key={i} className="pg-operations-card h-16 rounded-2xl animate-pulse" style={{ background: 'var(--pg-surface)' }} />
          ))}
        </div>
      ) : loadError ? <p role="alert" className="text-sm text-muted-foreground">Live upgrade data is unavailable. Refresh live upgrades to retry; controls are disabled until data loads.</p> : (
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
      <div className="pg-operations-card rounded-2xl p-4 space-y-4"
        style={{ background: 'color-mix(in srgb, rgb(255 140 0) 5%, var(--pg-surface))', border: '1px solid rgba(255,140,0,0.2)' }}>
        <p className="text-xs font-bold text-muted-foreground uppercase tracking-widest">Demo Upgrade Controls</p>

        <div>
          <label htmlFor={eventSelectId} className="block text-xs font-medium text-muted-foreground mb-1">Select Event</label>
          <select
            id={eventSelectId}
            value={selectedEventId}
            disabled={loading || loadError || actionLoading}
            aria-describedby="live-upgrade-event-help live-upgrade-event-context"
            onChange={e => { setSelectedEventId(e.target.value); setActionMsg(null); }}
            className="w-full px-3 py-2.5 rounded-xl text-sm text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary focus-visible:outline-offset-2 disabled:opacity-50"
            style={{ background: 'var(--pg-surface-raised)', border: '1px solid var(--pg-line)' }}
          >
            <option value="">— choose an event —</option>
            {events.map(ev => (
              <option key={ev.id} value={ev.id}>{eventChoiceLabel(ev, Date.now(), { alwaysReference: true })}</option>
            ))}
          </select>
          <p id="live-upgrade-event-help" className="mt-2 text-xs text-muted-foreground">Controls apply only to the selected event reference. Separate records are retained; matching names and times do not confirm they are the same occurrence.</p>
          <p id="live-upgrade-event-context" className="mt-2 text-sm text-foreground break-words" role="status">{selectedEvent ? eventChoiceLabel(selectedEvent, Date.now(), { alwaysReference: true }) : 'Choose an event to review its occurrence and reference before using controls.'}</p>
        </div>

        {selectedEvent && (
          <div className="text-xs text-muted-foreground">
            Demo upgrades for this event: <strong className="text-foreground">{selectedEventDemoUpgrades.length}</strong>
            {hasActiveDemoUpgrades && <span className="pg-operations-status ml-2 font-semibold" style={{ '--pg-status-ink': '#00FF87' }}>● Active</span>}
            {!hasActiveDemoUpgrades && hasAnyDemoUpgrades && <span className="pg-operations-status ml-2 font-semibold" style={{ '--pg-status-ink': '#FF8C00' }}>● Paused</span>}
          </div>
        )}

        <div className="flex gap-2 flex-wrap">
          <button
            onClick={() => runAction('released')}
            disabled={!selectedEvent || loading || loadError || actionLoading || hasActiveDemoUpgrades}
            className="flex items-center gap-1.5 px-4 py-2.5 rounded-full font-bold text-xs transition-all disabled:opacity-40"
            style={{ background: 'var(--pg-orange)', color: 'var(--pg-ink)' }}
          >
            <Play className="w-3.5 h-3.5" />
            {hasAnyDemoUpgrades && !hasActiveDemoUpgrades ? 'Reactivate' : 'Release Demo Upgrades'}
          </button>

          <button
            onClick={() => runAction('pause')}
            disabled={!selectedEvent || loading || loadError || actionLoading || !hasActiveDemoUpgrades}
            className="pg-operations-status flex items-center gap-1.5 px-4 py-2.5 rounded-full font-bold text-xs transition-all disabled:opacity-40"
            style={{ background: 'color-mix(in srgb, rgb(255 200 0) 12%, var(--pg-surface))', border: '1px solid rgba(255,200,0,0.3)', '--pg-status-ink': '#FFE600' }}
          >
            <Pause className="w-3.5 h-3.5" /> Pause
          </button>

          <button
            onClick={() => runAction('reset')}
            disabled={!selectedEvent || loading || loadError || actionLoading || !hasAnyDemoUpgrades}
            className="pg-operations-status flex items-center gap-1.5 px-4 py-2.5 rounded-full font-bold text-xs transition-all disabled:opacity-40"
            style={{ background: 'color-mix(in srgb, rgb(255 45 120) 10%, var(--pg-surface))', border: '1px solid rgba(255,45,120,0.25)', '--pg-status-ink': '#FF2D78' }}
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
          <p className="pg-operations-status text-xs font-semibold" style={{ '--pg-status-ink': actionMsg.type === 'success' ? '#00FF87' : '#FF2D78' }}>
            {actionMsg.text}
          </p>
        )}
      </div>
    </div>
  );
}
