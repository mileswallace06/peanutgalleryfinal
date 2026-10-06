import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { MapPin, ChevronRight, ChevronDown, LocateFixed, X, RefreshCw, HelpCircle, ArrowRight, Ticket, Radio, CalendarDays } from 'lucide-react';
import LocationAutocomplete from '@/components/LocationAutocomplete';
import { getUpgradeEventTiming, groupUpgradeEvents, loadOwnedUpgradeEvents } from '@/lib/upgradeDiscovery';
import { formatUpgradeStartsIn, getUpgradeVenueDateParts } from '@/lib/upgradeEventState';
import { logNavEvent } from '@/lib/navLogger';
import { usePullToRefresh } from '@/hooks/usePullToRefresh';
import { useSellingDiscovery } from '@/hooks/useSellingDiscovery';
import { useAuth } from '@/lib/AuthContext';
import WhatIsPGOverlay, { shouldShowOverlay } from '@/components/WhatIsPGOverlay';
import FounderStoryCard from '@/components/founder/FounderStoryCard';
import EventThumbnail from '@/components/events/EventThumbnail';
import BrowseHeaderTools from '@/components/BrowseHeaderTools';
import '@/components/eventmode/ticket-upgrades.css';

export default function Upgrades() {
  const { user, isAuthenticated, isLoadingAuth } = useAuth();
  // Reuse Sell's bounded future + ongoing requests and validated location.
  const discovery = useSellingDiscovery();
  const { result, editingLocation, locationInput, locationStatus, cityError } = discovery;
  const allEvents = result.events;
  const loading = discovery.loading || discovery.restoring;
  const locationLabel = discovery.area?.label || '';
  const sourceError = result.pgError || result.tmError;
  const [showOverlay, setShowOverlay] = useState(() => shouldShowOverlay(user));
  const [browseView, setBrowseView] = useState('upcoming');
  const [nowMs, setNowMs] = useState(Date.now);

  const canReadTickets = Boolean(user?.id && isAuthenticated && !isLoadingAuth);
  const ticketQuery = useQuery({
    queryKey: ['upgrade-owned-events', user?.id],
    queryFn: () => loadOwnedUpgradeEvents(base44),
    enabled: canReadTickets,
    staleTime: 60000,
    retry: false,
    refetchOnWindowFocus: false,
  });
  const ownedGroups = groupUpgradeEvents(canReadTickets ? ticketQuery.data?.events || [] : [], nowMs);
  const ownedEvents = [...ownedGroups.live, ...ownedGroups.upcoming];
  const ticketPanelShown = canReadTickets && (ticketQuery.isPending || ticketQuery.isError || ownedEvents.length > 0 || ticketQuery.data?.unavailableCount > 0);

  // One clock updates every card's countdown and Live now without extra inventory calls.
  useEffect(() => {
    const updateClock = () => { if (!document.hidden) setNowMs(Date.now()); };
    const timer = setInterval(updateClock, 1000);
    document.addEventListener('visibilitychange', updateClock);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', updateClock);
    };
  }, []);

  const { live: liveEvents, upcoming: upcomingEvents } = groupUpgradeEvents(allEvents, nowMs);
  const visibleEvents = browseView === 'live' ? liveEvents : upcomingEvents;

  const { containerRef, pulling } = usePullToRefresh(() => {
    discovery.refresh();
    if (canReadTickets) ticketQuery.refetch();
  });

  return (
    <div ref={containerRef} className="pg-design-page pg-upgrades-page" style={{ '--pg-upgrade-wallet-space': ticketPanelShown ? '48px' : '0px' }}>
      {showOverlay && <WhatIsPGOverlay onDismiss={() => setShowOverlay(false)} user={user} />}
      {pulling && <div className="pg-upgrades-refresh" role="status"><RefreshCw size={16} className="animate-spin" /> Refreshing…</div>}

      <BrowseHeaderTools path="/upgrades">
        <button className="pg-upgrades-location" aria-expanded={editingLocation} aria-controls="upgrade-location-filter" onClick={editingLocation ? discovery.closeLocation : discovery.openLocation}>
          <MapPin size={18} aria-hidden="true" /><span>{locationLabel || 'Choose your location'}</span><ChevronRight size={15} aria-hidden="true" />
        </button>
        <button type="button" className="pg-upgrades-help" aria-label="How seat upgrades work" onClick={() => setShowOverlay(true)}>
          <HelpCircle size={17} aria-hidden="true" /><span>How it works</span>
        </button>
      </BrowseHeaderTools>

      {ticketPanelShown && <OwnedTicketsPanel
        events={ownedEvents} nowMs={nowMs} loading={ticketQuery.isPending}
        failed={ticketQuery.isError} unavailableCount={ticketQuery.data?.unavailableCount || 0}
        retrying={ticketQuery.isFetching} onRetry={() => ticketQuery.refetch()} />}

      <div className="pg-upgrades-location-panel">
        {editingLocation ? (
          <div id="upgrade-location-filter" className="pg-upgrades-city-edit">
            <div className="pg-upgrades-city-input">
              <LocationAutocomplete value={locationInput} onChange={discovery.changeLocationInput}
                onSelect={discovery.selectCity} onSubmit={discovery.rejectCity}
                onNearMe={() => discovery.locate()} nearMeLoading={locationStatus === 'requesting'} autoFocus />
              <button type="button" className="pg-upgrades-close" aria-label="Close location editor" onClick={discovery.closeLocation}><X size={20} /></button>
            </div>
            {cityError && <p className="pg-upgrades-note" role="alert">{cityError}</p>}
            {(locationStatus === 'denied' || locationStatus === 'unavailable' || locationStatus === 'timeout') && <p className="pg-upgrades-note">
              {locationStatus === 'denied' ? 'Location blocked — enter your city above.' : locationStatus === 'timeout' ? 'Location timed out — enter your city above.' : "Couldn't detect location — enter your city above."}
            </p>}
          </div>
        ) : !locationLabel ? (
          <section className="pg-upgrades-intro" aria-labelledby="upgrade-location-heading">
            <h2 id="upgrade-location-heading">Find your event</h2>
            <p>Choose a city to see nearby events and available upgrades.</p>
            <div className="pg-upgrades-location-actions">
              <button type="button" className="pg-action pg-upgrades-near" onClick={() => discovery.locate()} disabled={locationStatus === 'requesting'}>
                <LocateFixed size={18} aria-hidden="true" />{locationStatus === 'requesting' ? 'Locating…' : 'Near me'}
              </button>
              <button type="button" className="pg-action pg-upgrades-city" onClick={discovery.openLocation}>
                <MapPin size={18} aria-hidden="true" />Choose city
              </button>
            </div>
          </section>
        ) : null}
        {!editingLocation && locationLabel && locationStatus === 'requesting' && <p className="pg-upgrades-note" role="status">Finding your location…</p>}
        {!editingLocation && ['denied', 'unavailable', 'timeout'].includes(locationStatus) && <p className="pg-upgrades-note" role="status">We couldn’t get your location. Tap the location above to choose a city.</p>}
      </div>

      {sourceError && <div className="pg-state pg-upgrades-notice" role="alert">
        {result.rateLimited ? 'Some events could not load because the provider is busy.' : 'Some events could not load. These results may be incomplete.'}
        {' '}<button type="button" onClick={discovery.refresh} disabled={loading}>Try again</button>
      </div>}
      <div aria-live="polite" aria-atomic="true" className="sr-only">
        {!loading && locationLabel && (sourceError ? 'Event results are incomplete' : allEvents.length === 0 ? `No events found near ${locationLabel}` : `${allEvents.length} event${allEvents.length !== 1 ? 's' : ''} found near ${locationLabel}`)}
      </div>

      <div className="pg-upgrades-feed">
        {loading ? <div className="pg-upgrades-stack" role="status" aria-label="Loading nearby upgrades">{[1, 2, 3].map(i => <div key={i} className="pg-upgrades-skeleton animate-pulse" />)}</div>
          : (locationStatus === 'granted' || locationLabel) && <>
            <div className="pg-upgrades-view-switch" role="group" aria-label="Browse upgrades by event time">
              <button type="button" aria-pressed={browseView === 'upcoming'} aria-controls="upgrade-discovery-results" onClick={() => setBrowseView('upcoming')}>
                <CalendarDays size={16} aria-hidden="true" /><span>Upcoming</span><span className="pg-upgrades-view-count">{upcomingEvents.length}</span>
              </button>
              <button type="button" aria-pressed={browseView === 'live'} aria-controls="upgrade-discovery-results" onClick={() => setBrowseView('live')}>
                <Radio size={16} aria-hidden="true" /><span>Live now</span><span className="pg-upgrades-view-count">{liveEvents.length}</span>
              </button>
            </div>
            <section id="upgrade-discovery-results" aria-label={browseView === 'live' ? 'Live now' : 'Upcoming events'}>
              <p className="sr-only" role="status">{visibleEvents.length} {browseView === 'live' ? 'live' : 'upcoming'} events</p>
              {visibleEvents.length === 0 ? <div className="pg-state pg-upgrades-view-empty">
                <h2>{sourceError ? 'Events couldn’t fully load.' : result.limited ? 'No matching events in these results.' : browseView === 'live' ? 'Nothing live nearby right now.' : 'No upcoming events nearby.'}</h2>
                <p>{sourceError ? 'Try again before checking whether anything is live.' : result.limited ? 'More events may exist beyond these results. Try a nearby city.' : browseView === 'live' ? 'Find your next event in Upcoming. Available upgrades appear in its event hub.' : 'Try another city, or check back for more events.'}</p>
                {browseView === 'live' && <button type="button" className="pg-action" onClick={() => setBrowseView('upcoming')}>See upcoming events <ArrowRight size={16} aria-hidden="true" /></button>}
              </div>
                : <div className="pg-upgrades-stack">{visibleEvents.map(event => <EventCard key={event.id} event={event} nowMs={nowMs} mode={getUpgradeEventTiming(event, nowMs).status} />)}</div>}
            </section>
          </>}
        <div className="pg-upgrades-founder"><FounderStoryCard /></div>
      </div>
    </div>
  );
}

