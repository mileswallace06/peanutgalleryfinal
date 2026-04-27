import { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Shield, Database, CheckCircle, XCircle, RefreshCw, Lock } from 'lucide-react';

const ADMIN_PASSWORD = 'peanut2026';

export default function AdminMode() {
  const [unlocked, setUnlocked] = useState(sessionStorage.getItem('pg_admin_unlocked') === '1');
  const [password, setPassword] = useState('');
  const [pwError, setPwError] = useState('');

  const [user, setUser] = useState(null);
  const [seedLoading, setSeedLoading] = useState(false);
  const [seedResult, setSeedResult] = useState(null);
  const [seedError, setSeedError] = useState('');

  const [listings, setListings] = useState([]);
  const [purchases, setPurchases] = useState([]);
  const [dataLoading, setDataLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState('');

  useEffect(() => {
    if (unlocked) {
      base44.auth.me().then(setUser).catch(() => {});
      loadData();
    }
  }, [unlocked]);

  const loadData = async () => {
    setDataLoading(true);
    const [l, p] = await Promise.all([
      base44.entities.Listing.list('-created_date', 50),
      base44.entities.Purchase.list('-created_date', 50),
    ]);
    setListings(l);
    setPurchases(p);
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
    setSeedLoading(true);
    setSeedError('');
    setSeedResult(null);
    const res = await base44.functions.invoke('seedDemoListings', {});
    if (res.data.error) {
      setSeedError(res.data.error);
    } else {
      setSeedResult(res.data);
      await loadData();
    }
    setSeedLoading(false);
  };

  const handleProofAction = async (listingId, action) => {
    setActionLoading(listingId + action);
    await base44.entities.Listing.update(listingId, { proof_status: action === 'approve' ? 'approved' : 'rejected' });
    await loadData();
    setActionLoading('');
  };

  const handleCaptureAdmin = async (purchase) => {
    setActionLoading(purchase.id);
    // Mark both confirmed and capture
    await base44.entities.Purchase.update(purchase.id, { seller_confirmed: true, buyer_confirmed: true });
    await base44.functions.invoke('capturePayment', { purchase_id: purchase.id, confirming_role: 'buyer' });
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

      {/* Seed Demo Inventory */}
      <div className="bg-white border border-border rounded-2xl p-5 mb-6">
        <div className="flex items-center gap-2 mb-3">
          <Database className="w-5 h-5 text-primary" />
          <h2 className="font-bold text-lg">Seed Demo Inventory</h2>
        </div>
        <p className="text-sm text-muted-foreground mb-4">
          Creates 3 demo events and 15 listings with your email as seller. All listings are pre-approved and immediately purchasable.
          <span className="text-amber-600 font-medium"> Run only once per environment.</span>
        </p>
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
          <div className="mt-3 text-sm bg-green-50 border border-green-200 rounded-lg p-3 text-green-800">
            ✅ Created {seedResult.events_created} events and {seedResult.listings_created} listings.
          </div>
        )}
        {seedError && (
          <div className="mt-3 text-sm bg-destructive/10 border border-destructive/20 rounded-lg p-3 text-destructive">
            {seedError}
          </div>
        )}
      </div>

      {/* Proof Review */}
      <div className="bg-white border border-border rounded-2xl p-5 mb-6">
        <h2 className="font-bold text-lg mb-4">Proof Review ({pendingProof.length} pending)</h2>
        {pendingProof.length === 0 ? (
          <p className="text-sm text-muted-foreground">No listings pending proof review.</p>
        ) : (
          <div className="space-y-3">
            {pendingProof.map(l => (
              <div key={l.id} className="flex items-center justify-between p-3 bg-secondary rounded-lg text-sm">
                <div>
                  <span className="font-medium">Section {l.section} Row {l.row}</span>
                  <span className="text-muted-foreground ml-2">· {l.seller_email}</span>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => handleProofAction(l.id, 'approve')}
                    disabled={actionLoading === l.id + 'approve'}
                    className="flex items-center gap-1 bg-green-100 text-green-700 border border-green-200 px-3 py-1 rounded-lg text-xs font-medium hover:bg-green-200 transition-colors"
                  >
                    <CheckCircle className="w-3 h-3" /> Approve
                  </button>
                  <button
                    onClick={() => handleProofAction(l.id, 'reject')}
                    disabled={actionLoading === l.id + 'reject'}
                    className="flex items-center gap-1 bg-red-50 text-red-600 border border-red-200 px-3 py-1 rounded-lg text-xs font-medium hover:bg-red-100 transition-colors"
                  >
                    <XCircle className="w-3 h-3" /> Reject
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Escrow Dashboard */}
      <div className="bg-white border border-border rounded-2xl p-5">
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