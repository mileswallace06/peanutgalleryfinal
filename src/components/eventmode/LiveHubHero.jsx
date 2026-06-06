import { useState, useEffect } from 'react';
import { ArrowLeft, Bell, Zap, Gift, Clock, ShieldCheck } from 'lucide-react';
import { Link } from 'react-router-dom';
import { getEventLiveStatus } from '@/lib/eventTiming';
import { format } from 'date-fns';

function formatCountdown(minutes) {
  if (minutes <= 0) return null;
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  if (h > 0 && m > 0) return `${h}h ${m}m`;
  if (h > 0) return `${h}h`;
  return `${m}m`;
}

export default function LiveHubHero({ event, listings, drops }) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick(n => n + 1), 60000);
    return () => clearInterval(t);
  }, []);

  const timing = event ? getEventLiveStatus(event) : null;
  const isLive = timing?.status === 'live';
  const isSoon = timing?.status === 'soon';
  const countdown = timing?.minutes_until_start > 0 ? formatCountdown(timing.minutes_until_start) : null;

  const activeDrops = drops.filter(d => d.status === 'active' || d.status === 'pending').length;
  const upgradeCount = listings.length;

  return (
    <div className="relative overflow-hidden" style={{ marginTop: 'env(safe-area-inset-top)' }}>
      {/* Background */}
      {event?.image_url ? (
        <div className="absolute inset-0">
          <img src={event.image_url} alt={event?.title} className="w-full h-full object-cover" />
          <div className="absolute inset-0" style={{ background: 'linear-gradient(to bottom, rgba(0,0,0,0.4) 0%, rgba(0,0,0,0.98) 100%)' }} />
        </div>
      ) : (
        <div className="absolute inset-0" style={{ background: 'linear-gradient(135deg, #0a0012, #050820)' }} />
      )}

      <div className="relative z-10 px-4 pt-4 pb-6">
        {/* Back nav */}
        <Link to="/upgrades" className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-full mb-5"
          style={{ background: 'rgba(0,0,0,0.5)', color: 'rgba(255,255,255,0.65)', backdropFilter: 'blur(12px)' }}>
          <ArrowLeft className="w-3.5 h-3.5" /> Back
        </Link>

        {/* Status pill */}
        <div className="mb-2">
          {isLive ? (
            <span className="inline-flex items-center gap-1.5 text-[11px] font-bold px-3 py-1 rounded-full"
              style={{ background: 'rgba(255,45,120,0.12)', color: '#FF2D78', border: '1px solid rgba(255,45,120,0.3)' }}>
              <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
              Live Now
            </span>
          ) : isSoon ? (
            <span className="inline-flex items-center gap-1.5 text-[11px] font-medium px-3 py-1 rounded-full"
              style={{ background: 'rgba(255,255,255,0.07)', color: 'rgba(255,255,255,0.55)', border: '1px solid rgba(255,255,255,0.12)' }}>
              <Clock className="w-3 h-3" /> Starts in {countdown || 'Soon'}
            </span>
          ) : (
            <span className="text-[11px] font-medium tracking-wide" style={{ color: 'rgba(255,255,255,0.38)' }}>
              Upgrade Marketplace
            </span>
          )}
        </div>

        {/* Event title */}
        <h1 className="font-display text-white leading-tight mb-4" style={{ fontSize: 'clamp(1.5rem, 5.5vw, 2.2rem)' }}>
          {event?.title || '…'}
        </h1>

        {/* Event date — subtle, below title */}
        {(event?.event_start_utc || event?.date) && (
          <p className="text-xs mb-5" style={{ color: 'rgba(255,255,255,0.38)' }}>
            {format(new Date(event.event_start_utc || event.date), 'EEE, MMM d · h:mm a')}
          </p>
        )}

        {/* Primary stat — upgrades get dominant weight */}
        <div className="flex items-center gap-3 mb-3">
          <div className="flex-1 flex items-center gap-3 px-4 py-3 rounded-2xl"
            style={{
              background: upgradeCount > 0 ? 'rgba(0,255,135,0.08)' : 'rgba(255,255,255,0.04)',
              border: upgradeCount > 0 ? '1px solid rgba(0,255,135,0.2)' : '1px solid rgba(255,255,255,0.07)',
            }}>
            <Zap className="w-4 h-4 flex-shrink-0" style={{ color: upgradeCount > 0 ? '#00FF87' : 'rgba(255,255,255,0.2)' }} />
            <div>
              <span className="font-black text-2xl text-white leading-none">{upgradeCount}</span>
              <span className="text-xs font-medium ml-2" style={{ color: 'rgba(255,255,255,0.45)' }}>
                Upgrade{upgradeCount !== 1 ? 's' : ''} available
              </span>
            </div>
          </div>

          {/* Secondary: Fan Gifts — visually smaller */}
          <div className="flex items-center gap-2 px-3 py-3 rounded-2xl"
            style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)' }}>
            <Gift className="w-4 h-4" style={{ color: activeDrops > 0 ? '#BF5FFF' : 'rgba(255,255,255,0.2)' }} />
            <span className="font-bold text-sm text-white">{activeDrops}</span>
          </div>

          {/* Notify */}
          <button className="flex items-center justify-center w-11 h-11 rounded-2xl transition-all active:scale-95"
            style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.09)' }}>
            <Bell className="w-4 h-4" style={{ color: 'rgba(255,255,255,0.4)' }} />
          </button>
        </div>

        {/* Trust line — Phase 3 */}
        <div className="flex items-center gap-1.5">
          <ShieldCheck className="w-3 h-3 flex-shrink-0" style={{ color: 'rgba(255,255,255,0.28)' }} />
          <span className="text-[10px]" style={{ color: 'rgba(255,255,255,0.28)' }}>
            Protected transfers · Payment held until you confirm receipt
          </span>
        </div>
      </div>
    </div>
  );
}