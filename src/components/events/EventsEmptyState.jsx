import { LocateFixed, MapPin } from 'lucide-react';

/**
 * Anticipatory empty state for the Events page.
 * Feels alive — not a dead end.
 */
export default function EventsEmptyState({ locationStatus, onNearMe, onEnterCity }) {
  const isDenied = locationStatus === 'denied';
  const isError = locationStatus === 'unavailable' || locationStatus === 'timeout';
  const isRequesting = locationStatus === 'requesting';

  return (
    <div className="px-4">
      {/* Background image card */}
      <div className="rounded-3xl overflow-hidden relative mb-5" style={{ minHeight: 220 }}>
        <img
          src="https://images.unsplash.com/photo-1459749411175-04bf5292ceea?w=800&q=70"
          alt="concert crowd"
          className="w-full h-full object-cover absolute inset-0"
          style={{ opacity: 0.28, filter: 'grayscale(10%)' }}
        />
        {/* purple-tinted vignette */}
        <div className="absolute inset-0" style={{ background: 'linear-gradient(135deg, rgba(191,95,255,0.15) 0%, transparent 50%, rgba(0,0,0,0.5) 100%)' }} />

        <div className="relative z-10 flex flex-col items-center justify-center text-center px-6 py-12 gap-2">
          {isDenied ? (
            <>
              <MapPin className="w-7 h-7 text-muted-foreground opacity-40 mb-1" />
              <p className="font-bold text-foreground text-base">Location access blocked</p>
              <p className="text-sm text-muted-foreground max-w-xs">
                Enable location in your browser settings, or search by city below.
              </p>
            </>
          ) : isError ? (
            <>
              <MapPin className="w-7 h-7 text-muted-foreground opacity-40 mb-1" />
              <p className="font-bold text-foreground text-base">
                {locationStatus === 'timeout' ? 'Location timed out' : "Couldn't detect location"}
              </p>
              <p className="text-sm text-muted-foreground max-w-xs">
                Try again or enter your city to see what's happening nearby.
              </p>
            </>
          ) : (
            <>
              <LocateFixed className="w-7 h-7 text-muted-foreground opacity-40 mb-1" />
              <p className="font-bold text-foreground text-base">
                {isRequesting ? 'Finding events near you…' : 'See what\'s happening nearby'}
              </p>
              <p className="text-sm text-muted-foreground max-w-xs">
                {isRequesting
                  ? 'Looking for concerts, sports, and more in your area.'
                  : 'Fan-listed tickets for shows in your city.'}
              </p>
            </>
          )}
        </div>
      </div>

      {/* Action buttons — intentional purple CTAs */}
      {!isRequesting && (
        <div className="flex gap-2">
          {!isDenied && (
            <button
              onClick={onNearMe}
              className="flex-1 flex items-center justify-center gap-2 py-3 rounded-2xl font-bold text-sm transition-all active:scale-[0.98]"
              style={{ background: 'rgba(191,95,255,0.15)', border: '1px solid rgba(191,95,255,0.35)', color: '#BF5FFF' }}
            >
              <LocateFixed className="w-4 h-4" />
              Near Me
            </button>
          )}
          <button
            onClick={onEnterCity}
            className="flex-1 flex items-center justify-center gap-2 py-3 rounded-2xl font-semibold text-sm transition-all active:scale-[0.98]"
            style={{ background: 'hsl(var(--card))', border: '1px solid rgba(191,95,255,0.2)' }}
          >
            <MapPin className="w-4 h-4" style={{ color: '#BF5FFF', opacity: 0.7 }} />
            <span className="text-foreground">Enter city</span>
          </button>
        </div>
      )}
    </div>
  );
}