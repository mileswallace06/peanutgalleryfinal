import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { format } from 'date-fns';
import { Search, MapPin, Calendar, Filter } from 'lucide-react';

const CATEGORIES = ['all', 'concert', 'sports', 'theater', 'comedy', 'other'];

const STATUS_BADGE = {
  live: 'bg-red-100 text-red-700 border border-red-200',
  upcoming: 'bg-amber-50 text-amber-700 border border-amber-200',
  ended: 'bg-muted text-muted-foreground',
};

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
    <div className="max-w-6xl mx-auto px-4 py-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-foreground mb-1">Live Events</h1>
        <p className="text-muted-foreground">Find seat upgrades near you</p>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3 mb-8">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search events, venues, cities..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full pl-9 pr-4 py-2.5 rounded-lg border border-border bg-white text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
          />
        </div>
        <div className="flex items-center gap-2">
          <Filter className="w-4 h-4 text-muted-foreground" />
          <div className="flex gap-1 flex-wrap">
            {CATEGORIES.map(cat => (
              <button
                key={cat}
                onClick={() => setCategory(cat)}
                className={`px-3 py-1.5 rounded-full text-xs font-medium capitalize transition-colors ${
                  category === cat
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-secondary text-secondary-foreground hover:bg-secondary/80'
                }`}
              >
                {cat}
              </button>
            ))}
          </div>
        </div>
      </div>

      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="rounded-xl border border-border bg-white h-64 animate-pulse" />
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
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {filtered.map(event => (
            <Link
              key={event.id}
              to={`/events/${event.id}`}
              className="group rounded-xl border border-border bg-white overflow-hidden hover:shadow-md transition-shadow"
            >
              <div className="h-44 bg-muted relative overflow-hidden">
                {event.image_url ? (
                  <img
                    src={event.image_url}
                    alt={event.title}
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-5xl">🎫</div>
                )}
                <span className={`absolute top-3 right-3 text-xs font-semibold px-2 py-0.5 rounded-full ${STATUS_BADGE[event.status] || STATUS_BADGE.upcoming}`}>
                  {event.status === 'live' ? '🔴 LIVE' : event.status?.toUpperCase()}
                </span>
                {event.category && (
                  <span className="absolute top-3 left-3 text-xs font-medium px-2 py-0.5 rounded-full bg-black/40 text-white capitalize">
                    {event.category}
                  </span>
                )}
              </div>
              <div className="p-4">
                <h3 className="font-semibold text-foreground line-clamp-1 mb-1">{event.title}</h3>
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