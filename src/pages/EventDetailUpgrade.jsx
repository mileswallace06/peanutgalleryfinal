import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { format } from 'date-fns';
import { MapPin, Calendar, ArrowLeft, Zap } from 'lucide-react';
import ListingCard from '@/components/events/ListingCard';
import PurchaseDialog from '@/components/events/PurchaseDialog';
import TransferWindowBadge from '@/components/events/TransferWindowBadge';
import CommunityTransferReport from '@/components/listings/CommunityTransferReport';
import { getEventLiveStatus } from '@/lib/eventTiming';
import { getTransferWindowInfo } from '@/lib/transferWindow';

export default function EventDetailUpgrade() {
  const { id } = useParams();
  const [event, setEvent] = useState(null);
  const [listings, setListings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedListing, setSelectedListing] = useState(null);
  const [user, setUser] = useState(null);
  const [transferReports, setTransferReports] = useState([]);

  useEffect(() => {
    base44.auth.me().then(setUser).catch(() => {});
    base44.entities.TransferReport.filter({ event_id: id }).then(setTransferReports).catch(() => {});
    Promise.all([
      base44.entities.Event.filter({ id }),
      base44.entities.Listing.filter({ event_id: id, status: 'active', proof_status: 'approved' }),
    ]).then(([events, rawListings]) => {
      const ev = events[0] || null;
      setEvent(ev);
      const adminUnlocked = sessionStorage.getItem('pg_admin_unlocked') === '1';
      const timing = ev ? getEventLiveStatus(ev) : null;
      const isLiveMode = timing ? timing.status === 'live' : false;
      // Upgrades tab shows LIVE-only listings (unless admin bypass)
      const filtered = adminUnlocked
        ? rawListings
        : rawListings.filter(() => isLiveMode);
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
        <Link to="/upgrades" className="text-primary text-sm mt-3 inline-block">← Back to upgrades</Link>
      </div>
    );
  }

  const adminUnlocked = sessionStorage.getItem('pg_admin_unlocked') === '1';
  const timing = getEventLiveStatus(event);
  const isLive = timing.status === 'live';
  const isLiveMode = timing.status === 'live';
  const isDemoOnly = listings.length > 0 && listings.every(l => l.notes?.startsWith('[DEMO]'));
  const sorted = [...listings].sort((a, b) => a.asking_price - b.asking_price);
  const cheapest = sorted[0]?.asking_price;
  const transferInfo = getTransferWindowInfo(event);
  // Event-level window is ADVISORY only. Purchases are only blocked by listing-level transfer_status.
  const upgradesBlocked = false;

  return (
    <div className="pb-32">

      {/* ── Hero ── */}
      <div className="relative h-72 sm:h-80 overflow-hidden" style={{ marginTop: 'env(safe-area-inset-top)' }}>
        {event.image_url ? (
          <img src={event.image_url} alt={event.title} className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full bg-white/5 flex items-center justify-center text-7xl">🎫</div>
        )}
        <div className="absolute inset-0"
          style={{ background: 'linear-gradient(to bottom, rgba(5,3,12,0.25) 0%, rgba(5,3,12,0.5) 50%, rgba(5,3,12,0.97) 100%)' }}
        />

        <Link
          to="/upgrades"
          className="absolute top-4 left-4 flex items-center gap-1.5 text-sm font-semibold text-white/80 hover:text-white transition-colors px-3 py-1.5 rounded-full"
          style={{ background: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(12px)' }}
        >
          <ArrowLeft className="w-4 h-4" /> Upgrades
        </Link>

        {isLive && (
          <span className="absolute top-4 right-4 text-xs font-black px-3 py-1 rounded-full animate-pulse"
            style={{ background: '#FF2D7820', color: '#FF2D78', border: '1px solid #FF2D7860' }}>
            🔴 LIVE NOW
          </span>
        )}

        <div className="absolute bottom-0 left-0 right-0 px-5 pb-5">
          <h1 className="font-display text-foreground leading-tight mb-2"
            style={{ fontSize: 'clamp(1.8rem, 7vw, 2.8rem)' }}>
            {event.title}
          </h1>
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-1.5 text-xs text-white/70">
              <Calendar className="w-3.5 h-3.5" />
              {(event.event_start_utc || event.date) ? format(new Date(event.event_start_utc || event.date), 'EEEE, MMMM d, yyyy · h:mm a') : 'TBD'}
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

        {/* Transfer window status (event-level advisory) */}
        <div className="mb-3">
          <TransferWindowBadge event={event} expanded showCountdown />
        </div>

        {/* Community transfer reporting */}
        {user && (
          <div className="mb-4">
            <CommunityTransferReport
              event={event}
              userEmail={user.email}
              recentReports={transferReports}
              onSubmitted={() => base44.entities.TransferReport.filter({ event_id: id }).then(setTransferReports).catch(() => {})}
            />
          </div>
        )}

        {/* Location-lock notice */}
        <div className="mb-5 rounded-2xl px-4 py-3 flex items-start gap-3"
          style={{ background: 'rgba(0,255,135,0.06)', border: '1px solid rgba(0,255,135,0.2)' }}>
          <Zap className="w-4 h-4 mt-0.5 flex-shrink-0" style={{ color: '#00FF87' }} />
          <p className="text-xs text-muted-foreground leading-relaxed">
            <span className="font-bold text-foreground">Location-locked</span> — only fans physically at the venue can buy upgrades. No scalpers, ever.
          </p>
        </div>

        <div className="mb-6">
          <div className="flex items-start justify-between">
            <div>
              <h2 className="font-display text-2xl text-foreground flex items-center gap-2">
                <Zap className="w-5 h-5" style={{ color: '#00FF87' }} />
                Seat Upgrades
                <span className="font-sans text-base font-normal text-muted-foreground">({listings.length})</span>
              </h2>
              <p className="text-sm text-muted-foreground mt-1">Move to better seats from fans already at the venue</p>
            </div>
            {adminUnlocked && (
              <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full opacity-50"
                style={{ background: 'rgba(255,255,255,0.07)', color: 'rgba(255,255,255,0.5)', border: '1px solid rgba(255,255,255,0.1)' }}>
                admin
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



        {listings.length === 0 ? (
          <div className="text-center py-16 glass-card rounded-2xl">
            <p className="text-4xl mb-3">⚡</p>
          {!isLiveMode && !adminUnlocked ? (
            <>
              <p className="font-bold text-foreground">Event hasn't started yet</p>
              <p className="text-sm text-muted-foreground mt-1 max-w-[240px] mx-auto leading-relaxed">
                Seat upgrades unlock the moment the event begins. Come back then!
              </p>
            </>
          ) : (
            <>
              <p className="font-bold text-foreground">No upgrades available yet</p>
              <p className="text-sm text-muted-foreground mt-1 max-w-[220px] mx-auto leading-relaxed">
                Upgrades usually appear after the event starts. Check back soon.
              </p>
            </>
          )}
          </div>
        ) : (
          <div className="space-y-4">
            {/* Marketplace status bar */}
            <div className="flex items-center justify-between px-1 mb-1">
              <span className="text-xs font-semibold text-foreground/80">
                {listings.length} live listing{listings.length !== 1 ? 's' : ''}
              </span>
              <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-green-400 inline-block animate-pulse" />
                Updated recently
              </span>
            </div>
            {sorted.map(listing => (
              <ListingCard
                key={listing.id}
                listing={listing}
                isCheapest={listing.asking_price === cheapest}
                onUpgrade={upgradesBlocked ? undefined : setSelectedListing}
                mode="upgrade"
                transferWarning={transferInfo.showWarning ? transferInfo.sublabel : null}
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
          mode="upgrade"
        />
      )}
    </div>
  );
}