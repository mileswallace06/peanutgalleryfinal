import { useState } from 'react';
import { X } from 'lucide-react';

const DISMISSED_KEY = 'pg_livehub_explainer_dismissed';

/**
 * One-time explainer shown when a user first enters the Live Hub.
 * Dismissed forever once tapped.
 */
export default function LiveHubExplainer() {
  const [visible, setVisible] = useState(() => !localStorage.getItem(DISMISSED_KEY));

  if (!visible) return null;

  const dismiss = () => {
    localStorage.setItem(DISMISSED_KEY, '1');
    setVisible(false);
  };

  return (
    <div className="rounded-2xl px-4 py-4 relative"
      style={{
        background: 'linear-gradient(135deg, rgba(255,230,0,0.1), rgba(255,45,120,0.07))',
        border: '1px solid rgba(255,230,0,0.35)',
      }}>
      <button onClick={dismiss} className="absolute top-3 right-3 text-muted-foreground p-1">
        <X className="w-3.5 h-3.5" />
      </button>

      <div className="flex items-start gap-3 pr-6">
        <span className="text-2xl flex-shrink-0">⚡</span>
        <div>
          <p className="font-black text-sm text-foreground leading-tight mb-1">Welcome to the Live Hub</p>
          <p className="text-xs text-muted-foreground leading-relaxed">
            This is where fans at the venue trade seats in real time. You can:
          </p>
          <div className="mt-2 space-y-1">
            {[
              { icon: '🎁', text: 'Win free seats through Fan Drops' },
              { icon: '⚡', text: 'Buy seat upgrades right now' },
              { icon: '🏆', text: 'Earn Fan Karma by helping others' },
            ].map(({ icon, text }) => (
              <div key={text} className="flex items-center gap-2 text-xs text-foreground">
                <span>{icon}</span><span>{text}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}