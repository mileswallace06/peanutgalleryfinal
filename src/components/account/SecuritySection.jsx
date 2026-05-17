import { Mail, Key, ShieldCheck, ExternalLink } from 'lucide-react';

export default function SecuritySection({ user }) {
  return (
    <section>
      <h3 className="text-xs font-black tracking-widest uppercase text-muted-foreground mb-3">Security &amp; Verification</h3>
      <div className="rounded-2xl overflow-hidden divide-y divide-border" style={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))' }}>
        {/* Email */}
        <div className="flex items-center gap-3 px-4 py-3.5">
          <Mail className="w-4 h-4 text-muted-foreground flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wide">Email</p>
            <p className="text-sm font-medium text-foreground truncate">{user?.email || '—'}</p>
          </div>
          <span className="text-[10px] font-bold px-2 py-1 rounded-full"
            style={{ background: 'rgba(0,255,135,0.12)', color: '#00FF87', border: '1px solid rgba(0,255,135,0.3)' }}>
            Verified
          </span>
        </div>

        {/* Password */}
        <div className="flex items-center gap-3 px-4 py-3.5">
          <Key className="w-4 h-4 text-muted-foreground flex-shrink-0" />
          <div className="flex-1">
            <p className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wide">Password</p>
            <p className="text-sm font-medium text-foreground">••••••••••</p>
          </div>
          <a
            href="mailto:support@peanutgallery.app?subject=Password Change Request"
            className="text-xs font-bold px-3 py-1.5 rounded-xl flex items-center gap-1"
            style={{ background: 'hsl(var(--muted))', color: 'hsl(var(--muted-foreground))' }}
          >
            Change <ExternalLink className="w-3 h-3" />
          </a>
        </div>

        {/* Trust score */}
        <div className="flex items-center gap-3 px-4 py-3.5">
          <ShieldCheck className="w-4 h-4 flex-shrink-0" style={{ color: '#BF5FFF' }} />
          <div className="flex-1">
            <p className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wide">Trust Score</p>
            <p className="text-sm font-medium text-foreground">
              {user?.strike_count > 0
                ? <span style={{ color: '#FF2D78' }}>⚠️ {user.strike_count} strike{user.strike_count > 1 ? 's' : ''}</span>
                : <span style={{ color: '#00FF87' }}>✓ Clean record</span>
              }
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}