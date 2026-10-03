import { Link } from 'react-router-dom';
import { Zap, Ticket, ChevronRight, Clock3, RefreshCw } from 'lucide-react';
import { UPGRADE_LISTING_TYPES, TICKET_LISTING_TYPES } from '@/lib/listingTypes';
import { isListingVisible } from '@/lib/listingVisibility';
import { getUpgradeEventState, getUpgradeShowtimeLabel } from '@/lib/upgradeEventState';
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

export default function MoveCloserRail({ listings, event, currentUserEmail, loading, onView, nowMs, loadError, onRetry, refreshing, notifyControl }) {
  const visible = (listings || []).filter(l => isListingVisible(l, currentUserEmail));
  const upgrades = visible
    .filter(l => UPGRADE_LISTING_TYPES.includes(l.listing_type))
    .sort((a, b) => a.asking_price - b.asking_price);
  const admission = visible.filter(l => TICKET_LISTING_TYPES.includes(l.listing_type));

  const timing = getUpgradeEventState(event, nowMs);
  const isEnded = timing.status === 'ended';
  const isCancelled = [event?.status, event?.provider_status].some(status => ['cancelled', 'canceled'].includes(status));

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
          <p className="text-sm font-semibold" style={{ color: 'var(--ev-text)' }}>{isCancelled ? 'Event cancelled' : 'Event has ended'}</p>
          <p className="text-xs mt-1" style={{ color: 'var(--ev-text-muted)' }}>No more upgrades are available.</p>
        </div>
      </section>
    );
  }

  if (timing.status === 'unknown') {
    return (
      <section>
        <Heading />
        <div className="pg-state pg-live-empty pg-upgrade-availability">
          <Clock3 className="pg-upgrade-empty-icon" size={22} />
          <p className="pg-upgrade-empty-title" role="status">Event time unconfirmed</p>
          <p className="pg-upgrade-empty-detail">The event’s date and time must be confirmed before upgrades can be shown.</p>
          {notifyControl}
          {onRetry && <button type="button" className="pg-upgrade-refresh" onClick={onRetry} disabled={refreshing}>
            <RefreshCw size={15} className={refreshing ? 'animate-spin' : ''} />{refreshing ? 'Checking…' : 'Check availability'}
          </button>}
        </div>
      </section>
    );
  }

  if (timing.beforeShowtime || upgrades.length === 0) {
    const countdown = timing.countdown;
    return (
      <section>
        <Heading />
        <div className="pg-state pg-live-empty pg-upgrade-availability">
          {timing.beforeShowtime ? <Clock3 className="pg-upgrade-empty-icon" size={22} /> : <Zap className="pg-upgrade-empty-icon" size={22} />}
          <p className="pg-upgrade-empty-title" role="status">
            {loadError ? 'Unable to load upgrades' : timing.beforeShowtime ? 'Countdown to showtime' : 'No upgrades listed yet'}
          </p>
          <p className="pg-upgrade-empty-detail">
            {loadError ? 'We couldn’t check the latest availability. Please try again.'
              : timing.beforeShowtime ? 'Upgrades open at showtime. Check back when the event starts.'
                : 'New seat upgrades will appear here as fans list them.'}
          </p>
          {countdown && (
            <>
              <div className="pg-showtime-countdown" role="timer" aria-label="Time until showtime" aria-live="off">
                {Object.entries(countdown).filter(([unit, value]) => unit !== 'days' || value > 0).map(([unit, value]) => (
                  <div key={unit}><strong>{String(value).padStart(2, '0')}</strong><span>{unit}</span></div>
                ))}
              </div>
              <p className="pg-showtime-date">{getUpgradeShowtimeLabel(event)}</p>
            </>
          )}
          {!loadError && notifyControl}
          {onRetry && <button type="button" className="pg-upgrade-refresh" onClick={onRetry} disabled={refreshing}>
            <RefreshCw size={15} className={refreshing ? 'animate-spin' : ''} />{refreshing ? 'Checking…' : loadError ? 'Try again' : 'Check availability'}
          </button>}
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
