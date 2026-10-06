import '@/components/member-surfaces.css';
import { base44 } from '@/api/base44Client';
import { LogOut, Trash2, Moon, Sun, PlayCircle } from 'lucide-react';

export default function SessionSection({ onDeleteRequest, theme, toggleTheme, user }) {
  return (
    <section className="pg-member-section space-y-6">
      {/* Appearance */}
      <div>
        <h3 className="text-xs font-black tracking-widest uppercase text-muted-foreground mb-3">Appearance</h3>
        <div className="rounded-xl overflow-hidden" style={{ background: 'var(--pg-surface)', border: '1px solid var(--pg-line)' }}>
          <div className="flex items-center gap-3 px-4 py-3.5">
            {theme === 'dark'
              ? <Moon className="w-4 h-4 flex-shrink-0" style={{ color: 'var(--neon-purple)' }} />
              : <Sun className="w-4 h-4 flex-shrink-0" style={{ color: 'var(--neon-orange)' }} />
            }
            <div className="flex-1">
              <p className="text-sm font-medium text-foreground">Dark Mode</p>
              <p className="text-[11px] text-muted-foreground">{theme === 'dark' ? 'Currently on' : 'Currently off'}</p>
            </div>
            <button
              type="button"
              role="switch"
              aria-label="Dark mode"
              aria-checked={theme === 'dark'}
              onClick={toggleTheme}
              className="pg-preference-toggle pg-preference-toggle--appearance w-12 h-11 flex items-center justify-center rounded-lg flex-shrink-0"
            >
              <span
                aria-hidden="true"
                className="pg-preference-toggle-track relative block w-12 h-6 rounded-full transition-colors"
              >
                <span
                  className="pg-preference-toggle-thumb absolute top-0.5 left-0.5 w-5 h-5 rounded-full shadow transition-transform"
                  style={{ transform: theme === 'dark' ? 'translateX(24px)' : 'translateX(0)' }}
                />
              </span>
            </button>
          </div>
        </div>
      </div>

      {/* Session actions */}
      <div>
        <h3 className="text-xs font-black tracking-widest uppercase text-muted-foreground mb-3">Session</h3>
        <div className="space-y-3">
          {user?.role === 'admin' && (
            <button
              onClick={async () => {
                localStorage.removeItem('pg_onboarded');
                await base44.auth.updateMe({ has_seen_onboarding: false }).catch(() => {});
                window.location.href = '/events';
              }}
              className="w-full flex items-center gap-3 px-4 py-3.5 rounded-xl text-sm font-semibold transition-all active:scale-[0.98]"
              style={{ background: 'rgba(191,95,255,0.07)', border: '1px solid rgba(191,95,255,0.2)', color: 'var(--neon-purple)' }}
            >
              <PlayCircle className="w-4 h-4" /> Replay Onboarding
            </button>
          )}
          <button
            onClick={() => base44.auth.logout('/')}
            className="w-full flex items-center gap-3 px-4 py-3.5 rounded-xl text-sm font-semibold transition-all active:scale-[0.98]"
            style={{ background: 'rgba(255,45,120,0.07)', border: '1px solid rgba(255,45,120,0.2)', color: 'var(--neon-pink)' }}
          >
            <LogOut className="w-4 h-4" /> Sign Out
          </button>
          <button
            onClick={onDeleteRequest}
            className="w-full flex items-center gap-3 px-4 py-3.5 rounded-xl text-sm font-semibold transition-all active:scale-[0.98]"
            style={{ background: 'var(--pg-surface)', border: '1px solid var(--pg-line)', color: 'var(--pg-muted)' }}
          >
            <Trash2 className="w-4 h-4" /> Delete Account
          </button>
        </div>
      </div>
    </section>
  );
}
