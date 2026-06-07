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
      {/* Background image card — compact, atmospheric */}
      <div className="rounded-2xl overflow-hidden relative mb-2" style={{ minHeight: 136 }}>
        <img
          src="https://images.unsplash.com/photo-1506157786151-b8491531f063?w=900&q=80"
          alt="concert crowd"
          className="w-full h-full object-cover absolute inset-0"
          style={{ opacity: 0.45, filter: 'grayscale(5%)' }}
        />
        {/* purple-tinted vignette */}
        <div className="absolute inset-0" style={{ background: 'linear-gradient(135deg, rgba(191,95,255,0.18) 0%, rgba(0,0,0,0.25) 50%, rgba(0,0,0,0.65) 100%)' }} />

        <div className="relative z-10 flex flex-col justify-end px-5 py-4 h-full" style={{ minHeight: 136 }}>
          {isDenied ? (
            <div>
              <p className="font-bold text-white text-sm leading-tight">Location access blocked</p>
              <p className="text-xs mt-0.5" style={{ color: 'rgba(255,255,255,0.55)' }}>
                Enable location in settings, or search by city.
              </p>
            </div>
          ) : isError ? (
            <div>
              <p className="font-bold text-white text-sm leading-tight">
                {locationStatus === 'timeout' ? 'Location timed out' : "Couldn't detect location"}
              </p>
              <p className="text-xs mt-0.5" style={{ color: 'rgba(255,255,255,0.55)' }}>
                Try again or enter your city.
              </p>
            </div>
          ) : (
            <div>
              <p className="font-bold text-white text-sm leading-tight">
                {isRequesting ? 'Finding events near you…' : "Your city's next shows"}
              </p>
              <p className="text-xs mt-0.5" style={{ color: 'rgba(255,255,255,0.55)' }}>
                {isRequesting ? 'Scanning nearby venues…' : 'Fan-listed upgrades · buyer-protected'}
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Action buttons — tight to card, intentional purple CTAs */}
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