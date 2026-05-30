import { useState, useEffect, useCallback } from 'react';
import { base44 } from '@/api/base44Client';
import { isAdmin } from '@/lib/isAdmin';
import { Navigate, Link } from 'react-router-dom';
import { formatDistanceToNow } from 'date-fns';
import { Shield, RefreshCw, AlertTriangle, TrendingUp, Clock, CheckCircle, XCircle, Activity, Zap, Bell } from 'lucide-react';
import { isVerificationExpired } from '@/lib/transferConfidence';
import EventNavHealthPanel from '@/components/founder/EventNavHealthPanel';

function StatCard({ label, value, color, icon, sub, urgent }) {
  return (
    <div className="rounded-2xl p-4"
      style={{
        background: urgent && value > 0 ? `rgba(255,45,120,0.07)` : 'rgba(255,255,255,0.04)',
        border: urgent && value > 0 ? '1px solid rgba(255,45,120,0.3)' : '1px solid rgba(255,255,255,0.08)',
      }}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-2xl font-black" style={{ color: color || 'hsl(var(--foreground))' }}>{value}</div>
          <div className="text-xs text-muted-foreground mt-0.5">{label}</div>
          {sub && <div className="text-[10px] text-muted-foreground mt-0.5">{sub}</div>}
        </div>
        {icon && <span className="text-xl flex-shrink-0 opacity-70">{icon}</span>}
      </div>
    </div>
  );
}

function SectionHeader({ title, icon }) {
  return (
    <div className="flex items-center gap-2 mb-3">
      <span className="text-base">{icon}</span>
      <h2 className="font-bold text-sm text-foreground uppercase tracking-wide">{title}</h2>
      <div className="flex-1 h-px" style={{ background: 'rgba(255,255,255,0.06)' }} />
    </div>
  );
}

