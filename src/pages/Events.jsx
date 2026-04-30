import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { format } from 'date-fns';
import { Search, MapPin, Calendar, Filter } from 'lucide-react';

const CATEGORIES = ['all', 'concert', 'sports', 'theater', 'comedy', 'other'];

export default function Events() {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('all');

  useEffect(() => {
    base44.entities.Event.list('date', 50)
      .then(data => setEvents(data.filter(e => e.status !== 'ended')))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const filtered = events.filter(e => {
    const matchCat = category === 'all' || e.category === category;
    const q = search.toLowerCase();
    const matchSearch = !q || e.title?.toLowerCase().includes(q) || e.city?.toLowerCase().includes(q) || e.venue?.toLowerCase().includes(q);
    return matchCat && matchSearch;
  });

  return (
    <div className="px-4 py-6 pb-32">
      <div className="mb-6">
        <h1 className="font-display text-4xl text-foreground mb-1">Live Events</h1>
        <p className="text-sm text-muted-foreground">Find seat upgrades near you</p>
      </div>

      {/* Search */}
      <div className="relative mb-4">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <input
          type="text"
          placeholder="Search events, venues, cities..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="w-full pl-9 pr-4 py-3 rounded-xl border border-white/10 bg-white/5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
        />
      </div>

      {/* Category pills */}
      <div className="flex gap-2 flex-wrap mb-6">
        {CATEGORIES.map(cat => (
          <button
            key={cat}
            onClick={() => setCategory(cat)}
            className={`px-3 py-1.5 rounded-full text-xs font-bold capitalize transition-all ${
              category === cat
                ? 'text-black neon-glow-purple'
                : 'bg-white/5 text-muted-foreground border border-white/10 hover:border-white/20'
            }`}
            style={category === cat ? { background: '#BF5FFF' } : {}}
          >
            {cat}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="space-y-4">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="rounded-2xl border border-white/08 bg-white/04 h-36 animate-pulse" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-20 text-muted-foreground">
          <p className="text-4xl mb-3">🥜</p>
          {search || category !== 'all' ? (
            <>
              <p className="font-medium">No events found</p>
              <p className="text-sm mt-1">Try adjusting your search or filters</p>
            </>
          ) : (
            <>
              <p className="font-medium">No events available right now</p>
              <p className="text-sm mt-1">Check back later or try another search</p>
            </>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          {filtered.map(event => (
            <Link
              key={event.id}
              to={`/events/${event.id}`}
              className="group glass-card rounded-2xl overflow-hidden flex flex-col active:scale-[0.98] transition-transform"
            >
              <div className="h-40 bg-white/5 relative overflow-hidden">
                {event.image_url ? (
                  <img
                    src={event.image_url}
                    alt={event.title}
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-5xl">🎫</div>
                )}
                <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
                {event.status === 'live' && (
                  <span className="absolute top-3 right-3 text-xs font-bold px-2 py-0.5 rounded-full animate-pulse"
                    style={{ background: '#FF2D7818', color: '#FF2D78', border: '1px solid #FF2D7840' }}>
                    🔴 LIVE
                  </span>
                )}
                {event.category && (
                  <span className="absolute top-3 left-3 text-xs font-bold px-2 py-0.5 rounded-full"
                    style={{ background: 'rgba(0,0,0,0.5)', color: '#fff', backdropFilter: 'blur(8px)' }}>
                    {event.category}
                  </span>
                )}
              </div>
              <div className="p-4">
                <h3 className="font-bold text-foreground text-base line-clamp-1 mb-2">{event.title}</h3>
                <div className="flex items-center gap-1 text-xs text-muted-foreground mb-1">
                  <Calendar className="w-3 h-3" />
                  {event.date ? format(new Date(event.date), 'EEE, MMM d · h:mm a') : 'TBD'}
                </div>
                <div className="flex items-center gap-1 text-xs text-muted-foreground">
                  <MapPin className="w-3 h-3" />
                  {event.venue}{event.city ? `, ${event.city}` : ''}
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}