import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { getUpgradeEventState, getUpgradeShowtimeLabel } from '@/lib/upgradeEventState';
import GeneratedHero from './GeneratedHero';

/**
 * EventHero — the cinematic hero for the Event Mode screen.
 *
 * Renders the resolved hero image (event.hero_image_url, falling back to the
 * raw image_url for events synced before the field existed). If no image
 * resolves, or if the image fails to load, it renders the pure-CSS
 * GeneratedHero so there is never an empty hero.
 */
export default function EventHero({ event, nowMs, backLink = { to: '/upgrades', label: 'Upgrades' } }) {
  const heroUrl = event?.hero_image_url || event?.image_url;
  const [imgFailed, setImgFailed] = useState(false);
  const timing = getUpgradeEventState(event, nowMs);

  if (!heroUrl || imgFailed) {
    return <GeneratedHero event={event} nowMs={nowMs} backLink={backLink} />;
  }

  const dateText = getUpgradeShowtimeLabel(event);

  return (
    <header className="pg-live-hero">
      <img src={heroUrl} alt={event?.title || ''} className="pg-live-hero-image" onError={() => setImgFailed(true)} />
      <div className="pg-live-hero-shade" />
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
