import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { format } from 'date-fns';
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

  if (!heroUrl || imgFailed) {
    return <GeneratedHero event={event} />;
  }

  const dateText = (event?.event_start_utc || event?.date)
    ? format(new Date(event.event_start_utc || event.date), 'EEE, MMM d · h:mm a')
    : null;

  return (
    <div className="relative w-full overflow-hidden" style={{ minHeight: '40vh', maxHeight: '46vh' }}>
      <img src={heroUrl} alt={event?.title || ''}
        className="absolute inset-0 w-full h-full object-cover"
        onError={() => setImgFailed(true)} />
      {/* Readability overlay — fades into the Event Mode background */}
      <div className="absolute inset-0"
        style={{ background: 'linear-gradient(to bottom, rgba(5,7,10,0.35) 0%, rgba(5,7,10,0.55) 45%, var(--ev-bg) 100%)' }} />

      <Link to="/upgrades" aria-label="Back to upgrades"
        className="absolute left-3 z-20 inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-full"
        style={{
          top: 'calc(0.75rem + env(safe-area-inset-top))',
          background: 'rgba(0,0,0,0.45)',
          color: 'var(--ev-text-2)',
          backdropFilter: 'blur(10px)',
          WebkitBackdropFilter: 'blur(10px)',
          border: '1px solid var(--ev-border)',
        }}>
        <ArrowLeft className="w-3.5 h-3.5" /> Back
      </Link>

      <div className="absolute bottom-0 left-0 right-0 px-4 pb-5 z-10">
        {event?.venue && (
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] mb-1.5" style={{ color: 'var(--ev-teal)' }}>
            {event.venue}{event.city ? ` · ${event.city}` : ''}
          </p>
        )}
        <h1 className="font-display text-white leading-[1.05] mb-2 line-clamp-3"
          style={{ fontSize: 'clamp(1.6rem, 6vw, 2.4rem)', letterSpacing: '-0.01em' }}>
          {event?.title || '—'}
        </h1>
        {dateText && (
          <p className="text-xs" style={{ color: 'var(--ev-text-2)' }}>{dateText}</p>
        )}
      </div>
    </div>
  );
}