import { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { format } from 'date-fns';
import { MapPin, Calendar, Search, ChevronRight, LocateFixed, X } from 'lucide-react';

export default function Events() {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [showSearch, setShowSearch] = useState(false);

  // Location state
  const [locationLabel, setLocationLabel] = useState('');
  const [latlong, setLatlong] = useState('');
  const [locationInput, setLocationInput] = useState('');
  const [editingLocation, setEditingLocation] = useState(false);
  const [detectingLocation, setDetectingLocation] = useState(false);
  const locationInputRef = useRef(null);

  const fetchEvents = (ll, cityOverride) => {
    setLoading(true);
    const adminUnlocked = sessionStorage.getItem('pg_admin_unlocked') === '1';
    const now = Date.now();
    const tmParams = { size: 40 };
    if (ll) { tmParams.latlong = ll; tmParams.radius = '50'; }
    else if (cityOverride) { tmParams.city = cityOverride; }

    Promise.all([
      base44.entities.Event.list('date', 50),
      base44.functions.invoke('getTicketmasterEvents', tmParams),
    ]).then(([localData, tmRes]) => {
      const eligible = localData.filter(e => e.status !== 'ended');
      const pgEvents = adminUnlocked
        ? eligible
        : eligible.filter(e => !e.date || now < new Date(e.date).getTime());
      const pgMapped = pgEvents.map(e => ({ ...e, source: 'pg' }));
      const tmEvents = (tmRes?.data?.events || []).map(e => ({ ...e, id: `tm_${e.tm_id}` }));
      setEvents([...pgMapped, ...tmEvents]);
    }).catch(console.error).finally(() => setLoading(false));
  };

  // Auto-detect on mount
  useEffect(() => {
    setDetectingLocation(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const ll = `${pos.coords.latitude},${pos.coords.longitude}`;
        setLatlong(ll);
        setLocationLabel('Near me');
        setDetectingLocation(false);
        fetchEvents(ll, null);
      },
      () => {
        // Permission denied or unavailable — load without location
        setDetectingLocation(false);
        fetchEvents(null, null);
      },
      { timeout: 6000 }
    );
  }, []);

  const handleLocationSubmit = (e) => {
    e.preventDefault();
    const val = locationInput.trim();
    if (!val) return;
    setLatlong('');
    setLocationLabel(val);
    setEditingLocation(false);
    fetchEvents(null, val);
  };

  const handleDetectAgain = () => {
    setDetectingLocation(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const ll = `${pos.coords.latitude},${pos.coords.longitude}`;
        setLatlong(ll);
        setLocationLabel('Near me');
        setDetectingLocation(false);
        setEditingLocation(false);
        fetchEvents(ll, null);
      },
      () => setDetectingLocation(false),
      { timeout: 6000 }
    );
  };

  const filtered = events.filter(e => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      e.title?.toLowerCase().includes(q) ||
      e.city?.toLowerCase().includes(q) ||
      e.state?.toLowerCase().includes(q) ||
      e.venue?.toLowerCase().includes(q)
    );
  });

  return (
    <div className="pb-32">

      {/* ── Hero ── */}
      <div className="relative h-56 overflow-hidden">
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
            🎫 TICKETS
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

      {/* ── Location bar ── */}
      <div className="px-4 mt-4 mb-2">
        {editingLocation ? (
          <form onSubmit={handleLocationSubmit} className="flex gap-2">
            <div className="relative flex-1">
              <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <input
                ref={locationInputRef}
                autoFocus
                type="text"
                placeholder="City or zip code…"
                value={locationInput}
                onChange={e => setLocationInput(e.target.value)}
                className="w-full pl-9 pr-3 py-2.5 rounded-xl text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
                style={{ background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.14)' }}
              />
            </div>
            <button
              type="button"
              onClick={handleDetectAgain}
              title="Use my location"
              className="flex items-center justify-center w-10 h-10 rounded-xl flex-shrink-0"
              style={{ background: 'rgba(0,200,255,0.12)', border: '1px solid rgba(0,200,255,0.25)', color: '#00C8FF' }}
            >
              <LocateFixed className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() => setEditingLocation(false)}
              className="flex items-center justify-center w-10 h-10 rounded-xl flex-shrink-0"
              style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.5)' }}
            >
              <X className="w-4 h-4" />
            </button>
            <button type="submit" className="px-4 py-2.5 rounded-xl font-bold text-sm flex-shrink-0"
              style={{ background: 'rgba(0,200,255,0.15)', color: '#00C8FF', border: '1px solid rgba(0,200,255,0.3)' }}>
              Go
            </button>
          </form>
        ) : (
          <button
            onClick={() => { setLocationInput(locationLabel === 'Near me' ? '' : locationLabel); setEditingLocation(true); }}
            className="flex items-center gap-2 text-sm font-medium px-3 py-2 rounded-xl"
            style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.09)', color: 'rgba(255,255,255,0.7)' }}
          >
            {detectingLocation
              ? <span className="w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin" />
              : <MapPin className="w-3.5 h-3.5" style={{ color: '#00C8FF' }} />
            }
            <span>{detectingLocation ? 'Detecting location…' : locationLabel || 'Set location'}</span>
            <span className="text-[10px] text-muted-foreground ml-1">· change</span>
          </button>
        )}
      </div>

      {/* ── Search bar ── */}
      <div className="px-4 mt-2 mb-4">
        <div className="relative">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search events, venues, cities..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-3 rounded-2xl text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
            style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.10)' }}
          />
        </div>
      </div>

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
      ) : filtered.length === 0 ? (
        <div className="text-center py-20 text-muted-foreground px-4">
          <p className="text-4xl mb-3">🥜</p>
          <p className="font-medium">No events found</p>
          <p className="text-sm mt-1 opacity-70">Try adjusting your search</p>
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
  const isTM = event.source === 'ticketmaster';

  return (
    <div
      className="rounded-2xl overflow-hidden flex items-stretch"
      style={{
        background: 'linear-gradient(135deg, rgba(255,255,255,0.07) 0%, rgba(255,255,255,0.03) 100%)',
        border: '1px solid rgba(255,255,255,0.09)',
        boxShadow: '0 4px 24px rgba(0,0,0,0.4)',
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
              className="inline-flex items-center gap-1 text-[10px] font-bold px-2.5 py-1 rounded-full"
              style={{ background: 'rgba(191,95,255,0.12)', color: '#BF5FFF', border: '1px solid rgba(191,95,255,0.25)' }}
              onClick={e => e.stopPropagation()}
            >
              🥜 List your seats
            </Link>
          </div>
        )}
        {isTM && (
          <div className="mt-2.5">
            <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2.5 py-1 rounded-full"
              style={{ background: 'rgba(0,200,255,0.08)', color: 'rgba(0,200,255,0.7)', border: '1px solid rgba(0,200,255,0.15)' }}>
              🎟️ Official tickets
            </span>
          </div>
        )}
      </div>

      {/* View button */}
      <div className="flex items-center pr-3 pl-1">
        {isTM ? (
          <Link
            to={`/events/tm/${event.tm_id}`}
            className="flex items-center gap-1 px-3 py-2 rounded-xl font-bold text-xs whitespace-nowrap"
            style={{
              background: 'rgba(0,200,255,0.15)',
              color: '#00C8FF',
              border: '1px solid rgba(0,200,255,0.25)',
            }}
          >
            View <ChevronRight className="w-3.5 h-3.5" />
          </Link>
        ) : (
          <Link
            to={`/events/${event.id}`}
            className="flex items-center gap-1 px-3 py-2 rounded-xl font-bold text-xs whitespace-nowrap"
            style={{
              background: 'rgba(0,200,255,0.15)',
              color: '#00C8FF',
              border: '1px solid rgba(0,200,255,0.25)',
            }}
          >
            View <ChevronRight className="w-3.5 h-3.5" />
          </Link>
        )}
      </div>
    </div>
  );
}