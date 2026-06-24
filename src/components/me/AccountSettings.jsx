import { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { useTheme } from '@/hooks/useTheme';
import { LogOut, Trash2, Moon, Sun, CreditCard, Mail, Key, ChevronRight, ExternalLink } from 'lucide-react';
import DeleteAccountModal from '@/components/DeleteAccountModal';

export default function AccountSettings({ user, purchases = [] }) {
  const { theme, toggleTheme } = useTheme();
  const [showDeleteModal, setShowDeleteModal] = useState(false);

  return (
    <div className="space-y-6 px-5 pb-10">

      {/* Account Info */}
      <section>
        <h3 className="text-xs font-black tracking-widest uppercase text-muted-foreground mb-3">Account</h3>
        <div className="rounded-2xl overflow-hidden divide-y divide-border" style={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))' }}>
          <div className="flex items-center gap-3 px-4 py-3.5">
            <Mail className="w-4 h-4 text-muted-foreground flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wide">Email</p>
              <p className="text-sm font-medium text-foreground truncate">{user?.email}</p>
            </div>
          </div>
          <div className="flex items-center gap-3 px-4 py-3.5">
            <Key className="w-4 h-4 text-muted-foreground flex-shrink-0" />
            <div className="flex-1">
              <p className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wide">Password</p>
              <p className="text-sm font-medium text-foreground">••••••••</p>
            </div>
            <a
              href="mailto:experience@peanutgallery.store?subject=Password Change Request"
              className="text-xs font-bold px-3 py-1.5 rounded-xl flex items-center gap-1"
              style={{ background: 'hsl(var(--muted))', color: 'hsl(var(--muted-foreground))' }}
            >
              Change <ExternalLink className="w-3 h-3" />
            </a>
          </div>
        </div>
      </section>

      {/* Appearance */}
      <section>
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
      </section>

      {/* Payment History */}
      <section>
        <h3 className="text-xs font-black tracking-widest uppercase text-muted-foreground mb-3">Payment History</h3>
        <div className="rounded-2xl overflow-hidden" style={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))' }}>
          {purchases.length === 0 ? (
            <div className="px-4 py-5 flex items-center gap-3">
              <CreditCard className="w-4 h-4 text-muted-foreground flex-shrink-0" />
              <p className="text-sm text-muted-foreground">No purchases yet</p>
            </div>
          ) : (
            <div className="divide-y divide-border">
              {purchases.slice(0, 5).map(p => (
                <div key={p.id} className="flex items-center gap-3 px-4 py-3.5">
                  <CreditCard className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">Order #{p.id?.slice(-6)}</p>
                    <p className="text-[11px] text-muted-foreground capitalize">{p.transfer_status?.replace('_', ' ')}</p>
                  </div>
                  <span className="text-sm font-bold" style={{ color: '#00FF87' }}>${p.amount?.toFixed(2)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* Sign Out & Delete */}
      <section className="space-y-3">
        <h3 className="text-xs font-black tracking-widest uppercase text-muted-foreground mb-3">Session</h3>
        <button
          onClick={() => base44.auth.logout('/')}
          className="w-full flex items-center gap-3 px-4 py-3.5 rounded-2xl text-sm font-semibold transition-all active:scale-[0.98]"
          style={{ background: 'rgba(255,45,120,0.07)', border: '1px solid rgba(255,45,120,0.2)', color: '#FF2D78' }}
        >
          <LogOut className="w-4 h-4" /> Sign Out
        </button>
        <button
          onClick={() => setShowDeleteModal(true)}
          className="w-full flex items-center gap-3 px-4 py-3.5 rounded-2xl text-sm font-semibold transition-all active:scale-[0.98]"
          style={{ background: 'rgba(255,45,120,0.05)', border: '1px solid rgba(255,45,120,0.15)', color: 'hsl(var(--muted-foreground))' }}
        >
          <Trash2 className="w-4 h-4" /> Delete Account
        </button>
      </section>

      <DeleteAccountModal user={user} isOpen={showDeleteModal} onClose={() => setShowDeleteModal(false)} />
    </div>
  );
}