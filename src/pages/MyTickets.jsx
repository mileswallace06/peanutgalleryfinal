import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { format } from 'date-fns';
import { Ticket, Clock, CheckCircle, AlertTriangle } from 'lucide-react';

export default function MyTickets() {
  const [user, setUser] = useState(null);
  const [purchases, setPurchases] = useState([]);
  const [events, setEvents] = useState({});
  const [loading, setLoading] = useState(true);

  const load = async () => {
    const me = await base44.auth.me();
    setUser(me);

    const myPurchases = await base44.entities.Purchase.filter({ buyer_email: me.email });
    setPurchases(myPurchases);

    const eventIds = [...new Set(myPurchases.map(p => p.event_id).filter(Boolean))];
    const eventMap = {};
    await Promise.all(eventIds.map(async (eid) => {
      const res = await base44.entities.Event.filter({ id: eid });
      if (res[0]) eventMap[eid] = res[0];
    }));
    setEvents(eventMap);
  };

  useEffect(() => {
    load().catch(console.error).finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-12 text-center">
        <span className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin inline-block" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-12 text-center text-muted-foreground">
        <p>Please sign in to view your tickets.</p>
      </div>
    );
  }

  const pending = purchases.filter(p => p.transfer_status === 'pending_transfer');
  const completed = purchases.filter(p => p.transfer_status === 'completed');
  const disputed = purchases.filter(p => p.transfer_status === 'disputed');

  const StatusBadge = ({ p }) => {
    if (p.transfer_status === 'completed') return <span className="text-xs bg-green-100 text-green-700 border border-green-200 px-2 py-0.5 rounded-full font-medium">Received ✓</span>;
    if (p.transfer_status === 'disputed') return <span className="text-xs bg-amber-100 text-amber-700 border border-amber-200 px-2 py-0.5 rounded-full font-medium">Disputed</span>;
    if (!p.seller_confirmed) return <span className="text-xs bg-blue-50 text-blue-700 border border-blue-200 px-2 py-0.5 rounded-full font-medium">Waiting on seller</span>;
    return <span className="text-xs bg-amber-100 text-amber-700 border border-amber-200 px-2 py-0.5 rounded-full font-medium">Confirm receipt</span>;
  };

  const PurchaseRow = ({ p }) => {
    const event = events[p.event_id];
    const needsConfirm = p.transfer_status === 'pending_transfer' && p.seller_confirmed && !p.buyer_confirmed;
    return (
      <div className={`bg-white border rounded-xl p-4 flex items-center justify-between gap-3 flex-wrap text-sm ${needsConfirm ? 'border-amber-300' : 'border-border'}`}>
        <div className="flex-1 min-w-0">
          <div className="font-semibold truncate">{event?.title || 'Event'}</div>
          <div className="text-xs text-muted-foreground mt-0.5">
            {event?.date ? format(new Date(event.date), 'EEE, MMM d · h:mm a') : ''}
            {event?.venue ? ` · ${event.venue}` : ''}
          </div>
          <div className="text-xs text-muted-foreground mt-0.5">
            ${p.amount?.toFixed(2)} · Qty: {p.quantity}
            {p.created_date && <> · Purchased {format(new Date(p.created_date), 'MMM d')}</>}
          </div>
          <div className="mt-1.5"><StatusBadge p={p} /></div>
        </div>
        <Link
          to={`/purchase/${p.id}`}
          className={`text-sm font-semibold px-4 py-2 rounded-lg transition-colors flex-shrink-0 ${
            needsConfirm
              ? 'bg-primary text-primary-foreground hover:bg-primary/90'
              : 'border border-border text-foreground hover:bg-muted'
          }`}
        >
          {needsConfirm ? 'Confirm Receipt →' : 'View Details →'}
        </Link>
      </div>
    );
  };

  return (
    <div className="max-w-3xl mx-auto px-4 py-8">
      <div className="mb-8">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Ticket className="w-6 h-6 text-primary" /> My Tickets
        </h1>
        <p className="text-sm text-muted-foreground mt-1">{user.email}</p>
      </div>

      {purchases.length === 0 ? (
        <div className="text-center py-20 text-muted-foreground">
          <p className="text-4xl mb-3">🎫</p>
          <p className="font-medium">No purchases yet</p>
          <Link to="/events" className="text-primary text-sm mt-2 inline-block hover:underline">Browse events →</Link>
        </div>
      ) : (
        <>
          {/* Needs action */}
          {pending.filter(p => p.seller_confirmed && !p.buyer_confirmed).length > 0 && (
            <section className="mb-8">
              <h2 className="font-semibold text-lg mb-3 flex items-center gap-2">
                <Clock className="w-5 h-5 text-amber-500" /> Action Required
                <span className="bg-amber-100 text-amber-700 text-xs font-bold px-2 py-0.5 rounded-full">
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
              <h2 className="font-semibold text-lg mb-3 flex items-center gap-2">
                <Clock className="w-5 h-5 text-blue-500" /> Awaiting Transfer ({pending.filter(p => !p.seller_confirmed).length})
              </h2>
              <div className="space-y-3">
                {pending.filter(p => !p.seller_confirmed).map(p => <PurchaseRow key={p.id} p={p} />)}
              </div>
            </section>
          )}

          {/* Disputed */}
          {disputed.length > 0 && (
            <section className="mb-8">
              <h2 className="font-semibold text-lg mb-3 flex items-center gap-2">
                <AlertTriangle className="w-5 h-5 text-amber-500" /> Disputed ({disputed.length})
              </h2>
              <div className="space-y-3">
                {disputed.map(p => <PurchaseRow key={p.id} p={p} />)}
              </div>
            </section>
          )}

          {/* Completed */}
          {completed.length > 0 && (
            <section>
              <h2 className="font-semibold text-lg mb-3 flex items-center gap-2">
                <CheckCircle className="w-5 h-5 text-green-600" /> Completed ({completed.length})
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