import { useState, useRef, useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { format } from 'date-fns';
import { MapPin, ChevronRight, LocateFixed, X, RefreshCw, Zap, HelpCircle, ArrowRight } from 'lucide-react';
import LocationAutocomplete from '@/components/LocationAutocomplete';
import { getEventLiveStatus, SOON_WINDOW_MINUTES } from '@/lib/eventTiming';
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
  const { user } = useAuth();
  const _ss = readSS();
  const [allEvents, setAllEvents] = useState([]);
  const [loading, setLoading] = useState(false);
  const [showOverlay, setShowOverlay] = useState(() => shouldShowOverlay(user));
  const [locationInput, setLocationInput] = useState(_ss?.locationInput || '');
  const [editingLocation, setEditingLocation] = useState(false);

  const [tmError, setTmError] = useState(false);

  const { locationStatus, latlong, latlongRef, locationLabel, locationLabelRef, requestLocation, refreshLocation, setManualCity } = useLocationDetect({
    onSuccess: (ll) => fetchEvents(ll, null),
  });

  const abortRef = useRef(null);

  useEffect(() => {
    return () => abortRef.current?.abort();
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

  const nowMs = Date.now();
  const liveEvents = allEvents.filter((e) => {
    const s = getEventLiveStatus(e, nowMs).status;
    return s === 'live';
  });
  const soonEvents = allEvents.filter((e) => {
    const s = getEventLiveStatus(e, nowMs).status;
    return s === 'soon';
  });
  const upcomingEvents = allEvents
    .filter((e) => {
      const s = getEventLiveStatus(e, nowMs).status;
      return s === 'upcoming';
    })
    .sort((a, b) => {
      const aMs = new Date(a.event_start_utc || a.date || 0).getTime();
      const bMs = new Date(b.event_start_utc || b.date || 0).getTime();
      return aMs - bMs;
    });

  const { containerRef, pulling } = usePullToRefresh(() => {
    const ll = latlongRef.current || null;
    const city = !ll && locationLabelRef.current && locationLabelRef.current !== 'Near me' ? locationLabelRef.current : null;
    fetchEvents(ll, city, true);
  });

  return (
    <div ref={containerRef} className="pg-design-page pg-upgrades-page">
      {showOverlay && <WhatIsPGOverlay onDismiss={() => setShowOverlay(false)} user={user} />}
      {pulling && <div className="pg-upgrades-refresh" role="status"><RefreshCw size={16} className="animate-spin" /> Refreshing…</div>}

      <BrowseHeaderTools path="/upgrades">
        <button className="pg-upgrades-location" aria-expanded={editingLocation} aria-controls="upgrade-location-filter" onClick={() => { setLocationInput(locationLabel === 'Near me' ? '' : locationLabel || ''); setEditingLocation(!editingLocation); }}>
          <MapPin size={18} aria-hidden="true" /><span>{locationLabel || 'Choose your location'}</span><ChevronRight size={15} aria-hidden="true" />
        </button>
      </BrowseHeaderTools>

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
            <section aria-label="Live now" className={liveEvents.length === 0 ? 'sr-only' : undefined}>
              {liveEvents.length === 0 ? <p>No live events · upgrades open at showtime</p>
                : <><SectionHeader variant="live" label="Live now" count={liveEvents.length} /><div className="pg-upgrades-stack">{liveEvents.map(event => <EventCard key={event.id} event={event} mode="live" />)}</div></>}
            </section>
            {soonEvents.length > 0 && <section>
              <SectionHeader variant="soon" label="Starting soon" count={soonEvents.length} meta={`within ${SOON_WINDOW_MINUTES} min`} />
              <div className="pg-upgrades-stack">{soonEvents.map(event => <EventCard key={event.id} event={event} mode="soon" />)}</div>
            </section>}
            <section>
              <SectionHeader variant="upcoming" label="Upcoming near you" count={upcomingEvents.length > 0 ? upcomingEvents.length : null} />
              {upcomingEvents.length === 0 ? <div className="pg-state">No upcoming events in this area — check back soon.</div>
                : <div className="pg-upgrades-stack">{upcomingEvents.map(event => <EventCard key={event.id} event={event} mode="upcoming" />)}</div>}
            </section>
          </>}
        <button className="pg-upgrades-explainer" onClick={() => setShowOverlay(true)}><HelpCircle size={19} />How seat upgrades work<ChevronRight size={17} /></button>
        <div className="pg-upgrades-founder"><FounderStoryCard /></div>
      </div>
    </div>
  );
}

function SectionHeader({ label, count, meta, variant }) {
  return <div className={`pg-upgrades-section-heading pg-upgrades-section-${variant}`}>
    <span className="pg-upgrades-status-dot" aria-hidden="true" />
    <h2 className="pg-section-title">{label}</h2>
    {count != null && <span className="pg-upgrades-count">{count}</span>}
    {meta && <span className="pg-upgrades-meta">{meta}</span>}
  </div>;
}

function EventCard({ event, mode }) {
  const isLive = mode === 'live';
  const isSoon = mode === 'soon';
  const navigate = useNavigate();
  const isTM = event.source === 'ticketmaster' || String(event.id || '').startsWith('tm_');
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
      const dest = (isLive || isSoon) ? `/upgrades/${pgId}` : `/events/${pgId}`;
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

  const linkLabel = syncing ? 'Loading…' : isLive ? 'Open Live Hub' : isSoon ? 'Get Ready' : 'View Tickets';

  return (
    <button type="button" onClick={handleClick} disabled={syncing || !hasValidLink}
      className={`pg-ticket pg-upgrade-ticket pg-upgrade-ticket-${mode}`}>
      <div className="pg-upgrade-art">
        <EventThumbnail event={event} className="pg-upgrade-image" />
        <div className="pg-upgrade-eyebrow"><span>{event.category || 'Live events'}</span>{isLive && <b>LIVE</b>}{isSoon && <b className="pg-upgrade-soon">SOON</b>}</div>
        <div className="pg-upgrade-art-caption">
          <p>{event.venue}{event.city ? ` · ${event.city}` : ''}</p>
          {!isLive && !isTM && <span className="pg-upgrade-availability">Upgrades open at showtime</span>}
        </div>
      </div>
      <div className="pg-upgrade-ticket-bottom">
        <div className="pg-upgrade-ticket-copy">
          <h3>{event.title}</h3>
        </div>
        <span className="pg-ticket-end pg-upgrade-ticket-action">
          <span className="pg-upgrade-date">{event.date ? format(new Date(event.date), 'MMM d · h:mm a') : 'Date to be announced'}</span>
          <span className="pg-upgrade-action-label">
            {syncing ? <RefreshCw size={14} className="animate-spin" /> : null}
            <span>{hasValidLink ? linkLabel : 'Unavailable'}</span>
            {!syncing && hasValidLink && <ArrowRight size={14} aria-hidden="true" />}
          </span>
        </span>
      </div>
      {adminUnlocked && <span className="sr-only">id:{String(event.id || '').slice(0, 12)} tm:{String(event.tm_id || '-').slice(0, 12)} src:{event.source || '?'}</span>}
    </button>
  );
}
