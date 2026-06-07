import { LocateFixed, MapPin, Ticket, ArrowUpRight, ShieldCheck } from 'lucide-react';

export default function EventsEmptyState({ locationStatus, onNearMe, onEnterCity }) {
  const isDenied = locationStatus === 'denied';
  const isError = locationStatus === 'unavailable' || locationStatus === 'timeout';
  const isRequesting = locationStatus === 'requesting';

  if (isRequesting) {
    return (
      <div className="px-4">
        <div className="rounded-2xl overflow-hidden relative" style={{ minHeight: 120 }}>
          <img src="https://images.unsplash.com/photo-1506157786151-b8491531f063?w=900&q=80" alt="concert crowd"
            className="w-full h-full object-cover absolute inset-0" style={{ opacity: 0.4 }} />
          <div className="absolute inset-0" style={{ background: 'linear-gradient(135deg, rgba(191,95,255,0.2) 0%, rgba(0,0,0,0.7) 100%)' }} />
          <div className="relative z-10 flex flex-col justify-end px-5 py-5 h-full" style={{ minHeight: 120 }}>
            <p className="font-bold text-white text-sm">Finding events near you…</p>
            <p className="text-xs mt-0.5" style={{ color: 'rgba(255,255,255,0.55)' }}>Scanning nearby venues</p>
          </div>
        </div>
      </div>
    );
  }

  if (isDenied || isError) {
    return (
      <div className="px-4 space-y-2">
        <div className="rounded-2xl px-4 py-4"
          style={{ background: 'hsl(var(--card))', border: '1px solid rgba(191,95,255,0.2)' }}>
          <p className="font-bold text-foreground text-sm">
            {isDenied ? 'Location access blocked' : locationStatus === 'timeout' ? 'Location timed out' : "Couldn't detect location"}
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">
            {isDenied ? 'Enable location in your device settings, or search by city below.' : 'Try again or enter your city to find nearby events.'}
          </p>
        </div>
        <button onClick={onEnterCity}
          className="w-full flex items-center justify-center gap-2 py-3 rounded-2xl font-semibold text-sm transition-all active:scale-[0.98]"
          style={{ background: 'hsl(var(--card))', border: '1px solid rgba(191,95,255,0.3)' }}>
          <MapPin className="w-4 h-4" style={{ color: '#BF5FFF' }} />
          <span className="text-foreground">Search by city</span>
        </button>
      </div>
    );
  }

  // Default idle state — lead with VALUE, then ask for location
  return (
    <div className="px-4 space-y-3">
      {/* Value proposition — what they get */}
      <div className="rounded-2xl overflow-hidden relative" style={{ minHeight: 140 }}>
        <img src="https://images.unsplash.com/photo-1506157786151-b8491531f063?w=900&q=80" alt="concert crowd"
          className="w-full h-full object-cover absolute inset-0" style={{ opacity: 0.4 }} />
        <div className="absolute inset-0" style={{ background: 'linear-gradient(135deg, rgba(191,95,255,0.2) 0%, rgba(0,0,0,0.72) 100%)' }} />
        <div className="relative z-10 px-5 py-5 flex flex-col gap-3" style={{ minHeight: 140 }}>
          <p className="font-display text-white leading-tight" style={{ fontSize: 'clamp(1.4rem, 6vw, 1.8rem)' }}>
            Fan tickets.<br />Buyer protected.
          </p>
          <div className="flex flex-col gap-1.5">
            {[
              { icon: <Ticket className="w-3 h-3" />, text: 'Real fan-listed seats for concerts & sports near you' },
              { icon: <ArrowUpRight className="w-3 h-3" />, text: 'Seat upgrades available at showtime — often below face value' },
              { icon: <ShieldCheck className="w-3 h-3" />, text: 'Money held in escrow — you confirm before seller is paid' },
            ].map(({ icon, text }) => (
              <div key={text} className="flex items-center gap-2">
                <span style={{ color: '#BF5FFF' }}>{icon}</span>
                <p className="text-[11px]" style={{ color: 'rgba(255,255,255,0.7)' }}>{text}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Why location — then the ask */}
      <div className="rounded-2xl px-4 py-3.5 space-y-3"
        style={{ background: 'hsl(var(--card))', border: '1px solid rgba(191,95,255,0.2)' }}>
        <div>
          <p className="font-bold text-foreground text-sm">See events near you</p>
          <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
            Your location is used only to find nearby events and upgrades. It's never stored or shared.
          </p>
        </div>
        <div className="flex gap-2">
          <button onClick={onNearMe}
            className="flex-1 flex items-center justify-center gap-2 py-3 rounded-2xl font-bold text-sm transition-all active:scale-[0.98]"
            style={{ background: 'rgba(191,95,255,0.15)', border: '1px solid rgba(191,95,255,0.4)', color: '#BF5FFF' }}>
            <LocateFixed className="w-4 h-4" />
            Use My Location
          </button>
          <button onClick={onEnterCity}
            className="flex-1 flex items-center justify-center gap-2 py-3 rounded-2xl font-semibold text-sm transition-all active:scale-[0.98]"
            style={{ background: 'hsl(var(--muted))', border: '1px solid hsl(var(--border))' }}>
            <MapPin className="w-4 h-4" style={{ color: '#BF5FFF', opacity: 0.7 }} />
            <span className="text-foreground">Enter City</span>
          </button>
        </div>
      </div>
    </div>
  );
}