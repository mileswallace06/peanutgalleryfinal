import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { format } from 'date-fns';
import { Ticket, Clock, CheckCircle, Package, Rocket, ArrowRight, Plus } from 'lucide-react';
import SellerMetrics from '@/components/sales/SellerMetrics';

export default function MySales() {
  const [user, setUser] = useState(null);
  const [listings, setListings] = useState([]);
  const [purchases, setPurchases] = useState([]);
  const [events, setEvents] = useState({});
  const [loading, setLoading] = useState(true);

  const load = async () => {
    const me = await base44.auth.me();
    setUser(me);

    const [myListings, allPurchases] = await Promise.all([
      base44.entities.Listing.filter({ seller_email: me.email }),
      base44.entities.Purchase.filter({ seller_email: me.email }),
    ]);

    setListings(myListings);
    setPurchases(allPurchases);

    // Fetch events for all listings
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
        <p>Please sign in to view your sales.</p>
      </div>
    );
  }

  const pendingTransfers = purchases.filter(p => p.transfer_status === 'pending_transfer' && !p.seller_confirmed);
  const completedSales = purchases.filter(p => p.transfer_status === 'completed');
  const activeListings = listings.filter(l => l.status === 'active');

  return (
    <div className="max-w-3xl mx-auto px-4 py-8" style={{ paddingTop: 'calc(2rem + env(safe-area-inset-top))' }}>
      <div className="flex items-start justify-between gap-4 mb-8">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
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

      {/* Pending Transfers — action required */}
      <section className="mb-8">
        <h2 className="font-semibold text-lg mb-3 flex items-center gap-2">
          <Clock className="w-5 h-5 text-amber-500" /> Action Required
          {pendingTransfers.length > 0 && (
            <span className="bg-amber-100 text-amber-700 text-xs font-bold px-2 py-0.5 rounded-full">{pendingTransfers.length}</span>
          )}
        </h2>
        {pendingTransfers.length === 0 ? (
          <p className="text-sm text-muted-foreground bg-white border border-border rounded-xl p-5">No pending transfers.</p>
        ) : (
          <div className="space-y-3">
            {pendingTransfers.map(p => {
              const event = events[p.event_id];
              return (
                <div key={p.id} className="bg-white border border-amber-200 rounded-xl p-5">
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div>
                      <div className="font-semibold text-sm">{event?.title || 'Event'}</div>
                      <div className="text-xs text-muted-foreground mt-0.5">
                        Buyer: <span className="font-medium text-foreground">{p.buyer_email}</span>
                        {p.buyer_name && <> · {p.buyer_name}</>}
                        {p.buyer_phone && <> · {p.buyer_phone}</>}
                      </div>
                      <div className="text-xs text-muted-foreground mt-0.5">
                        Amount: <span className="font-medium text-foreground">${p.amount?.toFixed(2)}</span>
                        {' '}· Qty: {p.quantity}
                      </div>
                      <div className="text-xs text-muted-foreground mt-0.5">
                        Buyer confirmed receipt: {p.buyer_confirmed ? <span className="text-green-600 font-medium">Yes ✓</span> : <span>Not yet</span>}
                      </div>
                    </div>
                    <Link
                      to={`/purchase/${p.id}`}
                      className="inline-flex items-center gap-1.5 bg-primary text-primary-foreground px-4 py-2 rounded-lg text-sm font-semibold hover:bg-primary/90 transition-colors flex-shrink-0"
                    >
                      Send Tickets <ArrowRight className="w-3.5 h-3.5" />
                    </Link>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Active Listings */}
      <section className="mb-8">
        <h2 className="font-semibold text-lg mb-3 flex items-center gap-2">
          <Ticket className="w-5 h-5 text-primary" /> Active Listings ({activeListings.length})
        </h2>
        {activeListings.length === 0 ? (
          <p className="text-sm text-muted-foreground bg-white border border-border rounded-xl p-5">No active listings.</p>
        ) : (
          <div className="space-y-2">
            {activeListings.map(l => {
              const event = events[l.event_id];
              return (
                <div key={l.id} className="bg-white border border-border rounded-xl p-4 flex items-center justify-between gap-3 flex-wrap text-sm">
                  <div>
                    <div className="font-medium">{event?.title || 'Event'}</div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      Section {l.section} · Row {l.row} · {l.quantity} seat{l.quantity !== 1 ? 's' : ''} · ${l.asking_price}/ea
                    </div>
                  </div>
                  <span className="text-xs bg-green-100 text-green-700 border border-green-200 px-2 py-0.5 rounded-full font-medium">Active</span>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Roadmap */}
      <section className="mb-8">
        <div className="bg-secondary border border-border rounded-2xl p-5">
          <h2 className="font-semibold text-base flex items-center gap-2 mb-2">
            <Rocket className="w-4 h-4 text-primary" /> Coming Soon: Instant Listings
          </h2>
          <p className="text-sm text-muted-foreground">
            Pre-verify your tickets once and get an <span className="font-medium text-foreground">⚡ Instant Listing</span> badge — buyers see your tickets as immediately transferable, boosting your sell rate and trust score. No re-review required per sale.
          </p>
          <span className="inline-block mt-3 text-xs bg-amber-100 text-amber-700 border border-amber-200 px-2.5 py-1 rounded-full font-medium">Roadmap · Not yet available</span>
        </div>
      </section>

      {/* Completed Sales */}
      <section>
        <h2 className="font-semibold text-lg mb-3 flex items-center gap-2">
          <CheckCircle className="w-5 h-5 text-green-600" /> Completed Sales ({completedSales.length})
        </h2>
        {completedSales.length === 0 ? (
          <p className="text-sm text-muted-foreground bg-white border border-border rounded-xl p-5">No completed sales yet.</p>
        ) : (
          <div className="space-y-2">
            {completedSales.map(p => {
              const event = events[p.event_id];
              return (
                <div key={p.id} className="bg-white border border-border rounded-xl p-4 flex items-center justify-between gap-3 flex-wrap text-sm">
                  <div>
                    <div className="font-medium">{event?.title || 'Event'}</div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      Buyer: {p.buyer_email} · ${p.amount?.toFixed(2)}
                      {p.created_date && <> · {format(new Date(p.created_date), 'MMM d, yyyy')}</>}
                    </div>
                  </div>
                  <Link to={`/purchase/${p.id}`} className="text-xs text-primary hover:underline">View →</Link>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}