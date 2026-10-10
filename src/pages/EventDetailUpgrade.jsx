/**
 * EventDetailUpgrade — redesigned Event Mode screen for a specific event.
 * Route: /upgrades/:id
 *
 * Cinematic hero → YOUR TICKET (when owned) → MOVE CLOSER rail (existing
 * upgrade listings) → sell-your-seats module. Flash Drops and Fan Karma remain
 * accessible via the preserved hub tabs so no existing behavior is lost.
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useLocation, Link } from 'react-router-dom';
import { discoveryBackLink } from '@/lib/eventDiscoveryState';
import { Zap } from 'lucide-react';
import { base44 } from '@/api/base44Client';
import FlashDropCenter from '@/components/eventmode/FlashDropCenter';
import FanKarmaCard from '@/components/eventmode/FanKarmaCard';
import CreateFlashDropSheet from '@/components/flashdrops/CreateFlashDropSheet';
import EventLookupDebugPanel from '@/components/debug/EventLookupDebugPanel';
import { logNavEvent } from '@/lib/navLogger';
import UpgradeEligibilityGate from '@/components/upgrades/UpgradeEligibilityGate.jsx';
import DiscoveryAlertControl from '@/components/upgrades/DiscoveryAlertControl.jsx';
import { UPGRADE_LISTING_TYPES } from '@/lib/listingTypes';
import EventHero from '@/components/eventmode/EventHero';
import CurrentTicketModule from '@/components/eventmode/CurrentTicketModule';
import MoveCloserRail from '@/components/eventmode/MoveCloserRail';
import SellSeatsModule from '@/components/eventmode/SellSeatsModule';
import PurchaseDialog from '@/components/events/PurchaseDialog';
import { loadFanGifts } from '@/lib/fanGiftRead';
import { sharedListingSelection } from '@/lib/sharedListingDestination';
import { getUpgradeEventState } from '@/lib/upgradeEventState';
import { eventIdentityLabel } from '@/lib/eventIdentity';
import { useUpgradeClock } from '@/hooks/useUpgradeClock';
import { listingEventEligibility } from '../../base44/shared/listingEventEligibility.js';
import '@/components/eventmode/ticket-upgrades.css';
import './shared-listing.css';

const TABS = [
  { key: 'Upgrades', label: 'Upgrades', sub: 'Better seats' },
  { key: 'Fan Gifts', label: 'Fan Gifts', sub: 'Free seat drops' },
  { key: 'Fan Karma', label: 'Fan Karma', sub: 'Points & giving' },
];

export default function EventDetailUpgrade() {
  const { id } = useParams();
  const { search, state: routeState } = useLocation();
  const backLink = discoveryBackLink(routeState, 'upgrades');
  const [event, setEvent] = useState(null);
  const [listings, setListings] = useState([]);
  const [drops, setDrops] = useState([]);
  const [dropLoadError, setDropLoadError] = useState(false);
  const [dropsLoading, setDropsLoading] = useState(false);
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('Upgrades');
  const [showDropSheet, setShowDropSheet] = useState(false);
  const [lookupTrace, setLookupTrace] = useState(null);
  const [lookupError, setLookupError] = useState(false);
  const [hubEligibilityPassed, setHubEligibilityPassed] = useState(false);
  const [selectedListing, setSelectedListing] = useState(null);
  const [listingLoadError, setListingLoadError] = useState(false);
  const [refreshingListings, setRefreshingListings] = useState(false);
  const listingRequest = useRef(0);
  const previousInventoryPhase = useRef(null);
  const nowMs = useUpgradeClock(event);
  const timing = getUpgradeEventState(event, nowMs);

  const refreshListings = useCallback(async () => {
    if (!event?.id) return;
    const requestId = ++listingRequest.current;
    setRefreshingListings(true);
    try {
      const result = await base44.functions.invoke('getListingParticipantView', {
        action: 'list_active_by_event', event_id: event.id,
      });
      if (!Array.isArray(result?.data?.listings)) throw new Error('Invalid listings response');
      if (listingRequest.current !== requestId) return;
      setListings(result.data.listings);
      setListingLoadError(false);
    } catch {
      if (listingRequest.current === requestId) setListingLoadError(true);
    } finally {
      if (listingRequest.current === requestId) setRefreshingListings(false);
    }
  }, [event?.id]);

  useEffect(() => {
    if (!event?.id || loading || timing.status === 'ended') return;
    const refreshIfVisible = () => { if (!document.hidden) refreshListings(); };
    // Initial load already read inventory; check again when the event changes phase.
    if (previousInventoryPhase.current?.eventId === event.id
      && previousInventoryPhase.current.status !== timing.status) refreshIfVisible();
    previousInventoryPhase.current = { eventId: event.id, status: timing.status };
    const timer = setInterval(refreshIfVisible, 30000);
    window.addEventListener('focus', refreshIfVisible);
    document.addEventListener('visibilitychange', refreshIfVisible);
    return () => {
      clearInterval(timer);
      listingRequest.current += 1;
      window.removeEventListener('focus', refreshIfVisible);
      document.removeEventListener('visibilitychange', refreshIfVisible);
    };
  }, [event?.id, loading, timing.status, refreshListings]);

  const refreshDrops = async (eventId) => {
    setDropsLoading(true);
    setDropLoadError(false);
    try {
      const view = await loadFanGifts(eventId);
      setDrops(view.drops);
    } catch {
      setDropLoadError(true);
    } finally {
      setDropsLoading(false);
    }
  };

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    setLoading(true);
    setEvent(null);
    setListings([]);
    setUser(null);
    setActiveTab('Upgrades');
    setShowDropSheet(false);
    setSelectedListing(null);
    setHubEligibilityPassed(false);
    setListingLoadError(false);
    setRefreshingListings(false);
    setLookupError(false);
    setLookupTrace(null);
    setDrops([]);
    setDropLoadError(false);

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
        if (cancelled) return;
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
        const [dropData, me] = await Promise.all([
          loadFanGifts(resolvedId).catch(() => null),
          base44.auth.me().catch(() => null),
        ]);

        // Phase 1B-2: fetch listings through the safe participant view function.
        let safeListings = [];
        let listingReadFailed = false;
        try {
          const res = await base44.functions.invoke('getListingParticipantView', {
            action: 'list_active_by_event',
            event_id: resolvedId,
          });
          if (!Array.isArray(res?.data?.listings)) throw new Error('Invalid listings response');
          safeListings = res.data.listings;
        } catch (fnErr) {
          console.error('[EventDetailUpgrade] listing fetch failed:', fnErr);
          safeListings = [];
          listingReadFailed = true;
        }

        if (cancelled) return;
        setEvent(resolvedEvent);
        setListings(safeListings);
        setListingLoadError(listingReadFailed);
        setDrops(dropData?.drops || []);
        setDropLoadError(dropData === null);
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
        if (cancelled) return;
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
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; listingRequest.current += 1; };
  }, [id]);

  const handleWinnerSelected = (dropId) => {
    setDrops(prev => prev.map(d => d.id === dropId ? { ...d, status: 'winner_selected' } : d));
  };

  if (!loading && (!event || lookupError)) {
    return (
      <div className="pg-design-page pg-live-page">
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
              style={{ background: 'var(--pg-cyan)', color: 'var(--pg-ink)' }}>
              Retry
            </button>
            <Link to={backLink.to} state={backLink.state} className="text-sm underline" style={{ color: 'var(--ev-text-2)' }}>← Back to {backLink.label.toLowerCase()}</Link>
          </div>
        </div>
        {user?.role === 'admin' && <EventLookupDebugPanel routeId={id} lookupTrace={lookupTrace} />}
      </div>
    );
  }

  const shared = sharedListingSelection(listings, event, search, UPGRADE_LISTING_TYPES);

  return (
    <div className="pg-design-page pg-live-page">
      <EventHero event={event} nowMs={nowMs} backLink={backLink} />
      <p className="mx-4 text-sm text-muted-foreground break-words">{eventIdentityLabel(event, { alwaysReference: true })}</p>
      <CurrentTicketModule event={event} user={user} />

      {/* Tab bar */}
      <div className="pg-live-tabs" role="group" aria-label="Live hub">
        {TABS.map(tab => (
          <button key={tab.key} onClick={() => setActiveTab(tab.key)} aria-pressed={activeTab === tab.key}
            className={activeTab === tab.key ? 'is-active' : ''}>
            <span>{tab.label}</span>
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="pg-live-content">
        {activeTab === 'Upgrades' && (
          <>
            {!loading && shared.requested && (
              <div className="pg-shared-handoff" role="status">
                <h2>{shared.listings.length ? 'The upgrade shared with you' : 'This shared listing is no longer available'}</h2>
                <p>{shared.listings.length ? 'Review this exact upgrade below. Existing admission and eligibility requirements still apply.' : 'No other upgrade has been selected. You can browse the event’s other upgrades.'}</p>
                <Link to={`/upgrades/${encodeURIComponent(event.id)}`}>View all upgrades for this event</Link>
              </div>
            )}
            {/* Timing only controls when the existing eligibility UI is shown. */}
            {!loading && timing.isLive && (() => {
              const upgradeListings = listings.filter(l => UPGRADE_LISTING_TYPES.includes(l.listing_type));
              const anyHasGate = upgradeListings.some(l => l.requires_location || l.requires_existing_ticket);
              const isDemo = upgradeListings.some(l => l.is_demo_listing);
              if (!anyHasGate) return null;
              const strictest = upgradeListings.find(l => l.requires_location && l.requires_existing_ticket)
                || upgradeListings.find(l => l.requires_location)
                || upgradeListings.find(l => l.requires_existing_ticket);
              return (
                <div className="pg-live-eligibility">
                  <p className="pg-live-eligibility-title">
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

            {(!shared.requested || shared.listings.length > 0 || loading) && <MoveCloserRail
              listings={shared.listings}
              event={event}
              currentUserEmail={user?.email}
              loading={loading}
              onView={setSelectedListing}
              nowMs={nowMs}
              loadError={listingLoadError}
              refreshing={refreshingListings}
              onRetry={refreshListings}
              notifyControl={!shared.requested && event && <DiscoveryAlertControl eventId={event.id} user={user} />}
            />}
            <SellSeatsModule event={event} nowMs={nowMs} />
          </>
        )}

        {activeTab === 'Fan Gifts' && (
          <FlashDropCenter
            creationClosed={!listingEventEligibility(event, nowMs).allowed}
            drops={drops}
            user={user}
            listings={listings}
            loading={loading || dropsLoading}
            loadError={dropLoadError}
            onRetry={() => refreshDrops(event.id)}
            onDropSeats={clickEvent => {
              if (!listingEventEligibility(event, Date.now()).allowed) return;
              clickEvent.currentTarget.focus({ preventScroll: true });
              setShowDropSheet(true);
            }}
            onWinnerSelected={handleWinnerSelected}
          />
        )}

        {activeTab === 'Fan Karma' && (
          <FanKarmaCard eventId={event.id} user={user} />
        )}
      </div>

      {/* Flash Drop creation sheet — preserved */}
      {showDropSheet && event && (
        <CreateFlashDropSheet
          event={event}
          user={user}
          onEventChecked={setEvent}
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
