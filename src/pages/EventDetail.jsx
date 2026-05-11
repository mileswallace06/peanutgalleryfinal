import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { format } from 'date-fns';
import { MapPin, Calendar, ArrowLeft, Ticket } from 'lucide-react';
import ListingCard from '@/components/events/ListingCard';
import PurchaseDialog from '@/components/events/PurchaseDialog';
import { getEventLiveStatus } from '@/lib/eventTiming';

export default function EventDetail() {
  const { id } = useParams();
  const [event, setEvent] = useState(null);
  const [listings, setListings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedListing, setSelectedListing] = useState(null);
  const [user, setUser] = useState(null);

  useEffect(() => {
    base44.auth.me().then(setUser).catch(() => {});
    Promise.all([
      base44.entities.Event.filter({ id }),
      base44.entities.Listing.filter({ event_id: id, status: 'active', proof_status: 'approved' }),
    ]).then(([events, rawListings]) => {
      const ev = events[0] || null;
      setEvent(ev);
      const adminUnlocked = sessionStorage.getItem('pg_admin_unlocked') === '1';
      const timing = ev ? getEventLiveStatus(ev) : null;
      const isLiveMode = timing ? (timing.status === 'live' || timing.status === 'ended') : false;
      // Events tab shows PRE-event listings only (unless admin bypass)
      const filtered = adminUnlocked
        ? rawListings
        : rawListings.filter(() => !isLiveMode);
      const real = filtered.filter(l => !l.notes?.startsWith('[DEMO]'));
      setListings(real.length > 0 ? real : filtered);
    }).catch(console.error).finally(() => setLoading(false));
  }, [id]);

  if (loading) {
    return (
      <div className="px-4 py-8 space-y-4">
        <div className="h-64 bg-white/5 rounded-3xl animate-pulse" />
        <div className="h-5 w-48 bg-white/5 rounded animate-pulse mt-6" />
        <div className="space-y-4 mt-4">
          {[...Array(3)].map((_, i) => <div key={i} className="h-40 bg-white/5 rounded-2xl animate-pulse" />)}
        </div>
      </div>
    );
  }

  if (!event) {
    return (
      <div className="px-4 py-20 text-center">
        <p className="text-muted-foreground">Event not found.</p>
        <Link to="/events" className="text-primary text-sm mt-3 inline-block">← Back to events</Link>
      </div>
    );
  }

  const adminUnlocked = sessionStorage.getItem('pg_admin_unlocked') === '1';
  const timing = getEventLiveStatus(event);
  const isLive = timing.status === 'live';
  const isLiveMode = timing.status === 'live' || timing.status === 'ended';
  const isDemoOnly = listings.length > 0 && listings.every(l => l.notes?.startsWith('[DEMO]'));
  const sorted = [...listings].sort((a, b) => a.asking_price - b.asking_price);
  const cheapest = sorted[0]?.asking_price;

  return (
    <div className="pb-32">

      {/* ── Hero ── */}
      <div className="relative h-72 sm:h-80 overflow-hidden">
        {event.image_url ? (
          <img src={event.image_url} alt={event.title} className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full bg-white/5 flex items-center justify-center text-7xl">🎫</div>
        )}
        {/* Heavy bottom gradient */}
        <div className="absolute inset-0"
          style={{ background: 'linear-gradient(to bottom, rgba(5,3,12,0.25) 0%, rgba(5,3,12,0.5) 50%, rgba(5,3,12,0.97) 100%)' }}
        />

        {/* Back button */}
        <Link
          to="/events"
          className="absolute top-4 left-4 flex items-center gap-1.5 text-sm font-semibold text-white/80 hover:text-white transition-colors px-3 py-1.5 rounded-full"
          style={{ background: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(12px)' }}
        >
          <ArrowLeft className="w-4 h-4" /> Events
        </Link>

        {/* Live badge */}
        {isLive && (
          <span className="absolute top-4 right-4 text-xs font-black px-3 py-1 rounded-full animate-pulse"
            style={{ background: '#FF2D7820', color: '#FF2D78', border: '1px solid #FF2D7860' }}>
            🔴 LIVE NOW
          </span>
        )}

        {/* Event info overlaid on bottom of hero */}
        <div className="absolute bottom-0 left-0 right-0 px-5 pb-5">
          <h1 className="font-display text-foreground leading-tight mb-2"
            style={{ fontSize: 'clamp(1.8rem, 7vw, 2.8rem)' }}>
            {event.title}
          </h1>
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-1.5 text-xs text-white/70">
              <Calendar className="w-3.5 h-3.5" />
              {event.date ? format(new Date(event.date), 'EEEE, MMMM d, yyyy · h:mm a') : 'TBD'}
            </div>
            <div className="flex items-center gap-1.5 text-xs text-white/70">
              <MapPin className="w-3.5 h-3.5" />
              {event.venue}{event.city ? `, ${event.city}` : ''}
            </div>
          </div>
        </div>
      </div>

      {/* ── Content ── */}
      <div className="px-4 pt-8">

        {/* Section header */}
        <div className="mb-6">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="font-display text-2xl text-foreground flex items-center gap-2">
                <Ticket className="w-5 h-5 text-primary" />
                Available Tickets
                <span className="font-sans text-base font-normal text-muted-foreground">({listings.length})</span>
              </h2>
              <p className="text-sm text-muted-foreground mt-1">Buy tickets from other fans</p>
            </div>
            {adminUnlocked && (
              <span className="text-xs bg-amber-500/15 text-amber-400 border border-amber-500/30 px-2 py-0.5 rounded-full font-medium">
                🔑 Admin
              </span>
            )}
          </div>

          {isDemoOnly && (
            <div className="mt-3">
              <span className="text-xs font-medium px-2.5 py-1 rounded-full bg-amber-500/15 text-amber-400 border border-amber-500/30">
                🧪 Demo upgrades for testing
              </span>
            </div>
          )}
        </div>

        {/* Listings */}
        {listings.length === 0 ? (
          <div className="text-center py-16 glass-card rounded-2xl">
            <p className="text-4xl mb-3">🎟️</p>
            {isLiveMode && !adminUnlocked ? (
            <>
              <p className="font-bold text-foreground">Event has started!</p>
              <p className="text-sm text-muted-foreground mt-1 max-w-[240px] mx-auto leading-relaxed">
                Ticket sales are closed. Check the <strong>Upgrades</strong> tab to find seat upgrades at the venue.
              </p>
            </>
          ) : (
            <>
              <p className="font-bold text-foreground">No tickets available yet</p>
              <p className="text-sm text-muted-foreground mt-1 max-w-[220px] mx-auto leading-relaxed">
                Check back soon for available listings.
              </p>
            </>
          )}
          </div>
        ) : (
          <div className="space-y-4">
            {sorted.map(listing => (
              <ListingCard
                key={listing.id}
                listing={listing}
                isCheapest={listing.asking_price === cheapest}
                onUpgrade={setSelectedListing}
                mode="ticket"
              />
            ))}
          </div>
        )}
      </div>

      {selectedListing && (
        <PurchaseDialog
          event={event}
          listing={selectedListing}
          onClose={() => setSelectedListing(null)}
          mode="ticket"
        />
      )}
    </div>
  );
}