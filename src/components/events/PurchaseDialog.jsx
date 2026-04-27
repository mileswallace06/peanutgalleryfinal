import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { loadStripe } from '@stripe/stripe-js';
import { Elements, CardElement, useStripe, useElements } from '@stripe/react-stripe-js';
import { base44 } from '@/api/base44Client';
import { X, Lock, Shield, ArrowRight } from 'lucide-react';

function CheckoutForm({ event, listing, buyerEmail, onClose }) {
  const stripe = useStripe();
  const elements = useElements();
  const navigate = useNavigate();

  const [name, setName] = useState('');
  const [email, setEmail] = useState(buyerEmail || '');
  const [phone, setPhone] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const total = listing.asking_price * (listing.quantity || 1);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!stripe || !elements) return;
    setLoading(true);
    setError('');

    let paymentIntentId = null;

    try {
      // 1. Create PaymentIntent (server-side, escrow)
      const res = await base44.functions.invoke('createPaymentIntent', {
        listing_id: listing.id,
        buyer_name: name,
        buyer_email: email,
        buyer_phone: phone,
      });
      const { clientSecret, paymentIntentId: piId } = res.data;
      paymentIntentId = piId;

      // 2. Confirm card payment (authorize only — not captured)
      const result = await stripe.confirmCardPayment(clientSecret, {
        payment_method: {
          card: elements.getElement(CardElement),
          billing_details: { name, email },
        },
      });

      if (result.error) {
        // Restore listing
        await base44.entities.Listing.update(listing.id, { status: 'active' });
        setError(result.error.message);
        setLoading(false);
        return;
      }

      // 3. Create Purchase entity
      const purchase = await base44.entities.Purchase.create({
        listing_id: listing.id,
        event_id: event.id,
        buyer_email: email,
        buyer_name: name,
        buyer_phone: phone,
        seller_email: listing.seller_email,
        amount: total,
        quantity: listing.quantity || 1,
        payment_intent_id: paymentIntentId,
        transfer_status: 'pending_transfer',
        buyer_confirmed: false,
        seller_confirmed: false,
        payment_captured: false,
      });

      // 4. Navigate to purchase page
      navigate(`/purchase/${purchase.id}`);
    } catch (err) {
      // Attempt to restore listing on any error
      if (listing.id) {
        await base44.entities.Listing.update(listing.id, { status: 'active' }).catch(() => {});
      }
      setError(err.response?.data?.error || err.message || 'Something went wrong');
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {/* Order summary */}
      <div className="bg-secondary rounded-lg p-4">
        <div className="font-semibold text-sm text-foreground mb-2">Order Summary</div>
        <div className="flex justify-between text-sm mb-1">
          <span className="text-muted-foreground">{event.title}</span>
        </div>
        <div className="flex justify-between text-sm mb-1">
          <span className="text-muted-foreground">Section {listing.section} · Row {listing.row}</span>
          <span>${listing.asking_price} × {listing.quantity || 1}</span>
        </div>
        <div className="border-t border-border mt-2 pt-2 flex justify-between font-bold">
          <span>Total</span>
          <span>${total.toFixed(2)}</span>
        </div>
      </div>

      {/* Escrow notice */}
      <div className="flex items-start gap-3 bg-green-50 border border-green-200 rounded-lg p-3">
        <Shield className="w-5 h-5 text-green-600 flex-shrink-0 mt-0.5" />
        <div className="text-xs text-green-800">
          <span className="font-semibold">Protected by Escrow.</span> Your payment is held securely and only released after both you and the seller confirm the ticket transfer.
        </div>
      </div>

      {/* Buyer info */}
      <div className="space-y-3">
        <div>
          <label className="block text-xs font-medium text-foreground mb-1">Full Name</label>
          <input
            type="text"
            required
            value={name}
            onChange={e => setName(e.target.value)}
            className="w-full px-3 py-2 rounded-lg border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
            placeholder="Your full name"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-foreground mb-1">Email</label>
          <input
            type="email"
            required
            value={email}
            onChange={e => setEmail(e.target.value)}
            className="w-full px-3 py-2 rounded-lg border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
            placeholder="you@example.com"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-foreground mb-1">Phone (optional)</label>
          <input
            type="tel"
            value={phone}
            onChange={e => setPhone(e.target.value)}
            className="w-full px-3 py-2 rounded-lg border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
            placeholder="+1 (555) 000-0000"
          />
        </div>
      </div>

      {/* Card element */}
      <div>
        <label className="block text-xs font-medium text-foreground mb-1 flex items-center gap-1">
          <Lock className="w-3 h-3" /> Card Details
        </label>
        <div className="px-3 py-2.5 rounded-lg border border-border bg-white">
          <CardElement options={{
            style: {
              base: { fontSize: '14px', color: '#1a1a1a', '::placeholder': { color: '#9ca3af' } }
            }
          }} />
        </div>
        <p className="text-xs text-muted-foreground mt-1">Test card: 4242 4242 4242 4242 · any future date · any CVC</p>
      </div>

      {error && (
        <div className="text-sm text-destructive bg-destructive/10 border border-destructive/20 rounded-lg px-3 py-2">
          {error}
        </div>
      )}

      <button
        type="submit"
        disabled={loading || !stripe}
        className="w-full flex items-center justify-center gap-2 bg-primary text-primary-foreground py-3 rounded-lg font-semibold text-sm hover:bg-primary/90 transition-colors disabled:opacity-60"
      >
        {loading ? (
          <><span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> Processing...</>
        ) : (
          <><Lock className="w-4 h-4" /> Pay ${total.toFixed(2)} Securely <ArrowRight className="w-4 h-4" /></>
        )}
      </button>
    </form>
  );
}

export default function PurchaseDialog({ event, listing, onClose }) {
  const [stripePromise, setStripePromise] = useState(null);
  const [user, setUser] = useState(null);
  const [reservedListingId, setReservedListingId] = useState(null);

  useEffect(() => {
    base44.auth.me().then(setUser).catch(() => {});
    base44.functions.invoke('getStripeKey', {}).then(res => {
      setStripePromise(loadStripe(res.data.publishableKey));
    }).catch(console.error);
  }, []);

  // If dialog is closed after reservation but before purchase completes, release the listing
  const handleClose = async () => {
    if (reservedListingId) {
      await base44.entities.Listing.update(reservedListingId, { status: 'active' }).catch(() => {});
    }
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={handleClose} />
      <div className="relative bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl w-full sm:max-w-md mx-auto max-h-[90vh] overflow-y-auto">
        <div className="sticky top-0 bg-white border-b border-border px-5 py-4 flex items-center justify-between rounded-t-2xl sm:rounded-t-2xl">
          <div>
            <h2 className="font-bold text-foreground">Complete Upgrade</h2>
            <p className="text-xs text-muted-foreground">Section {listing.section} · Row {listing.row}</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-muted transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="p-5">
          {!stripePromise ? (
            <div className="flex justify-center py-8">
              <span className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
            </div>
          ) : (
            <Elements stripe={stripePromise}>
              <CheckoutForm event={event} listing={listing} buyerEmail={user?.email} onClose={onClose} />
            </Elements>
          )}
        </div>
      </div>
    </div>
  );
}