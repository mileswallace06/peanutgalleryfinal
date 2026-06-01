import { useState } from 'react';
import { X } from 'lucide-react';

const DISMISSED_KEY = 'pg_flashdrop_explainer_dismissed';

/**
 * One-time Flash Drop explainer — shown the first time a user sees the Drops tab.
 */
export default function FlashDropExplainer() {
  const [visible, setVisible] = useState(() => !localStorage.getItem(DISMISSED_KEY));

  if (!visible) return null;

  const dismiss = () => {
    localStorage.setItem(DISMISSED_KEY, '1');
    setVisible(false);
  };

  return (
    <div className="rounded-2xl px-4 py-4 relative"
      style={{
        background: 'linear-gradient(135deg, rgba(191,95,255,0.1), rgba(255,45,120,0.07))',
        border: '1px solid rgba(191,95,255,0.35)',
      }}>
      <button onClick={dismiss} className="absolute top-3 right-3 text-muted-foreground p-1">
        <X className="w-3.5 h-3.5" />
      </button>

      <div className="flex items-start gap-3 pr-6">
        <span className="text-2xl flex-shrink-0">🎁</span>
        <div>
          <p className="font-black text-sm text-foreground leading-tight mb-1">What is a Fan Drop?</p>
          <p className="text-xs text-muted-foreground leading-relaxed">
            Fans sometimes donate their unused seats for free. Enter with one tap — a winner is randomly selected when the timer runs out. If you win, you'll get the seat upgrade instantly.
          </p>
          <button onClick={dismiss}
            className="mt-3 px-4 py-2 rounded-xl text-xs font-black"
            style={{ background: 'rgba(191,95,255,0.15)', border: '1px solid rgba(191,95,255,0.35)', color: '#BF5FFF' }}>
            Got it — show me the drops
          </button>
        </div>
      </div>
    </div>
  );
}