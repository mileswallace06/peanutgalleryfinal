import { useState, useEffect } from 'react';
import { useParams, Link, useNavigate, useLocation } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { getEventDateDisplay } from '@/lib/eventDateDisplay';
import { reliableTime } from '@/lib/sellingEventTiming';
import { MapPin, Calendar, ArrowLeft, Ticket, ExternalLink, Plus } from 'lucide-react';

/** Infer vendor label + homepage from a ticket URL domain */
function inferVendor(url) {
  if (!url) return { label: 'Official Tickets', homepage: null };
  try {
    const host = new URL(url).hostname.toLowerCase();
    if (host.includes('ticketmaster')) return { label: 'Ticketmaster', homepage: 'https://www.ticketmaster.com' };
    if (host.includes('ticketweb')) return { label: 'TicketWeb', homepage: 'https://www.ticketweb.com' };
    if (host.includes('axs')) return { label: 'AXS', homepage: 'https://www.axs.com' };
    if (host.includes('seatgeek')) return { label: 'SeatGeek', homepage: 'https://seatgeek.com' };
    if (host.includes('stubhub')) return { label: 'StubHub', homepage: 'https://www.stubhub.com' };
    return { label: host.replace(/^www\./, ''), homepage: `https://${host}` };
  } catch {
    return { label: 'Official Tickets', homepage: null };
  }
}
import ListingCard from '@/components/events/ListingCard';
import PurchaseDialog from '@/components/events/PurchaseDialog';
import { Disclosure } from '@/components/ClarityUI';
import './event-detail-clarity.css';

// Older synced records can lack the zone carried by the selected provider card.
// Use it only for display when identity, start instant and venue agree; local
// timing/TBA fields and the Event object used by listing actions remain intact.
function withMatchingRouterTimezone(event, passedEvent, tmId) {
  const normalize = value => typeof value === 'string' ? value.trim().toLowerCase() : '';
  const localZone = typeof event.venue_timezone === 'string' ? event.venue_timezone.trim() : event.venue_timezone;
  if (localZone || !tmId || event.tm_id !== tmId || passedEvent?.tm_id !== tmId) return event;
  const start = reliableTime(event.event_start_utc || event.date);
  if (start === null || start !== reliableTime(passedEvent.event_start_utc || passedEvent.date)) return event;
  if (!normalize(event.venue) || normalize(event.venue) !== normalize(passedEvent.venue)) return event;
  for (const field of ['city', 'state']) {
    const localValue = normalize(event[field]);
    const passedValue = normalize(passedEvent[field]);
    if (localValue && passedValue && localValue !== passedValue) return event;
  }
  const timeZone = typeof passedEvent.venue_timezone === 'string' ? passedEvent.venue_timezone.trim() : '';
  if (!timeZone) return event;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
  } catch {
    return event;
  }
  return { ...event, venue_timezone: timeZone };
}

