import { format } from 'date-fns';

function StatCard({ label, value, color }) {
  return (
    <div className="rounded-xl p-4 text-center" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
      <div className="text-2xl font-black" style={{ color: color || 'hsl(var(--foreground))' }}>{value}</div>
      <div className="text-[10px] text-muted-foreground mt-1">{label}</div>
    </div>
  );
}

export default function DonationOpsPanel({ donations, events, onRefresh }) {
  const now = new Date();

  const active = donations.filter(d => d.donation_status === 'active');
  const drawn = donations.filter(d => d.donation_status === 'drawn');
  const accepted = donations.filter(d => d.donation_status === 'accepted');
  const completed = donations.filter(d => d.donation_status === 'completed');
  const stale = donations.filter(d => {
    if (!['active', 'drawn'].includes(d.donation_status)) return false;
    if (!d.expires_at) return false;
    return new Date(d.expires_at) < now;
  });

  // Suspicious: donors with many active donations
  const donorCounts = {};
  donations.filter(d => d.donation_status === 'active').forEach(d => {
    donorCounts[d.donor_email] = (donorCounts[d.donor_email] || 0) + 1;
  });
  const suspiciousDonors = Object.entries(donorCounts).filter(([, c]) => c >= 3);

  return (
    <div className="space-y-6">
      <h2 className="font-bold text-foreground text-lg">Seat Donation Ops</h2>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard label="Active Donations" value={active.length} color="#00FF87" />
        <StatCard label="Drawn (Pending Accept)" value={drawn.length} color="#FF8C00" />
        <StatCard label="Stale / Expired" value={stale.length} color={stale.length > 0 ? '#FF2D78' : '#888'} />
        <StatCard label="Accepted" value={accepted.length + completed.length} color="#00C8FF" />
      </div>

      {/* Stale donations */}
      {stale.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">
            Stale/Expired Donations ({stale.length})
          </h3>
          <div className="space-y-2">
            {stale.map(d => (
              <div key={d.id} className="rounded-xl px-4 py-3 text-sm"
                style={{ background: 'rgba(255,45,120,0.06)', border: '1px solid rgba(255,45,120,0.2)' }}>
                <div className="font-semibold text-foreground">{d.event_title || 'Event'}</div>
                <div className="text-xs text-muted-foreground">From: {d.donor_name || d.donor_email} · Sec {d.section} Row {d.row}</div>
                <div className="text-xs text-muted-foreground">Expired: {d.expires_at ? format(new Date(d.expires_at), 'MMM d h:mm a') : '—'}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Suspicious donor patterns */}
      {suspiciousDonors.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">
            Suspicious Patterns (3+ active donations)
          </h3>
          <div className="space-y-2">
            {suspiciousDonors.map(([email, count]) => (
              <div key={email} className="rounded-xl px-4 py-3 text-sm flex items-center justify-between"
                style={{ background: 'rgba(255,230,0,0.06)', border: '1px solid rgba(255,230,0,0.25)' }}>
                <div className="font-medium text-foreground">{email}</div>
                <span className="text-xs font-bold px-2 py-0.5 rounded-full"
                  style={{ background: 'rgba(255,230,0,0.1)', color: '#FFE600', border: '1px solid rgba(255,230,0,0.3)' }}>
                  {count} active
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Active donations list */}
      {active.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">
            Active Donations ({active.length})
          </h3>
          <div className="space-y-2">
            {active.slice(0, 10).map(d => (
              <div key={d.id} className="rounded-xl px-4 py-3 text-sm"
                style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
                <div className="font-semibold text-foreground">{d.event_title || 'Event'}</div>
                <div className="text-xs text-muted-foreground">
                  From: {d.is_anonymous ? 'Anonymous' : (d.donor_name || d.donor_email)} · Sec {d.section} Row {d.row}
                  {d.expires_at && ` · Expires ${format(new Date(d.expires_at), 'MMM d')}`}
                </div>
              </div>
            ))}
            {active.length > 10 && <div className="text-xs text-muted-foreground text-center">+{active.length - 10} more</div>}
          </div>
        </div>
      )}

      {donations.length === 0 && (
        <div className="text-center py-10 rounded-2xl" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
          <div className="text-2xl mb-2">🎟</div>
          <div className="text-sm text-muted-foreground">No donations yet.</div>
        </div>
      )}
    </div>
  );
}