import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { getUpgradeEventState, getUpgradeShowtimeLabel } from '@/lib/upgradeEventState';

/**
 * GeneratedHero — a pure-CSS, premium "event poster" fallback rendered when an
 * event has no Ticketmaster artwork and no venue hero image.
 *
 * No AI generation, no external APIs, no image files. It uses the existing
 * Peanut Gallery Event Mode styling (dark surfaces + teal accents + display
 * typography) so it reads as intentional design, never as a missing image.
 */
export default function GeneratedHero({ event, nowMs, backLink = { to: '/upgrades', label: 'Upgrades' } }) {
  const timing = getUpgradeEventState(event, nowMs);
  const dateText = getUpgradeShowtimeLabel(event);

  return (
    <header className="pg-live-hero pg-live-hero-fallback">
      <span className="pg-live-poster-mark" aria-hidden="true">PG</span>
      <Link to={backLink.to} state={backLink.state} aria-label={`Back to ${backLink.label.toLowerCase()}`} className="pg-live-back"><ArrowLeft size={18} />{backLink.label}</Link>
      <div className="pg-live-hero-copy">
        {timing.isLive && <span className="pg-live-badge" title={timing.status === 'estimated_live' ? 'Estimated live window; the event may have ended' : undefined}>{timing.status === 'estimated_live' ? 'LIVE · EST.' : 'LIVE'}</span>}
        <h1>{event?.title || '—'}</h1>
        {event?.venue && <p>{event.venue}{event.city ? ` · ${event.city}` : ''}</p>}
        {dateText && <p className="pg-live-event-time">{dateText}</p>}
      </div>
    </header>
  );
}
