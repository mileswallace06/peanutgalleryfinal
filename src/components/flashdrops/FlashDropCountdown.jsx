import { useState, useEffect } from 'react';
import { Zap } from 'lucide-react';
import './fan-gifts-ticket.css';

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
    <div className={`pg-gift-countdown flex flex-col items-center gap-1${urgent ? ' is-urgent' : ''}`}>
      <div className="flex items-center gap-1.5">
        <Zap className="w-3.5 h-3.5" />
        <span className="text-[10px] font-black tracking-widest uppercase">
          Entry closes in
        </span>
      </div>
      <div
        className={`pg-gift-countdown-value text-4xl font-black tabular-nums transition-colors${secsLeft <= 30 ? ' is-soon' : ''}`}
      >
        {secsLeft}s
      </div>
    </div>
  );
}
