import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { format } from 'date-fns';
import { MapPin, Calendar, ArrowLeft, Ticket, ExternalLink } from 'lucide-react';
import ListingCard from '@/components/events/ListingCard';
import PurchaseDialog from '@/components/events/PurchaseDialog';

export default function EventDetailTM() {
  const { tmId } = useParams();
  const [event, setEvent] = useState(null);
  const [listings, setListings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedListing, setSelectedListing] = useState(null);

  useEffect(() => {
    // Fetch TM events and find the matching one by tm_id
    base44.functions.invoke('getTicketmasterEvents', { size: 100 })
      .then(res => {
        const tmEvents = res?.data?.events || [];
        const found = tmEvents.find(e => e.tm_id === tmId);
        if (found) {
          setEvent(found);
          // Check if we have a local PG event that maps to this TM event
          // For now, listings remain empty since TM events aren't in local DB
        }
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [tmId]);

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
        <div className="absolute inset-0"
          style={{ background: 'linear-gradient(to bottom, rgba(5,3,12,0.25) 0%, rgba(5,3,12,0.5) 50%, rgba(5,3,12,0.97) 100%)' }}
        />

        <Link
          to="/events"
          className="absolute top-4 left-4 flex items-center gap-1.5 text-sm font-semibold text-white/80 hover:text-white transition-colors px-3 py-1.5 rounded-full"
          style={{ background: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(12px)' }}
        >
          <ArrowLeft className="w-4 h-4" /> Events
        </Link>

        {/* TM badge + external link */}
        {event.tm_url && (
          <a
            href={event.tm_url}
            target="_blank"
            rel="noopener noreferrer"
            className="absolute top-4 right-4 flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-full"
            style={{ background: 'rgba(0,0,0,0.5)', color: 'rgba(255,255,255,0.7)', backdropFilter: 'blur(12px)', border: '1px solid rgba(255,255,255,0.15)' }}
          >
            Ticketmaster <ExternalLink className="w-3 h-3" />
          </a>
        )}

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
              {event.venue}{event.city ? `, ${event.city}` : ''}{event.state ? `, ${event.state}` : ''}
            </div>
          </div>
        </div>
      </div>

      {/* ── Content ── */}
      <div className="px-4 pt-8">

        <div className="mb-6">
          <h2 className="font-display text-2xl text-foreground flex items-center gap-2">
            <Ticket className="w-5 h-5 text-primary" />
            Fan Tickets
            <span className="font-sans text-base font-normal text-muted-foreground">({listings.length})</span>
          </h2>
          <p className="text-sm text-muted-foreground mt-1">Buy tickets from other fans at this event</p>
        </div>

        {listings.length === 0 ? (
          <div className="text-center py-16 glass-card rounded-2xl">
            <p className="text-4xl mb-3">🎟️</p>
            <p className="font-bold text-foreground">No fan tickets listed yet</p>
            <p className="text-sm text-muted-foreground mt-1 max-w-[240px] mx-auto leading-relaxed">
              Be the first to list your seats for this event.
            </p>
            <Link
              to="/create-listing"
              className="mt-4 inline-flex items-center gap-1.5 font-bold text-sm px-5 py-2.5 rounded-full"
              style={{ background: 'rgba(191,95,255,0.15)', color: '#BF5FFF', border: '1px solid rgba(191,95,255,0.3)' }}
            >
              🥜 List your seats
            </Link>

            {event.tm_url && (
              <div className="mt-5">
                <a
                  href={event.tm_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  View official tickets on Ticketmaster
                </a>
              </div>
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