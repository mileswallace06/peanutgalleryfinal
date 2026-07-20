import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { format } from 'date-fns';

/**
 * GeneratedHero — a pure-CSS, premium "event poster" fallback rendered when an
 * event has no Ticketmaster artwork and no venue hero image.
 *
 * No AI generation, no external APIs, no image files. It uses the existing
 * Peanut Gallery Event Mode styling (dark surfaces + teal accents + display
 * typography) so it reads as intentional design, never as a missing image.
 */
export default function GeneratedHero({ event }) {
  const dateText = (event?.event_start_utc || event?.date)
    ? format(new Date(event.event_start_utc || event.date), 'EEE, MMM d · h:mm a')
    : null;

  return (
    <div className="relative w-full overflow-hidden flex flex-col justify-end"
      style={{
        minHeight: '40vh',
        maxHeight: '46vh',
        background:
          'radial-gradient(ellipse 80% 60% at 18% -5%, rgba(0,200,255,0.12), transparent 60%),' +
          'radial-gradient(ellipse 70% 55% at 88% 8%, rgba(191,95,255,0.08), transparent 55%),' +
          'var(--ev-bg)',
      }}>

      {/* top teal hairline — the "energy" accent */}
      <div className="absolute top-0 left-0 right-0 h-px"
        style={{ background: 'linear-gradient(90deg, transparent, var(--ev-teal), transparent)' }} />

      {/* Back */}
      <Link to="/upgrades" aria-label="Back to upgrades"
        className="absolute left-3 z-20 inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-full"
        style={{
          top: 'calc(0.75rem + env(safe-area-inset-top))',
          background: 'rgba(0,0,0,0.4)',
          color: 'var(--ev-text-2)',
          backdropFilter: 'blur(10px)',
          WebkitBackdropFilter: 'blur(10px)',
          border: '1px solid var(--ev-border)',
        }}>
        <ArrowLeft className="w-3.5 h-3.5" /> Back
      </Link>

      {/* brandmark — the poster signature */}
      <div className="absolute right-4 z-20"
        style={{ top: 'calc(0.95rem + env(safe-area-inset-top))' }}>
        <span className="text-[10px] font-semibold uppercase tracking-[0.2em]" style={{ color: 'var(--ev-teal)' }}>
          Peanut Gallery
        </span>
      </div>

      {/* content */}
      <div className="relative px-4 pb-5 z-10">
        {event?.venue && (
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] mb-1.5" style={{ color: 'var(--ev-teal)' }}>
            {event.venue}{event.city ? ` · ${event.city}` : ''}
          </p>
        )}
        <h1 className="font-display text-white leading-[1.05] mb-2 line-clamp-3"
          style={{ fontSize: 'clamp(1.6rem, 6vw, 2.4rem)', letterSpacing: '-0.01em' }}>
          {event?.title || '—'}
        </h1>
        {dateText && <p className="text-xs" style={{ color: 'var(--ev-text-2)' }}>{dateText}</p>}
      </div>
    </div>
  );
}