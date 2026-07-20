/**
 * EventDetailUpgrade — redesigned Event Mode screen for a specific event.
 * Route: /upgrades/:id
 *
 * Cinematic hero → YOUR TICKET (when owned) → MOVE CLOSER rail (existing
 * upgrade listings) → sell-your-seats module. Flash Drops and Fan Karma remain
 * accessible via the preserved hub tabs so no existing behavior is lost.
 */
import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { Zap } from 'lucide-react';
import { base44 } from '@/api/base44Client';
import FlashDropCenter from '@/components/eventmode/FlashDropCenter';
import FanKarmaCard from '@/components/eventmode/FanKarmaCard';
import CreateFlashDropSheet from '@/components/flashdrops/CreateFlashDropSheet';
import EventLookupDebugPanel from '@/components/debug/EventLookupDebugPanel';
import { logNavEvent } from '@/lib/navLogger';
import UpgradeEligibilityGate from '@/components/upgrades/UpgradeEligibilityGate.jsx';
import { UPGRADE_LISTING_TYPES } from '@/lib/listingTypes';
import { isListingVisible } from '@/lib/listingVisibility';
import EventHero from '@/components/eventmode/EventHero';
import CurrentTicketModule from '@/components/eventmode/CurrentTicketModule';
import MoveCloserRail from '@/components/eventmode/MoveCloserRail';
import SellSeatsModule from '@/components/eventmode/SellSeatsModule';
import PurchaseDialog from '@/components/events/PurchaseDialog';

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
  const [hubEligibilityPassed, setHubEligibilityPassed] = useState(false);
  const [selectedListing, setSelectedListing] = useState(null);

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
        setListings(listingData.filter(l => isListingVisible(l, me?.email)));
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
      <div className="min-h-screen" style={{ background: 'var(--ev-bg)', paddingBottom: 'calc(6rem + env(safe-area-inset-bottom))' }}>
        <div className="px-4 py-20 text-center space-y-4">
          <Zap className="w-8 h-8 mx-auto opacity-20" />
          <div>
            <p className="font-bold text-lg" style={{ color: 'var(--ev-text)' }}>Event not found</p>
            <p className="text-sm mt-1 max-w-xs mx-auto" style={{ color: 'var(--ev-text-muted)' }}>
              This event may still be syncing. Try refreshing or go back.
            </p>
          </div>
          <div className="flex flex-col gap-2 items-center">
            <button onClick={() => window.location.reload()}
              className="px-5 py-2.5 rounded-full font-bold text-sm"
              style={{ background: 'var(--ev-teal)', color: '#021018' }}>
              Retry
            </button>
            <Link to="/upgrades" className="text-sm underline" style={{ color: 'var(--ev-text-2)' }}>← Back to Upgrades</Link>
          </div>
        </div>
        {user?.role === 'admin' && <EventLookupDebugPanel routeId={id} lookupTrace={lookupTrace} />}
      </div>
    );
  }

  return (
    <div className="min-h-screen" style={{ background: 'var(--ev-bg)', paddingBottom: 'calc(6rem + env(safe-area-inset-bottom))' }}>
      <EventHero event={event} />
      <CurrentTicketModule event={event} user={user} />

      {/* Tab bar */}
      <div className="sticky top-0 z-20 flex border-b"
        style={{ background: 'var(--ev-bg)', borderColor: 'var(--ev-border)' }}>
        {TABS.map(tab => (
          <button key={tab.key} onClick={() => setActiveTab(tab.key)}
            className="flex-1 py-2.5 transition-colors relative flex flex-col items-center gap-0"
            style={{ color: activeTab === tab.key ? 'var(--ev-teal)' : 'var(--ev-text-muted)' }}>
            <span className="text-[11px] font-black tracking-wide uppercase leading-none">{tab.label}</span>
            <span className="text-[9px] leading-none mt-0.5 opacity-60">{tab.sub}</span>
            {activeTab === tab.key && (
              <span className="absolute bottom-0 left-1/2 -translate-x-1/2 h-0.5 w-8 rounded-b"
                style={{ background: 'var(--ev-teal)' }} />
            )}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="px-4 py-5 space-y-6">
        {activeTab === 'Upgrades' && (
          <>
            {/* Hub-level eligibility gate — preserved as-is */}
            {!loading && (() => {
              const upgradeListings = listings.filter(l => UPGRADE_LISTING_TYPES.includes(l.listing_type));
              const anyHasGate = upgradeListings.some(l => l.requires_location || l.requires_existing_ticket);
              const isDemo = upgradeListings.some(l => l.is_demo_listing || l.notes?.startsWith('[DEMO]'));
              if (!anyHasGate) return null;
              const strictest = upgradeListings.find(l => l.requires_location && l.requires_existing_ticket)
                || upgradeListings.find(l => l.requires_location)
                || upgradeListings.find(l => l.requires_existing_ticket);
              return (
                <div className="mb-2">
                  <p className="text-xs font-bold uppercase tracking-widest mb-2" style={{ color: 'var(--ev-text-muted)' }}>
                    Upgrade Eligibility
                  </p>
                  <UpgradeEligibilityGate listing={strictest} isDemo={isDemo} onEligible={() => setHubEligibilityPassed(true)} />
                  {hubEligibilityPassed && (
                    <p className="text-[11px] mt-2 text-center font-semibold" style={{ color: 'var(--ev-teal)' }}>
                      ✓ Eligible — browse available upgrades below
                    </p>
                  )}
                </div>
              );
            })()}

            <MoveCloserRail
              listings={listings}
              event={event}
              currentUserEmail={user?.email}
              loading={loading}
              onView={setSelectedListing}
            />
            <SellSeatsModule event={event} />
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

      {/* Flash Drop creation sheet — preserved */}
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

      {/* Reuses the existing checkout / reservation system — no second checkout */}
      {selectedListing && (
        <PurchaseDialog
          event={event}
          listing={selectedListing}
          onClose={() => setSelectedListing(null)}
          mode="ticket"
        />
      )}
    </div>
  );
}