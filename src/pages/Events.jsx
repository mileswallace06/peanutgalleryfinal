import { useState, useRef, useCallback, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { format } from 'date-fns';
import { MapPin, Calendar, ChevronRight, RefreshCw, ShieldCheck, Search, ArrowUpDown } from 'lucide-react';
import { getEventLiveStatus } from '@/lib/eventTiming';
import { getEventUrl } from '@/lib/eventUrl';
import { logNavEvent } from '@/lib/navLogger';
import { usePullToRefresh } from '@/hooks/usePullToRefresh';
import { fetchTMEvents, bustTMCache } from '@/lib/tmCache';
import { mergeEventSources } from '@/lib/eventSourceMerger';
import { useLocationDetect } from '@/hooks/useLocationDetect';
import LocationAutocomplete from '@/components/LocationAutocomplete';
import EventsEmptyState from '@/components/events/EventsEmptyState';
import EventThumbnail from '@/components/events/EventThumbnail';

// ── sessionStorage helpers ────────────────────────────────────────────────
const SS_KEY = 'pg_events_location';
function readSS() {
  try { return JSON.parse(sessionStorage.getItem(SS_KEY) || 'null'); } catch { return null; }
}
function writeSS(data) {
  try { sessionStorage.setItem(SS_KEY, JSON.stringify(data)); } catch {}
}

import { normalizeSearch, escapeRegex } from '@/lib/searchNormalize';

// ── Server-side filtered search (M0.2) ─────────────────────────────────────
// Replaces the download-all strategy: instead of fetching up to 5000 events
// and filtering client-side, we query search_text_normalized server-side with
// $regex and a bounded result limit.
const PG_SEARCH_LIMIT = 100;   // keyword search: max 100 results
const PG_BROWSE_LIMIT = 200;  // city/near-me browse: max 200 results

function buildPGQuery({ keyword, cityOverride, ll }) {
  const query = {};
  if (keyword) {
    const normalized = normalizeSearch(keyword);
    const escaped = escapeRegex(normalized);
    if (escaped) query.search_text_normalized = { $regex: escaped, $options: 'i' };
  }
  if (cityOverride) {
    const cityNorm = normalizeSearch(cityOverride);
    const escaped = escapeRegex(cityNorm);
    if (escaped) query.city = { $regex: escaped, $options: 'i' };
  }
  if (ll) {
    // Near-me: only fetch events with valid coordinates (server-side filter).
    // The haversine radius filter is applied client-side by the merger.
    query.venue_lat = { $ne: null };
    query.venue_lng = { $ne: null };
  }
  return query;
}

async function fetchPGEvents(query, limit) {
  return await base44.entities.Event.filter(query, 'date', limit, 0);
}

export default function Events() {
  const _ss = readSS();
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  useEffect(() => {
    base44.auth.me().then(u => setIsAdmin(u?.role === 'admin')).catch(() => {});
  }, []);
  const [locationInput, setLocationInput] = useState(_ss?.locationInput || '');
  const [editingLocation, setEditingLocation] = useState(false);

  const [tmError, setTmError] = useState(false);
  const [networkError, setNetworkError] = useState(false);
  const [pgError, setPgError] = useState(false);       // PG-source failure (distinct from TM)
  const [partialData, setPartialData] = useState(false); // TM failed, PG partial results shown
  const [truncated, setTruncated] = useState(false);     // hit the 5000-event bounded max
  const [keyword, setKeyword] = useState('');
  // Sort: 'soonest' = upcoming soonest (default), 'latest' = latest upcoming
  // showPast: when false (default) hides past events; when true shows everything
  const [sortMode, setSortMode] = useState('soonest');
  const [showPast, setShowPast] = useState(false);
  // Track which TM IDs we've already synced this session to avoid duplicate calls
  const syncedTmIds = useRef(new Set());

  const { locationStatus, latlong, latlongRef, locationLabel, locationLabelRef, requestLocation, refreshLocation, setManualCity, setLocationLabelSync, setLatlongSync } = useLocationDetect({
    onSuccess: (ll) => fetchEvents(ll, null, null),
  });

  // Abort controller ref — cancel in-flight fetch when a new one starts or component unmounts
  const abortRef = useRef(null);

  useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  // Restore last manual city on hard refresh.
  // GPS coords are now auto-restored by useLocationDetect via localStorage cache.
  useEffect(() => {
    const ss = readSS();
    if (ss?.city && ss.city !== 'Near me' && !latlong) {
      setManualCity(ss.city);
      fetchEvents(null, ss.city, null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fetchEvents = useCallback(async (ll, cityOverride, keyword, bust = false) => {
    // Don't fetch until we have a location, city, or keyword
    if (!ll && !cityOverride && !keyword) return;

    // Cancel any previous in-flight fetch
    abortRef.current?.abort();
    abortRef.current = new AbortController();
    const signal = abortRef.current.signal;

    setLoading(true);
    setTmError(false);
    setNetworkError(false);
    setPgError(false);
    setPartialData(false);
    setTruncated(false);
    const now = Date.now();
    const tmParams = { size: 40 };
    if (ll) { tmParams.latlong = ll; tmParams.radius = '50'; }
    else if (cityOverride) { tmParams.city = cityOverride; }
    if (keyword) { tmParams.keyword = keyword; }

    if (bust) bustTMCache(tmParams);

    try {
      // Decouple PG and TM fetches — TM failure must not block PG results.
      const pgQuery = buildPGQuery({ keyword, cityOverride, ll });
      const pgLimit = keyword ? PG_SEARCH_LIMIT : PG_BROWSE_LIMIT;
      const [localResult, tmResult] = await Promise.allSettled([
        fetchPGEvents(pgQuery, pgLimit),
        fetchTMEvents(base44, tmParams),
      ]);

      if (signal.aborted) return;

      // M0.2: Use the shared event-source merger — fixes the tmResult.value contract
      // mismatch (fetchTMEvents returns { events, fromCache }, not an array).
      const merged = mergeEventSources({
        localResult, tmResult,
        filters: { cityOverride, ll, keyword, isAdmin, now },
      });

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
  }, []);



  const handleNearMe = () => {
    setEditingLocation(false);
    requestLocation();
  };

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

  const { containerRef, pulling } = usePullToRefresh(() => {
    const ll = latlongRef.current || null;
    const city = !ll && locationLabelRef.current && locationLabelRef.current !== 'Near me' ? locationLabelRef.current : null;
    fetchEvents(ll, city, null, true);
  });

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

      {/* ── Location + Search ── */}
      <div className="px-4 mt-3 mb-4 space-y-2">
        {/* Location chip — when set, show as accent pill */}
        {locationLabel && !editingLocation && (
          <div className="flex items-center gap-2">
            <button
              onClick={() => { setLocationInput(locationLabel === 'Near me' ? '' : locationLabel); setEditingLocation(true); }}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-full transition-all active:scale-[0.98]"
              style={{ background: 'rgba(var(--neon-purple-rgb),0.12)', border: '1px solid rgba(var(--neon-purple-rgb),0.3)' }}
            >
              <MapPin className="w-3 h-3 flex-shrink-0" style={{ color: 'var(--neon-purple)' }} />
              <span className="text-xs font-semibold truncate max-w-[120px]" style={{ color: 'var(--neon-purple)' }}>
                {locationStatus === 'requesting' ? 'Detecting…' : locationLabel}
              </span>
              <span className="text-[10px] opacity-60" style={{ color: 'var(--neon-purple)' }}>· change</span>
            </button>
            {locationLabel === 'Near me' && (
              <button
                onClick={() => { refreshLocation(); fetchEvents(latlongRef.current || null, null, null, true); }}
                disabled={locationStatus === 'requesting'}
                title="Refresh nearby events"
                aria-label="Refresh nearby events"
                className="flex items-center justify-center w-7 h-7 rounded-full flex-shrink-0 transition-all active:scale-95 disabled:opacity-50"
                style={{ background: 'rgba(var(--neon-purple-rgb),0.1)', border: '1px solid rgba(var(--neon-purple-rgb),0.25)' }}
              >
                <RefreshCw className={`w-3 h-3 ${locationStatus === 'requesting' ? 'animate-spin' : ''}`} style={{ color: 'var(--neon-purple)' }} />
              </button>
            )}
          </div>
        )}

        {/* City search with autocomplete dropdown — only show when no location set */}
        {!locationLabel && (
          <LocationAutocomplete
            value={locationInput}
            onChange={setLocationInput}
            onSelect={(s) => {
              setManualCity(s.label);
              setEditingLocation(false);
              writeSS({ city: s.label, locationInput: s.label });
              fetchEvents(null, s.label, null);
            }}
            onSubmit={(val) => {
              setManualCity(val);
              setEditingLocation(false);
              writeSS({ city: val, locationInput: val });
              fetchEvents(null, val, null);
            }}
            onNearMe={handleNearMe}
            nearMeLoading={locationStatus === 'requesting'}
            placeholder="Search city or event…"
          />
        )}
      </div>

      {/* ── Event search ── */}
      <div className="px-4 mb-4">
        <form onSubmit={(e) => {
          e.preventDefault();
          const ll = latlongRef.current || null;
          const city = !ll && locationLabelRef.current && locationLabelRef.current !== 'Near me' ? locationLabelRef.current : null;
          fetchEvents(ll, city, keyword.trim() || null);
        }}>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input
              type="text"
              value={keyword}
              onChange={e => setKeyword(e.target.value)}
              placeholder="Search events, artists, teams, venues…"
              className="w-full pl-9 pr-4 py-2.5 rounded-full text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
              style={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))' }}
            />
          </div>
        </form>
      </div>

      {/* ── Sort by Date ── */}
      <div className="px-4 mb-4 flex items-center gap-2">
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
          <button onClick={() => fetchEvents(latlongRef.current || null, null, null, true)}
            className="flex items-center gap-1 text-xs font-bold underline underline-offset-2 flex-shrink-0">
            <RefreshCw className="w-3 h-3" /> Retry
          </button>
        </div>
      )}
      {networkError && !tmError && (
        <div className="mx-4 mb-3 px-4 py-3 rounded-2xl text-sm font-medium flex items-center justify-between gap-3"
          style={{ background: 'rgba(var(--neon-pink-rgb), 0.08)', border: '1px solid rgba(var(--neon-pink-rgb), 0.2)', color: 'var(--neon-pink)' }}>
          <span>Failed to load events. Check your connection.</span>
          <button onClick={() => fetchEvents(latlongRef.current || null, null, null, true)}
            className="flex items-center gap-1 text-xs font-bold underline underline-offset-2 flex-shrink-0">
            <RefreshCw className="w-3 h-3" /> Retry
          </button>
        </div>
      )}
      {/* M0.1: PG-source failure (distinct from TM failure) */}
      {pgError && !networkError && (
        <div className="mx-4 mb-3 px-4 py-3 rounded-2xl text-sm font-medium flex items-center justify-between gap-3"
          style={{ background: 'rgba(var(--neon-pink-rgb), 0.08)', border: '1px solid rgba(var(--neon-pink-rgb), 0.2)', color: 'var(--neon-pink)' }}>
          <span>Could not load Peanut Gallery events. Showing Ticketmaster only.</span>
          <button onClick={() => fetchEvents(latlongRef.current || null, null, null, true)}
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
        {!loading && (locationLabel || latlong) && filtered.length > 0 && (
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
      ) : !loading && !latlong && !locationLabel ? (
        <EventsEmptyState
          locationStatus={locationStatus}
          onNearMe={requestLocation}
          onEnterCity={() => setEditingLocation(true)}
        />
      ) : filtered.length === 0 ? (
        <div className="px-4">
          <div className="rounded-2xl overflow-hidden relative flex items-center gap-4 px-4 py-4"
            style={{ background: 'hsl(var(--card))', border: '1px solid rgba(var(--neon-purple-rgb),0.15)', minHeight: 72 }}>
            <div className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0"
              style={{ background: 'rgba(var(--neon-purple-rgb),0.1)' }}>
              <MapPin className="w-4 h-4" style={{ color: 'var(--neon-purple)' }} />
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-bold text-foreground text-sm">No events found here</p>
              <p className="text-xs text-muted-foreground">Try a different city or check back soon.</p>
            </div>
            <button onClick={() => setEditingLocation(true)}
              className="flex-shrink-0 text-xs font-bold px-3 py-1.5 rounded-full transition-all active:scale-95"
              style={{ background: 'rgba(var(--neon-purple-rgb),0.12)', border: '1px solid rgba(var(--neon-purple-rgb),0.3)', color: 'var(--neon-purple)' }}>
              Change city
            </button>
          </div>
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