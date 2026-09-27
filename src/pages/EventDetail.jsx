import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { format } from 'date-fns';
import { MapPin, Calendar, ArrowLeft, Ticket, Zap, Plus, Bell, ShieldCheck } from 'lucide-react';
import ListingCard from '@/components/events/ListingCard';
import PurchaseDialog from '@/components/events/PurchaseDialog';
import { getEventLiveStatus } from '@/lib/eventTiming';
import { logNavEvent } from '@/lib/navLogger';
import EventLookupDebugPanel from '@/components/debug/EventLookupDebugPanel';
import { Disclosure } from '@/components/ClarityUI';
import './event-detail-clarity.css';
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
            lookupTrace: { ...trace },
          });
          return;
        }

        const resolvedId = ev.id;
        const me = await base44.auth.me().catch(() => null);
        // Phase 1B-2: fetch listings through the safe participant view function.
        // No direct Listing entity access — private fields never reach the client.
        let safeListings = [];
        try {
          const res = await base44.functions.invoke('getListingParticipantView', {
            action: 'list_active_by_event',
            event_id: resolvedId,
          });
          safeListings = res?.data?.listings || [];
        } catch (fnErr) {
          console.error('[EventDetail] listing fetch failed:', fnErr);
          safeListings = [];
        }
        if (cancelled) return;

        const adminUnlocked = me?.role === 'admin' || sessionStorage.getItem('pg_admin_unlocked') === '1';
        const timing = getEventLiveStatus(ev);
        const real = safeListings.filter(l => !l.is_demo_listing);
        setListings(real.length > 0 ? real : safeListings);

        logNavEvent({
            result: trace.steps[0]?.count > 0 ? 'success' : 'lookup_fallback_success',
            event: ev,
            sourcePage: 'EventDetail',
            generatedHref: `/events/${id}`,
            lookupMethod: trace.steps.find(s => s.count > 0)?.method || 'direct_id',
            lookupTrace: { ...trace },
          });
      } catch (err) {
        if (cancelled) return;
        console.error('[EventDetail] load error:', err);
        trace.steps.push({ method: 'caught_exception', count: 0, error: err?.message });
        setLookupTrace({ ...trace });
        setLookupError(true);
        logNavEvent({ result: 'navigation_error', event: { id }, sourcePage: 'EventDetail', generatedHref: `/events/${id}`, lookupMethod: 'direct_id', failureReason: err?.message || 'Unknown error', lookupTrace: { ...trace } });
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [id]);

  if (loading) {
    return (
      <div className="pg-secondary-page pg-event-detail pg-event-loading" role="status" aria-label="Loading event">
        <div className="pg-event-loading-photo animate-pulse" />
        <div className="h-8 w-3/4 bg-white/5 rounded animate-pulse" />
        <div className="h-20 bg-white/5 rounded animate-pulse" />
      </div>
    );
  }

  if (!event || lookupError) {
    return (
      <div className="pg-secondary-page pg-event-detail">
        <div className="pg-event-empty">
          <Ticket aria-hidden="true" className="pg-event-empty-icon" />
          <h1 className="font-display">Event not found</h1>
          <p>This event may still be syncing. Try refreshing or go back to find it.</p>
          <button onClick={() => window.location.reload()} className="pg-event-button">Retry</button>
          <Link to="/events" className="pg-event-text-link"><ArrowLeft aria-hidden="true" /> Back to events</Link>
        </div>
        {user?.role === 'admin' && <EventLookupDebugPanel routeId={id} lookupTrace={lookupTrace} />}
      </div>
    );
  }

  const adminUnlocked = user?.role === 'admin' || sessionStorage.getItem('pg_admin_unlocked') === '1';
  const timing = getEventLiveStatus(event);
  const isLive = timing.status === 'live';
  const isLiveMode = timing.status === 'live' || timing.status === 'ended';
  const isDemoOnly = listings.length > 0 && listings.some(l => l.is_demo_listing);
  const sorted = [...listings].sort((a, b) => a.asking_price - b.asking_price);
  const cheapest = sorted[0]?.asking_price;

  return (
    <div className="pg-secondary-page pg-event-detail">
      <header className="pg-event-hero">
        <div className="pg-event-hero-photo">
          {event.image_url ? (
            <img src={event.image_url} alt={event.title} />
          ) : (
            <div className="pg-event-photo-fallback"><Ticket aria-hidden="true" /><span>Peanut Gallery</span></div>
          )}
          <Link to="/events" className="pg-event-back"><ArrowLeft aria-hidden="true" /> Events</Link>
          {isLive && <span className="pg-event-status">Live now</span>}
          {timing.status === 'soon' && <span className="pg-event-status">Starting soon</span>}
          {timing.status === 'ended' && <span className="pg-event-status">Event ended</span>}
        </div>
        <div className="pg-event-summary">
          <p className="pg-event-eyebrow">Peanut Gallery / Event</p>
          <h1 className="font-display">{event.title}</h1>
          <div className="pg-event-facts">
            <p><Calendar aria-hidden="true" /><span>{(event.event_start_utc || event.date) ? format(new Date(event.event_start_utc || event.date), 'EEEE, MMMM d, yyyy · h:mm a') : 'Date to be confirmed'}</span></p>
            <p><MapPin aria-hidden="true" /><span>{event.venue}{event.city ? `, ${event.city}` : ''}</span></p>
          </div>
          <div className="pg-event-primary">
            {listings.length > 0 ? (
              <a href="#event-tickets" className="pg-event-button"><Ticket aria-hidden="true" /> View ticket listings</a>
            ) : isLiveMode && !adminUnlocked ? (
              <Link to={`/upgrades/${event.id}`} className="pg-event-button"><Zap aria-hidden="true" /> {timing.status === 'ended' ? 'Open Live Hub' : 'Find seat upgrades'}</Link>
            ) : (
              <a href="#event-tickets" className="pg-event-button"><Ticket aria-hidden="true" /> Check ticket availability</a>
            )}
            <p>Fan-to-fan tickets inside Peanut Gallery.</p>
          </div>
        </div>
      </header>

      <div className="pg-event-content">
        <section id="event-tickets" className="pg-event-listing-section" aria-labelledby="event-tickets-heading">
          <div className="pg-event-section-heading">
            <h2 id="event-tickets-heading" className="font-display">Ticket listings <span>({listings.length})</span></h2>
            <p>Choose a listing to see its seats and purchase details.</p>
            <div className="pg-event-badges">
              {adminUnlocked && <span className="pg-event-notice">Admin</span>}
              {isDemoOnly && <span className="pg-event-notice">Demo upgrades for testing</span>}
            </div>
          </div>

          {listings.length === 0 ? (
            isLiveMode && !adminUnlocked ? (
              <div className="pg-event-empty">
                <h3>{timing.status === 'ended' ? 'Pre-event ticket sales have closed' : 'Event is live — check Upgrades'}</h3>
                <p>{timing.status === 'ended'
                  ? 'This event has ended. Visit the Live Hub for this event.'
                  : 'Pre-event ticket sales have closed. Fans inside are listing seat upgrades right now.'}</p>
                <Link to={`/upgrades/${event.id}`} className="pg-event-text-link"><Zap aria-hidden="true" /> Open Live Hub</Link>
              </div>
            ) : (
              <div className="pg-event-empty">
                <h3>No tickets listed yet</h3>
                <p>Be the first to sell for this event and set the price.</p>
                <Link to={`/create-listing?event_id=${event.id}`} className="pg-event-button pg-event-button-secondary"><Plus aria-hidden="true" /> List tickets for this event</Link>
              </div>
            )
          ) : (
            <div className="pg-event-listings">
              {sorted.map(listing => (
                <ListingCard
                  key={listing.id}
                  listing={listing}
                  isCheapest={listing.asking_price === cheapest}
                  onUpgrade={setSelectedListing}
                  mode="ticket"
                  currentUserEmail={user?.email}
                />
              ))}
            </div>
          )}
        </section>

        <div className="pg-event-secondary">
          <Disclosure
            title={isLive ? 'Live Hub — open now' : timing.status === 'soon' ? 'Live Hub — starting soon' : 'Upgrades & Live Hub'}
            description="Seat upgrades and live fan activity"
            defaultOpen={isLive || timing.status === 'soon'}
          >
            <p>{isLive
              ? 'Flash Drops, seat upgrades & live fan activity'
              : timing.status === 'soon'
              ? 'Flash Drops & upgrades open when the event starts'
              : timing.status === 'ended'
              ? 'This event has ended.'
              : 'Flash Drops & upgrades unlock at showtime'}</p>
            <Link to={`/upgrades/${event.id}`} className="pg-event-text-link"><Zap aria-hidden="true" /> {isLive ? 'Open Live Hub' : timing.status === 'soon' ? 'Get ready in Live Hub' : 'View Live Hub'}</Link>
          </Disclosure>

          {listings.length === 0 && !(isLiveMode && !adminUnlocked) && (
            <>
              <Disclosure title="How Peanut Gallery works" description="Fan tickets, payment protection, and live upgrades">
                <div className="pg-event-explainer">
                  {[
                    { icon: Ticket, title: 'Fan-to-fan tickets', body: "Real fans sell tickets they can't use — no scalpers, no bots." },
                    { icon: ShieldCheck, title: 'Escrow protected', body: 'Your money is held safely until you confirm you got the tickets.' },
                    { icon: Zap, title: 'Live upgrades at showtime', body: "Once the event starts, better seats get listed by fans who can't use them." },
                  ].map(({ icon: Icon, title, body }) => (
                    <div key={title}><Icon aria-hidden="true" /><div><h3>{title}</h3><p>{body}</p></div></div>
                  ))}
                </div>
              </Disclosure>
              <Disclosure title="Ticket alerts" description="Get notified when tickets drop">
                <p>We'll alert you the moment a listing goes live.</p>
                <Link to="/account-settings" className="pg-event-text-link"><Bell aria-hidden="true" /> Manage alerts</Link>
              </Disclosure>
            </>
          )}
        </div>
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
