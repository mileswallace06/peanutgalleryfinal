import { useState, useEffect } from 'react';
import { ArrowLeft, Bell, Zap } from 'lucide-react';
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

        {/* Status pill — single clear status, nothing else competing */}
        <div className="mb-2">
          {isLive ? (
            <span className="inline-flex items-center gap-1.5 text-[11px] font-black px-3 py-1 rounded-full"
              style={{ background: '#FF2D7822', color: '#FF2D78', border: '1px solid #FF2D7855' }}>
              <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
              LIVE NOW
            </span>
          ) : isSoon ? (
            <span className="inline-flex items-center gap-1 text-[11px] font-black px-3 py-1 rounded-full"
              style={{ background: 'rgba(255,230,0,0.12)', color: '#FFE600', border: '1px solid rgba(255,230,0,0.3)' }}>
              ⏰ Starts in {countdown || 'Soon'}
            </span>
          ) : (
            <span className="text-[11px] font-semibold" style={{ color: 'rgba(255,255,255,0.4)' }}>
              ⚡ Live Hub
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

        {/* Three primary signals — equal weight, no noise */}
        <div className="grid grid-cols-3 gap-2">
          {/* Upgrades */}
          <div className="flex flex-col items-center gap-1 px-2 py-3 rounded-2xl"
            style={{
              background: upgradeCount > 0 ? 'rgba(0,255,135,0.09)' : 'rgba(255,255,255,0.04)',
              border: upgradeCount > 0 ? '1px solid rgba(0,255,135,0.25)' : '1px solid rgba(255,255,255,0.07)',
            }}>
            <Zap className="w-5 h-5" style={{ color: upgradeCount > 0 ? '#00FF87' : 'rgba(255,255,255,0.25)' }} />
            <span className="font-black text-lg text-white leading-none">{upgradeCount}</span>
            <span className="text-[10px] font-semibold leading-none" style={{ color: 'rgba(255,255,255,0.45)' }}>
              Upgrade{upgradeCount !== 1 ? 's' : ''}
            </span>
          </div>

          {/* Flash Drops */}
          <div className="flex flex-col items-center gap-1 px-2 py-3 rounded-2xl"
            style={{
              background: activeDrops > 0 ? 'rgba(255,230,0,0.09)' : 'rgba(255,255,255,0.04)',
              border: activeDrops > 0 ? '1px solid rgba(255,230,0,0.25)' : '1px solid rgba(255,255,255,0.07)',
            }}>
            <span className="text-xl leading-none">🎁</span>
            <span className="font-black text-lg text-white leading-none">{activeDrops}</span>
            <span className="text-[10px] font-semibold leading-none" style={{ color: 'rgba(255,255,255,0.45)' }}>
              Flash Drop{activeDrops !== 1 ? 's' : ''}
            </span>
          </div>

          {/* Notify */}
          <button className="flex flex-col items-center gap-1 px-2 py-3 rounded-2xl transition-all active:scale-95"
            style={{ background: 'rgba(191,95,255,0.09)', border: '1px solid rgba(191,95,255,0.25)' }}>
            <Bell className="w-5 h-5" style={{ color: '#BF5FFF' }} />
            <span className="font-black text-[11px] leading-none" style={{ color: '#BF5FFF' }}>Notify</span>
            <span className="text-[10px] font-semibold leading-none" style={{ color: 'rgba(255,255,255,0.35)' }}>Me</span>
          </button>
        </div>
      </div>
    </div>
  );
}