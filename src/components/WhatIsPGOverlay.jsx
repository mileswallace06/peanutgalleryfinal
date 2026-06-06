import { Zap, X, ShieldCheck, Ticket, Gift } from 'lucide-react';

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
    <div
      className="fixed inset-0 z-[200] flex flex-col justify-end"
      style={{ background: 'rgba(0,0,0,0.7)' }}
      onClick={handleDismiss}
    >
      <div
        className="w-full rounded-t-3xl"
        onClick={e => e.stopPropagation()}
        style={{ background: '#111', borderTop: '1px solid #222' }}
      >
        {/* Drag handle */}
        <div className="flex justify-center py-3">
          <div className="w-9 h-1 rounded-full" style={{ background: '#333' }} />
        </div>

        {/* Close */}
        <button
          onClick={handleDismiss}
          className="absolute top-4 right-4 w-8 h-8 rounded-full flex items-center justify-center"
          style={{ background: '#1e1e1e' }}
        >
          <X className="w-4 h-4" style={{ color: '#666' }} />
        </button>

        <div className="px-6 pb-8">
          {/* Eyebrow */}
          <p className="text-xs font-bold tracking-widest uppercase mb-3" style={{ color: '#00FF87' }}>
            ⚡ Peanut Gallery
          </p>

          {/* Headline */}
          <h2 className="font-display text-white mb-2" style={{ fontSize: '1.75rem', lineHeight: 1.1 }}>
            Better Seats,<br />Live At The Show
          </h2>

          <p className="text-sm mb-6" style={{ color: '#888', lineHeight: 1.6 }}>
            Buy seat upgrades directly from fans already inside the venue — payment held safely until you confirm.
          </p>

          {/* Features */}
          <div className="space-y-4 mb-7">
            {[
              { Icon: Ticket, label: 'Upgrade your seats during the event', color: '#FFE600' },
              { Icon: Gift, label: 'Win free upgrades through Fan Drops', color: '#BF5FFF' },
              { Icon: ShieldCheck, label: 'Money held in escrow until you confirm', color: '#00FF87' },
            ].map(({ Icon, label, color }) => (
              <div key={label} className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0"
                  style={{ background: `${color}15` }}>
                  <Icon className="w-4 h-4" style={{ color }} />
                </div>
                <p className="text-sm font-medium text-white">{label}</p>
              </div>
            ))}
          </div>

          {/* CTA */}
          <button
            onClick={handleDismiss}
            className="w-full py-4 rounded-2xl font-bold text-base flex items-center justify-center gap-2"
            style={{
              background: 'linear-gradient(135deg, #00FF87, #00C8FF)',
              color: '#000',
            }}
          >
            <Zap className="w-4 h-4" /> Got it, let's go
          </button>

          <p className="text-center text-xs mt-3" style={{ color: '#444' }}>
            This won't show again
          </p>
        </div>
      </div>
    </div>
  );
}