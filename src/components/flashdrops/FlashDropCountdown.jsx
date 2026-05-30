import { useState, useEffect } from 'react';
import { Zap } from 'lucide-react';

/**
 * Real-time countdown for an active Flash Drop entry window.
 * Props:
 *   closesAt: ISO string
 *   onExpired: () => void
 */
export default function FlashDropCountdown({ closesAt, onExpired }) {
  const [secsLeft, setSecsLeft] = useState(null);

  useEffect(() => {
    const tick = () => {
      const diff = Math.max(0, Math.floor((new Date(closesAt) - Date.now()) / 1000));
      setSecsLeft(diff);
      if (diff === 0) onExpired?.();
    };
    tick();
    const id = setInterval(tick, 500);
    return () => clearInterval(id);
  }, [closesAt]);

  if (secsLeft === null) return null;

  const urgent = secsLeft <= 15;
  const pct = Math.max(0, secsLeft); // used for visual urgency

  return (
    <div className="flex flex-col items-center gap-1">
      <div className="flex items-center gap-1.5">
        <Zap className="w-3.5 h-3.5" style={{ color: urgent ? '#FF2D78' : '#FFE600' }} />
        <span className="text-[10px] font-black tracking-widest uppercase" style={{ color: urgent ? '#FF2D78' : '#FFE600' }}>
          Entry closes in
        </span>
      </div>
      <div
        className="text-4xl font-black tabular-nums transition-colors"
        style={{
          color: urgent ? '#FF2D78' : secsLeft <= 30 ? '#FF8C00' : '#FFE600',
          textShadow: urgent ? '0 0 20px rgba(255,45,120,0.6)' : '0 0 20px rgba(255,230,0,0.4)',
          animation: urgent ? 'pulse 0.5s ease-in-out infinite' : 'none',
        }}
      >
        {secsLeft}s
      </div>
      <style>{`@keyframes pulse { 0%,100% { transform: scale(1); } 50% { transform: scale(1.08); } }`}</style>
    </div>
  );
}