export default function EventDetailTM() {
  const { tmId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  // Full TM event data passed from the Events list — avoids the broken
  // syncTMEvent(tm_id-only) fallback when the event hasn't synced to DB yet.
  const passedEvent = location.state?.tmEvent;
  const [event, setEvent] = useState(null); // TM event data
  const [localEventId, setLocalEventId] = useState(null); // local DB Event.id if it exists
  const [listings, setListings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedListing, setSelectedListing] = useState(null);
  const [creatingEvent, setCreatingEvent] = useState(false);
  const [user, setUser] = useState(null);

  useEffect(() => {
    base44.auth.me().then(setUser).catch(() => {});
    const logCtx = { route_param: tmId, source_page: 'EventDetailTM', event_source: 'ticketmaster', ts: new Date().toISOString() };

    // First, fetch local Event by tm_id to get synced event data + ID
    base44.entities.Event.filter({ tm_id: tmId }).then(localEvents => {
      let eventData = null;
      let eventId = null;

      if (localEvents.length > 0) {
        const localEv = localEvents[0];
        eventId = localEv.id;
        console.info('[EventDetailTM] lookup=db_tm_id success | localId:', eventId, logCtx);
        eventData = {
          tm_id: localEv.tm_id,
          title: localEv.title,
          venue: localEv.venue,
          city: localEv.city,
          state: localEv.state,
          date: localEv.date || localEv.event_start_local,
          event_start_utc: localEv.event_start_utc,
          venue_timezone: localEv.venue_timezone,
          date_tba: localEv.date_tba,
          time_tba: localEv.time_tba,
          no_specific_time: localEv.no_specific_time,
          image_url: localEv.image_url,
          tm_url: localEv.tm_url,
        };
        setLocalEventId(eventId);
        setEvent(eventData);
        
        // Phase 1B-2: fetch listings through the safe participant view function
        return base44.functions.invoke('getListingParticipantView', { action: 'list_active_by_event', event_id: eventId }).then(res => res?.data?.listings || []).catch(() => []);
      }

      // DB miss — but the Events list passed full TM data via router state.
      // Use it directly; no need for the syncTMEvent(tm_id-only) fallback,
      // which 400s because title is missing.
      if (passedEvent) {
        console.info('[EventDetailTM] lookup=router_state success | tmId:', tmId, logCtx);
        setEvent(passedEvent);
        return [];
      }

      // DB miss, no passed data — deep link. Best-effort sync + tmSuggest.
      console.info('[EventDetailTM] lookup=db_tm_id miss — triggering syncTMEvent | tmId:', tmId, logCtx);
      return base44.functions.invoke('syncTMEvent', { tm_id: tmId }).then(async (syncRes) => {
        const syncedId = syncRes?.data?.id;
        if (syncedId) {
          // Re-fetch the now-synced event
          const synced = await base44.entities.Event.filter({ id: syncedId });
          if (synced.length > 0) {
            const localEv = synced[0];
            setLocalEventId(localEv.id);
            setEvent({
              tm_id: localEv.tm_id,
              title: localEv.title,
              venue: localEv.venue,
              city: localEv.city,
              state: localEv.state,
              date: localEv.date || localEv.event_start_local,
              event_start_utc: localEv.event_start_utc,
              venue_timezone: localEv.venue_timezone,
              date_tba: localEv.date_tba,
              time_tba: localEv.time_tba,
              no_specific_time: localEv.no_specific_time,
              image_url: localEv.image_url,
              tm_url: localEv.tm_url,
            });
            return base44.functions.invoke('getListingParticipantView', { action: 'list_active_by_event', event_id: localEv.id }).then(res => res?.data?.listings || []).catch(() => []);
          }
        }
        // syncTMEvent had no data — try a keyword TM search as last resort
        return base44.functions.invoke('tmSuggest', { keyword: tmId, size: 5 }).then(sugRes => {
          const found = (sugRes?.data?.events || []).find(e => e.tm_id === tmId);
          if (found) {
            console.info('[EventDetailTM] lookup=tm_suggest success | title:', found.title, logCtx);
            setEvent(found);
          } else {
            console.warn('[EventDetailTM] lookup=all_methods_exhausted', logCtx);
          }
          return [];
        }).catch(() => []);
      }).catch(() => []);
    }).then(async rawListings => {
      if (Array.isArray(rawListings) && rawListings.length > 0) {
        const real = rawListings.filter(l => !l.is_demo_listing);
        setListings(real.length > 0 ? real : rawListings);
      }
    }).catch(err => {
      console.error('[EventDetailTM] load error', logCtx, err);
    }).finally(() => setLoading(false));
  }, [tmId]);

  // Upsert a local Event record from TM data, then navigate to CreateListing
  const handleListTickets = async () => {
    setCreatingEvent(true);
    let eventId = localEventId;
    if (!eventId) {
      // Create a local Event record from TM data
      const created = await base44.entities.Event.create({
        title: event.title,
        venue: event.venue,
        city: event.city,
        state: event.state,
        date: event.date,
        image_url: event.image_url,
        tm_id: event.tm_id,
        tm_url: event.tm_url,
        status: 'upcoming',
      });
      eventId = created.id;
      setLocalEventId(eventId);
    }
    setCreatingEvent(false);
    navigate(`/create-listing?event_id=${eventId}`);
  };

  if (loading) {
    return (
      <div className="pg-secondary-page pg-event-detail pg-event-loading" role="status" aria-label="Loading event">
        <div className="pg-event-loading-photo animate-pulse" />
        <div className="h-8 w-3/4 bg-white/5 rounded animate-pulse" />
        <div className="h-20 bg-white/5 rounded animate-pulse" />
      </div>
    );
  }

  if (!event) {
    return (
      <div className="pg-secondary-page pg-event-detail">
        <div className="pg-event-empty">
          <Ticket aria-hidden="true" className="pg-event-empty-icon" />
          <h1 className="font-display">Event not found</h1>
          <p>Return to events to choose another show.</p>
          <Link to="/events" className="pg-event-text-link"><ArrowLeft aria-hidden="true" /> Back to events</Link>
        </div>
      </div>
    );
  }

  const sorted = [...listings].sort((a, b) => a.asking_price - b.asking_price);
  const cheapest = sorted[0]?.asking_price;
  const vendor = inferVendor(event.tm_url);
  const displayEvent = withMatchingRouterTimezone(event, passedEvent, tmId);

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
        </div>
        <div className="pg-event-summary">
          <p className="pg-event-eyebrow">Peanut Gallery / Event</p>
          <h1 className="font-display">{event.title}</h1>
          <div className="pg-event-facts">
            <p><Calendar aria-hidden="true" /><span>{getEventDateDisplay(displayEvent)?.detailLabel || 'Date to be confirmed'}</span></p>
            <p><MapPin aria-hidden="true" /><span>{event.venue}{event.city ? `, ${event.city}` : ''}{event.state ? `, ${event.state}` : ''}</span></p>
          </div>
          <div className="pg-event-primary">
            {event.tm_url ? (
              <>
                <a href={event.tm_url} target="_blank" rel="noopener noreferrer" aria-label={`View on ${vendor.label} (opens in new tab)`} className="pg-event-button">
                  View on {vendor.label} <ExternalLink aria-hidden="true" />
                </a>
                <p>Official tickets. Primary marketplace tickets via {vendor.label}. Opens externally.</p>
              </>
            ) : (
              <>
                <a href="#event-tickets" className="pg-event-button"><Ticket aria-hidden="true" /> View Peanut Gallery listings</a>
                <p>No official link available.</p>
              </>
            )}
          </div>
        </div>
      </header>

      <div className="pg-event-content">
        <section id="event-tickets" className="pg-event-listing-section" aria-labelledby="event-tickets-heading">
          <div className="pg-event-section-heading">
            <h2 id="event-tickets-heading" className="font-display">Peanut Gallery listings <span>({listings.length})</span></h2>
            <p>Fan-to-fan tickets listed directly inside Peanut Gallery.</p>
          </div>
          {listings.length === 0 ? (
            <div className="pg-event-empty">
              <h3>No Peanut Gallery listings yet</h3>
              <p>Be the first to list your tickets for this event inside Peanut Gallery.</p>
            </div>
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

        <Disclosure title="Sell tickets for this event" description="Create a Peanut Gallery listing">
          <p>List your tickets for this event inside Peanut Gallery.</p>
          <button onClick={handleListTickets} disabled={creatingEvent} className="pg-event-button pg-event-button-secondary">
            {creatingEvent
              ? <span className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" aria-hidden="true" />
              : <Plus aria-hidden="true" />}
            {creatingEvent ? 'Preparing your listing…' : 'List tickets for this event'}
          </button>
        </Disclosure>
      </div>

      {selectedListing && (
        <PurchaseDialog
          event={{ ...event, id: localEventId }}
          listing={selectedListing}
          onClose={() => setSelectedListing(null)}
          mode="ticket"
        />
      )}
    </div>
  );
}
