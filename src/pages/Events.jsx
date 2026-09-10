import { useState, useRef, useCallback, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { format } from 'date-fns';
import { MapPin, Calendar, ChevronRight, RefreshCw, ShieldCheck, Search, ArrowUpDown, X } from 'lucide-react';
import { getEventLiveStatus } from '@/lib/eventTiming';
import { getEventUrl } from '@/lib/eventUrl';
import { logNavEvent } from '@/lib/navLogger';
import { usePullToRefresh } from '@/hooks/usePullToRefresh';
import { fetchTMEvents, bustTMCache } from '@/lib/tmCache';
import { mergeEventSources } from '@/lib/eventSourceMerger';
import { useLocationDetect } from '@/hooks/useLocationDetect';
import LocationAutocomplete from '@/components/LocationAutocomplete';
import { createEventSearchRequest, buildEventSearchParams } from '@/lib/eventSearchRequest';
import EventThumbnail from '@/components/events/EventThumbnail';

export default function Events() {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  useEffect(() => {
    base44.auth.me().then(u => setIsAdmin(u?.role === 'admin')).catch(() => {});
  }, []);
  const [locationInput, setLocationInput] = useState('');
  const [editingLocation, setEditingLocation] = useState(false);
  const [cityError, setCityError] = useState('');
  const [locationFilter, setLocationFilter] = useState(null);
  const [activeSearch, setActiveSearch] = useState(() => createEventSearchRequest());
  const activeSearchRef = useRef(activeSearch);
  const pendingNearMe = useRef(null);

  const [tmError, setTmError] = useState(false);
  const [networkError, setNetworkError] = useState(false);
  const [pgError, setPgError] = useState(false);       // PG-source failure (distinct from TM)
  const [partialData, setPartialData] = useState(false); // TM failed, PG partial results shown
  const [keyword, setKeyword] = useState('');
  const [hasSearched, setHasSearched] = useState(false);
  // Sort: 'soonest' = upcoming soonest (default), 'latest' = latest upcoming
  // showPast: when false (default) hides past events; when true shows everything
  const [sortMode, setSortMode] = useState('soonest');
  const [showPast, setShowPast] = useState(false);
  // Track which TM IDs we've already synced this session to avoid duplicate calls
  const syncedTmIds = useRef(new Set());

  const abortRef = useRef(null);
  useEffect(() => () => { abortRef.current?.abort(); pendingNearMe.current = null; }, []);

  const fetchEvents = useCallback(async (request, bust = false) => {
    activeSearchRef.current = request;
    setActiveSearch(request);
    const { keyword, cityOverride, ll } = request;
    setHasSearched(Boolean(keyword || cityOverride || ll));

    // Cancel any previous in-flight fetch
    abortRef.current?.abort();
    abortRef.current = new AbortController();
    const signal = abortRef.current.signal;

    setLoading(true);
    setTmError(false);
    setNetworkError(false);
    setPgError(false);
    setPartialData(false);
    const now = Date.now();
    const { tmParams, pgQuery, pgLimit } = buildEventSearchParams(request);
    if (!keyword && !cityOverride && !ll) {
      setEvents([]);
      setLoading(false);
      return;
    }

    if (bust) bustTMCache(tmParams);

    try {
      // Decouple PG and TM fetches — TM failure must not block PG results.
      const [localResult, tmResult] = await Promise.allSettled([
        base44.entities.Event.filter(pgQuery, 'date', pgLimit, 0),
        fetchTMEvents(base44, tmParams),
      ]);

      if (signal.aborted) return;

      // M0.2: Use the shared event-source merger — fixes the tmResult.value contract
      // mismatch (fetchTMEvents returns { events, fromCache }, not an array).
      const merged = mergeEventSources({
        localResult, tmResult,
        filters: { cityOverride, ll, keyword, isAdmin, now, tmKeywordApplied: true },
      });

      if (merged.pgError && merged.tmFailed) setNetworkError(true);
      if (merged.pgError) {
        console.error('[Events] PG fetch failed:', localResult.reason?.message);
        setPgError(true);
      }
      if (merged.tmError) setTmError(true);
      if (merged.partialData) {
        console.warn('[Events] TM fetch failed — showing PG partial results');
        setPartialData(true);
      }

      setEvents(merged.events);

      // Persist TM events locally so they survive past start time.
      // SESSION DEDUP: only sync each tm_id once per session to prevent duplicate DB records.
      const toSync = merged.tmEventsRaw.filter(e => e.tm_id && !syncedTmIds.current.has(e.tm_id));
      toSync.forEach(e => syncedTmIds.current.add(e.tm_id)); // mark BEFORE async call
      // Serialize syncs to avoid write races — stagger by 200ms per event
      toSync.forEach((e, i) => {
        setTimeout(() => {
          base44.functions.invoke('syncTMEvent', {
            tm_id: e.tm_id, title: e.title, venue: e.venue, city: e.city,
            state: e.state, date: e.date, image_url: e.image_url,
            tm_url: e.tm_url, category: e.category || null,
            tm_venue_id: e.tm_venue_id || '',
            venue_lat: e.venue_lat ?? null, venue_lng: e.venue_lng ?? null,
          }).catch(syncErr => console.warn('[Events] syncTMEvent failed for', e.tm_id, syncErr?.message));
        }, i * 200);
      });
    } catch (err) {
      if (signal.aborted) return; // stale response — discard silently
      const status = err?.response?.status || err?.status;
      if (status === 429) {
        setTmError(true);
        console.warn('[Events] Ticketmaster rate-limited (429)');
      } else {
        console.error('[Events] fetchEvents failed:', status, err?.message, err);
        setNetworkError(true);
      }
    } finally {
      if (!signal.aborted) setLoading(false);
    }
  }, [isAdmin]);



  const runSearch = (text, location = locationFilter) => {
    // A later submit/filter choice supersedes a pending geolocation request.
    pendingNearMe.current = null;
    setKeyword(text);
    setLocationFilter(location);
    setEditingLocation(false);
    setCityError('');
    fetchEvents(createEventSearchRequest(text, location));
  };

  const { locationStatus, requestLocation } = useLocationDetect({
    onSuccess: (ll) => {
      // Restoring cached GPS must never silently restrict an artist search.
      const pending = pendingNearMe.current;
      if (!pending) return;
      runSearch(pending.keyword, { ll });
    },
  });

  const handleNearMe = () => {
    pendingNearMe.current = { keyword: activeSearchRef.current.keyword };
    setCityError('');
    requestLocation();
  };
  const retrySearch = () => fetchEvents(activeSearchRef.current, true);
  const searchAllLocations = () => runSearch(activeSearchRef.current.keyword, null);
  const openLocationPicker = () => {
    setLocationInput(locationFilter?.city || '');
    setCityError('');
    setEditingLocation(true);
  };
  const locationFailed = ['denied', 'unavailable', 'timeout'].includes(locationStatus);

  // Date-aware sorting & filtering of events.
  // Marketplaces prioritizes future, purchasable events.
  const getEventDate = (e) => {
    // Prefer canonical UTC start time, fall back to legacy date field
    const d = e.event_start_utc || e.date;
    return d ? new Date(d).getTime() : null;
  };

  const filtered = (() => {
    const now = Date.now();
    let list = [...events];

    // Default: hide past events (users buy tickets for upcoming shows)
    // Toggle exposes past events for browsing
    if (!showPast) {
      list = list.filter(e => {
        const t = getEventDate(e);
        // Keep events with no parseable date (don't accidentally hide unknowns)
        return t === null || t >= now;
      });
    }

    list.sort((a, b) => {
      const ta = getEventDate(a);
      const tb = getEventDate(b);
      // Events without dates sink to the bottom regardless of mode
      if (ta === null && tb === null) return 0;
      if (ta === null) return 1;
      if (tb === null) return -1;
      // 'soonest' = ascending (nearest future first); 'latest' = descending
      return sortMode === 'latest' ? tb - ta : ta - tb;
    });

    return list;
  })();

  const { containerRef, pulling } = usePullToRefresh(retrySearch);

  return (
    <div ref={containerRef} className="pb-32 transition-transform duration-200">
      {pulling && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-40 flex items-center gap-2 px-4 py-2 rounded-full"
          style={{ background: 'rgba(var(--neon-purple-rgb), 0.1)', border: '1px solid rgba(var(--neon-purple-rgb), 0.25)' }}>
          <RefreshCw className="w-3.5 h-3.5 animate-spin" style={{ color: 'var(--neon-purple)' }} />
          <span className="text-xs font-semibold" style={{ color: 'var(--neon-purple)' }}>Refreshing…</span>
        </div>
      )}

      {/* ── Hero ── */}
      <div className="relative h-56 overflow-hidden" style={{ marginTop: 'env(safe-area-inset-top)' }}>
        <img
          src="https://images.unsplash.com/photo-1493225457124-a3eb161ffa5f?w=1200&q=85"
          alt="crowd"
          className="w-full h-full object-cover object-center"
        />
        {/* Dark overlay — heavy at bottom */}
        <div
          className="absolute inset-0"
          style={{ background: 'linear-gradient(to bottom, var(--hero-bg-top) 0%, var(--hero-bg-mid) 40%, var(--hero-bg-end) 100%)' }}
        />
        {/* Extra text-area darkening */}
        <div
          className="absolute bottom-0 left-0 right-0 h-36"
          style={{ background: 'linear-gradient(to top, var(--hero-bg-extra), transparent)' }}
        />



        {/* Headline */}
        <div className="absolute bottom-5 left-4 right-4">
          <h1
            className="font-display leading-[0.95]"
            style={{
              fontSize: 'clamp(3rem, 14vw, 5rem)',
              letterSpacing: '-0.02em',
              filter: 'drop-shadow(var(--hero-shadow))',
              background: 'linear-gradient(90deg, var(--neon-purple) 0%, var(--hero-text-fade) 60%)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              backgroundClip: 'text',
            }}
          >
            Events
          </h1>
          <p className="text-sm text-white/60 mt-1">Fan-listed tickets, buyer-protected.</p>
        </div>
      </div>

      {/* One event search; geography is a separate, opt-in filter. */}
      <div className="px-4 mt-3 mb-4 space-y-3">
        <form role="search" onSubmit={(e) => { e.preventDefault(); runSearch(keyword); }}>
          <label htmlFor="event-search" className="sr-only">Search events, artists, teams, or venues</label>
          <div className="flex items-center gap-2">
            <div className="relative flex-1 min-w-0">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
              <input id="event-search" type="search" value={keyword} maxLength={100}
                onChange={e => setKeyword(e.target.value)}
                placeholder="Artist, event, team or venue"
                enterKeyHint="search" autoComplete="off"
                className="w-full pl-9 pr-9 py-3 rounded-full text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/40 [&::-webkit-search-cancel-button]:appearance-none"
                style={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))' }} />
              {keyword && (
                <button type="button" onClick={() => runSearch('')} aria-label="Clear event search"
                  className="absolute right-1 top-1/2 -translate-y-1/2 p-2 text-muted-foreground">
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>
            <button type="submit" className="px-4 py-3 rounded-full text-sm font-bold bg-primary text-primary-foreground">Search</button>
          </div>
        </form>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={openLocationPicker} aria-expanded={editingLocation} aria-controls="event-location-filter"
            className="flex items-center gap-1.5 px-3 py-2 rounded-full text-xs font-semibold border border-primary/30 text-primary bg-primary/10">
            <MapPin className="w-3.5 h-3.5" />
            {activeSearch.locationLabel} · change
          </button>
          {locationFilter && (
            <button type="button" onClick={searchAllLocations} className="text-xs text-muted-foreground underline underline-offset-2">Search all locations</button>
          )}
          {!locationFilter && <span className="text-xs text-muted-foreground">Search across the U.S.</span>}
        </div>
        {editingLocation && (
          <section id="event-location-filter" aria-label="Location filter" className="p-3 rounded-2xl border border-border space-y-3">
            <div className="flex justify-between items-center">
              <p className="text-sm font-semibold">Filter by location</p>
              <button type="button" onClick={() => { pendingNearMe.current = null; setEditingLocation(false); }} aria-label="Close location filter" className="p-2"><X className="w-4 h-4" /></button>
            </div>
            <LocationAutocomplete value={locationInput} autoFocus
              onChange={(value) => { setLocationInput(value); setCityError(''); }}
              onSelect={(city) => {
                if (!city.city) { setCityError('Choose a city from the suggestions.'); return; }
                runSearch(activeSearchRef.current.keyword, { city: city.city, label: city.label || city.city });
              }}
              onSubmit={() => setCityError('Choose a city from the suggestions, or use Near me.')}
              placeholder="Find a city" />
            {cityError && <p role="alert" className="text-xs text-muted-foreground">{cityError}</p>}
            {locationFailed && <p role="status" className="text-xs text-muted-foreground">Location is unavailable. Choose a city or search all locations.</p>}
            <div className="flex gap-3">
              <button type="button" onClick={searchAllLocations} className="text-sm font-semibold text-primary">All locations</button>
              <button type="button" onClick={handleNearMe} disabled={locationStatus === 'requesting'} className="text-sm font-semibold text-primary disabled:opacity-50">
                {locationStatus === 'requesting' ? 'Locating…' : 'Near me'}
              </button>
            </div>
          </section>
        )}
      </div>

      {/* ── Sort by Date ── */}
      <div className="px-4 mb-4 flex flex-wrap items-center gap-2">
        <ArrowUpDown className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
        <div className="flex gap-1.5 flex-1">
          {[
            { id: 'soonest', label: 'Upcoming Soonest' },
            { id: 'latest', label: 'Latest Upcoming' },
          ].map(opt => (
            <button key={opt.id} onClick={() => setSortMode(opt.id)}
              className="px-3 py-1.5 rounded-full text-[11px] font-bold whitespace-nowrap transition-all"
              style={sortMode === opt.id
                ? { background: 'hsl(var(--primary))', color: 'hsl(var(--primary-foreground))' }
                : { background: 'hsl(var(--card))', color: 'hsl(var(--muted-foreground))', border: '1px solid hsl(var(--border))' }}>
              {opt.label}
            </button>
          ))}
        </div>
        <button onClick={() => setShowPast(v => !v)}
          className="px-3 py-1.5 rounded-full text-[11px] font-bold whitespace-nowrap transition-all"
          style={showPast
            ? { background: 'rgba(var(--neon-yellow-rgb),0.12)', color: 'var(--neon-yellow)', border: '1px solid rgba(var(--neon-yellow-rgb),0.3)' }
            : { background: 'hsl(var(--card))', color: 'hsl(var(--muted-foreground))', border: '1px solid hsl(var(--border))' }}>
          Past Events
        </button>
      </div>

      {/* ── Rate limit / network error ── */}
      {tmError && (
        <div className="mx-4 mb-3 px-4 py-3 rounded-2xl text-sm font-medium flex items-center justify-between gap-3"
          style={{ background: 'rgba(var(--neon-orange-rgb), 0.08)', border: '1px solid rgba(var(--neon-orange-rgb), 0.2)', color: 'var(--neon-orange)' }}>
          <span>Too many requests right now. Please wait a moment.</span>
          <button onClick={retrySearch}
            className="flex items-center gap-1 text-xs font-bold underline underline-offset-2 flex-shrink-0">
            <RefreshCw className="w-3 h-3" /> Retry
          </button>
        </div>
      )}
      {networkError && !tmError && (
        <div className="mx-4 mb-3 px-4 py-3 rounded-2xl text-sm font-medium flex items-center justify-between gap-3"
          style={{ background: 'rgba(var(--neon-pink-rgb), 0.08)', border: '1px solid rgba(var(--neon-pink-rgb), 0.2)', color: 'var(--neon-pink)' }}>
          <span>Failed to load events. Check your connection.</span>
          <button onClick={retrySearch}
            className="flex items-center gap-1 text-xs font-bold underline underline-offset-2 flex-shrink-0">
            <RefreshCw className="w-3 h-3" /> Retry
          </button>
        </div>
      )}
      {/* M0.1: PG-source failure (distinct from TM failure) */}
      {pgError && !networkError && (
        <div className="mx-4 mb-3 px-4 py-3 rounded-2xl text-sm font-medium flex items-center justify-between gap-3"
          style={{ background: 'rgba(var(--neon-pink-rgb), 0.08)', border: '1px solid rgba(var(--neon-pink-rgb), 0.2)', color: 'var(--neon-pink)' }}>
          <span>Could not load Peanut Gallery events. Results may be incomplete.</span>
          <button onClick={retrySearch}
            className="flex items-center gap-1 text-xs font-bold underline underline-offset-2 flex-shrink-0">
            <RefreshCw className="w-3 h-3" /> Retry
          </button>
        </div>
      )}
      {/* M0.1: Partial data — TM failed, PG partial results shown */}
      {partialData && !tmError && (
        <div className="mx-4 mb-3 px-4 py-3 rounded-2xl text-xs font-medium flex items-center gap-2"
          style={{ background: 'rgba(var(--neon-yellow-rgb), 0.06)', border: '1px solid rgba(var(--neon-yellow-rgb), 0.2)', color: 'var(--neon-yellow)' }}>
          <ShieldCheck className="w-3.5 h-3.5 flex-shrink-0" />
          <span>Showing Peanut Gallery events only — Ticketmaster is temporarily unavailable.</span>
        </div>
      )}

      {/* ── Event count + aria-live announcement ── */}
      <div aria-live="polite" aria-atomic="true" className="px-4 mb-4">
        {!loading && hasSearched && filtered.length > 0 && (
          <div className="flex items-center gap-3">
            <div className="h-px flex-1" style={{ background: 'rgba(var(--neon-purple-rgb),0.2)' }} />
            <p className="text-[10px] font-bold tracking-widest uppercase" style={{ color: 'var(--neon-purple)' }}>
              {filtered.length} event{filtered.length !== 1 ? 's' : ''}
            </p>
            <div className="h-px flex-1" style={{ background: 'rgba(var(--neon-purple-rgb),0.2)' }} />
          </div>
        )}
      </div>

      {/* ── Live Event Mode Banner ── */}
      {!loading && filtered.some(e => e.source !== 'ticketmaster' && getEventLiveStatus(e).status === 'live') && (
        <div className="mx-4 mb-4">
          {filtered.filter(e => e.source !== 'ticketmaster' && getEventLiveStatus(e).status === 'live').map(e => (
            <Link
              key={e.id}
              to={`/upgrades/${e.id}`}
              className="flex items-center gap-3 px-4 py-3 rounded-2xl mb-2"
              style={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))' }}
            >
              <span className="w-2 h-2 rounded-full bg-red-500 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="font-bold text-sm text-foreground leading-none">Live Now</p>
                <p className="text-xs text-muted-foreground mt-0.5 truncate">{e.title}</p>
              </div>
              <span className="text-xs font-bold px-3 py-1.5 rounded-full flex-shrink-0"
                style={{ background: 'hsl(var(--primary))', color: 'hsl(var(--primary-foreground))' }}>
                Open
              </span>
            </Link>
          ))}
        </div>
      )}

      {/* ── List ── */}
      {loading ? (
        <div className="px-4 space-y-3">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="rounded-2xl overflow-hidden flex animate-pulse" style={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))' }}>
              <div className="w-28 flex-shrink-0" style={{ minHeight: 110, background: 'hsl(var(--muted))' }} />
              <div className="flex-1 px-4 py-4 space-y-2">
                <div className="h-3.5 rounded-full bg-muted w-3/4" />
                <div className="h-2.5 rounded-full bg-muted w-1/2" />
                <div className="h-2.5 rounded-full bg-muted w-2/5" />
              </div>
            </div>
          ))}
        </div>
      ) : !hasSearched ? (
        <div className="mx-4 p-5 rounded-2xl border border-border bg-card space-y-2">
          <p className="font-semibold">Find your next event</p>
          <p className="text-sm text-muted-foreground">Search an artist, event, team or venue across the U.S., or choose a location to browse nearby.</p>
          <button type="button" onClick={openLocationPicker} className="text-sm font-semibold text-primary">Choose a location</button>
        </div>
      ) : filtered.length === 0 ? (
        <div className="mx-4 p-5 rounded-2xl border border-border bg-card space-y-2" role="status">
          <p className="font-semibold">
            {networkError || pgError || tmError || partialData ? 'Some search results are unavailable' : activeSearch.keyword ? `No matches for “${activeSearch.keyword}”` : 'No events found'}
          </p>
          <p className="text-sm text-muted-foreground">
            {networkError || pgError || tmError || partialData
              ? 'A source could not be loaded. Retry this search before assuming there are no events.'
              : locationFilter ? `No matches in ${activeSearch.locationLabel}. Try all locations or another search.`
                : 'Try another artist, event, team or venue. This search includes all locations.'}
          </p>
          {locationFilter && <button type="button" onClick={searchAllLocations} className="text-sm font-semibold text-primary">Search all locations</button>}
          {(networkError || pgError || tmError || partialData) && <button type="button" onClick={retrySearch} className="block text-sm font-semibold text-primary">Retry search</button>}
        </div>
      ) : (
        <div className="px-4 space-y-3">
          {filtered.map(event => (
            <EventRow key={event.id} event={event} isAdmin={isAdmin} />
          ))}
        </div>
      )}
    </div>
  );
}

