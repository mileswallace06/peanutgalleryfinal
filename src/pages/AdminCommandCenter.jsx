import '@/components/admin/operations-theme.css';
import { useState, useEffect, useCallback } from 'react';
import { base44 } from '@/api/base44Client';
import { isAdmin } from '@/lib/isAdmin';
import { Navigate } from 'react-router-dom';
import { useAuth } from '@/lib/AuthContext';
import { formatDistanceToNow } from 'date-fns';
import { summarizeAdminQueue, queueStatusLabel } from '@/lib/adminQueuePresentation';
import { Shield, RefreshCw, AlertTriangle, CreditCard, Zap, Users, Activity, Brain, Radio, Database, Bell, ClipboardList, Gauge } from 'lucide-react';
import TransferWindowAdminPanel from '@/components/admin/TransferWindowAdminPanel';
import TransferIntelligencePanel from '@/components/admin/cc/TransferIntelligencePanel';
import AdminAlertCenter from '@/components/admin/cc/AdminAlertCenter';
import CommandSummaryBar from '@/components/admin/cc/CommandSummaryBar';
import IssueFeed from '@/components/admin/cc/IssueFeed';
import MarketplaceHealth from '@/components/admin/cc/MarketplaceHealth';
import StripePanel from '@/components/admin/cc/StripePanel';
import InstantOpsPanel from '@/components/admin/cc/InstantOpsPanel';
import AIVerificationPanel from '@/components/admin/cc/AIVerificationPanel';
import DonationOpsPanel from '@/components/admin/cc/DonationOpsPanel';
import FlashDropMetricsPanel from '@/components/admin/cc/FlashDropMetricsPanel';
import PendingReviewQueue from '@/components/admin/PendingReviewQueue';
import FeeSimulatorV2 from '@/components/admin/FeeSimulatorV2';
import PricingStrategyAnalyzer from '@/components/admin/PricingStrategyAnalyzer';
import LiveUpgradeControlPanel from '@/components/admin/cc/LiveUpgradeControlPanel';
import InstantTransferReadyPanel from '@/components/admin/InstantTransferReadyPanel';
import ConfidenceCalibrationPanel from '@/components/admin/cc/ConfidenceCalibrationPanel';

function FeeSimulatorTabs() {
  const [feeTab, setFeeTab] = useState('simulator');
  return (
    <div className="space-y-4">
      <div className="pg-operations-tabs flex gap-2">
        {[{ id: 'simulator', label: '🧮 Fee Simulator' }, { id: 'strategy', label: '🎯 Pricing Strategy' }].map(t => (
          <button key={t.id} onClick={() => setFeeTab(t.id)}
            className="pg-operations-status px-3 py-1.5 rounded-full text-xs font-semibold transition-all"
            style={feeTab === t.id
              ? { background: 'var(--pg-violet)', '--pg-status-ink': 'var(--pg-ink)' }
              : { background: 'var(--pg-surface)', '--pg-status-ink': 'var(--pg-muted)', border: '1px solid var(--pg-line)' }}>
            {t.label}
          </button>
        ))}
      </div>
      {feeTab === 'simulator' && <FeeSimulatorV2 />}
      {feeTab === 'strategy' && <PricingStrategyAnalyzer />}
    </div>
  );
}

const SECTIONS = [
  { id: 'issues',    label: 'Live Issues',     icon: AlertTriangle },
  { id: 'health',   label: 'Market Health',   icon: Activity },
  { id: 'stripe',   label: 'Stripe / Payments',icon: CreditCard },
  { id: 'instant',  label: 'Instant Ops',     icon: Zap },
  { id: 'ai',       label: 'AI Verification', icon: Brain },
  { id: 'donations',label: 'Donations',        icon: Users },
  { id: 'alerts',   label: 'Alert Center',   icon: Bell },
  { id: 'transfers', label: 'Transfer Windows', icon: Radio },
  { id: 'transfer_intel', label: 'Transfer Intelligence', icon: Database },
  { id: 'calibration', label: 'Confidence Calibration', icon: Gauge },
  { id: 'review_queue',  label: 'Review Queue',          icon: ClipboardList },
  { id: 'fee_simulator', label: 'Fee Simulator',          icon: CreditCard },
  { id: 'flash_drops',   label: 'Flash Drops',            icon: Zap },
  { id: 'live_upgrades', label: 'Live Upgrades',          icon: Zap },
  { id: 'itr',           label: 'Instant Transfer Ready', icon: Shield },
];

