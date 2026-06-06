import { Zap, X } from 'lucide-react';

const STORAGE_KEY = 'pg_what_is_pg_seen';

export function shouldShowOverlay() {
  try { return !localStorage.getItem(STORAGE_KEY); } catch { return false; }
}

const FEATURES = [
  { icon: '⚡', title: 'Upgrade during the show', desc: 'Buy better seats from fans around you once the event starts.', color: '#FFE600' },
  { icon: '🎁', title: 'Win free upgrades', desc: 'Enter Fan Drops — seat giveaways from generous fans inside.', color: '#BF5FFF' },
  { icon: '🔒', title: 'Your money is protected', desc: 'Payment is held in escrow until you confirm receipt.', color: '#00C8FF' },
];

export default function WhatIsPGOverlay({ onDismiss }) {
  const handleDismiss = () => {
    try { localStorage.setItem(STORAGE_KEY, '1'); } catch {}
    onDismiss();
  };

  return (
    <div
      className="fixed inset-0 z-[200] flex flex-col justify-end"
      style={{ background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(6px)' }}
      onClick={handleDismiss}
    >
      {/* Sheet — stops click propagation so tapping inside doesn't close */}
      <div
        className="relative w-full rounded-t-3xl"
        style={{
          background: '#0a0a0a',
          borderTop: '1px solid rgba(0,255,135,0.3)',
          borderLeft: '1px solid rgba(255,255,255,0.06)',
          borderRight: '1px solid rgba(255,255,255,0.06)',
          paddingBottom: 'env(safe-area-inset-bottom)',
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Green top bar */}
        <div className="h-1 w-full rounded-t-3xl" style={{ background: 'linear-gradient(90deg, #00FF87, #00C8FF, #BF5FFF)' }} />

        {/* Drag handle */}
        <div className="flex justify-center pt-3 pb-1">
          <div className="w-10 h-1 rounded-full bg-white/20" />
        </div>

        {/* Close */}
        <button
          onClick={handleDismiss}
          className="absolute top-5 right-4 w-8 h-8 rounded-full flex items-center justify-center"
          style={{ background: 'rgba(255,255,255,0.08)' }}
        >
          <X className="w-4 h-4 text-white/60" />
        </button>

        <div className="px-6 pt-2 pb-6">
          {/* Badge */}
          <div className="flex items-center gap-2 mb-3">
            <span className="text-base">🎟</span>
            <span className="text-[10px] font-black tracking-[0.18em] uppercase" style={{ color: '#00FF87' }}>
              What is Peanut Gallery?
            </span>
          </div>

          {/* Headline */}
          <h2 className="font-display text-white leading-[1.05] mb-2" style={{ fontSize: '2rem' }}>
            Better Seats<br />After The Show Starts
          </h2>

          <p className="text-sm leading-relaxed mb-5" style={{ color: 'rgba(255,255,255,0.55)' }}>
            Buy live seat upgrades directly from fans already inside the venue — escrow-protected and location-verified.
          </p>

          {/* Feature rows */}
          <div className="space-y-3 mb-6">
            {FEATURES.map(({ icon, title, desc, color }) => (
              <div key={title} className="flex items-start gap-3">
                <div
                  className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 text-lg"
                  style={{ background: `${color}15`, border: `1px solid ${color}30` }}
                >
                  {icon}
                </div>
                <div className="pt-0.5">
                  <p className="text-sm font-bold text-white leading-tight">{title}</p>
                  <p className="text-xs mt-0.5" style={{ color: 'rgba(255,255,255,0.5)' }}>{desc}</p>
                </div>
              </div>
            ))}
          </div>

          {/* CTA */}
          <button
            onClick={handleDismiss}
            className="w-full py-4 rounded-2xl font-black text-base flex items-center justify-center gap-2 active:scale-[0.98] transition-transform"
            style={{
              background: 'linear-gradient(135deg, #00E87A, #00C8FF)',
              color: '#061a10',
              boxShadow: '0 0 32px rgba(0,232,122,0.25)',
            }}
          >
            <Zap className="w-5 h-5" /> Let's Go
          </button>
        </div>
      </div>
    </div>
  );
}