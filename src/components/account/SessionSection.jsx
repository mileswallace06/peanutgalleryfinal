import { base44 } from '@/api/base44Client';
import { LogOut, Trash2, Moon, Sun } from 'lucide-react';

export default function SessionSection({ onDeleteRequest, theme, toggleTheme }) {
  return (
    <section className="space-y-6">
      {/* Appearance */}
      <div>
        <h3 className="text-xs font-black tracking-widest uppercase text-muted-foreground mb-3">Appearance</h3>
        <div className="rounded-2xl overflow-hidden" style={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))' }}>
          <div className="flex items-center gap-3 px-4 py-3.5">
            {theme === 'dark'
              ? <Moon className="w-4 h-4 flex-shrink-0" style={{ color: '#BF5FFF' }} />
              : <Sun className="w-4 h-4 flex-shrink-0" style={{ color: '#FF8C00' }} />
            }
            <div className="flex-1">
              <p className="text-sm font-medium text-foreground">Dark Mode</p>
              <p className="text-[11px] text-muted-foreground">{theme === 'dark' ? 'Currently on' : 'Currently off'}</p>
            </div>
            <button
              onClick={toggleTheme}
              className="relative w-12 h-6 rounded-full transition-colors flex-shrink-0"
              style={{ background: theme === 'dark' ? '#BF5FFF' : 'hsl(var(--muted))' }}
            >
              <span
                className="absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform"
                style={{ transform: theme === 'dark' ? 'translateX(24px)' : 'translateX(0)' }}
              />
            </button>
          </div>
        </div>
      </div>

      {/* Session actions */}
      <div>
        <h3 className="text-xs font-black tracking-widest uppercase text-muted-foreground mb-3">Session</h3>
        <div className="space-y-3">
          <button
            onClick={() => base44.auth.logout('/')}
            className="w-full flex items-center gap-3 px-4 py-3.5 rounded-2xl text-sm font-semibold transition-all active:scale-[0.98]"
            style={{ background: 'rgba(255,45,120,0.07)', border: '1px solid rgba(255,45,120,0.2)', color: '#FF2D78' }}
          >
            <LogOut className="w-4 h-4" /> Sign Out
          </button>
          <button
            onClick={onDeleteRequest}
            className="w-full flex items-center gap-3 px-4 py-3.5 rounded-2xl text-sm font-semibold transition-all active:scale-[0.98]"
            style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', color: 'hsl(var(--muted-foreground))' }}
          >
            <Trash2 className="w-4 h-4" /> Delete Account
          </button>
        </div>
      </div>
    </section>
  );
}