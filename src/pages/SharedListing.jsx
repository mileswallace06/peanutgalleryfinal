import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowRight, Calendar, MapPin, RefreshCw, Ticket } from 'lucide-react';
import { base44 } from '@/api/base44Client';
import PublicPage from '@/components/PublicPage';
import EventThumbnail from '@/components/events/EventThumbnail';
import { UPGRADE_LISTING_TYPES } from '@/lib/listingTypes';
import { listingHandoffHref, loadSharedListing } from '@/lib/sharedListingDestination';
import { authPageHref } from '@/lib/brandedAuth';
import './shared-listing.css';

const reads = {
  invoke: (name, body) => base44.functions.invoke(name, body),
  filterEvents: query => base44.entities.Event.filter(query),
};
const price = amount => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount);
function eventDateLabel(event) {
  const dateMs = new Date(event.event_start_utc || event.date).getTime();
  const options = { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' };
  if (event.venue_timezone) {
    try { return new Intl.DateTimeFormat('en-US', { ...options, timeZone: event.venue_timezone }).format(dateMs); } catch { /* use explicit UTC below */ }
  }
  return `${new Intl.DateTimeFormat('en-US', { ...options, timeZone: 'UTC' }).format(dateMs)} · venue time unconfirmed`;
}

export default function SharedListing() {
  const { listingId } = useParams();
  const [result, setResult] = useState({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    setResult({ status: 'loading' });
    loadSharedListing(reads, listingId).then(value => { if (active) setResult(value); });
    return () => { active = false; };
  }, [listingId, attempt]);

  const { listing, event } = result;
  const upgrade = UPGRADE_LISTING_TYPES.includes(listing?.listing_type);
  const dateLabel = event ? eventDateLabel(event) : '';

  return (
    <PublicPage as="main" className="pg-shared-listing" data-kind={upgrade ? 'upgrade' : 'ticket'}>
      <div className="pg-shared-shell">
        <header className="pg-shared-brand">
          <Link to="/" aria-label="Peanut Gallery home"><Ticket aria-hidden="true" /><span>Peanut Gallery</span></Link>
          <span>Fan-to-fan tickets</span>
        </header>

        {result.status === 'loading' ? (
          <section className="pg-public-state pg-shared-state" role="status" aria-live="polite">
            <Ticket aria-hidden="true" /><h1>Opening this listing…</h1><p>Checking its current availability.</p>
          </section>
        ) : result.status !== 'available' ? (
          <section className="pg-public-state pg-shared-state" role="status" aria-live="polite">
            <Ticket aria-hidden="true" />
            <h1>{result.status === 'authentication-required' ? 'Sign in to check this listing' : result.status === 'error' ? 'We couldn’t load this listing' : 'This listing isn’t available'}</h1>
            <p>{result.status === 'authentication-required' ? 'We couldn’t confirm access to this listing. Try signing in, or try again.' : result.status === 'error' ? 'Please try again. We haven’t confirmed whether these tickets are available.'
              : 'It may be reserved, sold, removed, or past its event.'}</p>
            {result.status === 'authentication-required' && <Link className="pg-public-action" to={authPageHref('/login', `/listings/${encodeURIComponent(listingId)}`)}>Sign in to Peanut Gallery</Link>}
            {['error', 'authentication-required'].includes(result.status) && <button type="button" className="pg-public-action" onClick={() => setAttempt(value => value + 1)}><RefreshCw aria-hidden="true" /> Try again</button>}
            <Link className="pg-public-link" to="/events">Browse events</Link>
          </section>
        ) : (
          <>
            <article className="pg-shared-ticket" aria-labelledby="shared-listing-title">
              <EventThumbnail event={event} className="pg-shared-art" />
              <div className="pg-shared-copy">
                <p className="pg-shared-label">{upgrade ? 'Seat upgrade' : 'Ticket listing'} / Peanut Gallery</p>
                <h1 id="shared-listing-title">{event.title || 'Event listing'}</h1>
                <p className="pg-shared-fact"><Calendar aria-hidden="true" /><span>{dateLabel}</span></p>
                <p className="pg-shared-fact"><MapPin aria-hidden="true" /><span>{[event.venue, event.city, event.state].filter(Boolean).join(', ') || 'Venue to be confirmed'}</span></p>
              </div>
              <div className="pg-shared-stub">
                <dl className="pg-shared-seats">
                  <div><dt>Section</dt><dd>{listing.section || 'General admission'}</dd></div>
                  <div><dt>Row</dt><dd>{listing.row || 'Not specified'}</dd></div>
                  <div><dt>Quantity</dt><dd>{listing.quantity} {listing.quantity === 1 ? 'ticket' : 'tickets'}</dd></div>
                </dl>
                <div className="pg-shared-price"><strong>{price(listing.asking_price)}</strong><span>per ticket · buyer fee applies</span></div>
              </div>
            </article>
            {upgrade && <p className="pg-shared-notice"><strong>This is an upgrade, not admission.</strong> You must already have a ticket to this event. Location and eligibility requirements apply.</p>}
            {!upgrade && listing.requires_location && <p className="pg-shared-notice">This listing has a location requirement. Review the details before purchasing.</p>}
            <div className="pg-shared-next">
              <Link to={listingHandoffHref(listing)} className="pg-public-action">View this {upgrade ? 'upgrade' : 'ticket'} in PG <ArrowRight aria-hidden="true" /></Link>
              <p>Sign in to continue. Availability and the final price are checked in the purchase flow.</p>
            </div>
          </>
        )}

        <footer className="pg-shared-footer"><Link to="/terms">Terms</Link><Link to="/privacy">Privacy</Link><Link to="/">About Peanut Gallery</Link></footer>
      </div>
    </PublicPage>
  );
}
