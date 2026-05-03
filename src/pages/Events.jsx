import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { format } from 'date-fns';
import { MapPin, Calendar, Search, ChevronRight, ArrowRight } from 'lucide-react';

export default function Events() {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [showSearch, setShowSearch] = useState(false);

  useEffect(() => {
    const adminUnlocked = sessionStorage.getItem('pg_admin_unlocked') === '1';
    const now = Date.now();
    base44.entities.Event.list('date', 50)
      .then(data => {
        const eligible = data.filter(e => e.status !== 'ended');
        // Events tab = upcoming events that haven't started yet
        setEvents(adminUnlocked
          ? eligible
          : eligible.filter(e => !e.date || now < new Date(e.date).getTime())
        );
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const filtered = events.filter(e => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      e.title?.toLowerCase().includes(q) ||
      e.city?.toLowerCase().includes(q) ||
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



        {/* Headline */}
        <div className="absolute bottom-5 left-4 right-4">
          <h1
            className="font-display leading-[0.9] text-white"
            style={{ fontSize: 'clamp(2.8rem, 13vw, 4.5rem)', textShadow: '0 2px 30px rgba(0,0,0,0.8)' }}
          >
            Get Tickets
          </h1>
        </div>
      </div>

      {/* ── Search / Recommended toggle ── */}
      <div className="px-4 mt-5 mb-4">
        {showSearch ? (
          <div className="relative">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input
              autoFocus
              type="text"
              placeholder="Search events, venues, cities..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full pl-10 pr-4 py-3.5 rounded-2xl text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
              style={{ background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.12)' }}
            />
          </div>
        ) : (
          <div className="flex gap-2">
            <button
              className="flex-1 flex items-center justify-center gap-2 py-3 rounded-2xl font-bold text-sm"
              style={{ background: 'rgba(255,255,255,0.1)', color: '#fff', border: '1px solid rgba(255,255,255,0.15)' }}
            >
              📍 Recommended
            </button>
            <button
              onClick={() => setShowSearch(true)}
              className="flex-1 flex items-center justify-center gap-2 py-3 rounded-2xl font-bold text-sm"
              style={{ background: 'rgba(255,255,255,0.05)', color: 'rgba(255,255,255,0.5)', border: '1px solid rgba(255,255,255,0.08)' }}
            >
              <Search className="w-4 h-4" /> Search
            </button>
          </div>
        )}
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
          <span
            className="absolute top-2 left-2 text-[9px] font-black px-1.5 py-0.5 rounded-full"
            style={{ background: '#FF2D78', color: '#fff' }}
          >
            LIVE
          </span>
        )}
      </div>

      {/* Info */}
      <div className="flex-1 px-4 py-3.5 flex flex-col justify-between min-w-0">
        <div>
          <h3 className="font-bold text-foreground text-sm leading-tight mb-2 line-clamp-2">{event.title}</h3>
          <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground mb-1">
            <MapPin className="w-3 h-3 flex-shrink-0" style={{ color: '#00C8FF' }} />
            <span className="truncate">{event.venue}{event.city ? `, ${event.city}` : ''}</span>
          </div>
          <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <Calendar className="w-3 h-3 flex-shrink-0" style={{ color: '#BF5FFF' }} />
            <span>{event.date ? format(new Date(event.date), 'EEE, MMM d · h:mm a') : 'TBD'}</span>
          </div>
        </div>

        {/* List your seats tag */}
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
      </div>

      {/* View button */}
      <div className="flex items-center pr-3 pl-1">
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
      </div>
    </div>
  );
}