export default function AdminCommandCenter() {
  const { user, isLoadingAuth } = useAuth();
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [queueStates, setQueueStates] = useState({});
  const [lastRefresh, setLastRefresh] = useState(null);
  const [activeSection, setActiveSection] = useState('issues');

  // Raw data
  const [purchases, setPurchases] = useState([]);
  const [listings, setListings] = useState([]);
  const [events, setEvents] = useState({});
  const [donations, setDonations] = useState([]);
  const [stripeMode, setStripeMode] = useState(null);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    setQueueStates({});
    // Each operational queue has its own source and bounded read. A failed queue
    // must never turn into an empty/all-clear queue or hide other loaded work.
    const queueRequests = [
      ['alerts', () => base44.entities.AdminAlert.list('-created_date', 100)],
      ['reviews', () => base44.entities.Listing.filter({ proof_status: 'pending_review' }, '-created_date', 50)],
      ['transfers', () => base44.entities.Listing.list('-updated_date', 200)],
    ];
    const queueLoad = Promise.all(queueRequests.map(async ([key, request]) => {
      try {
        const value = summarizeAdminQueue(key, await request());
        setQueueStates(previous => ({ ...previous, [key]: value }));
      } catch {
        setQueueStates(previous => ({ ...previous, [key]: { status: 'error' } }));
      }
    }));
    try {
      const [p, l, d, sm] = await Promise.all([
        base44.entities.Purchase.list('-created_date', 100),
        base44.entities.Listing.list('-created_date', 100),
        base44.entities.SeatDonation.list('-created_date', 50),
        base44.functions.invoke('getStripeMode', {}).then(r => r.data).catch(() => null),
      ]);
      if (![p, l, d].every(Array.isArray)) throw new Error('Transaction feed unavailable');
      setPurchases(p);
      setListings(l);
      setDonations(d);
      setStripeMode(sm);
      const eids = [...new Set([...p, ...l, ...d].map(x => x.event_id).filter(Boolean))];
      const eMap = {};
      await Promise.all(eids.map(async eid => {
        try {
          const res = await base44.entities.Event.filter({ id: eid });
          if (res[0]) eMap[eid] = res[0];
        } catch { /* Stable event references remain available when metadata cannot load. */ }
      }));
      setEvents(eMap);
      setLastRefresh(new Date());
    } catch {
      setLoadError(true);
    } finally {
      await queueLoad;
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isLoadingAuth && user && isAdmin(user)) {
      loadAll();
    }
  }, [isLoadingAuth, user]);

  // Still loading auth
  if (isLoadingAuth) {
    return (
      <div className="pg-operations-page min-h-full flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  // Not admin → redirect
  if (!user || !isAdmin(user)) {
    return <Navigate to="/events" replace />;
  }

  return (
    <div className="pg-operations-page pg-command-center" style={{ background: 'var(--pg-canvas)' }}>
      {/* Top bar */}
      <div className="pg-operations-header sticky top-0 z-40 px-4 py-3 flex items-center gap-3 border-b border-border"
        style={{ background: 'var(--pg-canvas)' }}>
        <Shield className="w-5 h-5 text-primary flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <span className="font-display text-sm font-black text-foreground tracking-wide">COMMAND CENTER</span>
          <span className="text-muted-foreground text-xs ml-2 hidden sm:inline">
            {lastRefresh ? `Updated ${formatDistanceToNow(lastRefresh, { addSuffix: true })}` : 'Loading…'}
          </span>
        </div>
        <a href="/founder" className="text-xs text-muted-foreground hover:text-foreground px-2 py-1 rounded hidden sm:block flex-shrink-0">Founder →</a>
        <a href="/admin-legacy" className="text-xs text-muted-foreground hover:text-foreground px-2 py-1 rounded hidden sm:block flex-shrink-0">Legacy →</a>
        <button aria-label="Refresh admin dashboard and queues" onClick={loadAll} disabled={loading}
          className="p-1.5 rounded-lg hover:bg-muted transition-colors flex-shrink-0">
          <RefreshCw className={`w-4 h-4 text-muted-foreground ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* Summary bar */}
      <div className="px-4 pt-4">
        {loading ? <p role="status">Loading transaction summary…</p> : loadError ? <p role="alert">Transaction summary unavailable. Refresh to retry.</p> : <CommandSummaryBar
          purchases={purchases}
          listings={listings}
          donations={donations}
          stripeMode={stripeMode}
          onJump={setActiveSection}
        />}
        <section aria-label="Separate operational queues" className="grid grid-cols-1 sm:grid-cols-3 gap-2 mt-3">
          {[
            { key: 'alerts', section: 'alerts', label: 'Open alerts', scope: 'Newest 100 alerts; resolved entries included in the window.' },
            { key: 'reviews', section: 'review_queue', label: 'Listings pending review', scope: 'Up to 50 matching listings.' },
            { key: 'transfers', section: 'transfer_intel', label: 'Listings needing reverification', scope: 'Newest 200 updated listings before eligibility filtering.' },
          ].map(queue => <button key={queue.key} type="button" onClick={() => setActiveSection(queue.section)} className="pg-operations-card rounded-xl p-3 text-left">
            <strong className="block text-sm">{queue.label}</strong>
            <span role="status" className="block text-sm">{queueStatusLabel(queueStates[queue.key])}</span>
            <span className="block text-xs text-muted-foreground">{queue.scope} Counts are not global totals.</span>
          </button>)}
        </section>
      </div>

      {/* Section nav */}
      <div className="pg-operations-tabs px-4 mt-4 flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
        {SECTIONS.map(s => {
          const Icon = s.icon;
          return (
            <button key={s.id}
              onClick={() => setActiveSection(s.id)}
              className="pg-operations-status flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap flex-shrink-0 transition-all"
              style={activeSection === s.id
                ? { background: 'var(--pg-violet)', '--pg-status-ink': 'var(--pg-ink)' }
                : { background: 'var(--pg-surface)', '--pg-status-ink': 'var(--pg-muted)', border: '1px solid var(--pg-line)' }}>
              <Icon className="w-3 h-3" />{s.label}
            </button>
          );
        })}
      </div>

      {/* Active section */}
      <div className="px-4 py-4 max-w-5xl mx-auto pb-20">
        {['health', 'stripe', 'instant', 'ai', 'donations'].includes(activeSection) && (loading || loadError) && <p role={loadError ? 'alert' : 'status'}>{loadError ? 'This transaction-data section could not be loaded. Refresh the dashboard to retry.' : 'Loading this transaction-data section…'}</p>}
        {activeSection === 'issues' && (
          <IssueFeed
            purchases={purchases}
            listings={listings}
            events={events}
            donations={donations}
            onRefresh={loadAll}
            loading={loading}
            error={loadError}
          />
        )}
        {activeSection === 'health' && !loading && !loadError && (
          <MarketplaceHealth
            purchases={purchases}
            listings={listings}
            events={events}
          />
        )}
        {activeSection === 'stripe' && !loading && !loadError && (
          <StripePanel
            purchases={purchases}
            stripeMode={stripeMode}
            onRefresh={loadAll}
          />
        )}
        {activeSection === 'instant' && !loading && !loadError && (
          <InstantOpsPanel
            purchases={purchases}
            listings={listings}
            events={events}
            onRefresh={loadAll}
          />
        )}
        {activeSection === 'ai' && !loading && !loadError && (
          <AIVerificationPanel
            purchases={purchases}
            listings={listings}
            events={events}
            onRefresh={loadAll}
          />
        )}
        {activeSection === 'donations' && !loading && !loadError && (
          <DonationOpsPanel
            donations={donations}
            events={events}
            onRefresh={loadAll}
          />
        )}
        {activeSection === 'alerts' && (
          <AdminAlertCenter onRefresh={loadAll} />
        )}
        {activeSection === 'transfers' && (
          <TransferWindowAdminPanel onRefresh={loadAll} />
        )}
        {activeSection === 'transfer_intel' && (
          <TransferIntelligencePanel events={events} onRefresh={loadAll} />
        )}
        {activeSection === 'calibration' && (
          <ConfidenceCalibrationPanel />
        )}
        {activeSection === 'review_queue' && (
          <PendingReviewQueue onRefresh={loadAll} />
        )}
        {activeSection === 'fee_simulator' && (
          <FeeSimulatorTabs />
        )}
        {activeSection === 'flash_drops' && (
          <FlashDropMetricsPanel />
        )}
        {activeSection === 'live_upgrades' && (
          <LiveUpgradeControlPanel />
        )}
        {activeSection === 'itr' && (
          <InstantTransferReadyPanel />
        )}
      </div>
    </div>
  );
}
