import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { format } from 'date-fns';
import { MapPin, Calendar, ArrowLeft, Ticket, Zap } from 'lucide-react';
import ListingCard from '@/components/events/ListingCard';
import PurchaseDialog from '@/components/events/PurchaseDialog';
import { getEventLiveStatus } from '@/lib/eventTiming';
import { logNavEvent } from '@/lib/navLogger';

export default function EventDetail() {
  const { id } = useParams();
  const [event, setEvent] = useState(null);
  const [listings, setListings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedListing, setSelectedListing] = useState(null);
  const [user, setUser] = useState(null);
  const [lookupError, setLookupError] = useState(false);

  const loadEvent = async (resolvedId) => {
    const [rawListings] = await Promise.all([
      base44.entities.Listing.filter({ event_id: resolvedId, status: 'active', proof_status: 'approved' }),
    ]);
    return rawListings;
  };

  useEffect(() => {
    let cancelled = false;
    base44.auth.me().then(setUser).catch(() => {});
    setLoading(true);
    setLookupError(false);

    const logCtx = { route_param: id, source_page: 'EventDetail', ts: new Date().toISOString() };

    (async () => {
      try {
        // 1. Try direct id lookup first
        let events = await base44.entities.Event.filter({ id });
        let lookupMethod = 'direct_id';

        // 2. If not found and id looks like a tm_ prefix (shouldn't normally reach here, but handle it)
        if ((!events || events.length === 0) && id && id.startsWith('tm_')) {
          lookupMethod = 'tm_prefix_strip';
          const tmId = id.replace('tm_', '');
          events = await base44.entities.Event.filter({ tm_id: tmId });
        }

        // 3. If still not found, try tm_id lookup (e.g. user navigated with a bare tm_id as the path param)
        if (!events || events.length === 0) {
          lookupMethod = 'tm_id_field';
          events = await base44.entities.Event.filter({ tm_id: id });
        }

        if (cancelled) return;
        const ev = events?.[0] || null;
        setEvent(ev);

        if (!ev) {
          setLookupError(true);
          console.warn('[EventDetail] lookup=all_methods MISS', { ...logCtx, lookup_method: lookupMethod });
          logNavEvent({ result: 'event_not_found', event: { id, tm_id: id }, sourcePage: 'EventDetail', generatedHref: `/events/${id}`, lookupMethod, failureReason: 'All lookup methods exhausted — event not in DB' });
          return;
        }
        const navResult = lookupMethod === 'direct_id' ? 'success' : 'lookup_fallback_success';
        console.info('[EventDetail] lookup success', { ...logCtx, lookup_method: lookupMethod, resolved_id: ev.id, event_source: ev.source || 'pg' });
        logNavEvent({ result: navResult, event: ev, sourcePage: 'EventDetail', generatedHref: `/events/${id}`, lookupMethod });

        const resolvedId = ev.id;
        const rawListings = await loadEvent(resolvedId);
        if (cancelled) return;

        const adminUnlocked = sessionStorage.getItem('pg_admin_unlocked') === '1';
        const timing = getEventLiveStatus(ev);
        const isLiveMode = timing.status === 'live' || timing.status === 'ended';
        const filtered = adminUnlocked ? rawListings : rawListings.filter(() => !isLiveMode);
        const real = filtered.filter(l => !l.notes?.startsWith('[DEMO]'));
        setListings(real.length > 0 ? real : filtered);
      } catch (err) {
        if (cancelled) return;
        console.error('[EventDetail] load error:', err);
        setLookupError(true);
        logNavEvent({ result: 'navigation_error', event: { id }, sourcePage: 'EventDetail', generatedHref: `/events/${id}`, lookupMethod: 'direct_id', failureReason: err?.message || 'Unknown error' });
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
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

  if (!loading && (!event || lookupError)) {
    // Log the "not loaded" screen being shown
    logNavEvent({ result: 'event_not_loaded', event: { id }, sourcePage: 'EventDetail', generatedHref: `/events/${id}`, lookupMethod: 'all_methods', failureReason: 'Event not loaded screen shown to user' });
    return (
      <div className="px-4 py-20 text-center space-y-4">
        <p className="text-5xl">🎟️</p>
        <div>
          <p className="font-bold text-foreground text-lg">Event not loaded yet</p>
          <p className="text-sm text-muted-foreground mt-1 max-w-xs mx-auto">
            This event may still be syncing. Try refreshing or go back to find it.
          </p>
        </div>
        <div className="flex flex-col gap-2 items-center">
          <button
            onClick={() => window.location.reload()}
            className="px-5 py-2.5 rounded-full font-bold text-sm"
            style={{ background: 'hsl(var(--primary))', color: 'hsl(var(--primary-foreground))' }}
          >
            Retry
          </button>
          <Link to="/events" className="text-sm text-muted-foreground underline">← Back to Events</Link>
        </div>
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
      <div className="relative h-72 sm:h-80 overflow-hidden" style={{ marginTop: 'env(safe-area-inset-top)' }}>
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

        {/* Live badge + Event Mode button */}
        {isLive && (
          <div className="absolute top-4 right-4 flex items-center gap-2">
            <span className="text-xs font-black px-3 py-1 rounded-full animate-pulse"
              style={{ background: '#FF2D7820', color: '#FF2D78', border: '1px solid #FF2D7860' }}>
              🔴 LIVE NOW
            </span>
            <Link to={`/event-mode/${id}`}
              className="text-xs font-black px-3 py-1.5 rounded-full flex items-center gap-1"
              style={{ background: 'rgba(255,230,0,0.2)', color: '#FFE600', border: '1px solid rgba(255,230,0,0.5)', backdropFilter: 'blur(12px)' }}>
              ⚡ Event Mode
            </Link>
          </div>
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
              {(event.event_start_utc || event.date) ? format(new Date(event.event_start_utc || event.date), 'EEEE, MMMM d, yyyy · h:mm a') : 'TBD'}
            </div>
            <div className="flex items-center gap-1.5 text-xs text-white/70">
              <MapPin className="w-3.5 h-3.5" />
              {event.venue}{event.city ? `, ${event.city}` : ''}
            </div>
          </div>
        </div>
      </div>

      {/* ── Event Mode CTA — shown for live and soon events ── */}
      {(isLive || timing.status === 'soon') && (
        <Link to={`/event-mode/${id}`}
          className="mx-4 mt-4 flex items-center gap-3 px-4 py-3.5 rounded-2xl"
          style={{
            background: 'linear-gradient(135deg, rgba(255,230,0,0.15), rgba(255,45,120,0.1))',
            border: '1px solid rgba(255,230,0,0.4)',
          }}>
          <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
            style={{ background: 'rgba(255,230,0,0.2)' }}>
            <Zap className="w-5 h-5" style={{ color: '#FFE600' }} />
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-black text-sm text-foreground leading-none">
              {isLive ? '🎟 You\'re at the event?' : '⏰ Event starts soon!'}
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {isLive ? 'Enter Event Mode for Flash Drops, upgrades & live activity' : 'Get ready — Event Mode goes live when it starts'}
            </p>
          </div>
          <span className="text-xs font-black px-3 py-1.5 rounded-full flex-shrink-0"
            style={{ background: isLive ? 'rgba(255,230,0,0.2)' : 'rgba(255,255,255,0.08)', color: isLive ? '#FFE600' : 'hsl(var(--muted-foreground))' }}>
            {isLive ? 'Enter →' : 'Soon'}
          </span>
        </Link>
      )}

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