function OwnedTicketsPanel({ events, nowMs, loading, failed, unavailableCount, retrying, onRetry }) {
  if (loading) return <div className="pg-upgrades-wallet-status" role="status"><Ticket size={17} aria-hidden="true" /> Checking your tickets…</div>;
  if (failed || (events.length === 0 && unavailableCount > 0)) return <div className="pg-upgrades-wallet-status" role="status">
    <Link to="/my-tickets">Your tickets couldn’t load</Link>
    <button type="button" onClick={onRetry} disabled={retrying}>{retrying ? 'Retrying…' : 'Retry'}</button>
  </div>;
  if (events.length === 0) return null;
  return <details className="pg-upgrades-owned">
    <summary><Ticket size={17} aria-hidden="true" /><strong>Your tickets <span>{events.length}</span></strong><span className="pg-upgrades-owned-hint">Find upgrades</span><ChevronDown size={16} aria-hidden="true" /></summary>
    <div className="pg-upgrades-owned-body">
      <p>Choose a ticket you bought on PG. Upgrades are separate purchases, subject to availability.</p>
      <div className="pg-upgrades-stack">{events.map(event => <EventCard key={event.id} event={event} nowMs={nowMs} mode={getUpgradeEventTiming(event, nowMs).status} owned />)}</div>
      {unavailableCount > 0 && <p>Some tickets couldn’t load. <button type="button" onClick={onRetry} disabled={retrying}>{retrying ? 'Retrying…' : 'Try again'}</button></p>}
      <Link className="pg-upgrades-wallet-link" to="/my-tickets">Manage all your tickets <ArrowRight size={16} aria-hidden="true" /></Link>
    </div>
  </details>;
}

