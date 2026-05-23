import { useState, useRef, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { format } from 'date-fns';
import { MapPin, Calendar, Zap, ChevronRight, LocateFixed, X, Clock, RefreshCw } from 'lucide-react';
import LocationAutocomplete from '@/components/LocationAutocomplete';
import { getEventLiveStatus, SOON_WINDOW_MINUTES } from '@/lib/eventTiming';
import { usePullToRefresh } from '@/hooks/usePullToRefresh';
import { fetchTMEvents, bustTMCache } from '@/lib/tmCache';
import { useLocationDetect } from '@/hooks/useLocationDetect';

export default function Upgrades() {
  const [allEvents, setAllEvents] = useState([]);
  const [loading, setLoading] = useState(false);
  const [locationInput, setLocationInput] = useState('');
  const [editingLocation, setEditingLocation] = useState(false);

  const [tmError, setTmError] = useState(false);

  const { locationStatus, latlong, latlongRef, locationLabel, locationLabelRef, requestLocation, setManualCity } = useLocationDetect({
    onSuccess: (ll) => fetchEvents(ll, null),
  });

  const fetchEvents = useCallback(async (ll, cityOverride, bust = false) => {
    if (!ll && !cityOverride) return;

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

      setAllEvents([...pgMapped, ...uniqueTM]);
    } catch (err) {
      if (err?.response?.status === 429) setTmError(true);
      else console.error(err);
    } finally {
      setLoading(false);
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
    <div ref={containerRef} className="pb-32 transition-transform duration-200">
      {pulling && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-40 flex items-center gap-2 px-4 py-2 rounded-full"
          style={{ background: 'rgba(0,255,135,0.15)', border: '1px solid rgba(0,255,135,0.3)' }}>
          <RefreshCw className="w-3.5 h-3.5 animate-spin" style={{ color: '#00FF87' }} />
          <span className="text-xs font-semibold" style={{ color: '#00FF87' }}>Refreshing…</span>
        </div>
      )}
      {/* Hero */}
      <div className="relative h-52 overflow-hidden" style={{ marginTop: 'env(safe-area-inset-top)' }}>
        <img
          src="https://images.unsplash.com/photo-1470229722913-7c0e2dbbafd3?w=900&q=80"
          alt="Upgrades"
          className="w-full h-full object-cover object-top"
        />
        <div className="absolute inset-0"
          style={{ background: 'linear-gradient(to bottom, rgba(5,3,12,0.4) 0%, rgba(5,3,12,0.2) 40%, rgba(5,3,12,0.95) 100%)' }} />

        <div className="absolute top-5 left-4">
          <span className="text-[10px] font-black tracking-[0.2em] px-3 py-1 rounded-full flex items-center gap-1.5"
            style={{ background: 'rgba(0,0,0,0.5)', color: '#00FF87', border: '1px solid #00FF8755', backdropFilter: 'blur(12px)' }}>
            ⚡ THE PEANUT GALLERY
          </span>
        </div>

        <div className="absolute bottom-5 left-4 right-4">
          <h1 className="font-display mb-3"
            style={{
              fontSize: 'clamp(3.2rem, 15vw, 5.2rem)',
              letterSpacing: '-0.02em',
              lineHeight: 1.1,
              background: 'linear-gradient(135deg, #00FF87 0%, #00C8FF 60%, #BF5FFF 100%)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              backgroundClip: 'text',
              filter: 'drop-shadow(0 6px 24px rgba(0,0,0,0.6))'
            }}>
            Upgrades
          </h1>
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full"
            style={{ background: 'rgba(0,255,135,0.15)', border: '1px solid rgba(0,255,135,0.35)' }}>
            <Zap className="w-3 h-3 flex-shrink-0" style={{ color: '#00FF87' }} />
            <span className="text-[11px] font-medium leading-snug" style={{ color: 'rgba(210,255,235,0.9)' }}>
              Already at the show? Upgrade seats from fans around you — location-verified.
            </span>
          </div>
        </div>
      </div>

      {/* Location bar */}
      <div className="px-4 mt-4 mb-5">
        {editingLocation ? (
          <div className="space-y-2">
            <div className="flex gap-2">
              <LocationAutocomplete
                value={locationInput}
                onChange={setLocationInput}
                onSelect={(s) => { setManualCity(s.label); setEditingLocation(false); fetchEvents(null, s.label); }}
                onSubmit={(val) => { setManualCity(val); setEditingLocation(false); fetchEvents(null, val); }}
                onNearMe={handleNearMe}
                nearMeLoading={locationStatus === 'requesting'}
                autoFocus
              />
              <button type="button" onClick={() => setEditingLocation(false)}
                className="flex items-center justify-center w-11 h-11 rounded-2xl flex-shrink-0 transition-all active:scale-95"
                style={{ background: 'hsl(var(--muted))', border: '1px solid hsl(var(--border))', color: 'hsl(var(--muted-foreground))' }}>
                <X className="w-4 h-4" />
              </button>
            </div>
            {locationStatus === 'denied' && (
              <p className="text-[11px] px-1" style={{ color: '#FF8C00' }}>
                Location access is blocked. Enable it in your browser settings or type your city above.
              </p>
            )}
            {(locationStatus === 'unavailable' || locationStatus === 'timeout') && (
              <p className="text-[11px] px-1" style={{ color: '#FF8C00' }}>
                {locationStatus === 'timeout'
                  ? "Location timed out. Try again or enter your city above."
                  : "Couldn't get your location. Try again or enter your city above."}
              </p>
            )}
          </div>
        ) : locationStatus === 'denied' && !locationLabel ? (
          <div className="space-y-2">
            <div className="flex items-start gap-3 px-4 py-3.5 rounded-2xl"
              style={{ background: 'rgba(255,140,0,0.08)', border: '1px solid rgba(255,140,0,0.25)' }}>
              <div className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0 mt-0.5"
                style={{ background: 'rgba(255,140,0,0.15)' }}>
                <MapPin className="w-4 h-4" style={{ color: '#FF8C00' }} />
              </div>
              <div className="text-left flex-1">
                <p className="text-xs font-black" style={{ color: '#FF8C00' }}>Location access is blocked</p>
                <p className="text-[11px] text-muted-foreground mt-0.5">Enable location permissions in your browser or search by city.</p>
              </div>
            </div>
            <button
              onClick={() => { setLocationInput(''); setEditingLocation(true); }}
              className="flex items-center gap-2 w-full px-4 py-3 rounded-2xl transition-all active:scale-[0.98]"
              style={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))' }}
            >
              <MapPin className="w-4 h-4 text-muted-foreground" />
              <span className="text-sm font-bold text-foreground">Search by city instead</span>
            </button>
          </div>
        ) : !locationLabel ? (
          /* idle — prompt user to set location */
          <div className="flex gap-2">
            <button onClick={requestLocation} disabled={locationStatus === 'requesting'}
              className="flex-1 flex items-center justify-center gap-2 py-3 rounded-2xl font-bold text-sm transition-all active:scale-[0.98] disabled:opacity-60"
              style={{ background: 'rgba(0,255,135,0.12)', border: '1px solid rgba(0,255,135,0.3)', color: '#00FF87' }}>
              {locationStatus === 'requesting'
                ? <span className="w-4 h-4 border-2 border-t-transparent rounded-full animate-spin" style={{ borderColor: '#00FF87', borderTopColor: 'transparent' }} />
                : <LocateFixed className="w-4 h-4" />
              }
              Near Me
            </button>
            <button onClick={() => { setLocationInput(''); setEditingLocation(true); }}
              className="flex-1 flex items-center justify-center gap-2 py-3 rounded-2xl font-bold text-sm transition-all active:scale-[0.98]"
              style={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))' }}>
              <MapPin className="w-4 h-4 text-muted-foreground" /> Enter city
            </button>
          </div>
        ) : (
          <button
            onClick={() => { setLocationInput(locationLabel === 'Near me' ? '' : locationLabel); setEditingLocation(true); }}
            className="flex items-center gap-3 w-full px-4 py-3 rounded-2xl transition-all active:scale-[0.98]"
            style={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))' }}
          >
            <div className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0"
              style={{ background: 'rgba(0,180,90,0.25)', border: '1px solid rgba(0,180,90,0.4)' }}>
              {locationStatus === 'requesting'
                ? <span className="w-3.5 h-3.5 border-2 border-t-transparent rounded-full animate-spin" style={{ borderColor: '#00FF87', borderTopColor: 'transparent' }} />
                : <MapPin className="w-4 h-4" style={{ color: '#00a855' }} />
              }
            </div>
            <div className="text-left flex-1 min-w-0">
              <p className="text-[10px] font-black tracking-widest uppercase text-muted-foreground">Showing events near</p>
              <p className="text-sm font-bold text-foreground truncate">{locationLabel}</p>
            </div>
            <span className="text-xs font-bold px-2.5 py-1 rounded-full flex-shrink-0"
              style={{ background: 'hsl(var(--muted))', color: 'hsl(var(--muted-foreground))' }}>
              Change
            </span>
          </button>
        )}
      </div>

      {/* Rate limit error */}
      {tmError && (
        <div className="mx-4 mb-3 px-4 py-3 rounded-2xl text-sm font-medium"
          style={{ background: 'rgba(255,140,0,0.1)', border: '1px solid rgba(255,140,0,0.3)', color: '#FF8C00' }}>
          Too many requests right now. Please wait a moment and try again.
        </div>
      )}

      {/* Content */}
      <div className="px-4 space-y-8">
        {!loading && locationStatus === 'idle' && !locationLabel && (
          <div className="rounded-2xl px-4 py-8 text-center"
            style={{ background: 'rgba(0,200,255,0.05)', border: '1px solid rgba(0,200,255,0.15)' }}>
            <p className="text-3xl mb-3">📍</p>
            <p className="text-sm font-bold text-foreground">Set your location to get started</p>
            <p className="text-xs text-muted-foreground mt-1">Tap "Near Me" or enter a city above</p>
          </div>
        )}
        {loading ? (
          <div className="space-y-3">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="rounded-2xl h-24 animate-pulse bg-muted" />
            ))}
          </div>
        ) : (locationStatus === 'granted' || locationLabel) && (
          <>
            {/* LIVE NOW */}
            <section>
              <div className="flex items-center gap-2 mb-3">
                <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                <h2 className="text-sm font-black tracking-widest uppercase text-foreground">Live Now</h2>
              </div>
              {liveEvents.length === 0 ? (
                <div className="rounded-2xl px-4 py-5 text-center"
                  style={{ background: 'rgba(255,45,120,0.05)', border: '1px solid rgba(255,45,120,0.15)' }}>
                  <p className="text-sm font-medium text-foreground/70">No events live right now</p>
                  <p className="text-xs text-muted-foreground mt-1">Check back once a show near you starts</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {liveEvents.map((event) => (
                    <EventCard key={event.id} event={event} mode="live" />
                  ))}
                </div>
              )}
            </section>

            {/* STARTING SOON */}
            {soonEvents.length > 0 && (
              <section>
                <div className="flex items-center gap-2 mb-3">
                  <Clock className="w-3.5 h-3.5 text-foreground" />
                  <h2 className="text-sm font-black tracking-widest uppercase text-foreground">Starting Soon</h2>
                  <span className="text-[10px] px-2 py-0.5 rounded-full font-bold bg-muted text-muted-foreground border border-border">
                    within {SOON_WINDOW_MINUTES} min
                  </span>
                </div>
                <div className="space-y-3">
                  {soonEvents.map((event) => (
                    <EventCard key={event.id} event={event} mode="soon" />
                  ))}
                </div>
              </section>
            )}

            {/* UPCOMING */}
            <section>
              <div className="flex items-center gap-2 mb-3">
                <Clock className="w-3.5 h-3.5 text-foreground" />
                <h2 className="text-sm font-black tracking-widest uppercase text-foreground">Upcoming Near You</h2>
              </div>
              {upcomingEvents.length === 0 ? (
                <div className="rounded-2xl px-4 py-5 text-center"
                  style={{ background: 'rgba(191,95,255,0.05)', border: '1px solid rgba(191,95,255,0.15)' }}>
                  <p className="text-sm font-medium text-foreground/70">No upcoming events found</p>
                  <p className="text-xs text-muted-foreground mt-1">New events are added regularly — check back soon.</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {upcomingEvents.map((event) => (
                    <EventCard key={event.id} event={event} mode="upcoming" />
                  ))}
                </div>
              )}
            </section>
          </>
        )}
      </div>
    </div>
  );
}

