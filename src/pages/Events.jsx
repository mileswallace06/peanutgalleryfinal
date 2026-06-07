import { useState, useRef, useCallback, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { format } from 'date-fns';
import { MapPin, Calendar, ChevronRight, LocateFixed, RefreshCw, ShieldCheck } from 'lucide-react';
import { getEventLiveStatus } from '@/lib/eventTiming';
import { getEventUrl } from '@/lib/eventUrl';
import { logNavEvent } from '@/lib/navLogger';
import { usePullToRefresh } from '@/hooks/usePullToRefresh';
import { fetchTMEvents, bustTMCache } from '@/lib/tmCache';
import { useLocationDetect } from '@/hooks/useLocationDetect';
import LocationAutocomplete from '@/components/LocationAutocomplete';
import EventsEmptyState from '@/components/events/EventsEmptyState';

// ── sessionStorage helpers ────────────────────────────────────────────────
const SS_KEY = 'pg_events_location';
function readSS() {
  try { return JSON.parse(sessionStorage.getItem(SS_KEY) || 'null'); } catch { return null; }
}
function writeSS(data) {
  try { sessionStorage.setItem(SS_KEY, JSON.stringify(data)); } catch {}
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
    const now = Date.now();
    const tmParams = { size: 40 };
    if (ll) { tmParams.latlong = ll; tmParams.radius = '50'; }
    else if (cityOverride) { tmParams.city = cityOverride; }
    if (keyword) { tmParams.keyword = keyword; }

    if (bust) bustTMCache(tmParams);

    try {
      const [localData, { events: tmEventsRaw }] = await Promise.all([
        base44.entities.Event.list('date', 50),
        fetchTMEvents(base44, tmParams),
      ]);

      const eligible = localData.filter(e => e.status !== 'ended');
      const pgEvents = isAdmin
        ? eligible
        : eligible.filter(e => !e.date || now < new Date(e.date).getTime());
      let pgFiltered = pgEvents.filter(e => !e.is_beta_live);

      if (cityOverride) {
        const cityLower = cityOverride.toLowerCase();
        pgFiltered = pgFiltered.filter(e =>
          e.city?.toLowerCase().includes(cityLower) ||
          e.venue?.toLowerCase().includes(cityLower)
        );
      }
      if (ll) {
        const tmCities = new Set(tmEventsRaw.map(e => e.city?.toLowerCase()).filter(Boolean));
        if (tmCities.size > 0) {
          pgFiltered = pgFiltered.filter(e => !e.city || tmCities.has(e.city.toLowerCase()));
        } else {
          pgFiltered = [];
        }
      }

      if (signal.aborted) return;
      const pgMapped = pgFiltered.map(e => ({ ...e, source: 'pg' }));
      const tmEvents = tmEventsRaw.map(e => ({ ...e, id: `tm_${e.tm_id}`, source: 'ticketmaster' }));
      setEvents([...pgMapped, ...tmEvents]);

      // Persist TM events locally so they survive past start time.
      // SESSION DEDUP: only sync each tm_id once per session to prevent duplicate DB records.
      // The syncTMEvent function is an upsert, but concurrent calls from multiple tabs/renders
      // can still create duplicates if the first write hasn't committed before the second read.
      const toSync = tmEventsRaw.filter(e => e.tm_id && !syncedTmIds.current.has(e.tm_id));
      toSync.forEach(e => syncedTmIds.current.add(e.tm_id)); // mark BEFORE async call
      // Serialize syncs to avoid write races — stagger by 200ms per event
      toSync.forEach((e, i) => {
        setTimeout(() => {
          base44.functions.invoke('syncTMEvent', {
            tm_id: e.tm_id, title: e.title, venue: e.venue, city: e.city,
            state: e.state, date: e.date, image_url: e.image_url,
            tm_url: e.tm_url, category: e.category || null,
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

  const filtered = events;

  const { containerRef, pulling } = usePullToRefresh(() => {
    const ll = latlongRef.current || null;
    const city = !ll && locationLabelRef.current && locationLabelRef.current !== 'Near me' ? locationLabelRef.current : null;
    fetchEvents(ll, city, null, true);
  });

  return (
    <div ref={containerRef} className="pb-32 transition-transform duration-200">
      {pulling && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-40 flex items-center gap-2 px-4 py-2 rounded-full"
          style={{ background: 'rgba(191,95,255,0.15)', border: '1px solid rgba(191,95,255,0.3)' }}>
          <RefreshCw className="w-3.5 h-3.5 animate-spin" style={{ color: '#BF5FFF' }} />
          <span className="text-xs font-semibold" style={{ color: '#BF5FFF' }}>Refreshing…</span>
        </div>
      )}

      {/* ── Hero ── */}
      <div className="relative h-56 overflow-hidden" style={{ marginTop: 'env(safe-area-inset-top)' }}>
        <img
          src="https://images.unsplash.com/photo-1429962714451-bb934ecdc4ec?w=1200&q=85"
          alt="crowd"
          className="w-full h-full object-cover object-center"
        />
        {/* Dark overlay — heavy at bottom */}
        <div
          className="absolute inset-0"
          style={{ background: 'linear-gradient(to bottom, rgba(5,3,12,0.45) 0%, rgba(5,3,12,0.2) 40%, rgba(5,3,12,0.92) 100%)' }}
        />
        {/* Purple accent wash */}
        <div
          className="absolute inset-0"
          style={{ background: 'linear-gradient(160deg, rgba(191,95,255,0.22) 0%, transparent 55%)' }}
        />
        {/* Extra text-area darkening */}
        <div
          className="absolute bottom-0 left-0 right-0 h-36"
          style={{ background: 'linear-gradient(to top, rgba(0,0,0,0.65), transparent)' }}
        />



        {/* Headline */}
        <div className="absolute bottom-5 left-4 right-4">
          <h1
            className="font-display text-white leading-[0.95]"
            style={{
              fontSize: 'clamp(3rem, 14vw, 5rem)',
              letterSpacing: '-0.02em',
              filter: 'drop-shadow(0 4px 16px rgba(0,0,0,0.7))',
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
              style={{ background: 'rgba(191,95,255,0.12)', border: '1px solid rgba(191,95,255,0.3)' }}
            >
              <MapPin className="w-3 h-3 flex-shrink-0" style={{ color: '#BF5FFF' }} />
              <span className="text-xs font-semibold truncate max-w-[120px]" style={{ color: '#BF5FFF' }}>
                {locationStatus === 'requesting' ? 'Detecting…' : locationLabel}
              </span>
              <span className="text-[10px] opacity-60" style={{ color: '#BF5FFF' }}>· change</span>
            </button>
            {locationLabel === 'Near me' && (
              <button
                onClick={() => { refreshLocation(); fetchEvents(latlongRef.current || null, null, null, true); }}
                disabled={locationStatus === 'requesting'}
                title="Refresh nearby events"
                aria-label="Refresh nearby events"
                className="flex items-center justify-center w-7 h-7 rounded-full flex-shrink-0 transition-all active:scale-95 disabled:opacity-50"
                style={{ background: 'rgba(191,95,255,0.1)', border: '1px solid rgba(191,95,255,0.25)' }}
              >
                <RefreshCw className={`w-3 h-3 ${locationStatus === 'requesting' ? 'animate-spin' : ''}`} style={{ color: '#BF5FFF' }} />
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

      {/* ── Rate limit / network error ── */}
      {tmError && (
        <div className="mx-4 mb-3 px-4 py-3 rounded-2xl text-sm font-medium flex items-center justify-between gap-3"
          style={{ background: 'rgba(255,140,0,0.1)', border: '1px solid rgba(255,140,0,0.3)', color: '#FF8C00' }}>
          <span>Too many requests right now. Please wait a moment.</span>
          <button onClick={() => fetchEvents(latlongRef.current || null, null, null, true)}
            className="flex items-center gap-1 text-xs font-bold underline underline-offset-2 flex-shrink-0">
            <RefreshCw className="w-3 h-3" /> Retry
          </button>
        </div>
      )}
      {networkError && !tmError && (
        <div className="mx-4 mb-3 px-4 py-3 rounded-2xl text-sm font-medium flex items-center justify-between gap-3"
          style={{ background: 'rgba(255,45,120,0.1)', border: '1px solid rgba(255,45,120,0.3)', color: '#FF2D78' }}>
          <span>Failed to load events. Check your connection.</span>
          <button onClick={() => fetchEvents(latlongRef.current || null, null, null, true)}
            className="flex items-center gap-1 text-xs font-bold underline underline-offset-2 flex-shrink-0">
            <RefreshCw className="w-3 h-3" /> Retry
          </button>
        </div>
      )}

      {/* ── Event count + aria-live announcement ── */}
      <div aria-live="polite" aria-atomic="true" className="px-4 mb-4">
        {!loading && (locationLabel || latlong) && filtered.length > 0 && (
          <div className="flex items-center gap-3">
            <div className="h-px flex-1" style={{ background: 'rgba(191,95,255,0.2)' }} />
            <p className="text-[10px] font-bold tracking-widest uppercase" style={{ color: '#BF5FFF' }}>
              {filtered.length} event{filtered.length !== 1 ? 's' : ''}
            </p>
            <div className="h-px flex-1" style={{ background: 'rgba(191,95,255,0.2)' }} />
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
              style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.15)' }}
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
            style={{ background: 'hsl(var(--card))', border: '1px solid rgba(191,95,255,0.15)', minHeight: 72 }}>
            <div className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0"
              style={{ background: 'rgba(191,95,255,0.1)' }}>
              <MapPin className="w-4 h-4" style={{ color: '#BF5FFF' }} />
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-bold text-foreground text-sm">No events found here</p>
              <p className="text-xs text-muted-foreground">Try a different city or check back soon.</p>
            </div>
            <button onClick={() => setEditingLocation(true)}
              className="flex-shrink-0 text-xs font-bold px-3 py-1.5 rounded-full transition-all active:scale-95"
              style={{ background: 'rgba(191,95,255,0.12)', border: '1px solid rgba(191,95,255,0.3)', color: '#BF5FFF' }}>
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
  const debugUrl = getEventUrl(event);

  const handleCardClick = () => {
    logNavEvent({
      result: debugUrl ? 'success' : 'navigation_error',
      event,
      sourcePage: 'Events',
      generatedHref: debugUrl || '',
      lookupMethod: 'none',
      failureReason: debugUrl ? '' : 'getEventUrl returned null — missing id and tm_id',
    });
  };

  return (
    <div
      className="rounded-2xl overflow-hidden flex items-stretch relative"
      style={{
        background: 'hsl(var(--card))',
        border: isLive
          ? '1px solid rgba(191,95,255,0.4)'
          : isSoon
          ? '1px solid rgba(191,95,255,0.2)'
          : '1px solid hsl(var(--border))',
        boxShadow: isLive ? '0 0 24px rgba(191,95,255,0.1)' : 'none',
      }}
    >
      {/* Thumbnail */}
      <div className="w-28 flex-shrink-0 relative overflow-hidden" style={{ minHeight: 120 }}>
        {event.image_url ? (
          <img src={event.image_url} alt={event.title} className="w-full h-full object-cover absolute inset-0" />
        ) : (
          <div className="w-full h-full absolute inset-0 flex items-center justify-center"
            style={{ background: 'linear-gradient(135deg, rgba(191,95,255,0.15), rgba(0,200,255,0.08))' }}>
            <Calendar className="w-6 h-6 opacity-30" style={{ color: '#BF5FFF' }} />
          </div>
        )}
        {isLive && (
          <div className="absolute inset-0 flex flex-col justify-end p-2"
            style={{ background: 'linear-gradient(to top, rgba(0,0,0,0.65) 0%, transparent 55%)' }}>
            <span className="text-[9px] font-black px-1.5 py-0.5 rounded-full self-start"
              style={{ background: '#FF2D78', color: '#fff', letterSpacing: '0.05em' }}>
              LIVE
            </span>
          </div>
        )}
        {/* Subtle purple left-edge accent bar */}
        <div className="absolute left-0 top-0 bottom-0 w-0.5"
          style={{ background: isLive ? 'rgba(191,95,255,0.8)' : isSoon ? 'rgba(191,95,255,0.4)' : 'rgba(191,95,255,0.15)' }} />
      </div>

      {/* Info */}
      <div className="flex-1 px-3 py-3.5 flex flex-col justify-between min-w-0 gap-2">
        <div>
          <h3 className="font-bold text-foreground leading-tight line-clamp-2 mb-1.5" style={{ fontSize: '0.875rem' }}>
            {event.title}
          </h3>
          <div className="space-y-0.5">
            <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <MapPin className="w-3 h-3 flex-shrink-0" style={{ color: '#BF5FFF', opacity: 0.7 }} />
              <span className="truncate">{event.venue}{event.city ? `, ${event.city}` : ''}{event.state ? `, ${event.state}` : ''}</span>
            </div>
            <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <Calendar className="w-3 h-3 flex-shrink-0 opacity-50" />
              <span>{event.date ? format(new Date(event.date), 'EEE, MMM d · h:mm a') : 'TBD'}</span>
            </div>
          </div>
        </div>

        {/* CTA */}
        <div className="flex items-center gap-2">
          {debugUrl ? (
            isLive ? (
              <Link
                to={`/upgrades/${event.id}`}
                className="inline-flex items-center gap-1.5 text-[11px] font-bold px-3 py-1.5 rounded-full"
                style={{ background: 'rgba(191,95,255,0.18)', border: '1px solid rgba(191,95,255,0.4)', color: '#BF5FFF' }}
                onClick={e => e.stopPropagation()}
              >
                Open Live Hub <ChevronRight className="w-3 h-3" />
              </Link>
            ) : (
              <Link
                to={debugUrl}
                className="inline-flex items-center gap-1 text-[11px] font-semibold px-3 py-1.5 rounded-full transition-all active:scale-[0.97]"
                style={{ background: 'rgba(191,95,255,0.1)', border: '1px solid rgba(191,95,255,0.25)', color: '#BF5FFF' }}
                onClick={handleCardClick}
              >
                View tickets <ChevronRight className="w-3 h-3" />
              </Link>
            )
          ) : (
            isSoon && <span className="text-[10px] font-medium text-muted-foreground">Starting soon</span>
          )}
        </div>
      </div>

      {isAdmin && (
        <div className="absolute bottom-1 left-28 right-2 text-[8px] font-mono leading-tight pointer-events-none"
          style={{ color: 'rgba(255,230,0,0.6)' }}>
          id:{String(event.id||'').slice(0,12)} tm:{String(event.tm_id||'-').slice(0,12)} src:{event.source||'?'} → {debugUrl||'NULL'}
        </div>
      )}
    </div>
  );
}