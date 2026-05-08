import { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { format } from 'date-fns';
import { MapPin, Calendar, Zap, ChevronRight, Search, LocateFixed, X } from 'lucide-react';

export default function Upgrades() {
  const [pgEvents, setPgEvents] = useState([]);
  const [tmEvents, setTmEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [tmLoading, setTmLoading] = useState(false);
  const [search, setSearch] = useState('');
  const searchDebounceRef = useRef(null);

  const [locationLabel, setLocationLabel] = useState('');
  const [latlong, setLatlong] = useState('');
  const latlongRef = useRef('');
  const locationLabelRef = useRef('');
  const [locationInput, setLocationInput] = useState('');
  const [editingLocation, setEditingLocation] = useState(false);
  const [detectingLocation, setDetectingLocation] = useState(false);
  const mountedRef = useRef(false);

  const setLL = (ll) => { latlongRef.current = ll; setLatlong(ll); };
  const setLabel = (label) => { locationLabelRef.current = label; setLocationLabel(label); };

  // Load PG live events once
  useEffect(() => {
    const adminUnlocked = sessionStorage.getItem('pg_admin_unlocked') === '1';
    const now = Date.now();
    base44.entities.Event.list('date', 50).then((data) => {
      const eligible = data.filter((e) => e.status !== 'ended');
      setPgEvents(adminUnlocked
        ? eligible
        : eligible.filter((e) =>
            e.is_beta_live ||
            e.status === 'live' ||
            (e.date && now >= new Date(e.date).getTime())
          )
      );
    }).catch(console.error).finally(() => setLoading(false));
  }, []);

  const fetchTMEvents = (ll, cityOverride, keyword) => {
    setTmLoading(true);
    const tmParams = { size: 30 };
    if (ll) { tmParams.latlong = ll; tmParams.radius = '50'; }
    else if (cityOverride) { tmParams.city = cityOverride; }
    if (keyword) { tmParams.keyword = keyword; }

    base44.functions.invoke('getTicketmasterEvents', tmParams)
      .then((tmRes) => {
        setTmEvents(tmRes?.data?.events || []);
      })
      .catch(console.error)
      .finally(() => setTmLoading(false));
  };

  const detectLocation = (onSuccess, onError) => {
    if (!navigator.geolocation) { onError && onError(); return; }
    navigator.geolocation.getCurrentPosition(
      (pos) => onSuccess(`${pos.coords.latitude},${pos.coords.longitude}`),
      () => { onError && onError(); },
      { timeout: 10000, enableHighAccuracy: true, maximumAge: 0 }
    );
  };

  // Auto-detect on mount
  useEffect(() => {
    if (mountedRef.current) return;
    mountedRef.current = true;
    setDetectingLocation(true);
    detectLocation(
      (ll) => {
        setLL(ll); setLabel('Near me');
        setDetectingLocation(false);
        fetchTMEvents(ll, null, null);
      },
      () => {
        setDetectingLocation(false);
        fetchTMEvents(null, null, null);
      }
    );
  }, []);

  // Re-fetch TM events when search changes
  useEffect(() => {
    if (!mountedRef.current) return;
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    searchDebounceRef.current = setTimeout(() => {
      const ll = latlongRef.current;
      const label = locationLabelRef.current;
      fetchTMEvents(
        ll || null,
        label && label !== 'Near me' ? label : null,
        search.trim() || null
      );
    }, 400);
    return () => clearTimeout(searchDebounceRef.current);
  }, [search]);

  const handleLocationSubmit = (e) => {
    e.preventDefault();
    const val = locationInput.trim();
    if (!val) return;
    setLL(''); setLabel(val);
    setEditingLocation(false);
    fetchTMEvents(null, val, search.trim() || null);
  };

  const handleDetectAgain = () => {
    setDetectingLocation(true);
    setEditingLocation(false);
    detectLocation(
      (ll) => {
        setLL(ll); setLabel('Near me');
        setDetectingLocation(false);
        fetchTMEvents(ll, null, search.trim() || null);
      },
      () => { setDetectingLocation(false); setLabel('Location unavailable'); }
    );
  };

  // Filter PG events by search
  const filteredPg = pgEvents.filter(e => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      e.title?.toLowerCase().includes(q) ||
      e.venue?.toLowerCase().includes(q) ||
      e.city?.toLowerCase().includes(q) ||
      e.artist?.toLowerCase().includes(q)
    );
  });

  // Dedupe TM events that already exist in PG (by tm_id)
  const pgTmIds = new Set(pgEvents.map(e => e.tm_id).filter(Boolean));
  const filteredTm = tmEvents.filter(e => !pgTmIds.has(e.tm_id));

  const totalCount = filteredPg.length + filteredTm.length;

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

      {/* Search bar */}
      <div className="px-4 mt-4 mb-2">
        <div className="relative">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search events, venues, artists..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-3 rounded-2xl text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
            style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.10)' }}
          />
        </div>
      </div>

      {/* Location bar */}
      <div className="px-4 mb-2">
        {editingLocation ? (
          <form onSubmit={handleLocationSubmit} className="flex gap-2">
            <div className="relative flex-1">
              <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <input
                autoFocus
                type="text"
                placeholder="City or zip code…"
                value={locationInput}
                onChange={e => setLocationInput(e.target.value)}
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
        ) : (
          <div className="flex items-center gap-2">
            <button
              onClick={() => { if (detectingLocation) return; setLocationInput(locationLabel === 'Near me' ? '' : locationLabel); setEditingLocation(true); }}
              disabled={detectingLocation}
              className="flex items-center gap-2 text-sm font-medium px-3 py-2 rounded-xl transition-opacity"
              style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.09)', color: 'rgba(255,255,255,0.7)', opacity: detectingLocation ? 0.6 : 1 }}
            >
              {detectingLocation
                ? <span className="w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin" />
                : <MapPin className="w-3.5 h-3.5" style={{ color: '#00C8FF' }} />
              }
              <span>{detectingLocation ? 'Detecting location…' : locationLabel || 'Set location'}</span>
              {!detectingLocation && <span className="text-[10px] text-muted-foreground ml-1">· change</span>}
            </button>
            {!detectingLocation && !locationLabel && (
              <button onClick={handleDetectAgain}
                className="flex items-center gap-1.5 text-xs font-bold px-3 py-2 rounded-xl"
                style={{ background: 'rgba(0,200,255,0.12)', border: '1px solid rgba(0,200,255,0.25)', color: '#00C8FF' }}>
                <LocateFixed className="w-3.5 h-3.5" /> Use my location
              </button>
            )}
          </div>
        )}
      </div>

      {/* Event list */}
      <div className="px-4 mt-1">
        {!(loading || tmLoading) && (
          <p className="text-xs text-muted-foreground font-medium mb-3">
            {totalCount} event{totalCount !== 1 ? 's' : ''} found
          </p>
        )}

        {loading || tmLoading ? (
          <div className="space-y-3">
            {[...Array(4)].map((_, i) =>
              <div key={i} className="rounded-2xl h-24 animate-pulse" style={{ background: 'rgba(255,255,255,0.05)' }} />
            )}
          </div>
        ) : totalCount === 0 ? (
          <div className="text-center py-16 glass-card rounded-2xl">
            <p className="text-4xl mb-3">⚡</p>
            <p className="font-bold text-foreground">No events found</p>
            <p className="text-sm text-muted-foreground mt-1">Try adjusting your search or location.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {/* PG live events */}
            {filteredPg.map((event) => (
              <Link
                key={event.id}
                to={`/upgrades/${event.id}`}
                className="flex items-center gap-3 rounded-2xl overflow-hidden active:scale-[0.98] transition-transform"
                style={{
                  background: 'linear-gradient(135deg, rgba(255,255,255,0.07) 0%, rgba(255,255,255,0.03) 100%)',
                  border: event.status === 'live' ? '1px solid rgba(0,255,135,0.25)' : '1px solid rgba(255,255,255,0.09)',
                  boxShadow: event.status === 'live' ? '0 0 20px rgba(0,255,135,0.08)' : 'none'
                }}
              >
                <div className="w-20 h-20 flex-shrink-0 relative overflow-hidden">
                  {event.image_url
                    ? <img src={event.image_url} alt={event.title} className="w-full h-full object-cover absolute inset-0" />
                    : <div className="w-full h-full absolute inset-0 flex items-center justify-center text-3xl" style={{ background: 'rgba(255,255,255,0.04)' }}>🎫</div>
                  }
                  {event.status === 'live' && (
                    <span className="absolute top-1.5 left-1.5 text-[8px] font-black px-1.5 py-0.5 rounded-full"
                      style={{ background: '#FF2D78', color: '#fff' }}>LIVE</span>
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
                </div>
                <ChevronRight className="w-4 h-4 mr-3 flex-shrink-0 text-muted-foreground" />
              </Link>
            ))}

            {/* TM events */}
            {filteredTm.map((event) => (
              <Link
                key={event.tm_id}
                to={`/events/tm/${event.tm_id}?mode=upgrade`}
                className="flex items-center gap-3 rounded-2xl overflow-hidden active:scale-[0.98] transition-transform"
                style={{
                  background: 'linear-gradient(135deg, rgba(255,255,255,0.05) 0%, rgba(255,255,255,0.02) 100%)',
                  border: '1px solid rgba(255,255,255,0.08)',
                }}
              >
                <div className="w-20 h-20 flex-shrink-0 relative overflow-hidden">
                  {event.image_url
                    ? <img src={event.image_url} alt={event.title} className="w-full h-full object-cover absolute inset-0" />
                    : <div className="w-full h-full absolute inset-0 flex items-center justify-center text-3xl" style={{ background: 'rgba(255,255,255,0.04)' }}>🎫</div>
                  }
                  <span className="absolute bottom-1 left-1 text-[8px] font-bold px-1.5 py-0.5 rounded-full"
                    style={{ background: 'rgba(0,0,0,0.7)', color: 'rgba(255,255,255,0.55)' }}>TM</span>
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
                </div>
                <ChevronRight className="w-4 h-4 mr-3 flex-shrink-0 text-muted-foreground" />
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}