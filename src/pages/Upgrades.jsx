import { useState, useEffect, useRef, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { format } from 'date-fns';
import { MapPin, Calendar, Zap, ChevronRight, LocateFixed, X, Clock, RefreshCw } from 'lucide-react';
import { getEventLiveStatus, SOON_WINDOW_MINUTES } from '@/lib/eventTiming';
import { usePullToRefresh } from '@/hooks/usePullToRefresh';

export default function Upgrades() {
  const [allEvents, setAllEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [locationLabel, setLocationLabel] = useState('');
  const [locationInput, setLocationInput] = useState('');
  const [editingLocation, setEditingLocation] = useState(false);
  const [detectingLocation, setDetectingLocation] = useState(false);
  const [locationDenied, setLocationDenied] = useState(false);
  const [latlong, setLatlong] = useState('');
  const locationLabelRef = useRef('');
  const latlongRef = useRef('');
  const locationInputRef = useRef(null);

  const setLocationLabelSync = (val) => { locationLabelRef.current = val; setLocationLabel(val); };
  const setLatlongSync = (val) => { latlongRef.current = val; setLatlong(val); };

  const fetchEvents = useCallback((ll, cityOverride) => {
    setLoading(true);
    const tmParams = { size: 40 };
    if (ll) { tmParams.latlong = ll; tmParams.radius = '50'; }
    else if (cityOverride) { tmParams.city = cityOverride; }

    Promise.all([
      base44.entities.Event.list('date', 200),
      base44.functions.invoke('getTicketmasterEvents', tmParams),
    ]).then(([localData, tmRes]) => {
      let pgEvents = localData.filter((e) => e.status !== 'ended');

      if (cityOverride && !ll) {
        const q = cityOverride.toLowerCase();
        pgEvents = pgEvents.filter((e) =>
          e.city?.toLowerCase().includes(q) ||
          e.state?.toLowerCase().includes(q) ||
          e.venue?.toLowerCase().includes(q)
        );
      }
      if (ll) {
        const tmCities = new Set(
          (tmRes?.data?.events || []).map(e => e.city?.toLowerCase()).filter(Boolean)
        );
        if (tmCities.size > 0) {
          pgEvents = pgEvents.filter(e => !e.city || tmCities.has(e.city.toLowerCase()));
        }
      }

      const pgMapped = pgEvents.map(e => ({ ...e, source: 'pg' }));
      const tmEvents = (tmRes?.data?.events || []).map(e => ({ ...e, id: `tm_${e.tm_id}`, source: 'ticketmaster' }));

      // Merge: prefer PG events, deduplicate TM events that already exist locally by tm_id
      const pgTmIds = new Set(pgMapped.map(e => e.tm_id).filter(Boolean));
      const uniqueTM = tmEvents.filter(e => !pgTmIds.has(e.tm_id));

      setAllEvents([...pgMapped, ...uniqueTM]);
    }).catch(console.error).finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    setDetectingLocation(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const ll = `${pos.coords.latitude},${pos.coords.longitude}`;
        setLatlongSync(ll);
        setLocationLabelSync('Near me');
        setDetectingLocation(false);
        setLocationDenied(false);
        fetchEvents(ll, null);
      },
      () => {
        setDetectingLocation(false);
        setLocationDenied(true);
        fetchEvents(null, null);
      },
      { timeout: 8000, enableHighAccuracy: true, maximumAge: 0 }
    );
  }, [fetchEvents]);

  const handleLocationSubmit = (e) => {
    e.preventDefault();
    const val = locationInput.trim();
    if (!val) return;
    setLatlongSync('');
    setLocationLabelSync(val);
    setEditingLocation(false);
    fetchEvents(null, val);
  };

  const handleDetectAgain = () => {
    setDetectingLocation(true);
    setLocationDenied(false);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const ll = `${pos.coords.latitude},${pos.coords.longitude}`;
        setLatlongSync(ll);
        setLocationLabelSync('Near me');
        setDetectingLocation(false);
        setEditingLocation(false);
        fetchEvents(ll, null);
      },
      () => {
        setDetectingLocation(false);
        setLocationDenied(true);
      },
      { timeout: 8000, enableHighAccuracy: true, maximumAge: 0 }
    );
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
    fetchEvents(latlongRef.current || null, locationLabelRef.current !== 'Near me' ? locationLabelRef.current : null);
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
          <form onSubmit={handleLocationSubmit} className="flex gap-2">
            <div className="relative flex-1">
              <MapPin className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: '#00FF87' }} />
              <input
                ref={locationInputRef}
                autoFocus
                type="text"
                placeholder="City, e.g. Phoenix…"
                value={locationInput}
                onChange={(e) => setLocationInput(e.target.value)}
                className="w-full pl-9 pr-3 py-3 rounded-2xl text-sm font-medium text-foreground placeholder:text-muted-foreground focus:outline-none"
                style={{ background: 'hsl(var(--card))', border: '1px solid rgba(0,255,135,0.35)', boxShadow: '0 0 0 3px rgba(0,255,135,0.08)' }}
              />
            </div>
            <button type="button" onClick={handleDetectAgain} title="Use my location"
              className="flex items-center justify-center w-11 h-11 rounded-2xl flex-shrink-0 transition-all active:scale-95"
              style={{ background: 'rgba(0,200,255,0.12)', border: '1px solid rgba(0,200,255,0.3)', color: '#00C8FF' }}>
              <LocateFixed className="w-4 h-4" />
            </button>
            <button type="button" onClick={() => setEditingLocation(false)}
              className="flex items-center justify-center w-11 h-11 rounded-2xl flex-shrink-0 transition-all active:scale-95"
              style={{ background: 'hsl(var(--muted))', border: '1px solid hsl(var(--border))', color: 'hsl(var(--muted-foreground))' }}>
              <X className="w-4 h-4" />
            </button>
            <button type="submit"
              className="px-4 py-3 rounded-2xl font-black text-sm flex-shrink-0 transition-all active:scale-95"
              style={{ background: 'linear-gradient(135deg, #00FF87, #00C8FF)', color: '#0a0510' }}>
              Go
            </button>
          </form>
        ) : locationDenied && !locationLabel ? (
          <button
            onClick={() => { setLocationInput(''); setEditingLocation(true); }}
            className="flex items-center gap-3 px-4 py-3.5 rounded-2xl w-full transition-all active:scale-[0.98]"
            style={{ background: 'rgba(255,165,0,0.08)', border: '1px solid rgba(255,165,0,0.25)' }}
          >
            <div className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0"
              style={{ background: 'rgba(255,165,0,0.15)' }}>
              <MapPin className="w-4 h-4" style={{ color: '#FF8C00' }} />
            </div>
            <div className="text-left">
              <p className="text-xs font-black" style={{ color: '#FF8C00' }}>Set your location</p>
              <p className="text-[11px] text-muted-foreground">Tap to enter your city and find nearby events</p>
            </div>
          </button>
        ) : (
          <button
            onClick={() => { setLocationInput(locationLabel === 'Near me' ? '' : locationLabel); setEditingLocation(true); }}
            className="flex items-center gap-3 w-full px-4 py-3 rounded-2xl transition-all active:scale-[0.98]"
            style={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))' }}
          >
            <div className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0"
              style={{ background: 'rgba(0,180,90,0.25)', border: '1px solid rgba(0,180,90,0.4)' }}>
              {detectingLocation
                ? <span className="w-3.5 h-3.5 border-2 border-t-transparent rounded-full animate-spin" style={{ borderColor: '#00FF87', borderTopColor: 'transparent' }} />
                : <MapPin className="w-4 h-4" style={{ color: '#00a855' }} />
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
      </div>

      {/* Content */}
      <div className="px-4 space-y-8">
        {loading ? (
          <div className="space-y-3">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="rounded-2xl h-24 animate-pulse dark:bg-[rgba(255,255,255,0.05)]" style={{ background: '#f0f0f0' }} />
            ))}
          </div>
        ) : (
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
                  <p className="text-xs text-muted-foreground mt-1">
                    {locationDenied && !locationLabel ? 'Enter your city above to find nearby events.' : 'New events are added regularly — check back soon.'}
                  </p>
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
          <div className="w-full h-full absolute inset-0 flex items-center justify-center text-3xl dark:bg-[rgba(255,255,255,0.04)]"
            style={{ background: '#f5f5f5' }}>🎫</div>
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