import { Zap, X } from 'lucide-react';

const STORAGE_KEY = 'pg_what_is_pg_seen';

export function shouldShowOverlay() {
  try { return !localStorage.getItem(STORAGE_KEY); } catch { return false; }
}

export default function WhatIsPGOverlay({ onDismiss }) {
  const handleDismiss = () => {
    try { localStorage.setItem(STORAGE_KEY, '1'); } catch {}
    onDismiss();
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(8px)' }}>
      <div className="relative w-full sm:max-w-md mx-auto rounded-t-3xl sm:rounded-3xl overflow-hidden"
        style={{
          background: 'hsl(0 0% 6%)',
          border: '1px solid rgba(0,255,135,0.25)',
          boxShadow: '0 0 80px rgba(0,255,135,0.12)',
        }}>
        {/* Top accent */}
        <div className="h-1" style={{ background: 'linear-gradient(90deg, #00FF87, #00C8FF, #BF5FFF)' }} />

        {/* Close button */}
        <button onClick={handleDismiss}
          className="absolute top-4 right-4 w-8 h-8 rounded-full flex items-center justify-center transition-colors"
          style={{ background: 'rgba(255,255,255,0.08)', color: 'hsl(var(--muted-foreground))' }}>
          <X className="w-4 h-4" />
        </button>

        <div className="px-6 pt-6 pb-8">
          {/* Badge */}
          <div className="inline-flex items-center gap-2 mb-5">
            <span className="text-2xl">🎟</span>
            <span className="text-[11px] font-black tracking-[0.2em] uppercase" style={{ color: '#00FF87' }}>
              What is Peanut Gallery?
            </span>
          </div>

          {/* Headline */}
          <h2 className="font-display leading-tight mb-3 text-foreground"
            style={{ fontSize: 'clamp(2rem, 8vw, 2.6rem)' }}>
            Better Seats<br />After The Event Starts
          </h2>

          <p className="text-sm text-muted-foreground leading-relaxed mb-6">
            Buy live seat upgrades directly from fans already inside the venue — escrow-protected and location-verified.
          </p>

          {/* Bullets */}
          <div className="space-y-4 mb-8">
            {[
              { icon: '⚡', title: 'Upgrade during the show', desc: 'Buy better seats from fans around you once the event starts.', color: '#FFE600' },
              { icon: '🎁', title: 'Win free upgrades', desc: 'Enter Fan Drops — seat giveaways from generous fans inside.', color: '#BF5FFF' },
              { icon: '🔒', title: 'Your money is protected', desc: 'Payment is held in escrow until you confirm you received your tickets.', color: '#00C8FF' },
            ].map(({ icon, title, desc, color }) => (
              <div key={title} className="flex items-start gap-3">
                <div className="w-9 h-9 rounded-2xl flex items-center justify-center flex-shrink-0 text-lg"
                  style={{ background: `${color}18`, border: `1px solid ${color}33` }}>
                  {icon}
                </div>
                <div>
                  <div className="text-sm font-bold text-foreground">{title}</div>
                  <div className="text-xs text-muted-foreground mt-0.5">{desc}</div>
                </div>
              </div>
            ))}
          </div>

          {/* CTA */}
          <button
            onClick={handleDismiss}
            className="w-full py-4 rounded-full font-black text-base flex items-center justify-center gap-2 transition-all active:scale-[0.98]"
            style={{ background: 'linear-gradient(135deg, #00E87A, #00B8E8)', color: '#0D0B14', boxShadow: '0 4px 24px rgba(0,232,122,0.3)' }}>
            <Zap className="w-5 h-5" /> Let's Go
          </button>

          <p className="text-[10px] text-center text-muted-foreground mt-3">
            Only shows once — we promise 🤝
          </p>
        </div>
      </div>
    </div>
  );
}