import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { format } from 'date-fns';

/**
 * EventHero — full-bleed cinematic hero for the redesigned Event Mode screen.
 * Image connects directly to the top and sides; no floating card.
 * Title is the strongest typographic element (display font), capped to avoid
 * oversized wrapping.
 */
export default function EventHero({ event }) {
  const dateText = (event?.event_start_utc || event?.date)
    ? format(new Date(event.event_start_utc || event.date), 'EEE, MMM d · h:mm a')
    : null;

  return (
    <div className="relative w-full overflow-hidden" style={{ minHeight: '40vh', maxHeight: '46vh' }}>
      {event?.image_url ? (
        <img src={event.image_url} alt={event?.title || ''} className="absolute inset-0 w-full h-full object-cover" />
      ) : (
        <div className="absolute inset-0" style={{ background: 'linear-gradient(160deg, #0a0f16, #05070a)' }} />
      )}
      {/* Readability overlay — fades into the Event Mode background */}
      <div className="absolute inset-0"
        style={{ background: 'linear-gradient(to bottom, rgba(5,7,10,0.35) 0%, rgba(5,7,10,0.55) 45%, var(--ev-bg) 100%)' }} />

      {/* Back navigation — sits below the status-bar safe area */}
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

      {/* Hero content */}
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