function EventCard({ event, mode }) {
  const isLive = mode === 'live';
  const isSoon = mode === 'soon';
  const isTM = event.source === 'ticketmaster' || String(event.id || '').startsWith('tm_');
  const tmId = event.tm_id || String(event.id || '').replace('tm_', '');
  const linkTo = isTM ? `/events/tm/${tmId}` : `/upgrades/${event.id}`;
  const linkLabel = isTM
    ? 'View'
    : isLive ? 'Upgrades' : isSoon ? 'Starting Soon' : 'Get Ready';

  return (
    <div
      className="flex items-center gap-3 rounded-2xl overflow-hidden"
      style={{
        background: isLive || isSoon ? 'var(--card)' : 'var(--card)',
        border: isLive ? '1px solid rgba(0,255,135,0.3)' : isSoon ? '1px solid rgba(255,230,0,0.3)' : '1px solid var(--border)',
        boxShadow: isLive ? '0 0 20px rgba(0,255,135,0.08)' : isSoon ? '0 0 20px rgba(255,230,0,0.06)' : 'none',
      }}
    >
      <div className="w-20 h-20 flex-shrink-0 relative overflow-hidden">
        {event.image_url ? (
          <img src={event.image_url} alt={event.title} className="w-full h-full object-cover absolute inset-0" />
        ) : (
          <div className="w-full h-full absolute inset-0 flex items-center justify-center text-3xl bg-muted">🎫</div>
        )}
        <span className="absolute top-1.5 left-1.5 text-[8px] font-black px-1.5 py-0.5 rounded-full"
          style={{
            background: isLive ? '#FF2D78' : isSoon ? 'rgba(255,230,0,0.9)' : 'rgba(191,95,255,0.85)',
            color: isSoon ? '#000' : '#fff'
          }}>
          {isLive ? 'LIVE' : isSoon ? 'SOON' : 'UPCOMING'}
        </span>
        {isTM && (
          <span className="absolute bottom-1.5 left-1.5 text-[8px] font-bold px-1.5 py-0.5 rounded-full"
            style={{ background: 'rgba(0,0,0,0.7)', color: 'rgba(255,255,255,0.6)' }}>TM</span>
        )}
      </div>

      <div className="flex-1 py-3 min-w-0">
        <h3 className="font-bold text-foreground text-sm leading-tight line-clamp-1">{event.title}</h3>
        <div className="flex items-center gap-1 text-[11px] text-muted-foreground mt-1">
          <MapPin className="w-3 h-3 flex-shrink-0" style={{ color: '#00C8FF' }} />
          <span className="truncate">{event.venue}{event.city ? `, ${event.city}` : ''}</span>
        </div>
        <div className="flex items-center gap-1 text-[11px] text-muted-foreground mt-0.5">
          <Calendar className="w-3 h-3 flex-shrink-0" style={{ color: '#BF5FFF' }} />
          <span>{event.date ? format(new Date(event.date), 'EEE, MMM d · h:mm a') : 'TBD'}</span>
        </div>
        {!isLive && !isTM && (
          <span className="inline-flex items-center gap-1 mt-1.5 text-[9px] font-bold px-2 py-0.5 rounded-full bg-muted text-muted-foreground border border-border">
            <Clock className="w-2.5 h-2.5" /> Upgrades unlock at showtime
          </span>
        )}
      </div>

      <div className="pr-3 flex-shrink-0">
        <Link
          to={linkTo}
          className="flex items-center gap-1 px-3 py-2 rounded-xl font-bold text-xs whitespace-nowrap"
          style={isLive
            ? { background: 'hsl(var(--primary))', color: 'hsl(var(--primary-foreground))' }
            : isSoon
            ? { background: 'hsl(var(--foreground))', color: 'hsl(var(--background))' }
            : { background: 'hsl(var(--secondary))', color: 'hsl(var(--secondary-foreground))', border: '1px solid hsl(var(--border))' }
          }
        >
          {linkLabel} <ChevronRight className="w-3.5 h-3.5" />
        </Link>
      </div>
    </div>
  );
}