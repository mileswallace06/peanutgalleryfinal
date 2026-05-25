import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { format } from 'date-fns';
import { Ticket, Clock, CheckCircle, Package, Rocket, ArrowRight, Plus, RefreshCw } from 'lucide-react';
import SellerMetrics from '@/components/sales/SellerMetrics';

export default function MySales() {
  const [user, setUser] = useState(null);
  const [listings, setListings] = useState([]);
  const [purchases, setPurchases] = useState([]);
  const [events, setEvents] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const me = await base44.auth.me();
      if (!me) { setLoading(false); return; }
      setUser(me);

      const [myListings, allPurchases] = await Promise.all([
        base44.entities.Listing.filter({ seller_email: me.email }),
        base44.entities.Purchase.filter({ seller_email: me.email }),
      ]);

      setListings(myListings);
      setPurchases(allPurchases);

      const eventIds = [...new Set([
        ...myListings.map(l => l.event_id),
        ...allPurchases.map(p => p.event_id),
      ])].filter(Boolean);

      const eventMap = {};
      await Promise.all(eventIds.map(async (eid) => {
        const res = await base44.entities.Event.filter({ id: eid });
        if (res[0]) eventMap[eid] = res[0];
      }));
      setEvents(eventMap);
    } catch (err) {
      setError(err?.message || 'Failed to load sales');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  if (loading) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-12 text-center">
        <span className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin inline-block" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-12 text-center space-y-4">
        <p className="text-4xl">⚠️</p>
        <p className="text-foreground font-semibold">Failed to load sales</p>
        <p className="text-sm text-muted-foreground">{error}</p>
        <button onClick={load} className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-primary text-primary-foreground font-semibold text-sm">
          <RefreshCw className="w-4 h-4" /> Try Again
        </button>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-12 text-center space-y-3">
        <p className="text-4xl">🔒</p>
        <p className="font-medium text-foreground">Sign in to view your sales</p>
        <button onClick={() => base44.auth.redirectToLogin()}
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-primary text-primary-foreground font-semibold text-sm">
          Sign In
        </button>
      </div>
    );
  }

  const pendingTransfers = purchases.filter(p => p.transfer_status === 'pending_transfer' && !p.seller_confirmed);
  const awaitingBuyer = purchases.filter(p => p.transfer_status === 'pending_transfer' && p.seller_confirmed && !p.buyer_confirmed);
  const completedSales = purchases.filter(p => p.transfer_status === 'completed');
  const activeListings = listings.filter(l => l.status === 'active');

  const cardStyle = { background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))' };

  return (
    <div className="max-w-3xl mx-auto px-4 pb-12" style={{ paddingTop: 'calc(2rem + env(safe-area-inset-top))' }}>
      <div className="flex items-start justify-between gap-4 mb-8">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2 text-foreground">
            <Package className="w-6 h-6 text-primary" /> My Sales
          </h1>
          <p className="text-sm text-muted-foreground mt-1">{user.email}</p>
        </div>
        <Link
          to="/create-listing"
          className="inline-flex items-center gap-2 bg-primary text-primary-foreground px-4 py-2.5 rounded-xl text-sm font-bold hover:bg-primary/90 transition-colors flex-shrink-0"
        >
          <Plus className="w-4 h-4" /> List Upgrade
        </Link>
      </div>

      <SellerMetrics purchases={purchases} />

      {/* Action Required — send tickets */}
      {pendingTransfers.length > 0 && (
        <section className="mb-8">
          <h2 className="font-semibold text-base mb-3 flex items-center gap-2 text-foreground">
            <Clock className="w-5 h-5" style={{ color: '#FF8C00' }} />
            <span>Action Required</span>
            <span className="text-xs font-bold px-2 py-0.5 rounded-full"
              style={{ background: 'rgba(255,140,0,0.15)', color: '#FF8C00', border: '1px solid rgba(255,140,0,0.3)' }}>
              {pendingTransfers.length}
            </span>
          </h2>
          <div className="space-y-3">
            {pendingTransfers.map(p => {
              const ev = events[p.event_id];
              return (
                <div key={p.id} className="rounded-2xl p-5"
                  style={{ background: 'rgba(255,140,0,0.07)', border: '1px solid rgba(255,140,0,0.25)' }}>
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div className="min-w-0">
                      <div className="font-semibold text-sm text-foreground truncate">{ev?.title || 'Event'}</div>
                      <div className="text-xs text-muted-foreground mt-0.5">
                        Buyer: <span className="font-medium text-foreground">{p.buyer_email}</span>
                        {p.buyer_name && <> · {p.buyer_name}</>}
                        {p.buyer_phone && <> · {p.buyer_phone}</>}
                      </div>
                      <div className="text-xs text-muted-foreground mt-0.5">
                        Amount: <span className="font-medium text-foreground">${p.amount?.toFixed(2)}</span>
                        {' '}· Qty: {p.quantity}
                      </div>
                    </div>
                    <Link
                      to={`/purchase/${p.id}`}
                      className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-bold flex-shrink-0"
                      style={{ background: 'linear-gradient(135deg, #FF8C00, #FF2D78)', color: '#fff' }}
                    >
                      Send Tickets <ArrowRight className="w-3.5 h-3.5" />
                    </Link>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Awaiting buyer confirmation */}
      {awaitingBuyer.length > 0 && (
        <section className="mb-8">
          <h2 className="font-semibold text-base mb-3 flex items-center gap-2 text-foreground">
            <Clock className="w-5 h-5" style={{ color: '#00C8FF' }} />
            <span>Awaiting Buyer Confirmation</span>
            <span className="text-xs font-bold px-2 py-0.5 rounded-full"
              style={{ background: 'rgba(0,200,255,0.12)', color: '#00C8FF', border: '1px solid rgba(0,200,255,0.3)' }}>
              {awaitingBuyer.length}
            </span>
          </h2>
          <div className="space-y-3">
            {awaitingBuyer.map(p => {
              const ev = events[p.event_id];
              return (
                <div key={p.id} className="rounded-2xl p-4 flex items-center justify-between gap-3 flex-wrap text-sm"
                  style={{ background: 'rgba(0,200,255,0.06)', border: '1px solid rgba(0,200,255,0.2)' }}>
                  <div className="min-w-0">
                    <div className="font-semibold text-foreground truncate">{ev?.title || 'Event'}</div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      ${p.amount?.toFixed(2)} · Qty: {p.quantity} · {p.buyer_email}
                    </div>
                  </div>
                  <Link to={`/purchase/${p.id}`}
                    className="text-xs font-bold px-3 py-1.5 rounded-xl flex-shrink-0"
                    style={{ background: 'rgba(0,200,255,0.12)', color: '#00C8FF', border: '1px solid rgba(0,200,255,0.25)' }}>
                    View →
                  </Link>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Active Listings */}
      <section className="mb-8">
        <h2 className="font-semibold text-base mb-3 flex items-center gap-2 text-foreground">
          <Ticket className="w-5 h-5 text-primary" /> Active Listings ({activeListings.length})
        </h2>
        {activeListings.length === 0 ? (
          <div className="rounded-2xl p-8 text-center" style={cardStyle}>
            <p className="text-2xl mb-2">🥜</p>
            <p className="text-sm font-semibold text-foreground">No active listings</p>
            <p className="text-xs text-muted-foreground mt-1">List tickets to start selling.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {activeListings.map(l => {
              const ev = events[l.event_id];
              return (
                <div key={l.id} className="rounded-2xl p-4 flex items-center justify-between gap-3 flex-wrap text-sm" style={cardStyle}>
                  <div className="min-w-0">
                    <div className="font-medium text-foreground truncate">{ev?.title || 'Event'}</div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      Section {l.section} · Row {l.row} · {l.quantity} seat{l.quantity !== 1 ? 's' : ''} · ${l.asking_price}/ea
                    </div>
                  </div>
                  <span className="text-xs font-bold px-2.5 py-1 rounded-full flex-shrink-0"
                    style={{ background: 'rgba(0,255,135,0.12)', color: 'var(--neon-green)', border: '1px solid rgba(0,255,135,0.25)' }}>
                    Active
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Roadmap */}
      <section className="mb-8">
        <div className="rounded-2xl p-5" style={cardStyle}>
          <h2 className="font-semibold text-base flex items-center gap-2 mb-2 text-foreground">
            <Rocket className="w-4 h-4 text-primary" /> Coming Soon: Instant Listings
          </h2>
          <p className="text-sm text-muted-foreground">
            Pre-verify your tickets once and get an <span className="font-medium text-foreground">⚡ Instant Listing</span> badge — buyers see your tickets as immediately transferable, boosting your sell rate and trust score.
          </p>
          <span className="inline-block mt-3 text-xs font-bold px-2.5 py-1 rounded-full"
            style={{ background: 'rgba(255,140,0,0.12)', color: '#FF8C00', border: '1px solid rgba(255,140,0,0.25)' }}>
            Roadmap · Not yet available
          </span>
        </div>
      </section>

      {/* Completed Sales */}
      <section>
        <h2 className="font-semibold text-base mb-3 flex items-center gap-2 text-foreground">
          <CheckCircle className="w-5 h-5" style={{ color: 'var(--neon-green)' }} /> Completed Sales ({completedSales.length})
        </h2>
        {completedSales.length === 0 ? (
          <div className="rounded-2xl p-8 text-center" style={cardStyle}>
            <p className="text-2xl mb-2">🎟️</p>
            <p className="text-sm font-semibold text-foreground">No completed sales yet</p>
            <p className="text-xs text-muted-foreground mt-1">When a buyer confirms receipt, your sale appears here.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {completedSales.map(p => {
              const ev = events[p.event_id];
              const eventDate = ev?.event_start_local || ev?.date;
              const payoutState = p.payment_captured ? 'paid out' : 'pending payout';
              const payoutColor = p.payment_captured ? 'var(--neon-green)' : '#FF8C00';
              return (
                <div key={p.id} className="rounded-2xl p-4 flex items-start justify-between gap-3 flex-wrap text-sm" style={cardStyle}>
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold text-foreground truncate">{ev?.title || 'Event'}</div>
                    {eventDate && (
                      <div className="text-xs text-muted-foreground mt-0.5">
                        {format(new Date(eventDate), 'EEE, MMM d, yyyy')}
                      </div>
                    )}
                    <div className="flex items-center gap-2 mt-1 flex-wrap">
                      <span className="text-xs font-bold" style={{ color: 'var(--neon-green)' }}>
                        ${p.seller_payout != null ? p.seller_payout.toFixed(2) : p.amount?.toFixed(2)}
                      </span>
                      <span className="text-xs font-semibold px-2 py-0.5 rounded-full"
                        style={{ background: p.payment_captured ? 'rgba(0,255,135,0.1)' : 'rgba(255,140,0,0.1)', color: payoutColor, border: `1px solid ${payoutColor}44` }}>
                        {payoutState}
                      </span>
                      {p.created_date && (
                        <span className="text-xs text-muted-foreground">· {format(new Date(p.created_date), 'MMM d, yyyy')}</span>
                      )}
                    </div>
                  </div>
                  <Link to={`/purchase/${p.id}`}
                    className="text-xs font-bold px-3 py-1.5 rounded-xl flex-shrink-0"
                    style={{ background: 'hsl(var(--muted))', color: 'hsl(var(--foreground))' }}>
                    View →
                  </Link>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}