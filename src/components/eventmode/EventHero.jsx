import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { format } from 'date-fns';
import { getEventLiveStatus } from '@/lib/eventTiming';
import GeneratedHero from './GeneratedHero';

/**
 * EventHero — the cinematic hero for the Event Mode screen.
 *
 * Renders the resolved hero image (event.hero_image_url, falling back to the
 * raw image_url for events synced before the field existed). If no image
 * resolves, or if the image fails to load, it renders the pure-CSS
 * GeneratedHero so there is never an empty hero.
 */
export default function EventHero({ event }) {
  const heroUrl = event?.hero_image_url || event?.image_url;
  const [imgFailed, setImgFailed] = useState(false);
  const isLive = event ? getEventLiveStatus(event).status === 'live' : false;

  if (!heroUrl || imgFailed) {
    return <GeneratedHero event={event} />;
  }

  const dateText = (event?.event_start_utc || event?.date)
    ? format(new Date(event.event_start_utc || event.date), 'EEE, MMM d · h:mm a')
    : null;

  return (
    <header className="pg-live-hero">
      <img src={heroUrl} alt={event?.title || ''} className="pg-live-hero-image" onError={() => setImgFailed(true)} />
      <div className="pg-live-hero-shade" />
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
