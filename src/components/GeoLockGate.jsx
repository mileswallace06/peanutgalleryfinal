import { Link } from 'react-router-dom';
import { MapPin, Shield, Wifi, AlertTriangle } from 'lucide-react';

// Wraps upgrade pages — shows a gate screen while checking location,
// blocks access if the user is not physically at the venue.
export default function GeoLockGate({ status, reason, venueName, distanceKm, backPath = '/upgrades' }) {
  if (status === 'allowed') return null; // parent renders content

  if (status === 'checking') {
    return (
      <div className="fixed inset-0 z-50 flex flex-col items-center justify-center px-6"
        style={{ background: 'hsl(255 10% 5%)' }}>
        <div className="w-16 h-16 rounded-full flex items-center justify-center mb-5"
          style={{ background: 'rgba(0,255,135,0.1)', border: '1px solid rgba(0,255,135,0.3)', boxShadow: '0 0 32px rgba(0,255,135,0.15)' }}>
          <MapPin className="w-7 h-7 animate-pulse" style={{ color: '#00FF87' }} />
        </div>
        <h2 className="font-display text-2xl text-foreground mb-2 text-center">Verifying Location</h2>
        <p className="text-sm text-muted-foreground text-center max-w-xs leading-relaxed mb-6">
          Confirming you're at the venue. This takes a moment — please allow location access if prompted.
        </p>
        <div className="flex gap-1.5">
          {[0, 1, 2].map(i => (
            <span key={i} className="w-2 h-2 rounded-full animate-bounce"
              style={{ background: '#00FF87', animationDelay: `${i * 0.15}s` }} />
          ))}
        </div>
        <p className="text-[11px] text-muted-foreground mt-6 text-center max-w-[200px] opacity-60">
          Also checking your connection to prevent VPN access.
        </p>
      </div>
    );
  }

  // Blocked — determine message
  let icon = <Shield className="w-8 h-8" style={{ color: '#FF2D78' }} />;
  let title = 'Access Denied';
  let message = 'You must be physically at the venue to view upgrade listings.';
  let sub = null;

  if (reason === 'vpn_detected') {
    icon = <Wifi className="w-8 h-8" style={{ color: '#FFE600' }} />;
    title = 'VPN Detected';
    message = 'Upgrades are location-locked to prevent remote poaching.';
    sub = 'Please disconnect your VPN and try again from the venue.';
  } else if (reason === 'gps_denied') {
    icon = <MapPin className="w-8 h-8" style={{ color: '#FF2D78' }} />;
    title = 'Location Required';
    message = 'You must allow location access to view seat upgrades.';
    sub = 'Enable location in your browser settings and reload the page.';
  } else if (reason?.startsWith('too_far')) {
    const km = reason.split(':')[1];
    icon = <AlertTriangle className="w-8 h-8" style={{ color: '#FF2D78' }} />;
    title = 'Not at the Venue';
    message = `You appear to be ${km ? `${km} km` : 'too far'} from ${venueName || 'the venue'}.`;
    sub = 'Upgrades are only available to fans physically inside or right outside the venue.';
  } else if (reason === 'wrong_city') {
    icon = <AlertTriangle className="w-8 h-8" style={{ color: '#FF2D78' }} />;
    title = 'Wrong Location';
    message = `Your GPS shows you're not in ${venueName ? `the city where ${venueName} is` : 'the right city'}.`;
    sub = 'Upgrades are only available to fans at the event.';
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center px-6"
      style={{ background: 'hsl(255 10% 5%)' }}>
      {/* Glow */}
      <div className="absolute inset-0 pointer-events-none"
        style={{ background: 'radial-gradient(ellipse 60% 40% at 50% 100%, rgba(255,45,120,0.12), transparent 65%)' }} />

      <div className="relative z-10 flex flex-col items-center text-center max-w-sm">
        <div className="w-20 h-20 rounded-full flex items-center justify-center mb-5"
          style={{ background: 'rgba(255,45,120,0.1)', border: '1px solid rgba(255,45,120,0.3)', boxShadow: '0 0 40px rgba(255,45,120,0.15)' }}>
          {icon}
        </div>

        <div className="text-[11px] font-black tracking-[0.2em] px-3 py-1 rounded-full mb-4"
          style={{ background: 'rgba(255,45,120,0.1)', color: '#FF2D78', border: '1px solid rgba(255,45,120,0.25)' }}>
          🔒 LOCATION LOCKED
        </div>

        <h2 className="font-display text-3xl text-foreground mb-3">{title}</h2>
        <p className="text-sm text-muted-foreground leading-relaxed mb-2">{message}</p>
        {sub && <p className="text-xs text-muted-foreground leading-relaxed mb-6 opacity-70">{sub}</p>}

        <div className="flex flex-col gap-3 w-full mt-4">
          <button onClick={() => window.location.reload()}
            className="w-full py-3.5 rounded-full font-black text-sm"
            style={{ background: 'linear-gradient(135deg, #BF5FFF, #FF2D78)', color: '#fff', boxShadow: '0 0 18px rgba(191,95,255,0.25)' }}>
            Try Again
          </button>
          <Link to={backPath}
            className="w-full py-3 rounded-full font-semibold text-sm text-center"
            style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.6)' }}>
            ← Back to Upgrades
          </Link>
        </div>

        <p className="text-[10px] text-muted-foreground mt-6 opacity-50 leading-relaxed max-w-[240px]">
          Peanut Gallery's location lock protects real fans. No scalpers, no remote buyers — upgrades are for people actually at the show.
        </p>
      </div>
    </div>
  );
}