function EventCard({ event, mode, owned = false, nowMs = Date.now() }) {
  const isEstimated = mode === 'estimated_live';
  const isLive = mode === 'live' || isEstimated;
  const isSoon = mode === 'soon';
  const navigate = useNavigate();
  const isTM = !owned && (event.source === 'ticketmaster' || String(event.id || '').startsWith('tm_'));
  // Admin check is done server-side; this component doesn't have user context, so just hide debug overlay for non-admins
  // Pass isAdmin from parent if needed — for now disable client-side bypass
  const adminUnlocked = false;

  // For real PG events, use direct link. For TM-only, sync first then navigate.
  const pgId = !isTM ? event.id : null;
  const tmId = event.tm_id || (String(event.id || '').startsWith('tm_') ? String(event.id).replace('tm_', '') : null);
  const hasValidLink = !!(pgId || tmId);

  const [syncing, setSyncing] = useState(false);

  const handleClick = async (e) => {
    if (pgId) {
      // Real PG event — for live/soon go to upgrade hub; for upcoming go to event detail where tickets are listed
      const dest = (owned || isLive || isSoon) ? `/upgrades/${pgId}` : `/events/${pgId}`;
      logNavEvent({ result: 'success', event, sourcePage: 'Upgrades', generatedHref: dest, lookupMethod: 'direct_id' });
      navigate(dest);
      return;
    }
    if (!tmId) return;
    // TM-only event — sync to DB first to get a real internal ID
    e.preventDefault();
    setSyncing(true);
    try {
      const res = await base44.functions.invoke('syncTMEvent', {
        tm_id: tmId,
        title: event.title,
        venue: event.venue,
        city: event.city,
        state: event.state,
        date: event.date,
        image_url: event.image_url,
        tm_url: event.tm_url,
        category: event.category,
        tm_venue_id: event.tm_venue_id,
        venue_timezone: event.venue_timezone,
      });
      const internalId = res?.data?.id;
      if (internalId) {
        logNavEvent({ result: 'success', event, sourcePage: 'Upgrades', generatedHref: `/upgrades/${internalId}`, lookupMethod: 'sync_then_navigate' });
        navigate(`/upgrades/${internalId}`);
      } else {
        // Sync returned no id — fall back to TM detail page
        navigate(`/events/tm/${tmId}`);
      }
    } catch {
      navigate(`/events/tm/${tmId}`);
    } finally {
      setSyncing(false);
    }
  };

  const linkLabel = syncing ? 'Loading…' : owned ? 'Find upgrades for your ticket' : isLive ? 'Open Live Hub' : isSoon ? 'Get Ready' : 'View Tickets';
  const timing = getUpgradeEventTiming(event, nowMs);
  const venueDate = getUpgradeVenueDateParts(event, timing.start);
  const hasDate = timing.status !== 'unknown' && venueDate !== null;
  const startsIn = ['upcoming', 'soon'].includes(timing.status) ? formatUpgradeStartsIn(timing.start, nowMs) : null;

  return (
    <button type="button" onClick={handleClick} disabled={syncing || !hasValidLink}
      className={`pg-ticket pg-browse-ticket pg-printed-ticket pg-upgrade-ticket pg-upgrade-ticket-${isLive ? 'live' : mode}`}>
      <EventThumbnail event={event} className="pg-browse-ticket-art" />
      <div className="pg-browse-ticket-copy">
        {event.category && <span className="sr-only">{event.category}</span>}
        <h3 className="pg-browse-ticket-title" title={event.title}>{event.title}</h3>
        <p className="pg-browse-ticket-venue" title={[event.venue, event.city].filter(Boolean).join(' · ')}>{event.venue}{event.city ? ` · ${event.city}` : ''}</p>
        <p className="pg-browse-ticket-detail">{hasDate ? venueDate.label : 'Date to be announced'}</p>
        {(startsIn || owned) && <p className="pg-browse-ticket-detail"><strong>{startsIn || 'Find upgrades'}</strong></p>}
      </div>
      <span className="pg-browse-ticket-stub">
        {(isLive || isSoon) && <span className="pg-browse-ticket-status" title={isEstimated ? 'Estimated live window; the event may have ended' : undefined}>{isEstimated ? 'Live · est.' : isLive ? 'Live' : 'Soon'}</span>}
        <span className="pg-browse-ticket-month">{hasDate ? venueDate.month : 'TBA'}</span>
        <span className="pg-browse-ticket-day">{hasDate ? venueDate.day : '—'}</span>
        <span className={hasValidLink ? 'sr-only' : 'pg-browse-ticket-status'}>{hasValidLink ? linkLabel : 'Unavailable'}</span>
        {syncing ? <RefreshCw size={18} className="pg-browse-ticket-arrow animate-spin" aria-hidden="true" /> : hasValidLink && <ArrowRight size={18} className="pg-browse-ticket-arrow" aria-hidden="true" />}
      </span>
      {adminUnlocked && <span className="sr-only">id:{String(event.id || '').slice(0, 12)} tm:{String(event.tm_id || '-').slice(0, 12)} src:{event.source || '?'}</span>}
    </button>
  );
}
