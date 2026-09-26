import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { format } from 'date-fns';
import { getEventLiveStatus } from '@/lib/eventTiming';

/**
 * GeneratedHero — a pure-CSS, premium "event poster" fallback rendered when an
 * event has no Ticketmaster artwork and no venue hero image.
 *
 * No AI generation, no external APIs, no image files. It uses the existing
 * Peanut Gallery Event Mode styling (dark surfaces + teal accents + display
 * typography) so it reads as intentional design, never as a missing image.
 */
export default function GeneratedHero({ event }) {
  const isLive = event ? getEventLiveStatus(event).status === 'live' : false;
  const dateText = (event?.event_start_utc || event?.date)
    ? format(new Date(event.event_start_utc || event.date), 'EEE, MMM d · h:mm a')
    : null;

  return (
    <header className="pg-live-hero pg-live-hero-fallback">
      <span className="pg-live-poster-mark" aria-hidden="true">PG</span>
      <Link to="/upgrades" aria-label="Back to upgrades" className="pg-live-back"><ArrowLeft size={18} />Upgrades</Link>
      <div className="pg-live-hero-copy">
        {isLive && <span className="pg-live-badge">LIVE</span>}
        <h1>{event?.title || '—'}</h1>
        {event?.venue && <p>{event.venue}{event.city ? ` · ${event.city}` : ''}</p>}
        {dateText && <p className="pg-live-event-time">{dateText}</p>}
      </div>
    </header>
  );
}
