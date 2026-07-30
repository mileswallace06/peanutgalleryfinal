import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { format } from 'date-fns';
import { Ticket, Clock, CheckCircle, AlertTriangle, RefreshCw, Heart, Zap } from 'lucide-react';
import DonateSeatSheet from '@/components/donations/DonateSeatSheet';

export default function MyTickets() {
  const [user, setUser] = useState(null);
  const [purchases, setPurchases] = useState([]);
  const [events, setEvents] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [donatingPurchase, setDonatingPurchase] = useState(null);

  const fetchPurchases = useCallback(async (silent = false) => {
    try {
      const res = await base44.functions.invoke('getPurchaseParticipantView', {
        action: 'list_mine', perspective: 'buyer',
      });
      const myPurchases = res?.data?.purchases || [];
      setPurchases(myPurchases);

      const eventIds = [...new Set(myPurchases.map(p => p.event_id).filter(Boolean))];
      const eventResults = await Promise.all(
        eventIds.map(eid => base44.entities.Event.filter({ id: eid }).then(r => r[0]).catch(() => null))
      );
      const eventMap = {};
      eventIds.forEach((eid, i) => { if (eventResults[i]) eventMap[eid] = eventResults[i]; });
      setEvents(eventMap);
      return myPurchases;
    } catch (err) {
      if (!silent) throw err;
      return [];
    }
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const me = await base44.auth.me();
      if (!me) { setLoading(false); return; }
      setUser(me);
      await fetchPurchases(false);
    } catch (err) {
      setError(err?.message || 'Failed to load tickets');
    } finally {
      setLoading(false);
    }
  }, [fetchPurchases]);

  useEffect(() => { load(); }, [load]);

  // Poll for updates while there are pending purchases (no raw subscriptions)
  useEffect(() => {
    const hasPending = purchases.some(p => p.transfer_status === 'pending_transfer');
    if (!hasPending) return;

    const interval = setInterval(() => {
      if (document.hidden) return;
      fetchPurchases(true);
    }, 20000);

    return () => clearInterval(interval);
  }, [purchases, fetchPurchases]);

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
        <p className="text-foreground font-semibold">Failed to load tickets</p>
        <p className="text-sm text-muted-foreground">{error}</p>
        <button onClick={load} className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-primary text-primary-foreground font-semibold text-sm">
          <RefreshCw className="w-4 h-4" /> Try Again
        </button>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-12 text-center text-muted-foreground space-y-3">
        <p className="text-4xl">🔒</p>
        <p className="font-medium text-foreground">Sign in to view your tickets</p>
        <button onClick={() => base44.auth.redirectToLogin()}
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-primary text-primary-foreground font-semibold text-sm">
          Sign In
        </button>
      </div>
    );
  }

  const pending = purchases.filter(p => p.transfer_status === 'pending_transfer');
  const completed = purchases.filter(p => p.transfer_status === 'completed');
  const disputed = purchases.filter(p => p.transfer_status === 'disputed');

  const cardStyle = { background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))' };

  const StatusBadge = ({ p }) => {
    if (p.transfer_status === 'completed')
      return <span className="text-xs font-bold px-2.5 py-1 rounded-full"
        style={{ background: 'rgba(0,255,135,0.12)', color: 'var(--neon-green)', border: '1px solid rgba(0,255,135,0.25)' }}>Received ✓</span>;
    if (p.transfer_status === 'disputed')
      return <span className="text-xs font-bold px-2.5 py-1 rounded-full"
        style={{ background: 'rgba(255,200,0,0.12)', color: 'var(--neon-yellow)', border: '1px solid rgba(255,200,0,0.25)' }}>Disputed</span>;
    if (!p.seller_confirmed)
      return <span className="text-xs font-bold px-2.5 py-1 rounded-full"
        style={{ background: 'rgba(0,200,255,0.12)', color: 'var(--neon-cyan)', border: '1px solid rgba(0,200,255,0.25)' }}>Waiting on seller</span>;
    return <span className="text-xs font-bold px-2.5 py-1 rounded-full"
      style={{ background: 'rgba(255,140,0,0.12)', color: 'var(--neon-orange)', border: '1px solid rgba(255,140,0,0.25)' }}>Confirm receipt</span>;
  };

  const PurchaseRow = ({ p }) => {
    const event = events[p.event_id];
    const needsConfirm = p.transfer_status === 'pending_transfer' && p.seller_confirmed && !p.buyer_confirmed;
    return (
      <div className="rounded-2xl p-4 flex items-center justify-between gap-3 flex-wrap text-sm"
        style={needsConfirm
          ? { background: 'rgba(255,140,0,0.07)', border: '1px solid rgba(255,140,0,0.3)' }
          : cardStyle}>
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-foreground truncate">{event?.title || 'Event'}</div>
          <div className="text-xs text-muted-foreground mt-0.5">
            {(event?.event_start_utc || event?.date) ? format(new Date(event.event_start_utc || event.date), 'EEE, MMM d · h:mm a') : ''}
            {event?.venue ? ` · ${event.venue}` : ''}
          </div>
          <div className="text-xs text-muted-foreground mt-0.5">
            <span className="font-semibold text-foreground">${p.amount?.toFixed(2)}</span> · Qty: {p.quantity}
            {p.created_date && <> · Purchased {format(new Date(p.created_date), 'MMM d')}</>}
          </div>
          <div className="mt-1.5"><StatusBadge p={p} /></div>
        </div>
        <div className="flex flex-col gap-1.5 flex-shrink-0">
          <Link
            to={`/purchase/${p.id}`}
            className="text-sm font-bold px-4 py-2 rounded-xl transition-colors text-center"
            style={needsConfirm
              ? { background: 'linear-gradient(135deg, #00E87A, #00B8E8)', color: '#0D0B14' }
              : { background: 'hsl(var(--muted))', color: 'hsl(var(--foreground))' }}
          >
            {needsConfirm ? 'Confirm →' : 'View →'}
          </Link>
          {p.transfer_status === 'completed' && event && (
            <div className="flex gap-1.5">
              <Link
                to={`/upgrades/${p.event_id}`}
                className="flex items-center justify-center gap-1 text-xs font-bold px-3 py-1.5 rounded-xl transition-colors"
                style={{ background: 'rgba(0,200,255,0.1)', border: '1px solid rgba(0,200,255,0.3)', color: '#00C8FF' }}>
                <Zap className="w-3 h-3" /> Upgrade
              </Link>
              <button
                onClick={() => setDonatingPurchase({ purchase: p, event })}
                className="flex items-center justify-center gap-1 text-xs font-bold px-3 py-1.5 rounded-xl transition-colors"
                style={{ background: 'rgba(191,95,255,0.1)', border: '1px solid rgba(191,95,255,0.3)', color: '#BF5FFF' }}>
                <Heart className="w-3 h-3" /> Donate
              </button>
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="max-w-3xl mx-auto px-4 pb-12" style={{ paddingTop: 'calc(2rem + env(safe-area-inset-top))' }}>
      {donatingPurchase && (
        <DonateSeatSheet
          event={donatingPurchase.event}
          purchase={donatingPurchase.purchase}
          onClose={() => setDonatingPurchase(null)}
          onDonated={() => setDonatingPurchase(null)}
        />
      )}
      <div className="mb-8">
        <h1 className="text-2xl font-bold flex items-center gap-2 text-foreground">
          <Ticket className="w-6 h-6 text-primary" /> My Tickets
        </h1>
        <p className="text-sm text-muted-foreground mt-1">{user.email}</p>
        <p className="text-xs text-muted-foreground mt-2">Your purchased tickets and upgrades appear here.</p>
      </div>

      {purchases.length === 0 ? (
        <div className="text-center py-20 text-muted-foreground">
          <p className="text-4xl mb-3">🎫</p>
          <p className="font-medium text-foreground">No tickets yet</p>
          <p className="text-sm mt-1">Browse events and buy tickets — they'll appear here.</p>
          <Link to="/events" className="text-primary text-sm mt-3 inline-block hover:underline">Browse events →</Link>
        </div>
      ) : (
        <>
          {/* Needs action — confirm receipt */}
          {pending.filter(p => p.seller_confirmed && !p.buyer_confirmed).length > 0 && (
            <section className="mb-8">
              <h2 className="font-semibold text-base mb-3 flex items-center gap-2 text-foreground">
                <Clock className="w-5 h-5" style={{ color: '#FF8C00' }} />
                Action Required
                <span className="text-xs font-bold px-2 py-0.5 rounded-full"
                  style={{ background: 'rgba(255,140,0,0.15)', color: '#FF8C00', border: '1px solid rgba(255,140,0,0.3)' }}>
                  {pending.filter(p => p.seller_confirmed && !p.buyer_confirmed).length}
                </span>
              </h2>
              <div className="space-y-3">
                {pending.filter(p => p.seller_confirmed && !p.buyer_confirmed).map(p => <PurchaseRow key={p.id} p={p} />)}
              </div>
            </section>
          )}

          {/* Waiting on seller */}
          {pending.filter(p => !p.seller_confirmed).length > 0 && (
            <section className="mb-8">
              <h2 className="font-semibold text-base mb-3 flex items-center gap-2 text-foreground">
                <Clock className="w-5 h-5" style={{ color: 'var(--neon-cyan)' }} />
                Awaiting Transfer ({pending.filter(p => !p.seller_confirmed).length})
              </h2>
              <div className="space-y-3">
                {pending.filter(p => !p.seller_confirmed).map(p => <PurchaseRow key={p.id} p={p} />)}
              </div>
            </section>
          )}

          {/* Disputed */}
          {disputed.length > 0 && (
            <section className="mb-8">
              <h2 className="font-semibold text-base mb-3 flex items-center gap-2 text-foreground">
                <AlertTriangle className="w-5 h-5" style={{ color: 'var(--neon-yellow)' }} />
                Disputed ({disputed.length})
              </h2>
              <div className="space-y-3">
                {disputed.map(p => <PurchaseRow key={p.id} p={p} />)}
              </div>
            </section>
          )}

          {/* Completed */}
          {completed.length > 0 && (
            <section>
              <h2 className="font-semibold text-base mb-3 flex items-center gap-2 text-foreground">
                <CheckCircle className="w-5 h-5" style={{ color: 'var(--neon-green)' }} />
                Completed ({completed.length})
              </h2>
              <div className="space-y-3">
                {completed.map(p => <PurchaseRow key={p.id} p={p} />)}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}