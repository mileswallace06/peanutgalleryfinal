import { useState, useRef, useCallback, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { format } from 'date-fns';
import { MapPin, Calendar, ChevronRight, LocateFixed, RefreshCw } from 'lucide-react';
import { usePullToRefresh } from '@/hooks/usePullToRefresh';
import { fetchTMEvents, bustTMCache } from '@/lib/tmCache';
import { useLocationDetect } from '@/hooks/useLocationDetect';
import LocationAutocomplete from '@/components/LocationAutocomplete';

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
  const [locationInput, setLocationInput] = useState(_ss?.locationInput || '');
  const [editingLocation, setEditingLocation] = useState(false);

  const [tmError, setTmError] = useState(false);
  const [networkError, setNetworkError] = useState(false);
  // Track which TM IDs we've already synced this session to avoid duplicate calls
  const syncedTmIds = useRef(new Set());

  const { locationStatus, latlong, latlongRef, locationLabel, locationLabelRef, requestLocation, setManualCity, setLocationLabelSync, setLatlongSync } = useLocationDetect({
    onSuccess: (ll) => fetchEvents(ll, null, null),
  });

  // Abort controller ref — cancel in-flight fetch when a new one starts or component unmounts
  const abortRef = useRef(null);

  useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  // Restore last city on hard refresh
  useEffect(() => {
    const ss = readSS();
    if (ss?.city && !latlong) {
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
    const adminUnlocked = sessionStorage.getItem('pg_admin_unlocked') === '1';
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
      const pgEvents = adminUnlocked
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
      const tmEvents = tmEventsRaw.map(e => ({ ...e, id: `tm_${e.tm_id}` }));
      setEvents([...pgMapped, ...tmEvents]);

      // Persist TM events locally so they survive past start time
      // Only sync IDs we haven't already synced this session
      tmEventsRaw
        .filter(e => e.tm_id && !syncedTmIds.current.has(e.tm_id))
        .forEach(e => {
          syncedTmIds.current.add(e.tm_id);
          base44.functions.invoke('syncTMEvent', {
            tm_id: e.tm_id, title: e.title, venue: e.venue, city: e.city,
            state: e.state, date: e.date, image_url: e.image_url,
            tm_url: e.tm_url, category: e.category || null,
          }).catch(syncErr => console.warn('[Events] syncTMEvent failed for', e.tm_id, syncErr?.message));
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
          src="https://images.unsplash.com/photo-1493225457124-a3eb161ffa5f?w=900&q=80"
          alt="crowd"
          className="w-full h-full object-cover object-top"
        />
        {/* Dark overlay — heavy at bottom */}
        <div
          className="absolute inset-0"
          style={{ background: 'linear-gradient(to bottom, rgba(5,3,12,0.45) 0%, rgba(5,3,12,0.2) 40%, rgba(5,3,12,0.92) 100%)' }}
        />
        {/* Extra text-area darkening */}
        <div
          className="absolute bottom-0 left-0 right-0 h-36"
          style={{ background: 'linear-gradient(to top, rgba(0,0,0,0.65), transparent)' }}
        />



        <div className="absolute top-5 left-4">
          <span className="text-[10px] font-black tracking-[0.2em] px-3 py-1 rounded-full flex items-center gap-1.5"
          style={{ background: 'rgba(0,0,0,0.5)', color: '#BF5FFF', border: '1px solid rgba(191,95,255,0.4)', backdropFilter: 'blur(12px)' }}>
            🎫 MARKETPLACE
          </span>
        </div>

        {/* Headline */}
        <div className="absolute bottom-5 left-4 right-4">
          <h1
            className="font-display leading-[0.9]"
            style={{
              fontSize: 'clamp(3.2rem, 15vw, 5.2rem)',
              letterSpacing: '-0.02em',
              background: 'linear-gradient(135deg, #BF5FFF 0%, #FF2D78 55%, #FFE600 100%)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              backgroundClip: 'text',
  
              filter: 'drop-shadow(0 6px 24px rgba(0,0,0,0.6))',
            }}
          >
            Get Tickets
          </h1>
          <div className="mt-2 inline-flex items-center gap-2 px-3 py-1.5 rounded-full"
            style={{ background: 'rgba(191,95,255,0.25)', border: '1px solid rgba(191,95,255,0.4)' }}>
            <span className="text-[11px] font-medium leading-snug" style={{ color: 'rgba(240,216,255,0.9)' }}>
              Purchase fan-listed tickets to any event, anywhere — anytime before the show starts.
            </span>
          </div>
        </div>
      </div>

      {/* ── Location + Search ── */}
      <div className="px-4 mt-4 mb-4 space-y-2">
        {/* Location chip — shows current location, tap to change */}
        {locationLabel && !editingLocation && (
          <button
            onClick={() => { setLocationInput(locationLabel === 'Near me' ? '' : locationLabel); setEditingLocation(true); }}
            className="flex items-center gap-2 px-3 py-2 rounded-2xl transition-all active:scale-[0.98]"
            style={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))' }}
          >
            <MapPin className="w-3.5 h-3.5 flex-shrink-0" style={{ color: '#00C8FF' }} />
            <span className="text-xs font-semibold text-foreground truncate max-w-[160px]">
              {locationStatus === 'requesting' ? 'Detecting…' : locationLabel}
            </span>
            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full ml-1 flex-shrink-0"
              style={{ background: 'hsl(var(--muted))', color: 'hsl(var(--muted-foreground))' }}>
              Change
            </span>
          </button>
        )}

        {/* City search with autocomplete dropdown */}
        <LocationAutocomplete
          value={locationInput}
          onChange={setLocationInput}
          onSelect={(s) => {
            console.log('[Events] city selected:', s.label);
            setManualCity(s.label);
            setEditingLocation(false);
            writeSS({ city: s.label, locationInput: s.label });
            fetchEvents(null, s.label, null);
          }}
          onSubmit={(val) => {
            console.log('[Events] city submitted:', val);
            setManualCity(val);
            setEditingLocation(false);
            writeSS({ city: val, locationInput: val });
            fetchEvents(null, val, null);
          }}
          onNearMe={handleNearMe}
          nearMeLoading={locationStatus === 'requesting'}
          placeholder="Search city or event…"
        />
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
      <div
        aria-live="polite"
        aria-atomic="true"
        className="px-4 mb-3"
      >
        {!loading && (locationLabel || latlong) && (
          <p className="text-xs text-muted-foreground font-medium">
            {filtered.length === 0
              ? `No events found${locationLabel ? ` for ${locationLabel}` : ''}`
              : `${filtered.length} event${filtered.length !== 1 ? 's' : ''}${locationLabel ? ` near ${locationLabel}` : ''}`}
          </p>
        )}
      </div>

      {/* ── List ── */}
      {loading ? (
        <div className="px-4 space-y-3">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="rounded-2xl h-28 animate-pulse" style={{ background: 'rgba(255,255,255,0.05)' }} />
          ))}
        </div>
      ) : !loading && !latlong && !locationLabel ? (
        <div className="text-center py-16 text-muted-foreground px-4 space-y-4">
          <p className="text-4xl">📍</p>
          {locationStatus === 'denied' ? (
            <>
              <div>
                <p className="font-medium text-foreground">Location access is blocked</p>
                <p className="text-sm mt-1 opacity-70">Enable location permissions in your browser or search by city.</p>
              </div>
              <button
                onClick={() => setEditingLocation(true)}
                className="mx-auto flex items-center gap-2 px-5 py-3 rounded-full font-bold text-sm"
                style={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))' }}>
                <MapPin className="w-4 h-4" /> Search by city
              </button>
            </>
          ) : (locationStatus === 'unavailable' || locationStatus === 'timeout') ? (
            <>
              <div>
                <p className="font-medium text-foreground">
                  {locationStatus === 'timeout' ? 'Location timed out' : "Couldn't get your location"}
                </p>
                <p className="text-sm mt-1 opacity-70">Try again or enter your city manually.</p>
              </div>
              <div className="flex gap-3 justify-center">
                <button onClick={requestLocation}
                  className="flex items-center gap-2 px-5 py-3 rounded-full font-bold text-sm"
                  style={{ background: 'rgba(0,200,255,0.12)', border: '1px solid rgba(0,200,255,0.3)', color: '#00C8FF' }}>
                  <LocateFixed className="w-4 h-4" /> Try again
                </button>
                <button onClick={() => setEditingLocation(true)}
                  className="flex items-center gap-2 px-5 py-3 rounded-full font-bold text-sm"
                  style={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))' }}>
                  <MapPin className="w-4 h-4" /> Enter city
                </button>
              </div>
            </>
          ) : (
            <>
              <div>
                <p className="font-medium text-foreground">Find events near you</p>
                <p className="text-sm mt-1 opacity-70">Tap Near Me or search by city.</p>
              </div>
              <div className="flex gap-3 justify-center">
                <button onClick={requestLocation}
                  className="flex items-center gap-2 px-5 py-3 rounded-full font-bold text-sm"
                  style={{ background: 'rgba(0,200,255,0.12)', border: '1px solid rgba(0,200,255,0.3)', color: '#00C8FF' }}>
                  <LocateFixed className="w-4 h-4" /> Near Me
                </button>
                <button onClick={() => setEditingLocation(true)}
                  className="flex items-center gap-2 px-5 py-3 rounded-full font-bold text-sm"
                  style={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))' }}>
                  <MapPin className="w-4 h-4" /> Enter city
                </button>
              </div>
            </>
          )}
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-20 text-muted-foreground px-4">
          <p className="text-4xl mb-3">🥜</p>
          <p className="font-medium">No events found nearby</p>
          <p className="text-sm mt-1 opacity-70">Try a different city or search term</p>
        </div>
      ) : (
        <div className="px-4 space-y-3">
          {filtered.map(event => (
            <EventRow key={event.id} event={event} />
          ))}
        </div>
      )}
    </div>
  );
}

