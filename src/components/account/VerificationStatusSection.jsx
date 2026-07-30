import { ShieldCheck, CheckCircle2, Circle } from 'lucide-react';

export default function VerificationStatusSection({ user, stripeStatus }) {
  const hasEmail = !!user?.email;
  const hasStripe = !!stripeStatus?.charges_enabled;
  const hasProfile = !!user?.full_name && !!user?.avatar_url;
  const hasListed = user?.has_listed === true; // set externally if desired

  const checks = [
    { label: 'Email verified', done: hasEmail, note: 'Required to use the platform' },
    { label: 'Payout account connected', done: hasStripe, note: 'Required to sell tickets' },
    { label: 'Profile complete', done: hasProfile, note: 'Name + avatar added' },
  ];

  const doneCount = checks.filter(c => c.done).length;
  const pct = Math.round((doneCount / checks.length) * 100);

  return (
    <section>
      <h3 className="text-xs font-black tracking-widest uppercase text-muted-foreground mb-3">Verification Status</h3>
      <div className="rounded-2xl overflow-hidden" style={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))' }}>
        {/* Progress bar */}
        <div className="px-4 pt-4 pb-3">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-bold text-foreground">Account Health</span>
            <span className="text-xs font-black" style={{ color: pct === 100 ? '#00FF87' : '#BF5FFF' }}>{pct}%</span>
          </div>
          <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'hsl(var(--muted))' }}>
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{
                width: `${pct}%`,
                background: pct === 100
                  ? 'linear-gradient(90deg, #00FF87, #00C8FF)'
                  : 'linear-gradient(90deg, #BF5FFF, #FF2D78)',
              }}
            />
          </div>
        </div>

        <div className="divide-y divide-border">
          {checks.map(({ label, done, note }) => (
            <div key={label} className="flex items-center gap-3 px-4 py-3">
              {done
                ? <CheckCircle2 className="w-4 h-4 flex-shrink-0" style={{ color: '#00FF87' }} />
                : <Circle className="w-4 h-4 flex-shrink-0 text-muted-foreground" />
              }
              <div className="flex-1">
                <p className="text-sm font-medium" style={{ color: done ? 'hsl(var(--foreground))' : 'hsl(var(--muted-foreground))' }}>{label}</p>
                {!done && <p className="text-[10px] text-muted-foreground">{note}</p>}
              </div>
              {done && (
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full"
                  style={{ background: 'rgba(0,255,135,0.1)', color: '#00FF87', border: '1px solid rgba(0,255,135,0.2)' }}>
                  Done
                </span>
              )}
            </div>
          ))}
        </div>

        {pct === 100 && (
          <div className="mx-4 mb-4 mt-1 flex items-center gap-2 px-3 py-2.5 rounded-xl"
            style={{ background: 'rgba(0,255,135,0.07)', border: '1px solid rgba(0,255,135,0.2)' }}>
            <ShieldCheck className="w-4 h-4 flex-shrink-0" style={{ color: '#00FF87' }} />
            <p className="text-xs text-muted-foreground">
              <span className="font-bold text-foreground">Fully verified.</span> Buyers see a trust badge on your listings.
            </p>
          </div>
        )}
      </div>
    </section>
  );
}