function EventRow({ event, isAdmin = false }) {
  const isTM = event.source === 'ticketmaster' || String(event.id || '').startsWith('tm_');
  const timing = !isTM && event.id ? getEventLiveStatus(event) : null;
  const isLive = timing?.status === 'live';
  const isSoon = timing?.status === 'soon';
  const eventUrl = getEventUrl(event);

  const handleCardClick = () => {
    logNavEvent({
      result: eventUrl ? 'success' : 'navigation_error',
      event,
      sourcePage: 'Events',
      generatedHref: eventUrl || '',
      lookupMethod: 'none',
      failureReason: eventUrl ? '' : 'getEventUrl returned null',
    });
  };

  // Marketplace signals — only show what's genuinely available
  const listingCount = event.listing_count || null;
  const minPrice = event.min_price || null;
  const isPGEvent = event.source === 'pg';

  return (
    <div
      className="rounded-2xl overflow-hidden flex items-stretch"
      style={{
        background: 'hsl(var(--card))',
        border: isLive
          ? '1px solid rgba(var(--neon-purple-rgb),0.35)'
          : '1px solid hsl(var(--border))',
        boxShadow: isLive
          ? '0 2px 16px rgba(var(--neon-purple-rgb),0.08), 0 1px 3px rgba(0,0,0,0.12)'
          : '0 1px 3px rgba(0,0,0,0.08)',
      }}
    >
      {/* Thumbnail */}
      <div className="w-28 flex-shrink-0 relative" style={{ minHeight: 116 }}>
        <EventThumbnail
          event={event}
          className="absolute inset-0 w-full h-full"
        />
        {/* Subtle gradient overlay for readability */}
        <div
          className="absolute inset-0"
          style={{ background: 'linear-gradient(to right, transparent 60%, rgba(0,0,0,0.18) 100%)' }}
        />
        {isLive && (
          <div className="absolute top-2 left-2">
            <span
              className="text-[9px] font-bold px-1.5 py-0.5 rounded"
              style={{ background: 'rgba(220,38,38,0.92)', color: '#fff', letterSpacing: '0.08em' }}
            >
              LIVE
            </span>
          </div>
        )}
      </div>

      {/* Info */}
      <div className="flex-1 px-3.5 py-3.5 flex flex-col justify-between min-w-0 gap-2">
        <div className="space-y-1">
          <h3
            className="font-semibold text-foreground leading-tight line-clamp-2"
            style={{ fontSize: '0.875rem' }}
          >
            {event.title}
          </h3>
          <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
            <MapPin className="w-3 h-3 flex-shrink-0 opacity-50" />
            <span className="truncate">
              {event.venue}{event.city ? `, ${event.city}` : ''}{event.state ? `, ${event.state}` : ''}
            </span>
          </div>
          <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
            <Calendar className="w-3 h-3 flex-shrink-0 opacity-40" />
            <span>{event.date ? format(new Date(event.date), 'EEE, MMM d · h:mm a') : 'TBD'}</span>
          </div>
        </div>

        {/* Marketplace signals */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            {isPGEvent && listingCount > 0 && (
              <span className="text-[11px] text-muted-foreground">
                {listingCount} listing{listingCount !== 1 ? 's' : ''}
                {minPrice ? ` · from $${minPrice}` : ''}
              </span>
            )}
            {isPGEvent && !listingCount && (
              <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                <ShieldCheck className="w-3 h-3 opacity-50" />
                Buyer protected
              </span>
            )}
          </div>

          {eventUrl && (
            isLive ? (
              <Link
                to={`/upgrades/${event.id}`}
                className="inline-flex items-center gap-1 text-[11px] font-semibold px-3 py-1.5 rounded-lg flex-shrink-0"
                style={{
                  background: 'hsl(var(--primary))',
                  color: 'hsl(var(--primary-foreground))',
                }}
                onClick={e => e.stopPropagation()}
              >
                Live Hub <ChevronRight className="w-3 h-3" />
              </Link>
            ) : (
              <Link
                to={eventUrl}
                state={isTM ? { tmEvent: event } : undefined}
                className="inline-flex items-center gap-1 text-[11px] font-medium px-3 py-1.5 rounded-lg flex-shrink-0 transition-all active:scale-[0.97]"
                style={{
                  background: 'hsl(var(--secondary))',
                  color: 'hsl(var(--secondary-foreground))',
                  border: '1px solid hsl(var(--border))',
                }}
                onClick={handleCardClick}
              >
                View <ChevronRight className="w-3 h-3" />
              </Link>
            )
          )}
        </div>
      </div>
    </div>
  );
}
