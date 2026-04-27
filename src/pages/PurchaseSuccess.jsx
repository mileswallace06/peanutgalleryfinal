import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { format } from 'date-fns';
import { CheckCircle, Clock, XCircle, AlertTriangle, ArrowLeft, Ticket } from 'lucide-react';

const STEPS = [
  { key: 'pending_transfer', label: 'Payment Authorized' },
  { key: 'seller_sent', label: 'Seller Confirmed' },
  { key: 'buyer_received', label: 'Buyer Confirmed' },
  { key: 'completed', label: 'Complete' },
];

function Stepper({ purchase }) {
  const sellerDone = purchase.seller_confirmed;
  const buyerDone = purchase.buyer_confirmed;
  const completed = purchase.transfer_status === 'completed';

  const stepStates = [
    'done',
    sellerDone ? 'done' : 'pending',
    buyerDone ? 'done' : 'pending',
    completed ? 'done' : 'pending',
  ];

  return (
    <div className="flex items-center gap-0 mb-6">
      {STEPS.map((step, i) => (
        <div key={step.key} className="flex items-center flex-1">
          <div className="flex flex-col items-center">
            <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold border-2 ${
              stepStates[i] === 'done'
                ? 'bg-green-500 border-green-500 text-white'
                : 'bg-white border-border text-muted-foreground'
            }`}>
              {stepStates[i] === 'done' ? '✓' : i + 1}
            </div>
            <span className="text-[10px] text-muted-foreground mt-1 text-center w-16 leading-tight">{step.label}</span>
          </div>
          {i < STEPS.length - 1 && (
            <div className={`flex-1 h-0.5 mb-4 ${stepStates[i] === 'done' ? 'bg-green-400' : 'bg-border'}`} />
          )}
        </div>
      ))}
    </div>
  );
}

export default function PurchaseSuccess() {
  const { id } = useParams();
  const [purchase, setPurchase] = useState(null);
  const [listing, setListing] = useState(null);
  const [event, setEvent] = useState(null);
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState('');

  const load = async () => {
    const [me, purchases] = await Promise.all([
      base44.auth.me().catch(() => null),
      base44.entities.Purchase.filter({ id }),
    ]);
    setUser(me);
    const p = purchases[0];
    if (p) {
      setPurchase(p);
      const [listings, events] = await Promise.all([
        base44.entities.Listing.filter({ id: p.listing_id }),
        base44.entities.Event.filter({ id: p.event_id }),
      ]);
      setListing(listings[0] || null);
      setEvent(events[0] || null);
    }
  };

  useEffect(() => {
    load().catch(console.error).finally(() => setLoading(false));
  }, [id]);

  const handleConfirm = async (role) => {
    setActionLoading(true);
    setError('');
    const res = await base44.functions.invoke('capturePayment', {
      purchase_id: purchase.id,
      confirming_role: role,
    });
    if (res.data.error) {
      setError(res.data.error);
    } else {
      await load();
    }
    setActionLoading(false);
  };

  const handleCancel = async () => {
    if (!confirm('Cancel this purchase? The payment will be refunded.')) return;
    setActionLoading(true);
    setError('');
    const res = await base44.functions.invoke('cancelPurchase', { purchase_id: purchase.id });
    if (res.data.error) {
      setError(res.data.error);
    } else {
      await load();
    }
    setActionLoading(false);
  };

  const handleDispute = async () => {
    const reason = prompt('Please describe the issue:');
    if (!reason) return;
    await base44.entities.Purchase.update(purchase.id, {
      transfer_status: 'disputed',
      dispute_reason: reason,
    });
    await load();
  };

  if (loading) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-12 text-center">
        <span className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin inline-block" />
      </div>
    );
  }

  if (!purchase) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-12 text-center text-muted-foreground">
        <p>Purchase not found.</p>
        <Link to="/events" className="text-primary text-sm mt-3 inline-block">← Browse events</Link>
      </div>
    );
  }

  const isBuyer = user?.email === purchase.buyer_email || user?.role === 'admin';
  const isSeller = user?.email === purchase.seller_email || user?.role === 'admin';
  const isCompleted = purchase.transfer_status === 'completed';
  const isExpired = purchase.transfer_status === 'expired';
  const isDisputed = purchase.transfer_status === 'disputed';
  const isPending = purchase.transfer_status === 'pending_transfer';

  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      <Link to="/events" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-6 transition-colors">
        <ArrowLeft className="w-4 h-4" /> Back to Events
      </Link>

      {/* Status banner */}
      {isCompleted && (
        <div className="flex items-center gap-3 bg-green-50 border border-green-200 rounded-xl p-4 mb-6">
          <CheckCircle className="w-6 h-6 text-green-600 flex-shrink-0" />
          <div>
            <div className="font-semibold text-green-800">Transfer Complete!</div>
            <div className="text-sm text-green-700">Payment has been released to the seller. Enjoy your upgrade! 🎉</div>
          </div>
        </div>
      )}
      {isExpired && (
        <div className="flex items-center gap-3 bg-muted rounded-xl p-4 mb-6">
          <XCircle className="w-6 h-6 text-muted-foreground flex-shrink-0" />
          <div>
            <div className="font-semibold">Purchase Cancelled</div>
            <div className="text-sm text-muted-foreground">This purchase was cancelled and refunded.</div>
          </div>
        </div>
      )}
      {isDisputed && (
        <div className="flex items-center gap-3 bg-amber-50 border border-amber-200 rounded-xl p-4 mb-6">
          <AlertTriangle className="w-6 h-6 text-amber-600 flex-shrink-0" />
          <div>
            <div className="font-semibold text-amber-800">Dispute Open</div>
            <div className="text-sm text-amber-700">Payment is frozen. Our team will review and resolve this.</div>
          </div>
        </div>
      )}

      {/* Order card */}
      <div className="bg-white border border-border rounded-2xl overflow-hidden mb-5">
        <div className="bg-secondary px-5 py-4 border-b border-border">
          <h1 className="font-bold text-lg flex items-center gap-2">
            <Ticket className="w-5 h-5 text-primary" /> Your Upgrade
          </h1>
          {event && <p className="text-sm text-muted-foreground mt-0.5">{event.title}</p>}
        </div>
        <div className="p-5 space-y-3">
          {listing && (
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div><span className="text-muted-foreground">Section</span><div className="font-semibold">{listing.section}</div></div>
              <div><span className="text-muted-foreground">Row</span><div className="font-semibold">{listing.row}</div></div>
              {listing.seats && <div><span className="text-muted-foreground">Seats</span><div className="font-semibold">{listing.seats}</div></div>}
              <div><span className="text-muted-foreground">Qty</span><div className="font-semibold">{purchase.quantity}</div></div>
            </div>
          )}
          <div className="border-t border-border pt-3 flex justify-between font-bold">
            <span>Total Paid</span>
            <span>${purchase.amount?.toFixed(2)}</span>
          </div>
          <div className="text-xs text-muted-foreground">
            Purchase ID: <span className="font-mono">{purchase.id.slice(0, 12)}…</span>
          </div>
        </div>
      </div>

      {/* Stepper */}
      {isPending && <Stepper purchase={purchase} />}

      {/* Action panels */}
      {isPending && (
        <div className="space-y-4">
          {/* Seller panel */}
          {isSeller && (
            <div className={`border rounded-xl p-5 ${purchase.seller_confirmed ? 'border-green-200 bg-green-50' : 'border-border bg-white'}`}>
              <h3 className="font-semibold mb-1 flex items-center gap-2">
                {purchase.seller_confirmed ? <CheckCircle className="w-5 h-5 text-green-600" /> : <Clock className="w-5 h-5 text-amber-500" />}
                Seller: {purchase.seller_confirmed ? 'Tickets Sent ✓' : 'Mark Tickets as Sent'}
              </h3>
              {!purchase.seller_confirmed && (
                <>
                  <p className="text-sm text-muted-foreground mb-3">Confirm that you've sent the tickets to the buyer.</p>
                  <button
                    onClick={() => handleConfirm('seller')}
                    disabled={actionLoading}
                    className="bg-primary text-primary-foreground px-4 py-2 rounded-lg text-sm font-semibold hover:bg-primary/90 transition-colors disabled:opacity-60"
                  >
                    {actionLoading ? 'Processing…' : 'I've Sent the Tickets'}
                  </button>
                </>
              )}
            </div>
          )}

          {/* Buyer panel */}
          {isBuyer && (
            <div className={`border rounded-xl p-5 ${purchase.buyer_confirmed ? 'border-green-200 bg-green-50' : 'border-border bg-white'}`}>
              <h3 className="font-semibold mb-1 flex items-center gap-2">
                {purchase.buyer_confirmed ? <CheckCircle className="w-5 h-5 text-green-600" /> : <Clock className="w-5 h-5 text-amber-500" />}
                Buyer: {purchase.buyer_confirmed ? 'Tickets Received ✓' : 'Confirm Receipt'}
              </h3>
              {!purchase.buyer_confirmed && (
                <>
                  <p className="text-sm text-muted-foreground mb-3">Once you confirm receipt, payment will be released to the seller.</p>
                  <div className="flex flex-wrap gap-2">
                    <button
                      onClick={() => handleConfirm('buyer')}
                      disabled={actionLoading}
                      className="bg-accent text-accent-foreground px-4 py-2 rounded-lg text-sm font-semibold hover:bg-accent/90 transition-colors disabled:opacity-60"
                    >
                      {actionLoading ? 'Processing…' : 'I Received My Tickets'}
                    </button>
                    <button
                      onClick={handleDispute}
                      disabled={actionLoading}
                      className="border border-amber-300 text-amber-700 bg-amber-50 px-4 py-2 rounded-lg text-sm font-semibold hover:bg-amber-100 transition-colors"
                    >
                      Open Dispute
                    </button>
                    <button
                      onClick={handleCancel}
                      disabled={actionLoading}
                      className="border border-border text-muted-foreground px-4 py-2 rounded-lg text-sm hover:bg-muted transition-colors"
                    >
                      Cancel Purchase
                    </button>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      )}

      {error && (
        <div className="mt-4 text-sm text-destructive bg-destructive/10 border border-destructive/20 rounded-lg px-3 py-2">
          {error}
        </div>
      )}
    </div>
  );
}