function EventRow({ event }) {
  // A TM event has source='ticketmaster' AND a tm_id but no real DB id (or id starts with tm_)
  const isTM = event.source === 'ticketmaster' || String(event.id || '').startsWith('tm_');

  return (
    <div
      className="rounded-2xl overflow-hidden flex items-stretch dark:border-[rgba(255,255,255,0.09)]"
      style={{
        background: 'var(--card)',
        border: '1px solid var(--border)',
        boxShadow: '0 4px 24px rgba(0,0,0,0.1)',
      }}
    >
      {/* Thumbnail */}
      <div className="w-28 h-full flex-shrink-0 relative overflow-hidden" style={{ minHeight: 110 }}>
        {event.image_url ? (
          <img src={event.image_url} alt={event.title} className="w-full h-full object-cover absolute inset-0" />
        ) : (
          <div className="w-full h-full absolute inset-0 flex items-center justify-center text-4xl" style={{ background: 'rgba(255,255,255,0.04)' }}>
            🎫
          </div>
        )}
        {event.status === 'live' && (
          <span className="absolute top-2 left-2 text-[9px] font-black px-1.5 py-0.5 rounded-full"
            style={{ background: '#FF2D78', color: '#fff' }}>
            LIVE
          </span>
        )}
        {isTM && (
          <span className="absolute bottom-1.5 left-1.5 text-[8px] font-bold px-1.5 py-0.5 rounded-full"
            style={{ background: 'rgba(0,0,0,0.7)', color: 'rgba(255,255,255,0.6)' }}>
            TM
          </span>
        )}
      </div>

      {/* Info */}
      <div className="flex-1 px-4 py-3.5 flex flex-col justify-between min-w-0">
        <div>
          <h3 className="font-bold text-foreground text-sm leading-tight mb-2 line-clamp-2">{event.title}</h3>
          <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground mb-1">
            <MapPin className="w-3 h-3 flex-shrink-0" style={{ color: '#00C8FF' }} />
            <span className="truncate">
              {event.venue}{event.city ? `, ${event.city}` : ''}{event.state ? `, ${event.state}` : ''}
            </span>
          </div>
          <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <Calendar className="w-3 h-3 flex-shrink-0" style={{ color: '#BF5FFF' }} />
            <span>{event.date ? format(new Date(event.date), 'EEE, MMM d · h:mm a') : 'TBD'}</span>
          </div>
        </div>

        {/* List your seats tag — only for PG events */}
        {!isTM && (
        <div className="mt-2.5">
          <Link
            to="/create-listing"
            className="inline-flex items-center gap-1 text-[10px] font-bold px-2.5 py-1 rounded-full bg-muted text-muted-foreground border border-border"
            onClick={e => e.stopPropagation()}
          >
            🥜 List your seats
          </Link>
        </div>
        )}
        {isTM && (
        <div className="mt-2.5">
          <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2.5 py-1 rounded-full bg-muted text-muted-foreground border border-border">
            🎟️ Official tickets
          </span>
        </div>
        )}
      </div>

      {/* View button */}
      <div className="flex items-center pr-3 pl-1">
        {isTM ? (
          (() => {
            const tmId = event.tm_id || String(event.id || '').replace('tm_', '');
            if (!tmId || tmId === 'undefined') {
              console.warn('[EventRow] TM event missing tm_id — suppressing View link', event);
              return (
                <span className="px-3 py-2 rounded-xl text-xs text-muted-foreground opacity-60 whitespace-nowrap">
                  Unavailable
                </span>
              );
            }
            return (
              <Link
                to={`/events/tm/${tmId}`}
                className="flex items-center gap-1 px-3 py-2 rounded-xl font-bold text-xs whitespace-nowrap"
                style={{ background: 'hsl(var(--primary))', color: 'hsl(var(--primary-foreground))' }}
              >
                View <ChevronRight className="w-3.5 h-3.5" />
              </Link>
            );
          })()
        ) : (
          (() => {
            if (!event.id) {
              console.warn('[EventRow] PG event missing id — suppressing View link', event);
              return (
                <span className="px-3 py-2 rounded-xl text-xs text-muted-foreground opacity-60 whitespace-nowrap">
                  Unavailable
                </span>
              );
            }
            return (
              <Link
                to={`/events/${event.id}`}
                className="flex items-center gap-1 px-3 py-2 rounded-xl font-bold text-xs whitespace-nowrap"
                style={{ background: 'hsl(var(--primary))', color: 'hsl(var(--primary-foreground))' }}
              >
                View <ChevronRight className="w-3.5 h-3.5" />
              </Link>
            );
          })()
        )}
      </div>
    </div>
  );
}