export default function FounderDashboard() {
  const [user, setUser] = useState(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [loading, setLoading] = useState(true);
  const [lastRefresh, setLastRefresh] = useState(null);

  const [purchases, setPurchases] = useState([]);
  const [listings, setListings] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [donations, setDonations] = useState([]);
  const [outcomes, setOutcomes] = useState([]);

  useEffect(() => {
    base44.auth.me({ fresh: true }).then(u => {
      setUser(u);
      setAuthChecked(true);
    }).catch(() => setAuthChecked(true));
  }, []);

  const loadAll = useCallback(async () => {
    setLoading(true);
    const [p, l, a, d, o] = await Promise.all([
      base44.entities.Purchase.list('-created_date', 200),
      base44.entities.Listing.list('-updated_date', 200),
      base44.entities.AdminAlert.filter({ resolved: false }),
      base44.entities.SeatDonation.list('-created_date', 50),
      base44.entities.TransferOutcome.list('-created_date', 500),
    ]);
    setPurchases(p || []);
    setListings(l || []);
    setAlerts(a || []);
    setDonations(d || []);
    setOutcomes(o || []);
    setLastRefresh(new Date());
    setLoading(false);
  }, []);

  useEffect(() => {
    if (authChecked && user && isAdmin(user)) loadAll();
  }, [authChecked, user]);

  if (!authChecked) return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
    </div>
  );

  if (!user || !isAdmin(user)) return <Navigate to="/events" replace />;

  // ── Derived metrics ──────────────────────────────────────────────────
  const activeListings = listings.filter(l => l.status === 'active');
  const hiddenListings = listings.filter(l => l.status === 'hidden');
  const expiredListings = activeListings.filter(l => isVerificationExpired(l));
  const needsReverify = activeListings.filter(l => !l.last_transfer_verification || isVerificationExpired(l));
  const disabledListings = listings.filter(l => l.transfer_status === 'transfer_disabled');
  const lowConfidence = activeListings.filter(l => (l.transfer_confidence_score ?? 100) < 40);

  const pendingTransfers = purchases.filter(p => p.transfer_status === 'pending_transfer');
  const openDisputes = purchases.filter(p => p.transfer_status === 'disputed');
  const buyerWaiting = pendingTransfers.filter(p => !p.seller_confirmed);
  const sellerMissed = pendingTransfers.filter(p => p.seller_confirmed && !p.buyer_confirmed);
  const completedSales = purchases.filter(p => p.transfer_status === 'completed');
  const totalRevenue = completedSales.reduce((s, p) => s + (p.platform_fee || 0), 0);

  const criticalAlerts = alerts.filter(a => a.priority === 'critical');
  const highAlerts = alerts.filter(a => a.priority === 'high');

  // ── TransferOutcome is source of truth for all transfer metrics ──
  const successfulOutcomes = outcomes.filter(o => o.transfer_successful);
  const failedOutcomes = outcomes.filter(o => !o.transfer_successful);
  const outcomeTotal = outcomes.length;

  // Success rate from TransferOutcome (falls back to Purchase if no outcomes yet)
  const successRate = outcomeTotal > 0
    ? Math.round((successfulOutcomes.length / outcomeTotal) * 100)
    : (completedSales.length + openDisputes.length > 0
      ? Math.round((completedSales.length / (completedSales.length + openDisputes.length)) * 100)
      : 100);

  // Dispute rate from TransferOutcome
  const disputeRate = outcomeTotal > 0
    ? Math.round((failedOutcomes.length / outcomeTotal) * 100)
    : 0;

  // Avg transfer time from TransferOutcome.minutes_to_transfer (authoritative)
  const outcomeTimes = successfulOutcomes
    .filter(o => o.minutes_to_transfer != null && o.minutes_to_transfer > 0)
    .map(o => o.minutes_to_transfer);
  const avgTransferMin = outcomeTimes.length
    ? Math.round(outcomeTimes.reduce((a, b) => a + b, 0) / outcomeTimes.length)
    : null;

  // Marketplace Health Score (0–100)
  // Weighted: success rate 40%, dispute rate 25%, critical alerts 20%, pending load 15%
  const alertPenalty = Math.min(criticalAlerts.length * 10, 30);
  const pendingPenalty = Math.min(pendingTransfers.length * 2, 15);
  const healthScore = Math.max(0, Math.min(100,
    Math.round(successRate * 0.40 + (100 - disputeRate * 4) * 0.25 + (100 - alertPenalty) * 0.20 + (100 - pendingPenalty) * 0.15)
  ));

  const needsAttentionNow = criticalAlerts.length > 0 || openDisputes.length > 0 || buyerWaiting.length > 3;

  return (
    <div className="min-h-screen" style={{ background: 'hsl(var(--background))' }}>
      {/* Top bar */}
      <div className="sticky top-0 z-40 px-4 py-3 flex items-center gap-3 border-b border-border"
        style={{ background: 'rgba(0,0,0,0.92)', backdropFilter: 'blur(24px)' }}>
        <Shield className="w-5 h-5 flex-shrink-0" style={{ color: needsAttentionNow ? '#FF2D78' : '#BF5FFF' }} />
        <div className="flex-1 min-w-0">
          <span className="font-display text-sm font-black text-foreground tracking-wide">FOUNDER DASHBOARD</span>
          {lastRefresh && (
            <span className="text-muted-foreground text-xs ml-2 hidden sm:inline">
              {formatDistanceToNow(lastRefresh, { addSuffix: true })}
            </span>
          )}
        </div>
        <Link to="/admin" className="text-xs text-muted-foreground hover:text-foreground px-2 py-1 rounded hidden sm:block flex-shrink-0">
          Full Admin →
        </Link>
        <button onClick={loadAll} disabled={loading} className="p-1.5 rounded-lg hover:bg-muted flex-shrink-0">
          <RefreshCw className={`w-4 h-4 text-muted-foreground ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      <div className="px-4 py-5 max-w-3xl mx-auto pb-20 space-y-7">

        {/* ── WHAT NEEDS ATTENTION NOW ── */}
        <div>
          <SectionHeader title="Needs Attention Now" icon="🚨" />
          {needsAttentionNow ? (
            <div className="space-y-2">
              {criticalAlerts.map(a => (
                <div key={a.id} className="flex items-center gap-3 rounded-xl px-4 py-3 text-sm"
                  style={{ background: 'rgba(255,45,120,0.1)', border: '1px solid rgba(255,45,120,0.35)' }}>
                  <span>🚨</span>
                  <span className="font-semibold text-foreground flex-1">{a.title}</span>
                  <Link to="/admin" className="text-xs font-bold flex-shrink-0" style={{ color: '#FF2D78' }}>Fix →</Link>
                </div>
              ))}
              {openDisputes.length > 0 && (
                <div className="flex items-center gap-3 rounded-xl px-4 py-3 text-sm"
                  style={{ background: 'rgba(255,45,120,0.08)', border: '1px solid rgba(255,45,120,0.3)' }}>
                  <span>⚖️</span>
                  <span className="font-semibold text-foreground flex-1">{openDisputes.length} open dispute{openDisputes.length !== 1 ? 's' : ''}</span>
                  <Link to="/admin" className="text-xs font-bold flex-shrink-0" style={{ color: '#FF2D78' }}>Resolve →</Link>
                </div>
              )}
              {buyerWaiting.length > 3 && (
                <div className="flex items-center gap-3 rounded-xl px-4 py-3 text-sm"
                  style={{ background: 'rgba(255,140,0,0.08)', border: '1px solid rgba(255,140,0,0.3)' }}>
                  <span>⏳</span>
                  <span className="font-semibold text-foreground flex-1">{buyerWaiting.length} buyers waiting for ticket transfer</span>
                  <Link to="/admin" className="text-xs font-bold flex-shrink-0" style={{ color: '#FF8C00' }}>View →</Link>
                </div>
              )}
            </div>
          ) : (
            <div className="rounded-xl px-4 py-3 flex items-center gap-3 text-sm"
              style={{ background: 'rgba(0,255,135,0.06)', border: '1px solid rgba(0,255,135,0.2)' }}>
              <CheckCircle className="w-4 h-4" style={{ color: '#00FF87' }} />
              <span className="text-muted-foreground">No critical issues right now. Marketplace looks healthy.</span>
            </div>
          )}
        </div>

        {/* ── ALERT PULSE ── */}
        {alerts.length > 0 && (
          <div>
            <SectionHeader title="Alert Pulse" icon="🔔" />
            <div className="grid grid-cols-4 gap-2">
              <StatCard label="Critical" value={criticalAlerts.length} color="#FF2D78" icon="🚨" urgent />
              <StatCard label="High" value={highAlerts.length} color="#FF8C00" icon="⚠️" />
              <StatCard label="Total Open" value={alerts.length} color="#FFE600" icon="🔔" />
              <StatCard label="Disputes" value={openDisputes.length} color="#FF2D78" icon="⚖️" urgent />
            </div>
          </div>
        )}

        {/* ── MARKETPLACE HEALTH SCORE ── */}
        <div>
          <SectionHeader title="Marketplace Health Score" icon="💊" />
          <div className="rounded-2xl p-5 flex items-center gap-6"
            style={{
              background: healthScore >= 80 ? 'rgba(0,255,135,0.06)' : healthScore >= 60 ? 'rgba(255,140,0,0.06)' : 'rgba(255,45,120,0.08)',
              border: `1px solid ${healthScore >= 80 ? 'rgba(0,255,135,0.25)' : healthScore >= 60 ? 'rgba(255,140,0,0.25)' : 'rgba(255,45,120,0.35)'}`,
            }}>
            <div>
              <div className="text-5xl font-black" style={{ color: healthScore >= 80 ? '#00FF87' : healthScore >= 60 ? '#FF8C00' : '#FF2D78' }}>
                {healthScore}
              </div>
              <div className="text-xs text-muted-foreground mt-1">/ 100</div>
            </div>
            <div className="flex-1 space-y-1.5">
              {[
                { label: 'Transfer Success Rate', value: `${successRate}%`, src: outcomeTotal > 0 ? 'TransferOutcome' : 'Purchase fallback' },
                { label: 'Dispute Rate', value: `${disputeRate}%`, src: 'TransferOutcome' },
                { label: 'Avg Transfer Time', value: avgTransferMin ? `${avgTransferMin}m` : 'No data', src: 'TransferOutcome' },
                { label: 'Open Critical Alerts', value: criticalAlerts.length, src: 'AdminAlert' },
              ].map(m => (
                <div key={m.label} className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">{m.label}</span>
                  <span className="font-bold text-foreground">{m.value}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* ── MARKETPLACE PULSE ── */}
        <div>
          <SectionHeader title="Marketplace Pulse" icon="📊" />
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <StatCard label="Active Listings" value={activeListings.length} icon="🎫" />
            <StatCard label="Pending Transfers" value={pendingTransfers.length} icon="⏳" />
            <StatCard label="Completed Sales" value={completedSales.length} color="#00FF87" icon="✅" />
            <StatCard label="Platform Revenue" value={`$${totalRevenue.toFixed(0)}`} color="#00FF87" icon="💸" />
          </div>
        </div>

        {/* ── TRANSFER HEALTH ── */}
        <div>
          <SectionHeader title="Transfer Health" icon="🔄" />
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <StatCard label="Needs Reverify" value={needsReverify.length} color="#FF8C00" icon="🔁" urgent={needsReverify.length > 5} />
            <StatCard label="Expired Listings" value={expiredListings.length} color="#FFE600" icon="⏱" urgent={expiredListings.length > 3} />
            <StatCard label="Hidden Listings" value={hiddenListings.length} color="#FF8C00" icon="🚫" />
            <StatCard label="Low Confidence" value={lowConfidence.length} color="#FF2D78" icon="📉" urgent={lowConfidence.length > 2} />
          </div>

          {/* Transfer metrics from TransferOutcome (source of truth) */}
          <div className="mt-3 rounded-xl p-4 grid grid-cols-2 sm:grid-cols-4 gap-4"
            style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
            <div>
              <div className="text-[10px] text-muted-foreground uppercase tracking-wide">Success Rate</div>
              <div className="text-xl font-black mt-0.5" style={{ color: successRate >= 90 ? '#00FF87' : successRate >= 75 ? '#FF8C00' : '#FF2D78' }}>
                {successRate}%
              </div>
              <div className="text-[9px] text-muted-foreground">{outcomeTotal > 0 ? `${outcomeTotal} outcomes` : 'Purchase fallback'}</div>
            </div>
            <div>
              <div className="text-[10px] text-muted-foreground uppercase tracking-wide">Dispute Rate</div>
              <div className="text-xl font-black mt-0.5" style={{ color: disputeRate === 0 ? '#00FF87' : disputeRate < 10 ? '#FF8C00' : '#FF2D78' }}>
                {disputeRate}%
              </div>
              <div className="text-[9px] text-muted-foreground">{failedOutcomes.length} failures logged</div>
            </div>
            <div>
              <div className="text-[10px] text-muted-foreground uppercase tracking-wide">Avg Transfer</div>
              <div className="text-xl font-black text-foreground mt-0.5">
                {avgTransferMin != null
                  ? (avgTransferMin < 60 ? `${avgTransferMin}m` : `${Math.floor(avgTransferMin / 60)}h ${avgTransferMin % 60}m`)
                  : '—'}
              </div>
              <div className="text-[9px] text-muted-foreground">{outcomeTimes.length} timed transfers</div>
            </div>
            <div>
              <div className="text-[10px] text-muted-foreground uppercase tracking-wide">Open Disputes</div>
              <div className="text-xl font-black mt-0.5" style={{ color: openDisputes.length > 0 ? '#FF2D78' : '#00FF87' }}>
                {openDisputes.length}
              </div>
              <div className="text-[9px] text-muted-foreground">from Purchase entity</div>
            </div>
          </div>
        </div>

        {/* ── OPERATIONS STATUS ── */}
        <div>
          <SectionHeader title="Operations" icon="⚙️" />
          <div className="space-y-2 text-sm">
            {[
              { label: 'Buyers waiting for seller to send', value: buyerWaiting.length, urgent: buyerWaiting.length > 0, color: '#FF8C00' },
              { label: 'Sellers sent — waiting buyer confirm', value: sellerMissed.length, urgent: false, color: '#00C8FF' },
              { label: 'Donations active/pending', value: donations.filter(d => d.donation_status === 'active').length, urgent: false, color: '#BF5FFF' },
            ].map(row => (
              <div key={row.label} className="flex items-center justify-between rounded-xl px-4 py-2.5"
                style={{
                  background: row.urgent && row.value > 0 ? 'rgba(255,140,0,0.06)' : 'rgba(255,255,255,0.03)',
                  border: `1px solid ${row.urgent && row.value > 0 ? 'rgba(255,140,0,0.25)' : 'rgba(255,255,255,0.07)'}`,
                }}>
                <span className="text-muted-foreground text-xs">{row.label}</span>
                <span className="font-black text-sm" style={{ color: row.value > 0 ? row.color : 'hsl(var(--muted-foreground))' }}>
                  {row.value}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* ── EVENT NAVIGATION HEALTH ── */}
        <EventNavHealthPanel />

        {/* ── QUICK LINKS ── */}
        <div>
          <SectionHeader title="Quick Links" icon="🔗" />
          <div className="grid grid-cols-2 gap-2">
            {[
              { label: 'Admin Command Center', to: '/admin', icon: '🛡️' },
              { label: 'Transfer Intelligence', to: '/admin', icon: '🧠' },
              { label: 'Beta QA', to: '/beta-qa', icon: '🧪' },
              { label: 'Leaderboard', to: '/leaderboard', icon: '🏆' },
            ].map(link => (
              <Link key={link.label} to={link.to}
                className="flex items-center gap-2 rounded-xl px-4 py-3 text-sm font-semibold transition-all hover:bg-white/8"
                style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
                <span>{link.icon}</span>
                <span className="text-foreground text-xs">{link.label}</span>
              </Link>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}