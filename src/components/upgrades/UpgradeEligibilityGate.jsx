import { useState } from 'react';
import { MapPin, Ticket, CheckCircle, XCircle, Loader2 } from 'lucide-react';

/**
 * Renders eligibility checks for upgrade listings:
 * - Existing ticket confirmation (requires_existing_ticket)
 * - Location verification (requires_location / location_requirement)
 *
 * In demo mode all checks are simulated (no real geofencing).
 * Calls onEligible() when all required checks pass.
 */
export default function UpgradeEligibilityGate({ listing, isDemo, onEligible }) {
  const needsTicket = listing?.requires_existing_ticket;
  const needsLocation = listing?.requires_location && listing?.location_requirement !== 'none';

  const [ticketConfirmed, setTicketConfirmed] = useState(false);
  const [locationStatus, setLocationStatus] = useState('idle'); // idle | checking | passed | failed
  const [locationError, setLocationError] = useState('');

  const allPassed = (!needsTicket || ticketConfirmed) && (!needsLocation || locationStatus === 'passed');

  const handleTicketConfirm = () => {
    setTicketConfirmed(true);
    if (!needsLocation || locationStatus === 'passed') onEligible();
  };

  const handleLocationCheck = () => {
    setLocationStatus('checking');
    setLocationError('');

    if (isDemo) {
      // Simulate a brief check
      setTimeout(() => {
        setLocationStatus('passed');
        if (!needsTicket || ticketConfirmed) onEligible();
      }, 1000);
      return;
    }

    if (!navigator.geolocation) {
      setLocationStatus('failed');
      setLocationError('Geolocation is not supported by your browser.');
      return;
    }

    navigator.geolocation.getCurrentPosition(
      () => {
        // Live mode: location obtained — actual proximity check happens server-side at purchase
        setLocationStatus('passed');
        if (!needsTicket || ticketConfirmed) onEligible();
      },
      (err) => {
        setLocationStatus('failed');
        setLocationError(err.code === 1 ? 'Location access denied. Please allow location in your browser settings.' : 'Could not determine your location. Please try again.');
      },
      { timeout: 10000, enableHighAccuracy: false }
    );
  };

  if (!needsTicket && !needsLocation) return null;

  return (
    <div className="space-y-3">
      {/* Existing ticket check */}
      {needsTicket && (
        <div className="rounded-2xl p-3 space-y-2"
          style={{ background: 'rgba(255,140,0,0.07)', border: '1px solid rgba(255,140,0,0.25)' }}>
          <div className="flex items-start gap-2.5">
            <Ticket className="w-4 h-4 flex-shrink-0 mt-0.5" style={{ color: '#FF8C00' }} />
            <div className="flex-1 min-w-0">
              <p className="text-xs font-bold" style={{ color: '#FF8C00' }}>Do you already have a ticket to this event?</p>
              <p className="text-[10px] text-muted-foreground mt-0.5 leading-relaxed">
                This upgrade only grants access to better seats — it does not include event admission.
              </p>
            </div>
          </div>
          {ticketConfirmed ? (
            <div className="flex items-center gap-1.5 text-xs font-semibold" style={{ color: '#00FF87' }}>
              <CheckCircle className="w-3.5 h-3.5" /> Confirmed — you have admission
            </div>
          ) : (
            <button
              type="button"
              onClick={handleTicketConfirm}
              className="w-full py-2 rounded-xl font-bold text-xs transition-all active:scale-95"
              style={{ background: 'rgba(255,140,0,0.15)', border: '1px solid rgba(255,140,0,0.35)', color: '#FF8C00' }}
            >
              Yes, I have a ticket to this event
            </button>
          )}
        </div>
      )}

      {/* Location check */}
      {needsLocation && (
        <div className="rounded-2xl p-3 space-y-2"
          style={{ background: 'rgba(0,200,255,0.07)', border: '1px solid rgba(0,200,255,0.25)' }}>
          <div className="flex items-start gap-2.5">
            <MapPin className="w-4 h-4 flex-shrink-0 mt-0.5" style={{ color: '#00C8FF' }} />
            <div className="flex-1 min-w-0">
              <p className="text-xs font-bold" style={{ color: '#00C8FF' }}>
                {listing.location_requirement === 'inside_venue' && 'You must be inside the venue'}
                {listing.location_requirement === 'venue_proximity' && 'You must be near the venue'}
                {listing.location_requirement === 'city_only' && 'You must be in the city'}
              </p>
              <p className="text-[10px] text-muted-foreground mt-0.5 leading-relaxed">
                {isDemo ? 'Demo mode — location check is simulated.' : 'We\'ll verify your location before completing this purchase.'}
              </p>
            </div>
          </div>

          {locationStatus === 'idle' && (
            <button
              type="button"
              onClick={handleLocationCheck}
              className="w-full py-2 rounded-xl font-bold text-xs transition-all active:scale-95"
              style={{ background: 'rgba(0,200,255,0.12)', border: '1px solid rgba(0,200,255,0.3)', color: '#00C8FF' }}
            >
              {isDemo ? 'Simulate Location Check' : 'Verify My Location'}
            </button>
          )}
          {locationStatus === 'checking' && (
            <div className="flex items-center gap-2 text-xs" style={{ color: '#00C8FF' }}>
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              {isDemo ? 'Simulating…' : 'Checking location…'}
            </div>
          )}
          {locationStatus === 'passed' && (
            <div className="flex items-center gap-1.5 text-xs font-semibold" style={{ color: '#00FF87' }}>
              <CheckCircle className="w-3.5 h-3.5" /> {isDemo ? 'Location simulated ✓' : 'Location verified ✓'}
            </div>
          )}
          {locationStatus === 'failed' && (
            <div className="space-y-1.5">
              <div className="flex items-center gap-1.5 text-xs font-semibold" style={{ color: '#FF2D78' }}>
                <XCircle className="w-3.5 h-3.5" /> {locationError}
              </div>
              <button
                type="button"
                onClick={handleLocationCheck}
                className="w-full py-2 rounded-xl font-bold text-xs"
                style={{ background: 'rgba(255,45,120,0.08)', border: '1px solid rgba(255,45,120,0.25)', color: '#FF2D78' }}
              >
                Try Again
              </button>
            </div>
          )}
        </div>
      )}

      {/* All passed confirmation */}
      {allPassed && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-bold"
          style={{ background: 'rgba(0,255,135,0.08)', border: '1px solid rgba(0,255,135,0.25)', color: '#00FF87' }}>
          <CheckCircle className="w-3.5 h-3.5" /> All eligibility checks passed — you can proceed
        </div>
      )}
    </div>
  );
}