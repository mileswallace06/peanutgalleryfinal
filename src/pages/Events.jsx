import { useState, useEffect, useRef, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { format } from 'date-fns';
import { MapPin, Calendar, Search, ChevronRight, LocateFixed, X, RefreshCw } from 'lucide-react';
import { usePullToRefresh } from '@/hooks/usePullToRefresh';
import { fetchTMEvents, bustTMCache } from '@/lib/tmCache';

export default function Events() {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const searchDebounceRef = useRef(null);

  // Location state — use refs to always have fresh values in callbacks
  const [locationLabel, setLocationLabel] = useState('');
  const [latlong, setLatlong] = useState('');
  const latlongRef = useRef('');
  const locationLabelRef = useRef('');
  const [locationInput, setLocationInput] = useState('');
  const [editingLocation, setEditingLocation] = useState(false);
  const [detectingLocation, setDetectingLocation] = useState(false);
  const searchRef = useRef('');
  const locationInputRef = useRef(null);

  // Keep refs in sync
  const setLatlongSync = (val) => { latlongRef.current = val; setLatlong(val); };
  const setLocationLabelSync = (val) => { locationLabelRef.current = val; setLocationLabel(val); };

  const [tmError, setTmError] = useState(false);
  const [networkError, setNetworkError] = useState(false);
  const [locationDenied, setLocationDenied] = useState(false);
  // Track which TM IDs we've already synced this session to avoid duplicate calls
  const syncedTmIds = useRef(new Set());

  const fetchEvents = useCallback(async (ll, cityOverride, keyword, bust = false) => {
    // Don't fetch until we have a location, city, or keyword
    if (!ll && !cityOverride && !keyword) return;

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
      const status = err?.response?.status || err?.status;
      if (status === 429) {
        setTmError(true);
        console.warn('[Events] Ticketmaster rate-limited (429)');
      } else {
        console.error('[Events] fetchEvents failed:', status, err?.message, err);
        setNetworkError(true);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  // Auto-detect location on mount — use maximumAge to avoid refiring on re-render
  useEffect(() => {
    setDetectingLocation(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const ll = `${pos.coords.latitude},${pos.coords.longitude}`;
        setLatlongSync(ll);
        setLocationLabelSync('Near me');
        setDetectingLocation(false);
        setLocationDenied(false);
        fetchEvents(ll, null, searchRef.current || null);
      },
      (err) => {
        setDetectingLocation(false);
        // code 1 = PERMISSION_DENIED, code 2 = POSITION_UNAVAILABLE, code 3 = TIMEOUT
        if (err.code === 1) {
          setLocationDenied(true);
        }
        setLoading(false);
      },
      { timeout: 8000, enableHighAccuracy: false, maximumAge: 60000 }
    );
  }, [fetchEvents]);

  // Search debounce — 600ms to reduce TM calls while typing
  useEffect(() => {
    searchRef.current = search;
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    searchDebounceRef.current = setTimeout(() => {
      const keyword = search.trim();
      const hasKeyword = keyword.length > 0;

      if (hasKeyword) {
        setLocationLabel(`"${keyword}"`);
        fetchEvents(null, null, keyword);
      } else {
        setLocationLabel(locationLabelRef.current);
        const ll = latlongRef.current || null;
        const city = !ll && locationLabelRef.current && locationLabelRef.current !== 'Near me'
          ? locationLabelRef.current : null;
        fetchEvents(ll, city, null);
      }
    }, 600);
    return () => clearTimeout(searchDebounceRef.current);
  }, [search, fetchEvents]);

  const handleLocationSubmit = (e) => {
    e.preventDefault();
    const val = locationInput.trim();
    if (!val) return;
    setLatlongSync('');
    setLocationLabelSync(val);
    setEditingLocation(false);
    fetchEvents(null, val, searchRef.current || null);
  };

  const [detectError, setDetectError] = useState(false);

  const handleDetectAgain = () => {
    setDetectingLocation(true);
    setDetectError(false);
    if (!navigator.geolocation) {
      setDetectingLocation(false);
      setDetectError(true);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const ll = `${pos.coords.latitude},${pos.coords.longitude}`;
        setLatlongSync(ll);
        setLocationLabelSync('Near me');
        setDetectingLocation(false);
        setDetectError(false);
        setLocationDenied(false);
        setEditingLocation(false);
        fetchEvents(ll, null, searchRef.current || null);
      },
      (err) => {
        console.warn('[Events] geolocation error:', err.code, err.message);
        setDetectingLocation(false);
        if (err.code === 1) {
          setDetectError(true);
          setLocationDenied(true);
        } else {
          // Position unavailable or timeout — permission was granted, just couldn't get a fix
          setDetectError(true);
        }
      },
      { timeout: 10000, enableHighAccuracy: false, maximumAge: 0 }
    );
  };

  // Local filter handles PG events; TM events are already filtered server-side by keyword
  const filtered = events.filter(e => {
    if (!search) return true;
    const q = search.toLowerCase();
    // TM events were already filtered by keyword in the API call — always show them
    if (e.source === 'ticketmaster') return true;
    return (
      e.title?.toLowerCase().includes(q) ||
      e.city?.toLowerCase().includes(q) ||
      e.state?.toLowerCase().includes(q) ||
      e.venue?.toLowerCase().includes(q) ||
      e.artist?.toLowerCase().includes(q)
    );
  });

  const { containerRef, pulling } = usePullToRefresh(() => {
    fetchEvents(
      latlongRef.current || null,
      locationLabelRef.current && locationLabelRef.current !== 'Near me' ? locationLabelRef.current : null,
      searchRef.current || null,
      true // bust cache on manual refresh
    );
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
        {editingLocation && (
          <form onSubmit={handleLocationSubmit} className="flex gap-2">
            <div className="relative flex-1">
              <MapPin className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: '#00C8FF' }} />
              <input
                ref={locationInputRef}
                autoFocus
                type="text"
                placeholder="City, e.g. Phoenix…"
                value={locationInput}
                onChange={e => setLocationInput(e.target.value)}
                className="w-full pl-9 pr-3 py-3 rounded-2xl text-sm font-medium text-foreground placeholder:text-muted-foreground focus:outline-none"
                style={{ background: 'hsl(var(--card))', border: '1px solid rgba(0,200,255,0.35)', boxShadow: '0 0 0 3px rgba(0,200,255,0.08)' }}
              />
            </div>
            <button type="button" onClick={handleDetectAgain} disabled={detectingLocation} title="Use my location"
              className="flex items-center justify-center w-11 h-11 rounded-2xl flex-shrink-0 transition-all active:scale-95 disabled:opacity-60"
              style={{ background: detectError ? 'rgba(255,45,120,0.12)' : 'rgba(0,200,255,0.12)', border: `1px solid ${detectError ? 'rgba(255,45,120,0.3)' : 'rgba(0,200,255,0.3)'}`, color: detectError ? '#FF2D78' : '#00C8FF' }}>
              {detectingLocation
                ? <span className="w-4 h-4 border-2 border-t-transparent rounded-full animate-spin" style={{ borderColor: '#00C8FF', borderTopColor: 'transparent' }} />
                : <LocateFixed className="w-4 h-4" />
              }
            </button>
            <button type="button" onClick={() => setEditingLocation(false)}
              className="flex items-center justify-center w-11 h-11 rounded-2xl flex-shrink-0 transition-all active:scale-95"
              style={{ background: 'hsl(var(--muted))', border: '1px solid hsl(var(--border))', color: 'hsl(var(--muted-foreground))' }}>
              <X className="w-4 h-4" />
            </button>
            <button type="submit"
              className="px-4 py-3 rounded-2xl font-black text-sm flex-shrink-0 transition-all active:scale-95"
              style={{ background: 'linear-gradient(135deg, #00C8FF, #BF5FFF)', color: '#fff' }}>
              Go
            </button>
          </form>
        )}
        {editingLocation && detectError && (
          <p className="text-[11px] mt-1.5 px-1" style={{ color: '#FF2D78' }}>
            Location access denied. Check your browser/device settings, or type your city above.
          </p>
        )}
        {!editingLocation && (
          <button
            onClick={() => { setLocationInput(locationLabel === 'Near me' ? '' : locationLabel); setEditingLocation(true); }}
            className="flex items-center gap-3 w-full px-4 py-3 rounded-2xl transition-all active:scale-[0.98]"
            style={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))' }}
          >
            <div className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0"
              style={{ background: 'rgba(0,200,255,0.15)', border: '1px solid rgba(0,200,255,0.3)' }}>
              {detectingLocation
                ? <span className="w-3.5 h-3.5 border-2 border-t-transparent rounded-full animate-spin" style={{ borderColor: '#00C8FF', borderTopColor: 'transparent' }} />
                : <MapPin className="w-4 h-4" style={{ color: '#00C8FF' }} />
              }
            </div>
            <div className="text-left flex-1 min-w-0">
              <p className="text-[10px] font-black tracking-widest uppercase text-muted-foreground">Showing events near</p>
              <p className="text-sm font-bold text-foreground truncate">
                {detectingLocation ? 'Detecting location…' : locationLabel || 'Set location'}
              </p>
            </div>
            <span className="text-xs font-bold px-2.5 py-1 rounded-full flex-shrink-0"
              style={{ background: 'hsl(var(--muted))', color: 'hsl(var(--muted-foreground))' }}>
              Change
            </span>
          </button>
        )}

        {/* Search bar */}
        <div className="relative">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search events, venues, cities..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-3 rounded-2xl text-sm font-medium text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
            style={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))' }}
          />
        </div>
      </div>

      {/* ── Rate limit / network error ── */}
      {tmError && (
        <div className="mx-4 mb-3 px-4 py-3 rounded-2xl text-sm font-medium flex items-center justify-between gap-3"
          style={{ background: 'rgba(255,140,0,0.1)', border: '1px solid rgba(255,140,0,0.3)', color: '#FF8C00' }}>
          <span>Too many requests right now. Please wait a moment.</span>
          <button onClick={() => fetchEvents(latlongRef.current || null, null, searchRef.current || null, true)}
            className="flex items-center gap-1 text-xs font-bold underline underline-offset-2 flex-shrink-0">
            <RefreshCw className="w-3 h-3" /> Retry
          </button>
        </div>
      )}
      {networkError && !tmError && (
        <div className="mx-4 mb-3 px-4 py-3 rounded-2xl text-sm font-medium flex items-center justify-between gap-3"
          style={{ background: 'rgba(255,45,120,0.1)', border: '1px solid rgba(255,45,120,0.3)', color: '#FF2D78' }}>
          <span>Failed to load events. Check your connection.</span>
          <button onClick={() => fetchEvents(latlongRef.current || null, null, searchRef.current || null, true)}
            className="flex items-center gap-1 text-xs font-bold underline underline-offset-2 flex-shrink-0">
            <RefreshCw className="w-3 h-3" /> Retry
          </button>
        </div>
      )}

      {/* ── Event count ── */}
      {!loading && (
        <div className="px-4 mb-3">
          <p className="text-xs text-muted-foreground font-medium">
            {filtered.length} event{filtered.length !== 1 ? 's' : ''} near you
          </p>
        </div>
      )}

      {/* ── List ── */}
      {loading ? (
        <div className="px-4 space-y-3">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="rounded-2xl h-28 animate-pulse" style={{ background: 'rgba(255,255,255,0.05)' }} />
          ))}
        </div>
      ) : !loading && !latlong && !locationLabel && !search ? (
        <div className="text-center py-16 text-muted-foreground px-4 space-y-4">
          <p className="text-4xl">📍</p>
          <div>
            <p className="font-medium text-foreground">Location access needed</p>
            <p className="text-sm mt-1 opacity-70">Allow location or enter your city to find events near you</p>
          </div>
          {locationDenied && (
            <div className="text-left px-4 py-3 rounded-2xl mx-auto max-w-xs"
              style={{ background: 'rgba(255,140,0,0.08)', border: '1px solid rgba(255,140,0,0.25)' }}>
              <p className="text-xs font-black" style={{ color: '#FF8C00' }}>Location access blocked</p>
              <p className="text-[11px] text-muted-foreground mt-0.5">Go to your browser or device <strong>Settings → Site permissions → Location</strong> and allow this site, then refresh.</p>
            </div>
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
          <Link
            to={`/events/tm/${event.tm_id || String(event.id).replace('tm_', '')}`}
            className="flex items-center gap-1 px-3 py-2 rounded-xl font-bold text-xs whitespace-nowrap"
            style={{ background: 'hsl(var(--primary))', color: 'hsl(var(--primary-foreground))' }}
          >
            View <ChevronRight className="w-3.5 h-3.5" />
          </Link>
        ) : (
          <Link
            to={`/events/${event.id}`}
            className="flex items-center gap-1 px-3 py-2 rounded-xl font-bold text-xs whitespace-nowrap"
            style={{ background: 'hsl(var(--primary))', color: 'hsl(var(--primary-foreground))' }}
          >
            View <ChevronRight className="w-3.5 h-3.5" />
          </Link>
        )}
      </div>
    </div>
  );
}