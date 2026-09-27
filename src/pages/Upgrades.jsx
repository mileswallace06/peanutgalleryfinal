import { useState, useRef, useCallback, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { format } from 'date-fns';
import { MapPin, ChevronRight, ChevronDown, LocateFixed, X, RefreshCw, Zap, HelpCircle, ArrowRight, Ticket, Radio, CalendarDays } from 'lucide-react';
import LocationAutocomplete from '@/components/LocationAutocomplete';
import { getEventLiveStatus } from '@/lib/eventTiming';
import { groupUpgradeEvents, loadOwnedUpgradeEvents } from '@/lib/upgradeDiscovery';
import { logNavEvent } from '@/lib/navLogger';
import { usePullToRefresh } from '@/hooks/usePullToRefresh';
import { fetchTMEvents, bustTMCache } from '@/lib/tmCache';
import { useLocationDetect } from '@/hooks/useLocationDetect';
import { useAuth } from '@/lib/AuthContext';
import WhatIsPGOverlay, { shouldShowOverlay } from '@/components/WhatIsPGOverlay';
import FounderStoryCard from '@/components/founder/FounderStoryCard';
import EventThumbnail from '@/components/events/EventThumbnail';
import BrowseHeaderTools from '@/components/BrowseHeaderTools';
import '@/components/eventmode/ticket-upgrades.css';

// ── sessionStorage helpers ────────────────────────────────────────────────
const SS_KEY = 'pg_upgrades_location';
function readSS() {
  try { return JSON.parse(sessionStorage.getItem(SS_KEY) || 'null'); } catch { return null; }
}
function writeSS(data) {
  try { sessionStorage.setItem(SS_KEY, JSON.stringify(data)); } catch {}
}

export default function Upgrades() {
  const { user, isAuthenticated, isLoadingAuth } = useAuth();
  const _ss = readSS();
  const [allEvents, setAllEvents] = useState([]);
  const [loading, setLoading] = useState(false);
  const [showOverlay, setShowOverlay] = useState(() => shouldShowOverlay(user));
  const [locationInput, setLocationInput] = useState(_ss?.locationInput || '');
  const [editingLocation, setEditingLocation] = useState(false);
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

  const [tmError, setTmError] = useState(false);

  const { locationStatus, latlong, latlongRef, locationLabel, locationLabelRef, requestLocation, refreshLocation, setManualCity } = useLocationDetect({
    onSuccess: (ll) => fetchEvents(ll, null),
  });

  const abortRef = useRef(null);

  useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  // Keep Live now accurate while the page remains open without refetching inventory.
  useEffect(() => {
    const updateClock = () => { if (!document.hidden) setNowMs(Date.now()); };
    const timer = setInterval(updateClock, 30000);
    document.addEventListener('visibilitychange', updateClock);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', updateClock);
    };
  }, []);

  // Restore last manual city on hard refresh.
  // GPS coords are auto-restored by useLocationDetect.
  useEffect(() => {
    const ss = readSS();
    if (ss?.city && ss.city !== 'Near me' && !latlong) {
      setManualCity(ss.city);
      fetchEvents(null, ss.city);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fetchEvents = useCallback(async (ll, cityOverride, bust = false) => {
    if (!ll && !cityOverride) return;

    abortRef.current?.abort();
    abortRef.current = new AbortController();
    const signal = abortRef.current.signal;

    setLoading(true);
    setTmError(false);
    const tmParams = { size: 40 };
    if (ll) { tmParams.latlong = ll; tmParams.radius = '50'; }
    else if (cityOverride) { tmParams.city = cityOverride; }

    if (bust) bustTMCache(tmParams);

    try {
      const [localData, { events: tmEventsRaw }] = await Promise.all([
        base44.entities.Event.list('date', 200),
        fetchTMEvents(base44, tmParams),
      ]);

      let pgEvents = localData.filter(e => e.status !== 'ended');

      if (cityOverride && !ll) {
        const q = cityOverride.toLowerCase();
        pgEvents = pgEvents.filter(e =>
          e.city?.toLowerCase().includes(q) ||
          e.state?.toLowerCase().includes(q) ||
          e.venue?.toLowerCase().includes(q)
        );
      }
      if (ll) {
        const tmCities = new Set(tmEventsRaw.map(e => e.city?.toLowerCase()).filter(Boolean));
        if (tmCities.size > 0) {
          pgEvents = pgEvents.filter(e => !e.city || tmCities.has(e.city.toLowerCase()));
        } else {
          pgEvents = [];
        }
      }

      const pgMapped = pgEvents.map(e => ({ ...e, source: 'pg' }));
      const tmEvents = tmEventsRaw.map(e => ({ ...e, id: `tm_${e.tm_id}`, source: 'ticketmaster' }));
      const pgTmIds = new Set(pgMapped.map(e => e.tm_id).filter(Boolean));
      const uniqueTM = tmEvents.filter(e => !pgTmIds.has(e.tm_id));

      if (signal.aborted) return;
      setAllEvents([...pgMapped, ...uniqueTM]);
    } catch (err) {
      if (signal.aborted) return;
      if (err?.response?.status === 429) setTmError(true);
      else console.error(err);
    } finally {
      if (!signal.aborted) setLoading(false);
    }
  }, []);

  const handleNearMe = () => {
    setEditingLocation(false);
    requestLocation();
  };

  const { live: liveEvents, upcoming: upcomingEvents } = groupUpgradeEvents(allEvents, nowMs);
  const visibleEvents = browseView === 'live' ? liveEvents : upcomingEvents;

  const { containerRef, pulling } = usePullToRefresh(() => {
    const ll = latlongRef.current || null;
    const city = !ll && locationLabelRef.current && locationLabelRef.current !== 'Near me' ? locationLabelRef.current : null;
    fetchEvents(ll, city, true);
    if (canReadTickets) ticketQuery.refetch();
  });

  return (
    <div ref={containerRef} className="pg-design-page pg-upgrades-page" style={{ '--pg-upgrade-wallet-space': ticketPanelShown ? '48px' : '0px' }}>
      {showOverlay && <WhatIsPGOverlay onDismiss={() => setShowOverlay(false)} user={user} />}
      {pulling && <div className="pg-upgrades-refresh" role="status"><RefreshCw size={16} className="animate-spin" /> Refreshing…</div>}

      <BrowseHeaderTools path="/upgrades">
        <button className="pg-upgrades-location" aria-expanded={editingLocation} aria-controls="upgrade-location-filter" onClick={() => { setLocationInput(locationLabel === 'Near me' ? '' : locationLabel || ''); setEditingLocation(!editingLocation); }}>
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
              <LocationAutocomplete value={locationInput} onChange={setLocationInput}
                onSelect={(s) => { setManualCity(s.label); setEditingLocation(false); writeSS({ city: s.label, locationInput: s.label }); fetchEvents(null, s.label); }}
                onSubmit={(val) => { setManualCity(val); setEditingLocation(false); writeSS({ city: val, locationInput: val }); fetchEvents(null, val); }}
                onNearMe={handleNearMe} nearMeLoading={locationStatus === 'requesting'} autoFocus />
              <button type="button" className="pg-upgrades-close" aria-label="Close location editor" onClick={() => setEditingLocation(false)}><X size={20} /></button>
            </div>
            {(locationStatus === 'denied' || locationStatus === 'unavailable' || locationStatus === 'timeout') && <p className="pg-upgrades-note">
              {locationStatus === 'denied' ? 'Location blocked — enter your city above.' : locationStatus === 'timeout' ? 'Location timed out — enter your city above.' : "Couldn't detect location — enter your city above."}
            </p>}
          </div>
        ) : !locationLabel ? (
          <div className="pg-upgrades-location-actions">
            <button className="pg-action pg-upgrades-near" onClick={handleNearMe} disabled={locationStatus === 'requesting'}>
              <LocateFixed size={18} />{locationStatus === 'requesting' ? 'Locating…' : 'Near me'}
            </button>
            <button className="pg-action pg-upgrades-city" onClick={() => { setLocationInput(locationLabel === 'Near me' ? '' : locationLabel || ''); setEditingLocation(true); }}>
              <MapPin size={18} />{locationLabel ? 'Change city' : 'Enter city'}
            </button>
          </div>
        ) : null}
        {!editingLocation && locationLabel && locationStatus === 'requesting' && <p className="pg-upgrades-note" role="status">Finding your location…</p>}
        {!editingLocation && ['denied', 'unavailable', 'timeout'].includes(locationStatus) && <p className="pg-upgrades-note" role="status">We couldn’t get your location. Tap the location above to choose a city.</p>}
      </div>

      {tmError && <div className="pg-state pg-upgrades-notice" role="alert">Too many requests right now. Please wait a moment and try again.</div>}
      <div aria-live="polite" aria-atomic="true" className="sr-only">
        {!loading && locationLabel && (allEvents.length === 0 ? `No events found near ${locationLabel}` : `${allEvents.length} event${allEvents.length !== 1 ? 's' : ''} found near ${locationLabel}`)}
      </div>

      <div className="pg-upgrades-feed">
        {!loading && locationStatus === 'idle' && !locationLabel && <div className="pg-state pg-upgrades-intro">
          <Zap size={24} /><h2>Move closer to the moment.</h2>
          <ol><li>Choose your location</li><li>Browse available upgrades</li><li>Choose a better seat</li></ol>
        </div>}
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
                <h2>{browseView === 'live' ? 'Nothing live nearby right now.' : 'No upcoming events nearby.'}</h2>
                <p>{browseView === 'live' ? 'Find your next event in Upcoming. Available upgrades appear in its event hub.' : 'Try another city, or check back for more events.'}</p>
                {browseView === 'live' && <button type="button" className="pg-action" onClick={() => setBrowseView('upcoming')}>See upcoming events <ArrowRight size={16} aria-hidden="true" /></button>}
              </div>
                : <div className="pg-upgrades-stack">{visibleEvents.map(event => <EventCard key={event.id} event={event} mode={getEventLiveStatus(event, nowMs).status} />)}</div>}
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
      <div className="pg-upgrades-stack">{events.map(event => <EventCard key={event.id} event={event} mode={getEventLiveStatus(event, nowMs).status} owned />)}</div>
      {unavailableCount > 0 && <p>Some tickets couldn’t load. <button type="button" onClick={onRetry} disabled={retrying}>{retrying ? 'Retrying…' : 'Try again'}</button></p>}
      <Link className="pg-upgrades-wallet-link" to="/my-tickets">Manage all your tickets <ArrowRight size={16} aria-hidden="true" /></Link>
    </div>
  </details>;
}

function EventCard({ event, mode, owned = false }) {
  const isLive = mode === 'live';
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
  const dateValue = event.event_start_utc || event.date;
  const date = dateValue ? new Date(dateValue) : null;
  const hasDate = date && !Number.isNaN(date.getTime());

  return (
    <button type="button" onClick={handleClick} disabled={syncing || !hasValidLink}
      className={`pg-ticket pg-browse-ticket pg-printed-ticket pg-upgrade-ticket pg-upgrade-ticket-${mode}`}>
      <EventThumbnail event={event} className="pg-browse-ticket-art" />
      <div className="pg-browse-ticket-copy">
        {event.category && <span className="sr-only">{event.category}</span>}
        <h3 className="pg-browse-ticket-title" title={event.title}>{event.title}</h3>
        <p className="pg-browse-ticket-venue" title={[event.venue, event.city].filter(Boolean).join(' · ')}>{event.venue}{event.city ? ` · ${event.city}` : ''}</p>
        <p className="pg-browse-ticket-detail">{hasDate ? format(date, 'MMM d · h:mm a') : 'Date to be announced'}</p>
        {owned ? <p className="pg-browse-ticket-detail"><strong>Find upgrades</strong></p> : !isLive && !isTM && <p className="pg-browse-ticket-detail">Upgrades open at showtime</p>}
      </div>
      <span className="pg-browse-ticket-stub">
        {(isLive || isSoon) && <span className="pg-browse-ticket-status">{isLive ? 'Live' : 'Soon'}</span>}
        <span className="pg-browse-ticket-month">{hasDate ? format(date, 'MMM') : 'TBA'}</span>
        <span className="pg-browse-ticket-day">{hasDate ? format(date, 'd') : '—'}</span>
        <span className={hasValidLink ? 'sr-only' : 'pg-browse-ticket-status'}>{hasValidLink ? linkLabel : 'Unavailable'}</span>
        {syncing ? <RefreshCw size={18} className="pg-browse-ticket-arrow animate-spin" aria-hidden="true" /> : hasValidLink && <ArrowRight size={18} className="pg-browse-ticket-arrow" aria-hidden="true" />}
      </span>
      {adminUnlocked && <span className="sr-only">id:{String(event.id || '').slice(0, 12)} tm:{String(event.tm_id || '-').slice(0, 12)} src:{event.source || '?'}</span>}
    </button>
  );
}
