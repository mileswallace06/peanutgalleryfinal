import { Link } from 'react-router-dom';
import { Zap, Ticket, ChevronRight } from 'lucide-react';
import { UPGRADE_LISTING_TYPES, TICKET_LISTING_TYPES } from '@/lib/listingTypes';
import { isListingVisible } from '@/lib/listingVisibility';
import MoveCloserListing from './MoveCloserListing';

/**
 * MoveCloserRail — presents existing upgrade listings (live_upgrade,
 * venue_upgrade) under the MOVE CLOSER heading as compact vertical ticket cards. Handles ended / not-live / no-upgrade states using real event status.
 * Admission tickets are not shown inline here; a link to the event marketplace
 * preserves access without duplicating the checkout UI.
 */
function Heading() {
  return <div className="pg-move-closer-heading"><h2 className="pg-page-title">Move closer</h2><p>Seat upgrades for this event.</p></div>;
}

export default function MoveCloserRail({ listings, event, currentUserEmail, loading, onView }) {
  const visible = (listings || []).filter(l => isListingVisible(l, currentUserEmail));
  const upgrades = visible
    .filter(l => UPGRADE_LISTING_TYPES.includes(l.listing_type))
    .sort((a, b) => a.asking_price - b.asking_price);
  const admission = visible.filter(l => TICKET_LISTING_TYPES.includes(l.listing_type));

  const eventStatus = event?.status;
  const isEnded = eventStatus === 'ended';
  const isLive = eventStatus === 'live';

  if (loading) {
    return (
      <section>
        <Heading />
        <div className="pg-seat-offer-stack">
          {[1, 2, 3].map(i => (
            <div key={i} className="pg-seat-offer-skeleton animate-pulse"
              style={{ background: 'var(--ev-surface)', border: '1px solid var(--ev-border)' }} />
          ))}
        </div>
      </section>
    );
  }

  if (isEnded) {
    return (
      <section>
        <Heading />
        <div className="pg-state pg-live-empty">
          <p className="text-sm font-semibold" style={{ color: 'var(--ev-text)' }}>Event has ended</p>
          <p className="text-xs mt-1" style={{ color: 'var(--ev-text-muted)' }}>No more upgrades are available.</p>
        </div>
      </section>
    );
  }

  if (upgrades.length === 0) {
    return (
      <section>
        <Heading />
        <div className="pg-state pg-live-empty">
          <Zap className="w-5 h-5 mx-auto mb-2" style={{ color: 'var(--ev-teal)', opacity: 0.5 }} />
          <p className="text-sm font-semibold" style={{ color: 'var(--ev-text)' }}>
            {isLive ? 'No upgrades listed yet' : 'Upgrades open at showtime'}
          </p>
          <p className="text-xs mt-1" style={{ color: 'var(--ev-text-muted)' }}>
            {isLive
              ? 'Fans inside can list seat upgrades. Check back soon.'
              : 'Seat upgrades will appear here once the event goes live.'}
          </p>
          {admission.length > 0 && (
            <Link to={`/events/${event?.id}`} className="pg-live-admission">
              <Ticket size={18} />View all tickets<ChevronRight size={16} />
            </Link>
          )}
        </div>
      </section>
    );
  }

  return (
    <section>
      <Heading />
      <div className="pg-seat-offer-stack">
        {upgrades.map((l, index) => <MoveCloserListing key={l.id} listing={l} event={event} accent={index % 2 ? 'cyan' : 'mint'} currentUserEmail={currentUserEmail} onView={onView} />)}
      </div>
      {admission.length > 0 && (
        <Link to={`/events/${event?.id}`} className="pg-live-admission">
          <Ticket size={18} />Need admission tickets?<ChevronRight size={16} />
        </Link>
      )}
    </section>
  );
}