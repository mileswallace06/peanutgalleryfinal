import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { format } from 'date-fns';
import { MapPin, Calendar, ArrowLeft, Ticket, TrendingDown, Star } from 'lucide-react';
import ListingCard from '@/components/events/ListingCard';
import PurchaseDialog from '@/components/events/PurchaseDialog';

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
      setEvent(events[0] || null);
      // Apply demo visibility rule: show demo only if no real listings
      const real = rawListings.filter(l => !l.notes?.startsWith('[DEMO]'));
      setListings(real.length > 0 ? real : rawListings);
    }).catch(console.error).finally(() => setLoading(false));
  }, [id]);

  if (loading) {
    return (
      <div className="px-4 py-8 space-y-4">
        <div className="h-56 bg-white/5 rounded-2xl animate-pulse" />
        <div className="h-6 w-48 bg-white/5 rounded animate-pulse" />
        <div className="space-y-4 mt-4">
          {[...Array(3)].map((_, i) => <div key={i} className="h-36 bg-white/5 rounded-2xl animate-pulse" />)}
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
  const isLive = event.status === 'live';
  const isDemoOnly = listings.length > 0 && listings.every(l => l.notes?.startsWith('[DEMO]'));

  return (
    <div className="px-4 py-6 pb-32">
      <Link to="/events" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-5 transition-colors">
        <ArrowLeft className="w-4 h-4" /> All Events
      </Link>

      <div className="mb-5">
        <h2 className="text-xl font-bold text-foreground">Upgrade Your Seats</h2>
        <p className="text-sm text-muted-foreground mt-0.5">Buy better seats from fans already at the event. Pay safely and confirm after transfer.</p>
      </div>

      {/* Hero */}
      <div className="relative rounded-2xl overflow-hidden mb-6 bg-muted h-52 sm:h-64">
        {event.image_url ? (
          <img src={event.image_url} alt={event.title} className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-6xl">🎫</div>
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/70 to-transparent" />
        <div className="absolute bottom-0 left-0 p-5 text-white">
          {isLive && (
            <span className="inline-block bg-red-500 text-white text-xs font-bold px-2 py-0.5 rounded-full mb-2">🔴 LIVE NOW</span>
          )}
          <h1 className="text-2xl sm:text-3xl font-bold leading-tight">{event.title}</h1>
          <div className="flex flex-wrap gap-3 mt-2 text-sm text-white/80">
            <span className="flex items-center gap-1">
              <Calendar className="w-3.5 h-3.5" />
              {event.date ? format(new Date(event.date), 'EEEE, MMMM d, yyyy · h:mm a') : 'TBD'}
            </span>
            <span className="flex items-center gap-1">
              <MapPin className="w-3.5 h-3.5" />
              {event.venue}{event.city ? `, ${event.city}` : ''}
            </span>
          </div>
        </div>
      </div>

      {/* Listings */}
      {(() => {
        const sorted = [...listings].sort((a, b) => a.asking_price - b.asking_price);
        const cheapest = sorted[0]?.asking_price;
        const TIER_RANK = { floor: 0, lower: 1, mid: 2, upper: 3 };
        const bestTier = sorted.reduce((best, l) => {
          if (!l.tier) return best;
          if (best === null || (TIER_RANK[l.tier] ?? 99) < (TIER_RANK[best] ?? 99)) return l.tier;
          return best;
        }, null);

        return (
          <>
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-bold text-xl text-foreground flex items-center gap-2">
                <Ticket className="w-5 h-5 text-primary" />
                Active Upgrades
                <span className="text-base font-normal text-muted-foreground">({listings.length})</span>
              </h2>
              {adminUnlocked && (
                <span className="text-xs bg-amber-100 text-amber-700 border border-amber-200 px-2 py-0.5 rounded-full font-medium">
                  🔑 Admin bypass active
                </span>
              )}
            </div>

            {listings.length > 0 && (
              <div className="flex flex-wrap gap-2 mb-4">
                <span className="inline-flex items-center gap-1.5 bg-green-50 border border-green-200 text-green-800 text-xs font-semibold px-3 py-1.5 rounded-full">
                  <TrendingDown className="w-3.5 h-3.5" /> From ${cheapest}/ticket
                </span>
                {bestTier && (
                  <span className="inline-flex items-center gap-1.5 bg-blue-50 border border-blue-200 text-blue-800 text-xs font-semibold px-3 py-1.5 rounded-full capitalize">
                    <Star className="w-3.5 h-3.5" /> Best: {bestTier} section
                  </span>
                )}
              </div>
            )}

            {isDemoOnly && (
              <div className="mb-3">
                <span className="text-xs font-medium px-2.5 py-1 rounded-full bg-amber-100 text-amber-700 border border-amber-200">
                  🧪 Demo upgrades for testing
                </span>
              </div>
            )}

            {listings.length === 0 ? (
              <div className="text-center py-14 text-muted-foreground glass-card rounded-2xl">
                <p className="text-3xl mb-3">🎟️</p>
                <p className="font-medium">No upgrades available yet</p>
                <p className="text-sm mt-1">Upgrades usually appear after the event starts. Check back in a few minutes.</p>
              </div>
            ) : (
              <div className="space-y-4">
                {sorted.map(listing => (
                  <ListingCard
                    key={listing.id}
                    listing={listing}
                    isCheapest={listing.asking_price === cheapest}
                    onUpgrade={setSelectedListing}
                  />
                ))}
              </div>
            )}
          </>
        );
      })()}

      {selectedListing && (
        <PurchaseDialog
          event={event}
          listing={selectedListing}
          onClose={() => setSelectedListing(null)}
        />
      )}
    </div>
  );
}