import { useState } from 'react';
import { MapPin, Ticket, CheckCircle, XCircle, Loader2 } from 'lucide-react';

/**
 * Simulates eligibility checks for upgrade listings.
 * In demo mode, all checks are simulated (no real geofencing).
 * In live mode, shows a placeholder for real checks.
 */
export default function UpgradeEligibilityGate({ listing, isDemo = false, onEligible }) {
  const [locationStatus, setLocationStatus] = useState('idle'); // idle | checking | pass | fail
  const [ticketStatus, setTicketStatus] = useState('idle');

  const needsLocation = listing?.requires_location && listing?.location_requirement !== 'none';
  const needsTicket = listing?.requires_existing_ticket;

  const allPassed = (
    (!needsLocation || locationStatus === 'pass') &&
    (!needsTicket || ticketStatus === 'pass')
  );

  // Notify parent when all checks pass
  const checkAndNotify = (newLoc, newTicket) => {
    const locOk = !needsLocation || newLoc === 'pass';
    const tickOk = !needsTicket || newTicket === 'pass';
    if (locOk && tickOk) onEligible?.();
  };

  const checkLocation = () => {
    if (isDemo) {
      setLocationStatus('checking');
      setTimeout(() => {
        setLocationStatus('pass');
        checkAndNotify('pass', ticketStatus);
      }, 1200);
      return;
    }
    if (!navigator.geolocation) { setLocationStatus('fail'); return; }
    setLocationStatus('checking');
    navigator.geolocation.getCurrentPosition(
      () => { setLocationStatus('pass'); checkAndNotify('pass', ticketStatus); },
      () => setLocationStatus('fail'),
      { timeout: 8000 }
    );
  };

  const checkTicket = () => {
    if (isDemo) {
      setTicketStatus('checking');
      setTimeout(() => {
        setTicketStatus('pass');
        checkAndNotify(locationStatus, 'pass');
      }, 900);
      return;
    }
    // Live: manual attestation only
    setTicketStatus('pass');
    checkAndNotify(locationStatus, 'pass');
  };

  const statusIcon = (status) => {
    if (status === 'checking') return <Loader2 className="w-4 h-4 animate-spin" style={{ color: '#FFE600' }} />;
    if (status === 'pass') return <CheckCircle className="w-4 h-4" style={{ color: '#00FF87' }} />;
    if (status === 'fail') return <XCircle className="w-4 h-4" style={{ color: '#FF2D78' }} />;
    return null;
  };

  return (
    <div className="rounded-2xl p-3 space-y-2"
      style={{ background: 'rgba(255,140,0,0.06)', border: '1px solid rgba(255,140,0,0.2)' }}>
      <p className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">
        Eligibility Checks {isDemo && <span style={{ color: '#BF5FFF' }}>· Demo</span>}
      </p>

      {needsLocation && (
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <MapPin className="w-4 h-4 flex-shrink-0" style={{ color: '#00C8FF' }} />
            <span className="text-xs text-foreground">
              {listing.location_requirement === 'inside_venue' && 'Must be inside the venue'}
              {listing.location_requirement === 'venue_proximity' && 'Must be near the venue'}
              {listing.location_requirement === 'city_only' && 'Must be in the city'}
            </span>
          </div>
          <div className="flex items-center gap-2">
            {statusIcon(locationStatus)}
            {locationStatus === 'idle' || locationStatus === 'fail' ? (
              <button
                type="button"
                onClick={checkLocation}
                className="text-[11px] font-bold px-3 py-1.5 rounded-full transition-all"
                style={{ background: 'rgba(0,200,255,0.12)', border: '1px solid rgba(0,200,255,0.3)', color: '#00C8FF' }}
              >
                {locationStatus === 'fail' ? 'Retry' : isDemo ? 'Simulate' : 'Check'}
              </button>
            ) : locationStatus === 'pass' ? (
              <span className="text-[11px] font-bold" style={{ color: '#00FF87' }}>Verified</span>
            ) : null}
          </div>
        </div>
      )}

      {needsTicket && (
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Ticket className="w-4 h-4 flex-shrink-0" style={{ color: '#FF8C00' }} />
            <span className="text-xs text-foreground">I have a ticket to this event</span>
          </div>
          <div className="flex items-center gap-2">
            {statusIcon(ticketStatus)}
            {ticketStatus === 'idle' ? (
              <button
                type="button"
                onClick={checkTicket}
                className="text-[11px] font-bold px-3 py-1.5 rounded-full transition-all"
                style={{ background: 'rgba(255,140,0,0.12)', border: '1px solid rgba(255,140,0,0.3)', color: '#FF8C00' }}
              >
                {isDemo ? 'Simulate' : 'Confirm'}
              </button>
            ) : ticketStatus === 'pass' ? (
              <span className="text-[11px] font-bold" style={{ color: '#00FF87' }}>Confirmed</span>
            ) : null}
          </div>
        </div>
      )}

      {allPassed && (
        <p className="text-[11px] font-bold text-center pt-1" style={{ color: '#00FF87' }}>
          ✓ All checks passed — you may proceed
        </p>
      )}
    </div>
  );
}