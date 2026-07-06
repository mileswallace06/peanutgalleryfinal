/**
 * Shared marketing UI primitives.
 * Eliminates duplicate SectionLabel, FormField, loading spinners,
 * admin gates, and panel switchers across all builder pages.
 */
import { Loader2 } from 'lucide-react';
import { NEON } from '@/lib/marketingTokens';

export function SectionLabel({ children, color = NEON.cyan, className = '' }) {
  return (
    <p className={`text-[10px] font-black tracking-widest uppercase mb-3 flex items-center gap-2 ${className}`} style={{ color }}>
      <span className="w-4 h-px inline-block" style={{ background: color }} />
      {children}
    </p>
  );
}

export function FormField({ label, value, onChange, placeholder, multiline = false, rows = 2, maxLength }) {
  const common = {
    value: value || '',
    onChange: e => onChange(e.target.value),
    placeholder,
    maxLength,
    className: 'w-full px-3 py-2 rounded-xl text-sm bg-background border border-border text-foreground placeholder:text-muted-foreground outline-none focus:border-primary transition-colors',
  };
  return (
    <div>
      <label className="text-[10px] font-bold text-muted-foreground block mb-1">{label}</label>
      {multiline
        ? <textarea {...common} rows={rows} className={`${common.className} resize-none`} />
        : <input type="text" {...common} />}
    </div>
  );
}

export function LoadingSpinner({ size = 'w-6 h-6', fullHeight = true }) {
  return (
    <div className={`flex items-center justify-center ${fullHeight ? 'min-h-full' : 'py-8'}`}>
      <div className={`${size} border-2 border-primary border-t-transparent rounded-full animate-spin`} />
    </div>
  );
}

export function PanelSwitcher({ panels, active, onChange }) {
  return (
    <div className="flex gap-2 px-4 mb-3">
      {panels.map(p => {
        const Icon = p.icon;
        return (
          <button key={p.id} onClick={() => onChange(p.id)} aria-pressed={active === p.id}
            className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl text-xs font-bold transition-all"
            style={active === p.id
              ? { background: 'hsl(var(--primary))', color: 'hsl(var(--primary-foreground))' }
              : { background: 'hsl(var(--card))', color: 'hsl(var(--muted-foreground))', border: '1px solid hsl(var(--border))' }}>
            <Icon className="w-3.5 h-3.5" /> {p.label}
          </button>
        );
      })}
    </div>
  );
}

export function ThemePicker({ theme, onChange }) {
  const themeColors = { dark: NEON.purple, dark_purple: NEON.purple, dark_green: NEON.green, dark_cyan: NEON.cyan, dark_pink: NEON.pink };
  return (
    <div className="flex gap-2 flex-wrap">
      {Object.entries({ dark: '', dark_purple: '', dark_green: '', dark_cyan: '', dark_pink: '' }).map(([key]) => {
        const color = themeColors[key];
        return (
          <button key={key} onClick={() => onChange(key)}
            className="flex items-center gap-2 px-3 py-2 rounded-xl transition-all active:scale-95"
            style={theme === key
              ? { background: 'hsl(var(--background))', border: `2px solid ${color}` }
              : { background: 'hsl(var(--muted))', border: '1px solid hsl(var(--border))' }}>
            <span className="w-4 h-4 rounded-full" style={{ background: color }} />
            <span className="text-xs font-bold text-foreground capitalize">{key.replace('dark_', '')}</span>
          </button>
        );
      })}
    </div>
  );
}