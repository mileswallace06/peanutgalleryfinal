import { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Shield, Database, CheckCircle, XCircle, RefreshCw, Lock, AlertTriangle, FileText, CreditCard, FlaskConical } from 'lucide-react';
import { Link } from 'react-router-dom';
import { format } from 'date-fns';
import EventTimingDebug from '@/components/admin/EventTimingDebug';
import InstantFulfillmentCenter from '@/components/admin/InstantFulfillmentCenter';
import FeeSimulator from '@/components/admin/FeeSimulator';
import TransactionAnalytics from '@/components/admin/TransactionAnalytics';
import { isAdmin } from '@/lib/isAdmin';

const ADMIN_PASSWORD = 'peanut2026';

export default function AdminMode() {
  const [unlocked, setUnlocked] = useState(sessionStorage.getItem('pg_admin_unlocked') === '1');
  const [password, setPassword] = useState('');
  const [pwError, setPwError] = useState('');

  const [user, setUser] = useState(null);
  const [stripeMode, setStripeMode] = useState(null);
  const [stripeModeLoading, setStripeModeLoading] = useState(false);

  const [seedLoading, setSeedLoading] = useState(false);
  const [seedResult, setSeedResult] = useState(null);
  const [seedError, setSeedError] = useState('');
  const [seedSellerEmail, setSeedSellerEmail] = useState('');
  const [seedEmailError, setSeedEmailError] = useState('');

  const [listings, setListings] = useState([]);
  const [purchases, setPurchases] = useState([]);
  const [events, setEvents] = useState({});
  const [sellerSales, setSellerSales] = useState({});
  const [dataLoading, setDataLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState('');

  useEffect(() => {
    if (unlocked) {
      base44.auth.me({ fresh: true }).then(u => {
        console.log('[AdminMode] email:', u?.email, '| role:', u?.role, '| isAdmin:', isAdmin(u));
        setUser(u);
        if (!isAdmin(u)) {
          // Non-admin got the password — lock them back out
          sessionStorage.removeItem('pg_admin_unlocked');
          setUnlocked(false);
          setPwError('Your account does not have admin privileges.');
        }
      }).catch(() => {});
      loadData();
      loadStripeMode();
    }
  }, [unlocked]);

  const loadStripeMode = async () => {
    setStripeModeLoading(true);
    try {
      const res = await base44.functions.invoke('getStripeMode', {});
      setStripeMode(res.data);
    } catch (e) {
      setStripeMode({ error: e.message });
    }
    setStripeModeLoading(false);
  };

  const loadData = async () => {
    setDataLoading(true);
    const [l, p] = await Promise.all([
      base44.entities.Listing.list('-created_date', 50),
      base44.entities.Purchase.list('-created_date', 50),
    ]);
    setListings(l);
    setPurchases(p);
    // Build completed sales count per seller
    const salesMap = {};
    p.filter(pur => pur.transfer_status === 'completed').forEach(pur => {
      salesMap[pur.seller_email] = (salesMap[pur.seller_email] || 0) + 1;
    });
    setSellerSales(salesMap);
    // Fetch events for disputed purchases
    const eventIds = [...new Set(p.map(pur => pur.event_id).filter(Boolean))];
    const eventMap = {};
    await Promise.all(eventIds.map(async eid => {
      const res = await base44.entities.Event.filter({ id: eid });
      if (res[0]) eventMap[eid] = res[0];
    }));
    setEvents(eventMap);
    setDataLoading(false);
  };

  const handleUnlock = (e) => {
    e.preventDefault();
    if (password === ADMIN_PASSWORD) {
      sessionStorage.setItem('pg_admin_unlocked', '1');
      setUnlocked(true);
    } else {
      setPwError('Incorrect password');
    }
  };

  const handleSeed = async () => {
    setSeedEmailError('');
    const trimmed = seedSellerEmail.trim();
    if (trimmed && !trimmed.includes('@')) {
      setSeedEmailError('Must be a valid email address containing @');
      return;
    }
    setSeedLoading(true);
    setSeedError('');
    setSeedResult(null);
    const payload = trimmed ? { seller_email: trimmed } : {};
    const res = await base44.functions.invoke('seedDemoListings', payload);
    if (res.data.error) {
      setSeedError(res.data.error);
    } else {
      setSeedResult(res.data);
      await loadData();
    }
    setSeedLoading(false);
  };

  const handleProofAction = async (listingId, action, sellerEmail) => {
    setActionLoading(listingId + action);
    await base44.entities.Listing.update(listingId, { proof_status: action === 'approve' ? 'approved' : 'rejected' });
    if (action === 'reject' && sellerEmail) {
      // Increment strike_count on seller
      const users = await base44.entities.User.filter({ email: sellerEmail });
      if (users[0]) {
        await base44.entities.User.update(users[0].id, { strike_count: (users[0].strike_count || 0) + 1 });
      }
    }
    await loadData();
    setActionLoading('');
  };

  const handleCaptureAdmin = async (purchase) => {
    setActionLoading(purchase.id);
    await base44.entities.Purchase.update(purchase.id, { seller_confirmed: true, buyer_confirmed: true });
    await base44.functions.invoke('capturePayment', { purchase_id: purchase.id, confirming_role: 'buyer' });
    await loadData();
    setActionLoading('');
  };

  const handleDisputeAction = async (purchase, action) => {
    setActionLoading(purchase.id + action);
    if (action === 'refund_buyer') {
      await base44.functions.invoke('cancelPurchase', { purchase_id: purchase.id });
    } else if (action === 'release_seller') {
      await base44.entities.Purchase.update(purchase.id, { seller_confirmed: true, buyer_confirmed: true });
      await base44.functions.invoke('capturePayment', { purchase_id: purchase.id, confirming_role: 'buyer' });
    } else if (action === 'strike_seller') {
      const users = await base44.entities.User.filter({ email: purchase.seller_email });
      if (users[0]) {
        await base44.entities.User.update(users[0].id, { strike_count: (users[0].strike_count || 0) + 1 });
      }
      await base44.entities.Purchase.update(purchase.id, { transfer_status: 'expired' });
    }
    await loadData();
    setActionLoading('');
  };

  if (!unlocked) {
    return (
      <div className="max-w-sm mx-auto px-4 py-20">
        <div className="text-center mb-8">
          <div className="text-4xl mb-3">🥜</div>
          <h1 className="text-2xl font-bold">Admin Mode</h1>
          <p className="text-muted-foreground text-sm mt-1">Enter the admin password to continue</p>
        </div>
        <form onSubmit={handleUnlock} className="space-y-3">
          <div className="relative">
            <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="Admin password"
              className="w-full pl-9 pr-4 py-3 rounded-xl border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
            />
          </div>
          {pwError && <p className="text-destructive text-xs">{pwError}</p>}
          <button
            type="submit"
            className="w-full bg-primary text-primary-foreground py-3 rounded-xl font-semibold hover:bg-primary/90 transition-colors"
          >
            Unlock Admin Mode
          </button>
        </form>
      </div>
    );
  }

  const pendingProof = listings.filter(l => l.proof_status === 'pending_review');
  const activePurchases = purchases.filter(p => p.transfer_status === 'pending_transfer');
  const disputedPurchases = purchases.filter(p => p.transfer_status === 'disputed');

  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      <div className="flex items-center gap-3 mb-8">
        <Shield className="w-7 h-7 text-primary" />
        <div>
          <h1 className="text-2xl font-bold">Admin Mode</h1>
          <p className="text-sm text-muted-foreground">{user?.email}</p>
        </div>
        <button
          onClick={loadData}
          className="ml-auto p-2 rounded-lg hover:bg-muted transition-colors"
          title="Refresh"
        >
          <RefreshCw className={`w-4 h-4 text-muted-foreground ${dataLoading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* Beta QA link */}
      <div className="bg-card border border-border rounded-2xl p-5 mb-6 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <FlaskConical className="w-5 h-5" style={{ color: '#BF5FFF' }} />
          <div>
            <h2 className="font-bold">Beta QA Dashboard</h2>
            <p className="text-sm text-muted-foreground mt-0.5">Checklists, bug tracking, feedback, and operational risks.</p>
          </div>
        </div>
        <Link to="/beta-qa"
          className="flex items-center gap-2 px-5 py-2.5 rounded-xl font-bold text-sm whitespace-nowrap"
          style={{ background: 'rgba(191,95,255,0.12)', color: '#BF5FFF', border: '1px solid rgba(191,95,255,0.3)' }}>
          Open QA →
        </Link>
      </div>

      {/* Stripe Mode Status */}
      <div className="bg-card border border-border rounded-2xl p-5 mb-6">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <CreditCard className="w-5 h-5 text-primary" />
            <h2 className="font-bold text-lg">Stripe Configuration</h2>
          </div>
          <button onClick={loadStripeMode} disabled={stripeModeLoading}
            className="p-1.5 rounded-lg hover:bg-muted transition-colors"
            title="Refresh Stripe mode">
            <RefreshCw className={`w-4 h-4 text-muted-foreground ${stripeModeLoading ? 'animate-spin' : ''}`} />
          </button>
        </div>

        {stripeModeLoading && !stripeMode ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <span className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
            Checking Stripe keys…
          </div>
        ) : stripeMode?.error ? (
          <div className="text-sm text-destructive bg-destructive/10 rounded-lg px-3 py-2">{stripeMode.error}</div>
        ) : stripeMode ? (
          <div className="space-y-3">
            {/* Overall mode badge */}
            <div className="flex items-center gap-3">
              {stripeMode.overallMode === 'live' ? (
                <span className="inline-flex items-center gap-1.5 text-sm font-bold px-3 py-1.5 rounded-full bg-green-100 text-green-700 border border-green-300">
                  <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                  ✅ Stripe LIVE Mode
                </span>
              ) : stripeMode.overallMode === 'test' ? (
                <span className="inline-flex items-center gap-1.5 text-sm font-bold px-3 py-1.5 rounded-full bg-amber-100 text-amber-700 border border-amber-300">
                  <span className="w-2 h-2 rounded-full bg-amber-500" />
                  🧪 Stripe TEST Mode — Real cards will be rejected
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 text-sm font-bold px-3 py-1.5 rounded-full bg-red-100 text-red-700 border border-red-300">
                  ⚠️ Key Mismatch — Frontend and backend are in different modes!
                </span>
              )}
            </div>

            {/* Key details */}
            <div className="grid grid-cols-2 gap-3 text-xs">
              <div className="bg-secondary rounded-lg p-3 border border-border">
                <div className="text-muted-foreground font-medium uppercase tracking-wide mb-1">Frontend Key (pk_)</div>
                <code className="font-mono text-foreground">{stripeMode.publishablePrefix}</code>
                <div className={`mt-1 font-semibold ${stripeMode.publishableMode === 'live' ? 'text-green-600' : stripeMode.publishableMode === 'test' ? 'text-amber-600' : 'text-destructive'}`}>
                  {stripeMode.publishableMode === 'live' ? '✅ Live' : stripeMode.publishableMode === 'test' ? '🧪 Test' : '❌ Unknown'}
                </div>
              </div>
              <div className="bg-secondary rounded-lg p-3 border border-border">
                <div className="text-muted-foreground font-medium uppercase tracking-wide mb-1">Backend Key (sk_)</div>
                <code className="font-mono text-foreground">{stripeMode.secretPrefix}</code>
                <div className={`mt-1 font-semibold ${stripeMode.secretMode === 'live' ? 'text-green-600' : stripeMode.secretMode === 'test' ? 'text-amber-600' : 'text-destructive'}`}>
                  {stripeMode.secretMode === 'live' ? '✅ Live' : stripeMode.secretMode === 'test' ? '🧪 Test' : '❌ Unknown'}
                </div>
              </div>
            </div>

            {!stripeMode.consistent && (
              <div className="text-xs bg-red-500/15 border border-red-500/30 text-red-400 rounded-lg px-3 py-2">
                ⚠️ <strong>Key mismatch detected.</strong> Frontend and backend must both be in the same mode (both pk_live + sk_live, or both pk_test + sk_test). Mixed modes will cause payment failures.
              </div>
            )}
            {stripeMode.overallMode === 'test' && (
              <div className="text-xs bg-amber-500/15 border border-amber-500/30 text-amber-400 rounded-lg px-3 py-2">
                To enable real payments: replace <code>STRIPE_PUBLISHABLE_KEY</code> with a <code>pk_live_…</code> key and <code>STRIPE_SECRET_KEY</code> with a <code>sk_live_…</code> key in Dashboard → Settings → Environment Variables.
              </div>
            )}
          </div>
        ) : null}
      </div>

      {/* Replay Onboarding */}
      <div className="bg-card border border-border rounded-2xl p-5 mb-6">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h2 className="font-bold text-lg">Replay Onboarding</h2>
            <p className="text-sm text-muted-foreground mt-0.5">Clears localStorage flag and re-shows the intro screens on next page load.</p>
          </div>
          <button
            onClick={() => { localStorage.removeItem('pg_onboarded'); window.location.href = '/'; }}
            className="flex items-center gap-2 bg-primary text-primary-foreground px-5 py-2.5 rounded-lg font-semibold text-sm hover:bg-primary/90 transition-colors"
          >
            🎫 Replay Onboarding
          </button>
        </div>
      </div>

      {/* Seed Demo Inventory */}
      <div className="bg-card border border-border rounded-2xl p-5 mb-6">
        <div className="flex items-center gap-2 mb-3">
          <Database className="w-5 h-5 text-primary" />
          <h2 className="font-bold text-lg">Seed Demo Inventory</h2>
        </div>
        <p className="text-sm text-muted-foreground mb-4">
          Creates 3 demo events and 15 listings. All listings are pre-approved and immediately purchasable.
          <span className="text-amber-600 font-medium"> Run only once per environment.</span>
        </p>
        <div className="mb-4">
          <label className="block text-xs font-medium text-foreground mb-1">
            Seller Email Override <span className="text-muted-foreground font-normal">(optional — for buyer flow testing)</span>
          </label>
          <input
            type="email"
            value={seedSellerEmail}
            onChange={e => { setSeedSellerEmail(e.target.value); setSeedEmailError(''); }}
            placeholder={`Default: your email (${user?.email})`}
            className={`w-full px-3 py-2 rounded-lg border text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 ${seedEmailError ? 'border-destructive' : 'border-border'}`}
          />
          {seedEmailError && <p className="text-xs text-destructive mt-1">{seedEmailError}</p>}
          <p className="text-xs text-muted-foreground mt-1">
            Set this to a <strong>different registered user's email</strong> so you (as admin) can test the full buyer flow without the self-purchase block.
          </p>
          <p className="text-xs text-amber-400 bg-amber-500/15 border border-amber-500/30 rounded-md px-2 py-1.5 mt-2">
            ⚠️ Use a registered Base44 user email. Do not use fake emails.
          </p>
        </div>
        <button
          onClick={handleSeed}
          disabled={seedLoading}
          className="flex items-center gap-2 bg-primary text-primary-foreground px-5 py-2.5 rounded-lg font-semibold text-sm hover:bg-primary/90 transition-colors disabled:opacity-60"
        >
          {seedLoading ? (
            <><span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> Seeding…</>
          ) : (
            <><Database className="w-4 h-4" /> Seed Demo Inventory</>
          )}
        </button>
        {seedResult && (
          <div className="mt-3 text-sm bg-green-500/15 border border-green-500/30 rounded-lg p-3 text-green-400">
            ✅ Created {seedResult.events_created} events and {seedResult.listings_created} listings.
          </div>
        )}
        {seedError && (
          <div className="mt-3 text-sm bg-destructive/10 border border-destructive/20 rounded-lg p-3 text-destructive">
            {seedError}
          </div>
        )}
      </div>

      {/* Instant Fulfillment Center */}
      <InstantFulfillmentCenter listings={listings} purchases={purchases} events={events} user={user} onRefresh={loadData} loading={dataLoading} />

      {/* Proof Review */}
      <div className="bg-card border border-border rounded-2xl p-5 mb-6">
        <h2 className="font-bold text-lg mb-4">Flagged Listings ({pendingProof.length} pending review)</h2>
        {pendingProof.length === 0 ? (
          <p className="text-sm text-muted-foreground">No listings pending proof review.</p>
        ) : (
          <div className="space-y-3">
            {pendingProof.map(l => {
            const sales = sellerSales[l.seller_email] || 0;
            return (
            <div key={l.id} className="p-3 bg-secondary rounded-lg text-sm space-y-2">
              <div className="flex items-start justify-between gap-2 flex-wrap">
                <div>
                  <span className="font-medium">Section {l.section} Row {l.row}</span>
                  <span className="text-muted-foreground ml-2">· ${l.asking_price}/ea · {l.seller_email}</span>
                  {l.proof_rejection_reason && (
                    <div className="mt-1 text-xs text-amber-400 bg-amber-500/15 border border-amber-500/30 rounded px-2 py-1 inline-block">
                      ⚠️ {l.proof_rejection_reason}
                    </div>
                  )}
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    <span className={`text-xs font-semibold px-1.5 py-0.5 rounded-full ${sales === 0 ? 'bg-amber-500/15 text-amber-400' : 'bg-green-500/15 text-green-400'}`}>
                      {sales === 0 ? 'No prior sales' : `${sales} completed sale${sales !== 1 ? 's' : ''}`}
                    </span>
                    {l.proof_url && (
                      <a href={l.proof_url} target="_blank" rel="noopener noreferrer" className="text-xs text-primary hover:underline">View proof ↗</a>
                    )}
                  </div>
                </div>
                <div className="flex gap-2 flex-wrap">
                  <button
                    onClick={() => handleProofAction(l.id, 'approve', l.seller_email)}
                    disabled={!!actionLoading}
                    className="flex items-center gap-1 bg-green-500/15 text-green-400 border border-green-500/30 px-3 py-1 rounded-lg text-xs font-medium hover:bg-green-500/25 transition-colors"
                  >
                    <CheckCircle className="w-3 h-3" /> Approve
                  </button>
                  <button
                    onClick={() => handleProofAction(l.id, 'reject', l.seller_email)}
                    disabled={!!actionLoading}
                    className="flex items-center gap-1 bg-red-500/15 text-red-400 border border-red-500/30 px-3 py-1 rounded-lg text-xs font-medium hover:bg-red-500/25 transition-colors"
                  >
                    <XCircle className="w-3 h-3" /> Reject + Strike
                  </button>
                </div>
              </div>
            </div>
            );
            })}
          </div>
        )}
      </div>

      {/* Dispute Queue */}
      <div className="bg-card border border-border rounded-2xl p-5 mb-6">
        <div className="flex items-center gap-2 mb-4">
          <AlertTriangle className="w-5 h-5 text-amber-500" />
          <h2 className="font-bold text-lg">Dispute Queue ({disputedPurchases.length})</h2>
        </div>
        {disputedPurchases.length === 0 ? (
          <p className="text-sm text-muted-foreground">No open disputes.</p>
        ) : (
          <div className="space-y-4">
            {disputedPurchases.map(p => {
              const event = events[p.event_id];
              return (
                <div key={p.id} className="border border-amber-500/30 bg-amber-500/10 rounded-xl p-4 text-sm space-y-3">
                  {/* Header row */}
                  <div className="flex items-start justify-between gap-2 flex-wrap">
                    <div>
                      <div className="font-semibold text-foreground">{event?.title || p.event_id}</div>
                      <div className="text-xs text-muted-foreground mt-0.5">
                        {event?.venue && <>{event.venue} · </>}
                        {p.created_date && format(new Date(p.created_date), 'MMM d, yyyy h:mm a')}
                      </div>
                    </div>
                    <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-400 border border-amber-500/30 flex-shrink-0">
                      Disputed
                    </span>
                  </div>

                  {/* Parties */}
                  <div className="grid grid-cols-2 gap-3 text-xs">
                    <div className="bg-secondary rounded-lg p-2.5 border border-border">
                      <div className="text-muted-foreground font-medium uppercase tracking-wide mb-0.5">Buyer</div>
                      <div className="font-semibold text-foreground">{p.buyer_email}</div>
                      {p.buyer_name && <div className="text-muted-foreground">{p.buyer_name}</div>}
                    </div>
                    <div className="bg-secondary rounded-lg p-2.5 border border-border">
                      <div className="text-muted-foreground font-medium uppercase tracking-wide mb-0.5">Seller</div>
                      <div className="font-semibold text-foreground">{p.seller_email}</div>
                    </div>
                  </div>

                  {/* Dispute reason */}
                  <div className="bg-secondary rounded-lg p-2.5 border border-amber-200">
                    <div className="text-xs text-muted-foreground font-medium uppercase tracking-wide mb-0.5">Reason</div>
                    <div className="text-foreground font-medium">{p.dispute_reason || '—'}</div>
                  </div>

                  {/* Transfer proof */}
                  {(p.transfer_proof_url || p.transfer_notes) && (
                    <div className="bg-secondary rounded-lg p-2.5 border border-border space-y-1">
                      <div className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Seller's Proof Submitted</div>
                      {p.transfer_notes && <p className="text-xs text-foreground">{p.transfer_notes}</p>}
                      {p.transfer_proof_url && (
                        <a href={p.transfer_proof_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-primary hover:underline font-medium">
                          <FileText className="w-3 h-3" /> View screenshot ↗
                        </a>
                      )}
                      {!p.transfer_proof_url && !p.transfer_notes && (
                        <span className="text-xs text-muted-foreground italic">None</span>
                      )}
                    </div>
                  )}

                  {/* Amount */}
                  <div className="text-xs text-muted-foreground">
                    Amount in escrow: <span className="font-bold text-foreground">${p.amount?.toFixed(2)}</span>
                    {' '}· Qty: {p.quantity}
                  </div>

                  {/* Admin actions */}
                  <div className="flex flex-wrap gap-2 pt-1 border-t border-amber-500/30">
                    <button
                      onClick={() => handleDisputeAction(p, 'refund_buyer')}
                      disabled={!!actionLoading}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-blue-500/15 text-blue-400 border border-blue-500/30 hover:bg-blue-500/25 transition-colors disabled:opacity-50"
                    >
                      <XCircle className="w-3.5 h-3.5" /> Refund Buyer
                    </button>
                    <button
                      onClick={() => handleDisputeAction(p, 'release_seller')}
                      disabled={!!actionLoading}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-green-500/15 text-green-400 border border-green-500/30 hover:bg-green-500/25 transition-colors disabled:opacity-50"
                    >
                      <CheckCircle className="w-3.5 h-3.5" /> Release to Seller
                    </button>
                    <button
                      onClick={() => handleDisputeAction(p, 'strike_seller')}
                      disabled={!!actionLoading}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-red-500/15 text-red-400 border border-red-500/30 hover:bg-red-500/25 transition-colors disabled:opacity-50"
                    >
                      <AlertTriangle className="w-3.5 h-3.5" /> Refund + Strike Seller
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Fee Simulator */}
      <FeeSimulator />

      {/* Transaction Economics */}
      <TransactionAnalytics purchases={purchases} />

      {/* Event Timing Debug */}
      <EventTimingDebug />

      {/* Escrow Dashboard */}
      <div className="bg-card border border-border rounded-2xl p-5">
        <h2 className="font-bold text-lg mb-4">Escrow Dashboard ({activePurchases.length} active)</h2>
        {activePurchases.length === 0 ? (
          <p className="text-sm text-muted-foreground">No active purchases in escrow.</p>
        ) : (
          <div className="space-y-3">
            {activePurchases.map(p => (
              <div key={p.id} className="p-3 bg-secondary rounded-lg text-sm">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div>
                    <div className="font-medium">{p.buyer_email} → {p.seller_email}</div>
                    <div className="text-muted-foreground text-xs mt-0.5">
                      ${p.amount} · Seller: {p.seller_confirmed ? '✓' : '⏳'} · Buyer: {p.buyer_confirmed ? '✓' : '⏳'}
                    </div>
                  </div>
                  <button
                    onClick={() => handleCaptureAdmin(p)}
                    disabled={actionLoading === p.id || p.payment_captured}
                    className="text-xs bg-primary text-primary-foreground px-3 py-1.5 rounded-lg font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
                  >
                    {actionLoading === p.id ? 'Processing…' : 'Force Capture'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}