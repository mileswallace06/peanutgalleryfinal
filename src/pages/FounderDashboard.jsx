import '@/components/admin/operations-theme.css';
import { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { isAdmin } from '@/lib/isAdmin';
import { Navigate, Link } from 'react-router-dom';
import { useAuth } from '@/lib/AuthContext';
import { Shield, RefreshCw, CheckCircle } from 'lucide-react';
import { isVerificationExpired } from '@/lib/transferConfidence';
import EventNavHealthPanel from '@/components/founder/EventNavHealthPanel';
import OperationalReadStatus from '@/components/founder/OperationalReadStatus';
import { useOperationalReads } from '@/hooks/useOperationalReads';
import { operationalValue } from '@/lib/operationalReads';

const READS = {
  purchases: () => base44.entities.Purchase.list('-created_date', 200),
  listings: () => base44.entities.Listing.list('-updated_date', 200),
  alerts: () => base44.entities.AdminAlert.filter({ resolved: false }),
  donations: () => base44.entities.SeatDonation.list('-created_date', 50),
  outcomes: () => base44.entities.TransferOutcome.list('-created_date', 500),
};
const SOURCE_LABELS = { purchases: 'Purchases', listings: 'Listings', alerts: 'Alerts', donations: 'Donations', outcomes: 'Transfer outcomes' };

function StatCard({ label, value, color, icon, sub, urgent }) {
  return (
    <div className="pg-operations-card rounded-2xl p-4"
      style={{
        background: urgent && value > 0 ? `rgba(255,45,120,0.07)` : 'var(--pg-surface)',
        border: urgent && value > 0 ? '1px solid rgba(255,45,120,0.3)' : '1px solid var(--pg-line)',
      }}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="pg-operations-status text-2xl font-black" style={{ '--pg-status-ink': ['Unavailable', 'Loading…'].includes(value) ? 'var(--pg-muted)' : color || 'var(--pg-text)' }}>{value}</div>
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
      <div className="flex-1 h-px" style={{ background: 'var(--pg-line)' }} />
    </div>
  );
}

export default function FounderDashboard() {
  const { user, isLoadingAuth } = useAuth();
  const [navigationHealth, setNavigationHealth] = useState({ status: 'loading', spike: false });
  const { sources, reload: loadAll, loading } = useOperationalReads(READS, !isLoadingAuth && isAdmin(user));
  const { purchases: purchaseRead, listings: listingRead, alerts: alertRead, donations: donationRead, outcomes: outcomeRead } = sources;
  const purchases = purchaseRead.rows;
  const listings = listingRead.rows;
  const alerts = alertRead.rows;
  const donations = donationRead.rows;
  const outcomes = outcomeRead.rows;
  const metric = (key, value) => operationalValue(sources[key], value);
  const allReady = navigationHealth.status === 'ready' && Object.values(sources).every(source => source.status === 'ready');

  if (isLoadingAuth) return (
    <div className="pg-operations-page min-h-full flex items-center justify-center">
      <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
    </div>
  );

  if (!user || !isAdmin(user)) return <Navigate to="/events" replace />;

  // ── Derived metrics ──────────────────────────────────────────────────
  const activeListings = listings.filter(l => l.status === 'active');
  const hiddenListings = listings.filter(l => l.status === 'hidden');
  const expiredListings = activeListings.filter(l => isVerificationExpired(l));
  const needsReverify = activeListings.filter(l => !l.last_transfer_verification || isVerificationExpired(l));
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

  // Empty success is evidence of no sample, not 100% health. A failed
  // authoritative outcomes read never silently becomes a Purchase fallback.
  const purchaseSample = completedSales.length + openDisputes.length;
  const successRate = outcomeRead.status !== 'ready' ? null : outcomeTotal > 0
    ? Math.round((successfulOutcomes.length / outcomeTotal) * 100)
    : purchaseRead.status === 'ready' && purchaseSample > 0 ? Math.round(completedSales.length / purchaseSample * 100) : null;
  const disputeRate = outcomeRead.status !== 'ready' ? null : outcomeTotal > 0
    ? Math.round((failedOutcomes.length / outcomeTotal) * 100)
    : purchaseRead.status === 'ready' && purchaseSample > 0 ? Math.round(openDisputes.length / purchaseSample * 100) : null;
  const rateText = rate => rate == null ? (outcomeRead.status === 'ready' && purchaseRead.status === 'ready' ? 'No data' : 'Unavailable') : `${rate}%`;

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
  const healthScore = !allReady || navigationHealth.spike || successRate == null || disputeRate == null ? null : Math.max(0, Math.min(100,
    Math.round(successRate * 0.40 + (100 - disputeRate * 4) * 0.25 + (100 - alertPenalty) * 0.20 + (100 - pendingPenalty) * 0.15)
  ));

  const needsAttentionNow = navigationHealth.spike || criticalAlerts.length > 0 || openDisputes.length > 0 || buyerWaiting.length > 3;

  return (
    <div className="pg-operations-page min-h-full" style={{ background: 'var(--pg-canvas)' }}>
      {/* Top bar */}
      <div className="pg-operations-header sticky top-0 z-40 px-4 py-3 flex items-center gap-3 border-b border-border"
        style={{ background: 'var(--pg-canvas)' }}>
        <Shield className="pg-operations-status w-5 h-5 flex-shrink-0" style={{ '--pg-status-ink': needsAttentionNow ? '#FF2D78' : '#BF5FFF' }} />
        <div className="flex-1 min-w-0">
          <span className="font-display text-sm font-black text-foreground tracking-wide">FOUNDER DASHBOARD</span>
        </div>
        <Link to="/admin" className="text-xs text-muted-foreground hover:text-foreground px-2 py-1 rounded hidden sm:block flex-shrink-0">
          Full Admin →
        </Link>
        <button type="button" aria-label="Refresh founder dashboard" aria-busy={loading} onClick={() => loadAll()} disabled={loading} className="p-1.5 rounded-lg hover:bg-muted flex-shrink-0">
          <RefreshCw className={`w-4 h-4 text-muted-foreground ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      <div className="px-4 py-5 max-w-3xl mx-auto pb-20 space-y-7">
        <OperationalReadStatus sources={sources} labels={SOURCE_LABELS} reload={loadAll} />
        <p className="text-xs text-muted-foreground">Window: latest 200 purchases, 200 listings, 50 donations and 500 transfer outcomes; currently returned unresolved alerts. Navigation health is reported separately.</p>

        {/* ── WHAT NEEDS ATTENTION NOW ── */}
        <div>
          <SectionHeader title="Needs Attention Now" icon="🚨" />
          {!allReady && <p role="status" className="text-sm text-muted-foreground mb-2">Assessment incomplete — some sources are loading or unavailable. Known issues remain listed below.</p>}
          {needsAttentionNow ? (
            <div className="space-y-2">
              {navigationHealth.spike && <p className="text-sm text-foreground">Navigation failure spike detected. Review Event Navigation Health below; overall health is not assessed while this spike is active.</p>}
              {criticalAlerts.map(a => (
                <div key={a.id} className="pg-operations-card flex items-center gap-3 rounded-xl px-4 py-3 text-sm"
                  style={{ background: 'color-mix(in srgb, rgb(255 45 120) 10%, var(--pg-surface))', border: '1px solid rgba(255,45,120,0.35)' }}>
                  <span>🚨</span>
                  <span className="font-semibold text-foreground flex-1">{a.title}</span>
                  <Link to="/admin" className="pg-operations-status text-xs font-bold flex-shrink-0" style={{ '--pg-status-ink': '#FF2D78' }}>Fix →</Link>
                </div>
              ))}
              {openDisputes.length > 0 && (
                <div className="pg-operations-card flex items-center gap-3 rounded-xl px-4 py-3 text-sm"
                  style={{ background: 'color-mix(in srgb, rgb(255 45 120) 8%, var(--pg-surface))', border: '1px solid rgba(255,45,120,0.3)' }}>
                  <span>⚖️</span>
                  <span className="font-semibold text-foreground flex-1">{openDisputes.length} open dispute{openDisputes.length !== 1 ? 's' : ''}</span>
                  <Link to="/admin" className="pg-operations-status text-xs font-bold flex-shrink-0" style={{ '--pg-status-ink': '#FF2D78' }}>Resolve →</Link>
                </div>
              )}
              {buyerWaiting.length > 3 && (
                <div className="pg-operations-card flex items-center gap-3 rounded-xl px-4 py-3 text-sm"
                  style={{ background: 'color-mix(in srgb, rgb(255 140 0) 8%, var(--pg-surface))', border: '1px solid rgba(255,140,0,0.3)' }}>
                  <span>⏳</span>
                  <span className="font-semibold text-foreground flex-1">{buyerWaiting.length} buyers waiting for ticket transfer</span>
                  <Link to="/admin" className="pg-operations-status text-xs font-bold flex-shrink-0" style={{ '--pg-status-ink': '#FF8C00' }}>View →</Link>
                </div>
              )}
            </div>
          ) : allReady ? (
            <div className="pg-operations-card rounded-xl px-4 py-3 flex items-center gap-3 text-sm"
              style={{ background: 'color-mix(in srgb, rgb(0 255 135) 6%, var(--pg-surface))', border: '1px solid rgba(0,255,135,0.2)' }}>
              <CheckCircle className="pg-operations-status w-4 h-4" style={{ '--pg-status-ink': '#00FF87' }} />
              <span className="text-muted-foreground">No critical alerts, open disputes or elevated buyer waits in the loaded windows.</span>
            </div>
          ) : null}
        </div>

        {/* ── ALERT PULSE ── */}
        {(alerts.length > 0 || alertRead.status !== 'ready') && (
          <div>
            <SectionHeader title="Alert Pulse" icon="🔔" />
            <div className="grid grid-cols-4 gap-2">
              <StatCard label="Critical" value={metric('alerts', criticalAlerts.length)} color="#FF2D78" icon="🚨" urgent />
              <StatCard label="High" value={metric('alerts', highAlerts.length)} color="#FF8C00" icon="⚠️" />
              <StatCard label="Total Open" value={metric('alerts', alerts.length)} color="#FFE600" icon="🔔" />
              <StatCard label="Disputes" value={metric('purchases', openDisputes.length)} color="#FF2D78" icon="⚖️" urgent />
            </div>
          </div>
        )}

        {/* ── MARKETPLACE HEALTH SCORE ── */}
        <div>
          <SectionHeader title="Marketplace Health Score" icon="💊" />
          <div className="pg-operations-card rounded-2xl p-5 flex items-center gap-6"
            style={{
              background: healthScore == null ? 'var(--pg-surface)' : healthScore >= 80 ? 'color-mix(in srgb, rgb(0 255 135) 6%, var(--pg-surface))' : healthScore >= 60 ? 'color-mix(in srgb, rgb(255 140 0) 6%, var(--pg-surface))' : 'color-mix(in srgb, rgb(255 45 120) 8%, var(--pg-surface))',
              border: `1px solid ${healthScore == null ? 'var(--pg-line)' : healthScore >= 80 ? 'rgba(0,255,135,0.25)' : healthScore >= 60 ? 'rgba(255,140,0,0.25)' : 'rgba(255,45,120,0.35)'}`,
            }}>
            <div>
              <div className="pg-operations-status text-5xl font-black" style={{ '--pg-status-ink': healthScore == null ? 'var(--pg-muted)' : healthScore >= 80 ? '#00FF87' : healthScore >= 60 ? '#FF8C00' : '#FF2D78' }}>
                {healthScore ?? '—'}
              </div>
              <div className="text-xs text-muted-foreground mt-1">{healthScore == null ? 'Not assessed' : '/ 100'}</div>
            </div>
            <div className="flex-1 space-y-1.5">
              {[
                { label: 'Transfer Success Rate', value: rateText(successRate), src: outcomeTotal > 0 ? 'TransferOutcome' : 'Purchase fallback' },
                { label: 'Dispute Rate', value: rateText(disputeRate), src: 'TransferOutcome' },
                { label: 'Avg Transfer Time', value: metric('outcomes', avgTransferMin ? `${avgTransferMin}m` : 'No data'), src: 'TransferOutcome' },
                { label: 'Open Critical Alerts', value: metric('alerts', criticalAlerts.length), src: 'AdminAlert' },
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
            <StatCard label="Active Listings" value={metric('listings', activeListings.length)} icon="🎫" />
            <StatCard label="Pending Transfers" value={metric('purchases', pendingTransfers.length)} icon="⏳" />
            <StatCard label="Completed Sales" value={metric('purchases', completedSales.length)} color="#00FF87" icon="✅" />
            <StatCard label="Platform Revenue" value={metric('purchases', `$${totalRevenue.toFixed(0)}`)} color="#00FF87" icon="💸" />
          </div>
        </div>

        {/* ── TRANSFER HEALTH ── */}
        <div>
          <SectionHeader title="Transfer Health" icon="🔄" />
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <StatCard label="Needs Reverify" value={metric('listings', needsReverify.length)} color="#FF8C00" icon="🔁" urgent={needsReverify.length > 5} />
            <StatCard label="Expired Listings" value={metric('listings', expiredListings.length)} color="#FFE600" icon="⏱" urgent={expiredListings.length > 3} />
            <StatCard label="Hidden Listings" value={metric('listings', hiddenListings.length)} color="#FF8C00" icon="🚫" />
            <StatCard label="Low Confidence" value={metric('listings', lowConfidence.length)} color="#FF2D78" icon="📉" urgent={lowConfidence.length > 2} />
          </div>

          {/* Transfer metrics from TransferOutcome (source of truth) */}
          <div className="pg-operations-card mt-3 rounded-xl p-4 grid grid-cols-2 sm:grid-cols-4 gap-4"
            style={{ background: 'var(--pg-surface)', border: '1px solid var(--pg-line)' }}>
            <div>
              <div className="text-[10px] text-muted-foreground uppercase tracking-wide">Success Rate</div>
              <div className="pg-operations-status text-xl font-black mt-0.5" style={{ '--pg-status-ink': successRate >= 90 ? '#00FF87' : successRate >= 75 ? '#FF8C00' : '#FF2D78' }}>
                {rateText(successRate)}
              </div>
              <div className="text-[9px] text-muted-foreground">{outcomeRead.status !== 'ready' ? 'Outcome source unavailable' : outcomeTotal > 0 ? `${outcomeTotal} outcomes` : purchaseRead.status === 'ready' && purchaseSample > 0 ? 'Purchase fallback' : 'No completed/disputed sample'}</div>
            </div>
            <div>
              <div className="text-[10px] text-muted-foreground uppercase tracking-wide">Dispute Rate</div>
              <div className="pg-operations-status text-xl font-black mt-0.5" style={{ '--pg-status-ink': disputeRate === 0 ? '#00FF87' : disputeRate < 10 ? '#FF8C00' : '#FF2D78' }}>
                {rateText(disputeRate)}
              </div>
              <div className="text-[9px] text-muted-foreground">{metric('outcomes', `${failedOutcomes.length} failures logged`)}</div>
            </div>
            <div>
              <div className="text-[10px] text-muted-foreground uppercase tracking-wide">Avg Transfer</div>
              <div className="text-xl font-black text-foreground mt-0.5">
                {outcomeRead.status !== 'ready' ? metric('outcomes', '') : avgTransferMin != null
                  ? (avgTransferMin < 60 ? `${avgTransferMin}m` : `${Math.floor(avgTransferMin / 60)}h ${avgTransferMin % 60}m`)
                  : '—'}
              </div>
              <div className="text-[9px] text-muted-foreground">{metric('outcomes', `${outcomeTimes.length} timed transfers`)}</div>
            </div>
            <div>
              <div className="text-[10px] text-muted-foreground uppercase tracking-wide">Open Disputes</div>
              <div className="pg-operations-status text-xl font-black mt-0.5" style={{ '--pg-status-ink': openDisputes.length > 0 ? '#FF2D78' : '#00FF87' }}>
                {metric('purchases', openDisputes.length)}
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
              { label: 'Buyers waiting for seller to send', value: metric('purchases', buyerWaiting.length), urgent: buyerWaiting.length > 0, color: '#FF8C00' },
              { label: 'Sellers sent — waiting buyer confirm', value: metric('purchases', sellerMissed.length), urgent: false, color: '#00C8FF' },
              { label: 'Donations active/pending', value: metric('donations', donations.filter(d => d.donation_status === 'active').length), urgent: false, color: '#BF5FFF' },
            ].map(row => (
              <div key={row.label} className="pg-operations-card flex items-center justify-between rounded-xl px-4 py-2.5"
                style={{
                  background: row.urgent && row.value > 0 ? 'color-mix(in srgb, rgb(255 140 0) 6%, var(--pg-surface))' : 'var(--pg-surface)',
                  border: `1px solid ${row.urgent && row.value > 0 ? 'rgba(255,140,0,0.25)' : 'var(--pg-line)'}`,
                }}>
                <span className="text-muted-foreground text-xs">{row.label}</span>
                <span className="pg-operations-status font-black text-sm" style={{ '--pg-status-ink': row.value > 0 ? row.color : 'var(--pg-muted)' }}>
                  {row.value}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* ── EVENT NAVIGATION HEALTH ── */}
        <EventNavHealthPanel onHealthChange={setNavigationHealth} />

        {/* ── QUICK LINKS ── */}
        <div>
          <SectionHeader title="Quick Links" icon="🔗" />
          <div className="grid grid-cols-2 gap-2">
            {[
              { label: 'Admin Command Center', to: '/admin', icon: '🛡️' },
              { label: 'Transfer Intelligence', to: '/admin', icon: '🧠' },
              { label: 'Beta QA', to: '/beta-qa', icon: '🧪' },
              { label: 'Beta Checklist', to: '/beta-checklist', icon: '📋' },
              { label: 'Leaderboard', to: '/leaderboard', icon: '🏆' },
            ].map(link => (
              <Link key={link.label} to={link.to}
                className="flex items-center gap-2 rounded-xl px-4 py-3 text-sm font-semibold transition-all hover:bg-muted"
                style={{ background: 'var(--pg-surface)', border: '1px solid var(--pg-line)' }}>
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
