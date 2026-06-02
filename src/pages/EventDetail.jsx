import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { format } from 'date-fns';
import { MapPin, Calendar, ArrowLeft, Ticket, Zap } from 'lucide-react';
import ListingCard from '@/components/events/ListingCard';
import PurchaseDialog from '@/components/events/PurchaseDialog';
import { getEventLiveStatus } from '@/lib/eventTiming';
import { logNavEvent } from '@/lib/navLogger';
import EventLookupDebugPanel from '@/components/debug/EventLookupDebugPanel';

export default function EventDetail() {
  const { id } = useParams();
  const [event, setEvent] = useState(null);
  const [listings, setListings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedListing, setSelectedListing] = useState(null);
  const [user, setUser] = useState(null);
  const [lookupError, setLookupError] = useState(false);
  const [lookupTrace, setLookupTrace] = useState(null);

  useEffect(() => {
    let cancelled = false;
    base44.auth.me().then(setUser).catch(() => {});
    setLoading(true);
    setLookupError(false);
    setLookupTrace(null);

    (async () => {
      const trace = { steps: [], finalCount: 0, finalId: null, syncTriggered: false, syncResult: null };

      try {
        // ── Step 1: direct internal id ──────────────────────────────────────
        let events = [];
        try {
          events = await base44.entities.Event.filter({ id });
        } catch (e) { /* ignore */ }
        trace.steps.push({ method: 'direct_id', count: events.length });

        // ── Step 2: tm_ prefix strip ─────────────────────────────────────────
        if (events.length === 0 && id && id.startsWith('tm_')) {
          const tmId = id.replace('tm_', '');
          try { events = await base44.entities.Event.filter({ tm_id: tmId }); } catch (e) { /* ignore */ }
          trace.steps.push({ method: 'tm_prefix_strip', count: events.length });
        }

        // ── Step 3: bare tm_id lookup ────────────────────────────────────────
        if (events.length === 0) {
          try { events = await base44.entities.Event.filter({ tm_id: id }); } catch (e) { /* ignore */ }
          trace.steps.push({ method: 'tm_id_field', count: events.length });
        }

        // ── Step 4: DEDUP CHECK — if multiple events found, pick newest ──────
        // ROOT CAUSE FIX: TM sync creates duplicate DB records for the same tm_id
        // because syncTMEvent is fire-and-forget from multiple concurrent clients.
        // If >1 result, pick the most recently updated one (has most complete data).
        if (events.length > 1) {
          console.warn(`[EventDetail] ${events.length} duplicate events found for id="${id}" — picking newest`);
          events = events.sort((a, b) => new Date(b.updated_date || 0) - new Date(a.updated_date || 0));
        }

        if (cancelled) return;
        trace.finalCount = events.length;
        trace.finalId = events[0]?.id || null;
        setLookupTrace({ ...trace });

        const ev = events[0] || null;
        setEvent(ev);

        if (!ev) {
          setLookupError(true);
          const lastMethod = trace.steps[trace.steps.length - 1]?.method || 'direct_id';
          logNavEvent({
            result: 'event_not_found',
            event: { id, tm_id: id },
            sourcePage: 'EventDetail',
            generatedHref: `/events/${id}`,
            lookupMethod: lastMethod,
            failureReason: `All lookup methods exhausted. Steps: ${trace.steps.map(s => `${s.method}=${s.count}`).join(', ')}`,
          });
          return;
        }

        const resolvedId = ev.id;
        const rawListings = await base44.entities.Listing.filter({ event_id: resolvedId, status: 'active', proof_status: 'approved' });
        if (cancelled) return;

        const adminUnlocked = sessionStorage.getItem('pg_admin_unlocked') === '1';
        const timing = getEventLiveStatus(ev);
        const isLiveMode = timing.status === 'live' || timing.status === 'ended';
        const filtered = adminUnlocked ? rawListings : rawListings.filter(() => !isLiveMode);
        const real = filtered.filter(l => !l.notes?.startsWith('[DEMO]'));
        setListings(real.length > 0 ? real : filtered);

        logNavEvent({
          result: trace.steps[0]?.count > 0 ? 'success' : 'lookup_fallback_success',
          event: ev,
          sourcePage: 'EventDetail',
          generatedHref: `/events/${id}`,
          lookupMethod: trace.steps.find(s => s.count > 0)?.method || 'direct_id',
        });
      } catch (err) {
        if (cancelled) return;
        console.error('[EventDetail] load error:', err);
        trace.steps.push({ method: 'caught_exception', count: 0, error: err?.message });
        setLookupTrace({ ...trace });
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
    return (
      <div className="pb-32">
        <div className="px-4 py-20 text-center space-y-4">
          <p className="text-5xl">🎟️</p>
          <div>
            <p className="font-bold text-foreground text-lg">Event not found</p>
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
        <EventLookupDebugPanel routeId={id} lookupTrace={lookupTrace} />
      </div>
    );
  }

  const adminUnlocked = user?.role === 'admin';
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
            <Link to={`/upgrades/${id}`}
              className="text-xs font-black px-3 py-1.5 rounded-full flex items-center gap-1"
              style={{ background: 'rgba(255,230,0,0.2)', color: '#FFE600', border: '1px solid rgba(255,230,0,0.5)', backdropFilter: 'blur(12px)' }}>
              ⚡ Live Hub
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

      {/* ── Event Mode CTA — always visible ── */}
      <Link to={`/upgrades/${event.id}`}
        className="mx-4 mt-4 flex items-center gap-3 px-4 py-4 rounded-2xl transition-all active:scale-[0.98]"
        style={isLive ? {
          background: 'linear-gradient(135deg, rgba(255,230,0,0.18), rgba(255,45,120,0.12))',
          border: '2px solid rgba(255,230,0,0.5)',
          boxShadow: '0 0 24px rgba(255,230,0,0.12)',
        } : timing.status === 'soon' ? {
          background: 'linear-gradient(135deg, rgba(191,95,255,0.12), rgba(0,200,255,0.08))',
          border: '1px solid rgba(191,95,255,0.4)',
        } : {
          background: 'hsl(var(--card))',
          border: '1px solid hsl(var(--border))',
        }}>
        <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 text-xl"
          style={{ background: isLive ? 'rgba(255,230,0,0.2)' : 'rgba(191,95,255,0.15)' }}>
          ⚡
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-black text-sm text-foreground leading-none">
            {isLive ? 'Live Hub — Open Now!' : timing.status === 'soon' ? 'Live Hub — Starting Soon' : 'Upgrades & Live Hub'}
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">
            {isLive
              ? 'Flash Drops, seat upgrades & live fan activity'
              : timing.status === 'soon'
              ? 'Flash Drops & upgrades open when the event starts'
              : 'Flash Drops & upgrades unlock at showtime'}
          </p>
        </div>
        <span className="text-xs font-black px-3 py-1.5 rounded-full flex-shrink-0"
          style={isLive
            ? { background: 'rgba(255,230,0,0.25)', color: '#FFE600', border: '1px solid rgba(255,230,0,0.4)' }
            : { background: 'hsl(var(--muted))', color: 'hsl(var(--muted-foreground))' }}>
          {isLive ? 'Open →' : timing.status === 'soon' ? 'Get Ready' : 'Preview'}
        </span>
      </Link>

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