import { useState, useEffect, useCallback } from 'react';
import { base44 } from '@/api/base44Client';
import { isAdmin } from '@/lib/isAdmin';
import { Navigate } from 'react-router-dom';
import { format, formatDistanceToNow } from 'date-fns';
import { Shield, RefreshCw, AlertTriangle, CreditCard, Zap, Users, Activity, Brain, Radio, Database, Bell, ClipboardList } from 'lucide-react';
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
import PendingReviewQueue from '@/components/admin/PendingReviewQueue';
import FeeSimulatorV2 from '@/components/admin/FeeSimulatorV2';

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
  { id: 'review_queue',  label: 'Review Queue',          icon: ClipboardList },
  { id: 'fee_simulator', label: 'Fee Simulator',          icon: CreditCard },
];

export default function AdminCommandCenter() {
  const [user, setUser] = useState(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [loading, setLoading] = useState(true);
  const [lastRefresh, setLastRefresh] = useState(null);
  const [activeSection, setActiveSection] = useState('issues');

  // Raw data
  const [purchases, setPurchases] = useState([]);
  const [listings, setListings] = useState([]);
  const [events, setEvents] = useState({});
  const [donations, setDonations] = useState([]);
  const [stripeMode, setStripeMode] = useState(null);

  // Auth check
  useEffect(() => {
    base44.auth.me({ fresh: true }).then(u => {
      setUser(u);
      setAuthChecked(true);
    }).catch(() => setAuthChecked(true));
  }, []);

  const loadAll = useCallback(async () => {
    setLoading(true);
    const [p, l, d, sm] = await Promise.all([
      base44.entities.Purchase.list('-created_date', 100),
      base44.entities.Listing.list('-created_date', 100),
      base44.entities.SeatDonation.list('-created_date', 50),
      base44.functions.invoke('getStripeMode', {}).then(r => r.data).catch(() => null),
    ]);
    setPurchases(p || []);
    setListings(l || []);
    setDonations(d || []);
    setStripeMode(sm);

    // Load events for all purchases
    const eids = [...new Set((p || []).map(x => x.event_id).filter(Boolean))];
    const eMap = {};
    await Promise.all(eids.map(async eid => {
      const res = await base44.entities.Event.filter({ id: eid });
      if (res[0]) eMap[eid] = res[0];
    }));
    setEvents(eMap);
    setLastRefresh(new Date());
    setLoading(false);
  }, []);

  useEffect(() => {
    if (authChecked && user && isAdmin(user)) {
      loadAll();
    }
  }, [authChecked, user]);

  // Not yet checked
  if (!authChecked) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  // Not admin → redirect silently
  if (!user || !isAdmin(user)) {
    return <Navigate to="/events" replace />;
  }

  return (
    <div className="min-h-screen" style={{ background: 'hsl(var(--background))' }}>
      {/* Top bar */}
      <div className="sticky top-0 z-40 px-4 py-3 flex items-center gap-3 border-b border-border"
        style={{ background: 'rgba(0,0,0,0.9)', backdropFilter: 'blur(24px)' }}>
        <Shield className="w-5 h-5 text-primary flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <span className="font-display text-sm font-black text-foreground tracking-wide">COMMAND CENTER</span>
          <span className="text-muted-foreground text-xs ml-2 hidden sm:inline">
            {lastRefresh ? `Updated ${formatDistanceToNow(lastRefresh, { addSuffix: true })}` : 'Loading…'}
          </span>
        </div>
        <a href="/founder" className="text-xs text-muted-foreground hover:text-foreground px-2 py-1 rounded hidden sm:block flex-shrink-0">Founder →</a>
        <a href="/admin-legacy" className="text-xs text-muted-foreground hover:text-foreground px-2 py-1 rounded hidden sm:block flex-shrink-0">Legacy →</a>
        <button onClick={loadAll} disabled={loading}
          className="p-1.5 rounded-lg hover:bg-muted transition-colors flex-shrink-0">
          <RefreshCw className={`w-4 h-4 text-muted-foreground ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* Summary bar */}
      <div className="px-4 pt-4">
        <CommandSummaryBar
          purchases={purchases}
          listings={listings}
          donations={donations}
          stripeMode={stripeMode}
          onJump={setActiveSection}
        />
      </div>

      {/* Section nav */}
      <div className="px-4 mt-4 flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
        {SECTIONS.map(s => {
          const Icon = s.icon;
          return (
            <button key={s.id}
              onClick={() => setActiveSection(s.id)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap flex-shrink-0 transition-all"
              style={activeSection === s.id
                ? { background: 'hsl(var(--primary))', color: 'hsl(var(--primary-foreground))' }
                : { background: 'rgba(255,255,255,0.06)', color: 'hsl(var(--muted-foreground))', border: '1px solid rgba(255,255,255,0.1)' }}>
              <Icon className="w-3 h-3" />{s.label}
            </button>
          );
        })}
      </div>

      {/* Active section */}
      <div className="px-4 py-4 max-w-5xl mx-auto pb-20">
        {activeSection === 'issues' && (
          <IssueFeed
            purchases={purchases}
            listings={listings}
            events={events}
            donations={donations}
            onRefresh={loadAll}
          />
        )}
        {activeSection === 'health' && (
          <MarketplaceHealth
            purchases={purchases}
            listings={listings}
            events={events}
          />
        )}
        {activeSection === 'stripe' && (
          <StripePanel
            purchases={purchases}
            stripeMode={stripeMode}
            onRefresh={loadAll}
          />
        )}
        {activeSection === 'instant' && (
          <InstantOpsPanel
            purchases={purchases}
            listings={listings}
            events={events}
            onRefresh={loadAll}
          />
        )}
        {activeSection === 'ai' && (
          <AIVerificationPanel
            purchases={purchases}
            listings={listings}
            events={events}
            onRefresh={loadAll}
          />
        )}
        {activeSection === 'donations' && (
          <DonationOpsPanel
            donations={donations}
            events={events}
            onRefresh={loadAll}
          />
        )}
        {activeSection === 'alerts' && (
          <AdminAlertCenter />
        )}
        {activeSection === 'transfers' && (
          <TransferWindowAdminPanel onRefresh={loadAll} />
        )}
        {activeSection === 'transfer_intel' && (
          <TransferIntelligencePanel events={events} onRefresh={loadAll} />
        )}
        {activeSection === 'review_queue' && (
          <PendingReviewQueue onRefresh={loadAll} />
        )}
        {activeSection === 'fee_simulator' && (
          <FeeSimulatorV2 />
        )}
      </div>
    </div>
  );
}