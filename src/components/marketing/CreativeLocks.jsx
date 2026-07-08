/**
 * Creative Locks
 * --------------------------------------------------------------------
 * Lockable design categories. When a category is locked, AI edits
 * must never modify it. This makes iterative editing predictable.
 *
 * "Make it feel more exciting" → only unlocked systems change.
 * "Keep the layout exactly the same but redesign everything else"
 *   → lock layout, then edit.
 */
import { Lock, Unlock, Layout, Type, Image, Palette, Sparkles, Camera, Award, MousePointerClick } from 'lucide-react';
import { LOCKABLE_SYSTEMS } from '@/lib/marketing/creativeIntent';
import { NEON, NEON_RGB } from '@/lib/marketingTokens';

const ICON_MAP = {
  layout: Layout,
  typography: Type,
  background: Image,
  colors: Palette,
  decorative: Sparkles,
  imagery: Camera,
  logo: Award,
  cta: MousePointerClick,
};

export default function CreativeLocks({ locks = {}, onToggle }) {
  return (
    <div>
      <p className="text-[9px] font-bold tracking-widest uppercase text-muted-foreground mb-2">
        Creative Locks — locked systems are protected from AI edits
      </p>
      <div className="grid grid-cols-2 gap-1.5">
        {Object.entries(LOCKABLE_SYSTEMS).map(([key, def]) => {
          const Icon = ICON_MAP[key] || Lock;
          const isLocked = locks[key];
          return (
            <button
              key={key}
              onClick={() => onToggle(key)}
              className="flex items-center gap-1.5 px-2.5 py-2 rounded-lg text-[10px] font-bold transition-all active:scale-95"
              style={isLocked
                ? { background: `rgba(${NEON_RGB.yellow}, 0.1)`, border: `1px solid rgba(${NEON_RGB.yellow}, 0.3)`, color: NEON.yellow }
                : { background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', color: 'hsl(var(--muted-foreground))' }}
            >
              <Icon className="w-3 h-3 flex-shrink-0" />
              <span className="truncate">{def.label}</span>
              {isLocked
                ? <Lock className="w-2.5 h-2.5 flex-shrink-0 ml-auto" />
                : <Unlock className="w-2.5 h-2.5 flex-shrink-0 ml-auto opacity-40" />}
            </button>
          );
        })}
      </div>
    </div>
  );
}