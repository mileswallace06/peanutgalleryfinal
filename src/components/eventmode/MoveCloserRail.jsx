import { Link } from 'react-router-dom';
import { Zap } from 'lucide-react';
import { UPGRADE_LISTING_TYPES, TICKET_LISTING_TYPES } from '@/lib/listingTypes';
import { isListingVisible } from '@/lib/listingVisibility';
import MoveCloserListing from './MoveCloserListing';

/**
 * MoveCloserRail — presents existing upgrade listings (live_upgrade,
 * venue_upgrade) under the MOVE CLOSER heading as a horizontally scrollable
 * rail. Handles ended / not-live / no-upgrade states using real event status.
 * Admission tickets are not shown inline here; a link to the event marketplace
 * preserves access without duplicating the checkout UI.
 */
function Heading() {
  return (
    <div className="flex items-center gap-2 mb-3">
      <span className="h-3.5 w-1 rounded-full" style={{ background: 'var(--ev-teal)' }} />
      <h2 className="font-display uppercase tracking-wide" style={{ color: 'var(--ev-text)', fontSize: '1.15rem' }}>
        Move Closer
      </h2>
    </div>
  );
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
        <div className="flex gap-3 overflow-x-auto pb-1" style={{ scrollbarWidth: 'none' }}>
          {[1, 2, 3].map(i => (
            <div key={i} className="flex-shrink-0 w-64 h-40 rounded-2xl animate-pulse"
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
        <div className="rounded-2xl p-6 text-center" style={{ background: 'var(--ev-surface)', border: '1px solid var(--ev-border)' }}>
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
        <div className="rounded-2xl p-6 text-center" style={{ background: 'var(--ev-surface)', border: '1px solid var(--ev-border)' }}>
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
            <Link to={`/events/${event?.id}`} className="inline-flex items-center gap-1 mt-3 text-xs font-semibold"
              style={{ color: 'var(--ev-teal)' }}>
              View all tickets →
            </Link>
          )}
        </div>
      </section>
    );
  }

  return (
    <section>
      <Heading />
      <div className="flex gap-3 overflow-x-auto pb-2 -mx-4 px-4"
        style={{ scrollbarWidth: 'none', scrollSnapType: 'x mandatory', WebkitOverflowScrolling: 'touch' }}>
        {upgrades.map(l => (
          <div key={l.id} style={{ scrollSnapAlign: 'start' }}>
            <MoveCloserListing listing={l} currentUserEmail={currentUserEmail} onView={onView} />
          </div>
        ))}
      </div>
      {admission.length > 0 && (
        <Link to={`/events/${event?.id}`} className="inline-flex items-center gap-1 mt-3 text-xs font-semibold"
          style={{ color: 'var(--ev-teal)' }}>
          View all tickets for this event →
        </Link>
      )}
    </section>
  );
}