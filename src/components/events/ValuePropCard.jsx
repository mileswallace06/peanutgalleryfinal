import { Link } from 'react-router-dom';
import { Zap } from 'lucide-react';

/**
 * ValuePropCard — the 5-second test card.
 * Shown on the Events / home page so first-time users immediately understand PG.
 */
export default function ValuePropCard({ onDismiss }) {
  return (
    <div className="mx-4 mb-5 rounded-2xl overflow-hidden relative"
      style={{
        background: 'linear-gradient(135deg, rgba(0,255,135,0.1) 0%, rgba(0,200,255,0.07) 50%, rgba(191,95,255,0.08) 100%)',
        border: '1px solid rgba(0,255,135,0.3)',
        boxShadow: '0 0 30px rgba(0,255,135,0.06)',
      }}>
      {/* Top accent line */}
      <div className="h-0.5" style={{ background: 'linear-gradient(90deg, #00FF87, #00C8FF, #BF5FFF)' }} />

      <div className="px-4 pt-4 pb-5">
        {/* Header */}
        <div className="flex items-start justify-between gap-2 mb-3">
          <div className="flex items-center gap-2">
            <span className="text-xl">🎟</span>
            <span className="text-[10px] font-black tracking-[0.2em] uppercase" style={{ color: '#00FF87' }}>What is Peanut Gallery?</span>
          </div>
          {onDismiss && (
            <button onClick={onDismiss} className="text-muted-foreground text-xs p-1 -mt-1 -mr-1">✕</button>
          )}
        </div>

        {/* Main value prop */}
        <h2 className="font-display text-foreground leading-tight mb-2" style={{ fontSize: 'clamp(1.4rem, 6vw, 1.8rem)' }}>
          Better Seats After<br />The Event Starts
        </h2>
        <p className="text-sm text-muted-foreground leading-relaxed mb-4">
          Buy live seat upgrades from fans already inside the venue.
        </p>

        {/* Three bullets */}
        <div className="space-y-2 mb-5">
          {[
            { icon: '⚡', text: 'Upgrade your seats during the event', color: '#FFE600' },
            { icon: '🎁', text: 'Win free seat upgrades through Fan Drops', color: '#BF5FFF' },
            { icon: '🔒', text: 'Money held safely until you confirm your tickets', color: '#00C8FF' },
          ].map(({ icon, text, color }) => (
            <div key={text} className="flex items-start gap-2.5">
              <span className="text-base flex-shrink-0 leading-none mt-0.5">{icon}</span>
              <span className="text-sm font-medium text-foreground leading-snug">{text}</span>
            </div>
          ))}
        </div>

        {/* CTA */}
        <Link to="/upgrades"
          className="flex items-center justify-center gap-2 w-full py-3 rounded-xl font-black text-sm transition-all active:scale-95"
          style={{ background: 'linear-gradient(135deg, #00FF87, #00C8FF)', color: '#0D0B14', boxShadow: '0 0 16px rgba(0,255,135,0.25)' }}>
          <Zap className="w-4 h-4" />
          See Live Upgrades
        </Link>
      </div>
    </div>
  );
}