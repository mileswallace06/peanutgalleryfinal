import { useState, useEffect, useRef, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { format } from 'date-fns';
import { MapPin, Calendar, Zap, ChevronRight, LocateFixed, X } from 'lucide-react';

// How long (ms) each category is considered "live" after start
const LIVE_DURATION_MS = {
  concert: 4 * 60 * 60 * 1000,
  sports:  4 * 60 * 60 * 1000,
  theater: 3 * 60 * 60 * 1000,
  comedy:  3 * 60 * 60 * 1000,
  other:   4 * 60 * 60 * 1000,
};
const DEFAULT_LIVE_MS = 4 * 60 * 60 * 1000;

function isEventLive(event, nowMs) {
  if (!event.date) return false;
  const startMs = new Date(event.date).getTime();
  if (isNaN(startMs)) return false;
  const duration = event.duration_hours
    ? event.duration_hours * 60 * 60 * 1000
    : (LIVE_DURATION_MS[event.category] ?? DEFAULT_LIVE_MS);
  return nowMs >= startMs && nowMs <= startMs + duration;
}

export default function Upgrades() {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [locationLabel, setLocationLabel] = useState('');
  const [locationInput, setLocationInput] = useState('');
  const [editingLocation, setEditingLocation] = useState(false);
  const [detectingLocation, setDetectingLocation] = useState(false);
  const [locationDenied, setLocationDenied] = useState(false);
  const latlongRef = useRef('');
  const locationLabelRef = useRef('');
  const locationInputRef = useRef(null);

  const setLatlongSync = (val) => { latlongRef.current = val; };
  const setLocationLabelSync = (val) => { locationLabelRef.current = val; setLocationLabel(val); };

  const fetchEvents = useCallback((cityOverride) => {
    setLoading(true);
    const adminUnlocked = sessionStorage.getItem('pg_admin_unlocked') === '1';
    const nowMs = Date.now();

    base44.entities.Event.list('date', 200).then((data) => {
      let live;

      if (adminUnlocked) {
        // Admin sees everything not ended
        live = data.filter((e) => e.status !== 'ended');
      } else {
        // Normal: show events within their live window OR manually flagged
        live = data.filter((e) => {
          if (e.status === 'ended') return false;
          if (e.is_beta_live) return true;
          return isEventLive(e, nowMs);
        });
      }

      // Location filter — only by city text (no TM proxy)
      if (cityOverride) {
        const cityLower = cityOverride.toLowerCase();
        live = live.filter((e) =>
          e.city?.toLowerCase().includes(cityLower) ||
          e.state?.toLowerCase().includes(cityLower) ||
          e.venue?.toLowerCase().includes(cityLower)
        );
      }

      // Sort: live events first, then by start time desc
      live.sort((a, b) => {
        const aLive = isEventLive(a, nowMs) ? 1 : 0;
        const bLive = isEventLive(b, nowMs) ? 1 : 0;
        if (bLive !== aLive) return bLive - aLive;
        return new Date(b.date) - new Date(a.date);
      });

      setEvents(live);
    }).catch(console.error).finally(() => setLoading(false));
  }, []);

  // Auto-detect location on mount
  useEffect(() => {
    setDetectingLocation(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const ll = `${pos.coords.latitude},${pos.coords.longitude}`;
        setLatlongSync(ll);
        setLocationLabelSync('Near me');
        setDetectingLocation(false);
        setLocationDenied(false);
        // We don't filter by latlong directly — city name from reverse label is enough
        // Just fetch all live events (user is at venue, city filter is implicit via city stored on event)
        fetchEvents(null);
      },
      () => {
        setDetectingLocation(false);
        setLocationDenied(true);
        fetchEvents(null);
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
    fetchEvents(val);
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
        fetchEvents(null);
      },
      () => {
        setDetectingLocation(false);
        setLocationDenied(true);
      },
      { timeout: 8000, enableHighAccuracy: true, maximumAge: 0 }
    );
  };

  return (
    <div className="pb-32">
      {/* Hero */}
      <div className="relative h-52 overflow-hidden">
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
      <div className="px-4 mt-4 mb-2">
        {editingLocation ? (
          <form onSubmit={handleLocationSubmit} className="flex gap-2">
            <div className="relative flex-1">
              <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <input
                ref={locationInputRef}
                autoFocus
                type="text"
                placeholder="City, e.g. Phoenix…"
                value={locationInput}
                onChange={(e) => setLocationInput(e.target.value)}
                className="w-full pl-9 pr-3 py-2.5 rounded-xl text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
                style={{ background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.14)' }}
              />
            </div>
            <button type="button" onClick={handleDetectAgain} title="Use my location"
              className="flex items-center justify-center w-10 h-10 rounded-xl flex-shrink-0"
              style={{ background: 'rgba(0,200,255,0.12)', border: '1px solid rgba(0,200,255,0.25)', color: '#00C8FF' }}>
              <LocateFixed className="w-4 h-4" />
            </button>
            <button type="button" onClick={() => setEditingLocation(false)}
              className="flex items-center justify-center w-10 h-10 rounded-xl flex-shrink-0"
              style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.5)' }}>
              <X className="w-4 h-4" />
            </button>
            <button type="submit" className="px-4 py-2.5 rounded-xl font-bold text-sm flex-shrink-0"
              style={{ background: 'rgba(0,200,255,0.15)', color: '#00C8FF', border: '1px solid rgba(0,200,255,0.3)' }}>
              Go
            </button>
          </form>
        ) : locationDenied && !locationLabel ? (
          <button
            onClick={() => setEditingLocation(true)}
            className="flex items-center gap-2 text-sm font-medium px-3 py-2 rounded-xl w-full"
            style={{ background: 'rgba(255,165,0,0.08)', border: '1px solid rgba(255,165,0,0.2)', color: 'rgba(255,200,100,0.9)' }}
          >
            <MapPin className="w-3.5 h-3.5 flex-shrink-0" />
            <span>Enable location or enter your city to see live upgrades near you</span>
          </button>
        ) : (
          <button
            onClick={() => { setLocationInput(locationLabel === 'Near me' ? '' : locationLabel); setEditingLocation(true); }}
            className="flex items-center gap-2 text-sm font-medium px-3 py-2 rounded-xl"
            style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.09)', color: 'rgba(255,255,255,0.7)' }}
          >
            {detectingLocation
              ? <span className="w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin" />
              : <MapPin className="w-3.5 h-3.5" style={{ color: '#00FF87' }} />
            }
            <span>{detectingLocation ? 'Detecting location…' : locationLabel || 'Set location'}</span>
            <span className="text-[10px] text-muted-foreground ml-1">· change</span>
          </button>
        )}
      </div>

      {/* Event list */}
      <div className="px-4 mt-3">
        <p className="text-xs text-muted-foreground font-medium mb-3">
          {loading ? 'Loading...' : `${events.length} live event${events.length !== 1 ? 's' : ''} happening now`}
        </p>

        {loading ? (
          <div className="space-y-3">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="rounded-2xl h-24 animate-pulse" style={{ background: 'rgba(255,255,255,0.05)' }} />
            ))}
          </div>
        ) : events.length === 0 ? (
          <div className="text-center py-16 glass-card rounded-2xl">
            <p className="text-4xl mb-3">⚡</p>
            <p className="font-bold text-foreground">No live events right now</p>
            <p className="text-sm text-muted-foreground mt-1">
              {locationDenied && !locationLabel
                ? 'Enter your city above to find live shows nearby.'
                : 'Check back once a show near you starts.'}
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {events.map((event) => {
              const nowMs = Date.now();
              const currentlyLive = event.is_beta_live || isEventLive(event, nowMs);
              return (
                <Link
                  key={event.id}
                  to={`/upgrades/${event.id}`}
                  className="flex items-center gap-3 rounded-2xl overflow-hidden active:scale-[0.98] transition-transform"
                  style={{
                    background: 'linear-gradient(135deg, rgba(255,255,255,0.07) 0%, rgba(255,255,255,0.03) 100%)',
                    border: currentlyLive ? '1px solid rgba(0,255,135,0.3)' : '1px solid rgba(255,255,255,0.09)',
                    boxShadow: currentlyLive ? '0 0 20px rgba(0,255,135,0.1)' : 'none',
                  }}
                >
                  {/* Thumbnail */}
                  <div className="w-20 h-20 flex-shrink-0 relative overflow-hidden">
                    {event.image_url ? (
                      <img src={event.image_url} alt={event.title} className="w-full h-full object-cover absolute inset-0" />
                    ) : (
                      <div className="w-full h-full absolute inset-0 flex items-center justify-center text-3xl"
                        style={{ background: 'rgba(255,255,255,0.04)' }}>🎫</div>
                    )}
                    {currentlyLive && (
                      <span className="absolute top-1.5 left-1.5 text-[8px] font-black px-1.5 py-0.5 rounded-full"
                        style={{ background: '#FF2D78', color: '#fff' }}>
                        LIVE
                      </span>
                    )}
                  </div>

                  {/* Info */}
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
                  </div>

                  <ChevronRight className="w-4 h-4 mr-3 flex-shrink-0 text-muted-foreground" />
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}