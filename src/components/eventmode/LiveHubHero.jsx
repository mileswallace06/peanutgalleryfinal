import { useState, useEffect } from 'react';
import { ArrowLeft, Bell, Zap } from 'lucide-react';
import { Link } from 'react-router-dom';
import { getEventLiveStatus } from '@/lib/eventTiming';
import { format } from 'date-fns';
import { motion } from 'framer-motion';

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

  // Re-render every minute for countdown
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
      {/* Hero image */}
      {event?.image_url && (
        <div className="absolute inset-0">
          <img src={event.image_url} alt={event.title} className="w-full h-full object-cover" />
          <div className="absolute inset-0" style={{ background: 'linear-gradient(to bottom, rgba(0,0,0,0.35) 0%, rgba(0,0,0,0.97) 100%)' }} />
        </div>
      )}
      {!event?.image_url && (
        <div className="absolute inset-0" style={{ background: 'linear-gradient(135deg, #0a0012, #050820)' }} />
      )}

      <div className="relative z-10 px-4 pt-4 pb-5">
        {/* Back nav */}
        <Link to="/upgrades" className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-full mb-4"
          style={{ background: 'rgba(0,0,0,0.5)', color: 'rgba(255,255,255,0.75)', backdropFilter: 'blur(12px)' }}>
          <ArrowLeft className="w-3.5 h-3.5" /> Upgrades
        </Link>

        {/* Label */}
        <div className="flex items-center gap-2 mb-1">
          <span className="text-[10px] font-black tracking-widest uppercase" style={{ color: 'rgba(255,255,255,0.45)' }}>
            ⚡ Live Hub
          </span>
          {isLive && (
            <span className="flex items-center gap-1 text-[10px] font-black px-2 py-0.5 rounded-full animate-pulse"
              style={{ background: '#FF2D7820', color: '#FF2D78', border: '1px solid #FF2D7844' }}>
              LIVE
            </span>
          )}
        </div>

        {/* Event title */}
        <h1 className="font-display text-white leading-tight mb-3" style={{ fontSize: 'clamp(1.4rem, 5.5vw, 2rem)' }}>
          {event?.title || '…'}
        </h1>

        {/* Status pill */}
        <div className="flex items-center gap-3 flex-wrap mb-4">
          {isLive ? (
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-full"
              style={{ background: 'rgba(0,255,135,0.12)', border: '1px solid rgba(0,255,135,0.3)' }}>
              <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse inline-block" />
              <span className="text-xs font-black" style={{ color: '#00FF87' }}>Event is LIVE</span>
            </div>
          ) : isSoon ? (
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-full"
              style={{ background: 'rgba(255,230,0,0.1)', border: '1px solid rgba(255,230,0,0.3)' }}>
              <span className="text-xs font-black" style={{ color: '#FFE600' }}>
                Starts In {countdown || 'Soon'}
              </span>
            </div>
          ) : countdown ? (
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-full"
              style={{ background: 'rgba(191,95,255,0.1)', border: '1px solid rgba(191,95,255,0.25)' }}>
              <span className="text-xs font-bold text-muted-foreground">Starts In {countdown}</span>
            </div>
          ) : event?.date || event?.event_start_utc ? (
            <span className="text-xs text-muted-foreground">
              {format(new Date(event.event_start_utc || event.date), 'EEE, MMM d · h:mm a')}
            </span>
          ) : null}
        </div>

        {/* Activity counts */}
        <div className="flex items-center gap-3">
          <motion.div
            className="flex items-center gap-2 px-3 py-2 rounded-xl flex-1"
            style={{ background: upgradeCount > 0 ? 'rgba(0,255,135,0.08)' : 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)' }}
          >
            <Zap className="w-4 h-4 flex-shrink-0" style={{ color: upgradeCount > 0 ? '#00FF87' : 'rgba(255,255,255,0.3)' }} />
            <div>
              <p className="font-black text-sm text-white leading-none">{upgradeCount}</p>
              <p className="text-[10px] text-muted-foreground leading-none mt-0.5">Upgrade{upgradeCount !== 1 ? 's' : ''}</p>
            </div>
          </motion.div>

          <motion.div
            className="flex items-center gap-2 px-3 py-2 rounded-xl flex-1"
            style={{ background: activeDrops > 0 ? 'rgba(255,230,0,0.08)' : 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)' }}
          >
            <span className="text-base leading-none">🎁</span>
            <div>
              <p className="font-black text-sm text-white leading-none">{activeDrops}</p>
              <p className="text-[10px] text-muted-foreground leading-none mt-0.5">Flash Drop{activeDrops !== 1 ? 's' : ''}</p>
            </div>
          </motion.div>

          <button
            className="flex items-center gap-2 px-3 py-2 rounded-xl flex-1"
            style={{ background: 'rgba(191,95,255,0.08)', border: '1px solid rgba(191,95,255,0.2)' }}
          >
            <Bell className="w-4 h-4 flex-shrink-0" style={{ color: '#BF5FFF' }} />
            <div>
              <p className="font-black text-[11px] leading-none" style={{ color: '#BF5FFF' }}>Notify</p>
              <p className="text-[10px] text-muted-foreground leading-none mt-0.5">Me</p>
            </div>
          </button>
        </div>
      </div>
    </div>
  );
}