/**
 * EventDetailUpgrade — Live Hub page for a specific event.
 * Route: /upgrades/:id
 * Three tabs: Flash Drops | Upgrades | Fan Karma
 */
import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { Zap } from 'lucide-react';
import { base44 } from '@/api/base44Client';
import LiveHubHero from '@/components/eventmode/LiveHubHero';
import FlashDropCenter from '@/components/eventmode/FlashDropCenter';
import UpgradeFeed from '@/components/eventmode/UpgradeFeed';
import FanKarmaCard from '@/components/eventmode/FanKarmaCard';
import CreateFlashDropSheet from '@/components/flashdrops/CreateFlashDropSheet';
import EventLookupDebugPanel from '@/components/debug/EventLookupDebugPanel';
import { logNavEvent } from '@/lib/navLogger';
import LiveHubEmptyState from '@/components/eventmode/LiveHubEmptyState';

const TABS = [
  { key: 'Upgrades', label: 'Upgrades', sub: 'Better seats' },
  { key: 'Fan Gifts', label: 'Fan Gifts', sub: 'Free seat drops' },
  { key: 'Fan Karma', label: 'Fan Karma', sub: 'Points & giving' },
];

export default function EventDetailUpgrade() {
  const { id } = useParams();
  const [event, setEvent] = useState(null);
  const [listings, setListings] = useState([]);
  const [drops, setDrops] = useState([]);
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('Upgrades');
  const [showDropSheet, setShowDropSheet] = useState(false);
  const [lookupTrace, setLookupTrace] = useState(null);
  const [lookupError, setLookupError] = useState(false);

  useEffect(() => {
    if (!id) return;
    setLookupError(false);
    setLookupTrace(null);

    (async () => {
      const trace = { steps: [], finalCount: 0, finalId: null };
      try {
        // Step 1: direct id
        let events = await base44.entities.Event.filter({ id }).catch(() => []);
        trace.steps.push({ method: 'direct_id', count: events.length });

        // Step 2: tm_ prefix strip
        if (events.length === 0 && id.startsWith('tm_')) {
          events = await base44.entities.Event.filter({ tm_id: id.replace('tm_', '') }).catch(() => []);
          trace.steps.push({ method: 'tm_prefix_strip', count: events.length });
        }

        // Step 3: bare tm_id
        if (events.length === 0) {
          events = await base44.entities.Event.filter({ tm_id: id }).catch(() => []);
          trace.steps.push({ method: 'tm_id_field', count: events.length });
        }

        // ROOT CAUSE FIX: dedup — pick newest if multiple records share the same id/tm_id
        if (events.length > 1) {
          events = events.sort((a, b) => new Date(b.updated_date || 0) - new Date(a.updated_date || 0));
        }

        trace.finalCount = events.length;
        trace.finalId = events[0]?.id || null;
        setLookupTrace({ ...trace });

        const resolvedEvent = events[0] || null;
        if (!resolvedEvent) {
          setLookupError(true);
          setLoading(false);
          const lastMethod = trace.steps[trace.steps.length - 1]?.method || 'direct_id';
          logNavEvent({
            result: 'event_not_found',
            event: { id, tm_id: id },
            sourcePage: 'EventDetailUpgrade',
            generatedHref: `/upgrades/${id}`,
            lookupMethod: lastMethod,
            failureReason: `All lookup methods exhausted. Steps: ${trace.steps.map(s => `${s.method}=${s.count}`).join(', ')}`,
            lookupTrace: { ...trace },
          });
          return;
        }

        const resolvedId = resolvedEvent.id;
        const [listingData, dropData, me] = await Promise.all([
          base44.entities.Listing.filter({ event_id: resolvedId, status: 'active' }).catch(() => []),
          base44.entities.FlashDrop.filter({ event_id: resolvedId }).catch(() => []),
          base44.auth.me().catch(() => null),
        ]);

        setEvent(resolvedEvent);
        setListings(listingData);
        setDrops(dropData);
        setUser(me);

        logNavEvent({
          result: trace.steps[0]?.count > 0 ? 'success' : 'lookup_fallback_success',
          event: resolvedEvent,
          sourcePage: 'EventDetailUpgrade',
          generatedHref: `/upgrades/${id}`,
          lookupMethod: trace.steps.find(s => s.count > 0)?.method || 'direct_id',
          lookupTrace: { ...trace },
        });
      } catch (err) {
        console.error('[EventDetailUpgrade] load error:', err);
        setLookupError(true);
        logNavEvent({
          result: 'navigation_error',
          event: { id, tm_id: id },
          sourcePage: 'EventDetailUpgrade',
          generatedHref: `/upgrades/${id}`,
          lookupMethod: 'direct_id',
          failureReason: err?.message || 'Unknown error',
          lookupTrace: { ...trace },
        });
      } finally {
        setLoading(false);
      }
    })();
  }, [id]);

  const handleWinnerSelected = (dropId) => {
    setDrops(prev => prev.map(d => d.id === dropId ? { ...d, status: 'winner_selected' } : d));
  };

  if (!loading && (!event || lookupError)) {
    return (
      <div className="min-h-screen bg-background pb-32">
        <div className="px-4 py-20 text-center space-y-4">
          <Zap className="w-8 h-8 mx-auto opacity-20" />
          <div>
            <p className="font-bold text-foreground text-lg">Event not found</p>
            <p className="text-sm text-muted-foreground mt-1 max-w-xs mx-auto">
              This event may still be syncing. Try refreshing or go back.
            </p>
          </div>
          <div className="flex flex-col gap-2 items-center">
            <button
              onClick={() => window.location.reload()}
              className="px-5 py-2.5 rounded-full font-bold text-sm"
              style={{ background: 'hsl(var(--primary))', color: 'hsl(var(--primary-foreground))' }}
            >
              Retry
            </button>
            <Link to="/upgrades" className="text-sm text-muted-foreground underline">← Back to Upgrades</Link>
          </div>
        </div>
        <EventLookupDebugPanel routeId={id} lookupTrace={lookupTrace} />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Hero */}
      <LiveHubHero event={event} listings={listings} drops={drops} />

      {/* Tab bar */}
      <div className="sticky top-0 z-20 flex border-b"
        style={{ background: 'hsl(var(--background))', borderColor: 'hsl(var(--border))' }}>
        {TABS.map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className="flex-1 py-2.5 transition-colors relative flex flex-col items-center gap-0"
            style={{ color: activeTab === tab.key ? 'hsl(var(--foreground))' : 'hsl(var(--muted-foreground))' }}
          >
            <span className="text-[11px] font-black tracking-wide uppercase leading-none">{tab.label}</span>
            <span className="text-[9px] leading-none mt-0.5 opacity-60">{tab.sub}</span>
            {activeTab === tab.key && (
              <span className="absolute bottom-0 left-0 right-0 h-0.5 rounded-full"
                style={{ background: 'hsl(var(--primary))' }} />
            )}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="px-4 py-5 space-y-4">
        {activeTab === 'Upgrades' && ( // eslint-disable-line
          <>
            <UpgradeFeed listings={listings} eventId={id} loading={loading} />
            {!loading && listings.length === 0 && drops.filter(d => d.status === 'active' || d.status === 'pending').length === 0 && (
              <LiveHubEmptyState />
            )}
          </>
        )}

        {activeTab === 'Fan Gifts' && (
          <FlashDropCenter
            drops={drops}
            user={user}
            listings={listings}
            loading={loading}
            onDropSeats={() => setShowDropSheet(true)}
            onWinnerSelected={handleWinnerSelected}
          />
        )}

        {activeTab === 'Fan Karma' && (
          <FanKarmaCard eventId={id} user={user} />
        )}
      </div>

      {/* Flash Drop creation sheet */}
      {showDropSheet && event && (
        <CreateFlashDropSheet
          event={event}
          user={user}
          onClose={() => setShowDropSheet(false)}
          onCreated={(drop) => {
            setDrops(prev => [drop, ...prev]);
            setShowDropSheet(false);
          }}
        />
      )}
    </div>
  );
}