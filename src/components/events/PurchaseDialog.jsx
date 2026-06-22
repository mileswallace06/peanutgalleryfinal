import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { loadStripe } from '@stripe/stripe-js';
import { Elements, CardElement, useStripe, useElements } from '@stripe/react-stripe-js';
import { base44 } from '@/api/base44Client';
import { formatFeeBreakdown, ACTIVE_FEE_MODEL_ID, FEE_MODELS } from '@/lib/feeEngine';
import { X, Lock, Shield, ArrowRight, AlertTriangle, MapPin, Ticket } from 'lucide-react';
import TransferAcknowledgment from '@/components/listings/TransferAcknowledgment';
import UpgradeEligibilityGate from '@/components/upgrades/UpgradeEligibilityGate.jsx';

function CheckoutForm({ event, listing, buyerEmail, onClose, onReserved }) {
  const stripe = useStripe();
  const elements = useElements();
  const navigate = useNavigate();

  const UPGRADE_LISTING_TYPES = ['live_upgrade', 'venue_upgrade'];
  const isUpgrade = UPGRADE_LISTING_TYPES.includes(listing.listing_type);
  const isDemo = listing.is_demo_listing || listing.notes?.startsWith('[DEMO]');
  const isDemoUpgrade = isUpgrade && isDemo;
  const hasEligibilityGate = isUpgrade && (listing.requires_location || listing.requires_existing_ticket);

  const [name, setName] = useState('');
  const [email] = useState(buyerEmail || ''); // HIGH-1: locked to authenticated user email
  const [phone, setPhone] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [feeBreakdown, setFeeBreakdown] = useState(null);
  const [eligibilityPassed, setEligibilityPassed] = useState(!hasEligibilityGate);
  // Transfer acknowledgment: low-confidence listings require explicit buyer ack
  const transferScore = listing.transfer_confidence_score ?? null;
  const needsTransferAck = transferScore !== null && transferScore < 70 && listing.transfer_status !== 'transfer_confirmed';
  const [transferAcknowledged, setTransferAcknowledged] = useState(!needsTransferAck);

  const qty = listing.quantity || 1;
  const subtotal = listing.asking_price * qty;
  const estimatedBreakdown = formatFeeBreakdown(listing.asking_price, qty);
  const estimatedFee = estimatedBreakdown.fee;
  const total = feeBreakdown ? feeBreakdown.buyerTotal : estimatedBreakdown.total;

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!stripe || !elements) return;
    if (isUpgrade && !eligibilityPassed) return;
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
      const { clientSecret, paymentIntentId: piId, subtotal, platformFee, buyerTotal, sellerPayout } = res.data;
      paymentIntentId = piId;
      setFeeBreakdown({ subtotal, platformFee, buyerTotal, sellerPayout });
      onReserved(listing.id); // track reservation so dialog close can release it

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
      const fb = feeBreakdown || { subtotal, platformFee: estimatedFee, buyerTotal: total, sellerPayout: subtotal };
      const purchase = await base44.entities.Purchase.create({
        listing_id: listing.id,
        event_id: event.id,
        buyer_email: email,
        buyer_name: name,
        buyer_phone: phone,
        seller_email: listing.seller_email,
        amount: fb.buyerTotal,
        subtotal: fb.subtotal,
        platform_fee: fb.platformFee,
        seller_payout: fb.sellerPayout,
        quantity: listing.quantity || 1,
        payment_intent_id: paymentIntentId,
        transfer_status: 'pending_transfer',
        buyer_confirmed: false,
        seller_confirmed: false,
        payment_captured: false,
      });

      // 4. Notify seller with direct deep-link to Transfer Assistant (fire-and-forget)
      base44.functions.invoke('recordNotification', {
        user_email: listing.seller_email,
        type: 'sale_created',
        title: '🎉 Your ticket sold!',
        body: `Tap to transfer your tickets and receive payment. Sec ${listing.section}, Row ${listing.row}.`,
        reference_type: 'purchase',
        reference_id: purchase.id,
        action_url: `/purchase/${purchase.id}`,
      }).catch(() => {});

      // 5. Navigate to purchase page
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

  // Demo upgrade: simulate without real payment
  const handleDemoUpgradeSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    await new Promise(r => setTimeout(r, 1200));
    const purchase = await base44.entities.Purchase.create({
      listing_id: listing.id,
      event_id: event.id,
      buyer_email: email,
      buyer_name: name || 'Demo User',
      seller_email: listing.seller_email,
      amount: 0,
      subtotal: 0,
      platform_fee: 0,
      seller_payout: 0,
      quantity: listing.quantity || 1,
      transfer_status: 'completed',
      buyer_confirmed: true,
      seller_confirmed: true,
      payment_captured: false,
    });
    navigate(`/purchase/${purchase.id}`);
  };

  return (
    <form onSubmit={isDemoUpgrade ? handleDemoUpgradeSubmit : handleSubmit} className="space-y-5">
      {/* Upgrade disclaimer */}
      {isUpgrade && (
        <div className="flex items-start gap-3 rounded-2xl p-3"
          style={{ background: 'rgba(255,140,0,0.08)', border: '1px solid rgba(255,140,0,0.35)' }}>
          <AlertTriangle className="w-5 h-5 flex-shrink-0 mt-0.5" style={{ color: '#FF8C00' }} />
          <div className="text-xs leading-relaxed" style={{ color: 'rgba(255,200,100,0.9)' }}>
            <strong style={{ color: '#FF8C00' }}>This is an upgrade, not admission.</strong> You must already have a ticket to this event. This purchase grants you access to better seats, not entry to the venue.
            {listing.requires_location && listing.location_requirement !== 'none' && (
              <div className="flex items-center gap-1.5 mt-1.5">
                <MapPin className="w-3.5 h-3.5 flex-shrink-0" style={{ color: '#00C8FF' }} />
                <span style={{ color: '#00C8FF' }}>
                  {listing.location_requirement === 'inside_venue' && 'You must be inside the venue to complete this purchase.'}
                  {listing.location_requirement === 'venue_proximity' && 'You must be near the venue to complete this purchase.'}
                  {listing.location_requirement === 'city_only' && 'You must be in the city to complete this purchase.'}
                </span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Demo upgrade notice */}
      {isDemoUpgrade && (
        <div className="flex items-start gap-3 rounded-2xl p-3"
          style={{ background: 'rgba(191,95,255,0.08)', border: '1px solid rgba(191,95,255,0.3)' }}>
          <Ticket className="w-5 h-5 flex-shrink-0 mt-0.5" style={{ color: '#BF5FFF' }} />
          <div className="text-xs leading-relaxed" style={{ color: 'rgba(220,190,255,0.9)' }}>
            <strong style={{ color: '#BF5FFF' }}>Demo mode.</strong> This simulates an upgrade purchase. No real payment, barcode validation, ticket transfer, or geofencing will occur.
          </div>
        </div>
      )}

      {/* Eligibility gate — blocks checkout for upgrades until checks pass */}
      {hasEligibilityGate && (
        <UpgradeEligibilityGate
          listing={listing}
          isDemo={isDemo}
          onEligible={() => setEligibilityPassed(true)}
        />
      )}

      {/* Order summary */}
      <div className="rounded-2xl p-4" style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)' }}>
        <div className="font-semibold text-sm text-foreground mb-3">Order Summary</div>
        <div className="space-y-1.5 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">{estimatedBreakdown.subtotalLabel}</span>
            <span className="text-foreground">${(feeBreakdown?.subtotal ?? estimatedBreakdown.subtotal).toFixed(2)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground flex items-center gap-1.5">
              Service fee
              <span className="text-[10px] px-1.5 py-0.5 rounded-full" style={{ background: 'rgba(191,95,255,0.12)', color: '#BF5FFF' }}>
                {FEE_MODELS[ACTIVE_FEE_MODEL_ID]?.shortLabel}
              </span>
            </span>
            <span className="text-foreground">${(feeBreakdown?.platformFee ?? estimatedBreakdown.fee).toFixed(2)}</span>
          </div>
        </div>
        <div className="mt-3 pt-2.5 flex justify-between font-black text-base" style={{ borderTop: '1px solid rgba(255,255,255,0.1)' }}>
          <span className="text-foreground">Total</span>
          <span style={{ color: '#00FF87' }}>${total.toFixed(2)}</span>
        </div>
        <p className="text-[10px] text-muted-foreground mt-1.5 leading-relaxed">
          Payment held in escrow until you confirm ticket receipt.
        </p>
      </div>

      {/* Transfer status acknowledgment */}
      {listing.transfer_status !== 'transfer_disabled' && (
        <TransferAcknowledgment
          listing={listing}
          onAcknowledged={() => setTransferAcknowledged(true)}
        />
      )}

      {/* Instant transfer notice */}
      {listing.listing_mode === 'instant' && listing.custody_status === 'verified' && (
        <div className="flex items-start gap-3 rounded-2xl p-3" style={{ background: 'rgba(0,200,255,0.08)', border: '1px solid rgba(0,200,255,0.3)' }}>
          <span className="text-lg flex-shrink-0">⚡</span>
          <div className="text-xs" style={{ color: 'rgba(200,240,255,0.9)' }}>
            <strong style={{ color: '#00C8FF' }}>Instant Transfer:</strong> Peanut Gallery already has this ticket ready. After purchase, we'll transfer it to you directly — no waiting on the seller.
          </div>
        </div>
      )}

      {/* Escrow notice — skip for demo upgrades */}
      {!isDemoUpgrade && (
        <div className="flex items-start gap-3 rounded-2xl p-3" style={{ background: 'rgba(0,255,135,0.08)', border: '1px solid rgba(0,255,135,0.25)' }}>
          <Shield className="w-5 h-5 flex-shrink-0 mt-0.5" style={{ color: '#00FF87' }} />
          <div className="text-xs" style={{ color: 'rgba(200,255,230,0.85)' }}>
            {isUpgrade
              ? 'Your payment is held in escrow. The seller is paid only after you confirm access to the upgraded seats.'
              : 'Your payment is held safely until the ticket transfer is confirmed. The seller does not get paid until you confirm you received the seats.'
            }
          </div>
        </div>
      )}

      {/* Buyer info */}
      <div className="space-y-3">
        <div>
          <label className="block text-xs font-medium text-muted-foreground mb-1">Full Name</label>
          <input
            type="text"
            required
            value={name}
            onChange={e => setName(e.target.value)}
            className="w-full px-3 py-2.5 rounded-xl text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
            style={{ background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.12)' }}
            placeholder="Your full name"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-muted-foreground mb-1">Email <span className="text-[10px] text-muted-foreground">(tickets sent here)</span></label>
          <input
            type="email"
            required
            value={email}
            readOnly
            className="w-full px-3 py-2.5 rounded-xl text-sm text-foreground opacity-70 cursor-not-allowed"
            style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-muted-foreground mb-1">Phone (optional)</label>
          <input
            type="tel"
            value={phone}
            onChange={e => setPhone(e.target.value)}
            className="w-full px-3 py-2.5 rounded-xl text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
            style={{ background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.12)' }}
            placeholder="+1 (555) 000-0000"
          />
        </div>
      </div>

      {/* Card element — hidden for demo upgrades */}
      {!isDemoUpgrade && (
        <div>
          <label className="block text-xs font-medium text-muted-foreground mb-1 flex items-center gap-1">
            <Lock className="w-3 h-3" /> Card Details
          </label>
          <div className="px-3 py-3 rounded-xl" style={{ background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.12)' }}>
            <CardElement options={{
              hidePostalCode: false,
              style: {
                base: { fontSize: '14px', color: '#ffffff', '::placeholder': { color: 'rgba(255,255,255,0.35)' }, iconColor: '#BF5FFF' },
                invalid: { color: '#FF2D78' }
              }
            }} />
          </div>
        </div>
      )}

      {error && (
        <div className="text-sm rounded-xl px-3 py-2" style={{ color: '#FF2D78', background: 'rgba(255,45,120,0.1)', border: '1px solid rgba(255,45,120,0.25)' }}>
          {error}
        </div>
      )}

      <button
        type="submit"
        disabled={loading || !eligibilityPassed || (!isDemoUpgrade && (!stripe || !transferAcknowledged))}
        className="w-full flex items-center justify-center gap-2 py-3.5 rounded-full font-black text-sm transition-all disabled:opacity-40 mt-2"
        style={{
          background: isDemoUpgrade
            ? 'linear-gradient(135deg, #BF5FFF, #7B2FFF)'
            : isUpgrade
            ? 'linear-gradient(135deg, #FF8C00, #FF2D78)'
            : 'linear-gradient(135deg, #00E87A, #00B8E8)',
          color: isDemoUpgrade ? '#fff' : '#0D0B14',
          boxShadow: isDemoUpgrade ? '0 0 18px rgba(191,95,255,0.22)' : '0 0 18px rgba(0,232,122,0.22)',
        }}
      >
        {loading ? (
          <><span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> Processing...</>
        ) : isDemoUpgrade ? (
          <><Ticket className="w-4 h-4" /> Simulate Upgrade Purchase <ArrowRight className="w-4 h-4" /></>
        ) : isUpgrade ? (
          <><ArrowRight className="w-4 h-4" /> Upgrade Live — ${total.toFixed(2)} Escrow Protected <ArrowRight className="w-4 h-4" /></>
        ) : (
          <><Lock className="w-4 h-4" /> Pay ${total.toFixed(2)} Securely — Escrow Protected <ArrowRight className="w-4 h-4" /></>
        )}
      </button>
      <div style={{ paddingBottom: 'env(safe-area-inset-bottom)' }} />
    </form>
  );
}

export default function PurchaseDialog({ event, listing, onClose, mode = 'ticket' }) {
  const [stripePromise, setStripePromise] = useState(null);
  const [user, setUser] = useState(null);
  const [reservedListingId, setReservedListingId] = useState(null);
  const UPGRADE_LISTING_TYPES = ['live_upgrade', 'venue_upgrade'];
  const isUpgrade = UPGRADE_LISTING_TYPES.includes(listing.listing_type);
  const isDemo = listing.is_demo_listing || listing.notes?.startsWith('[DEMO]');
  const isDemoUpgrade = isUpgrade && isDemo;

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
    <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={handleClose} />
      <div className="relative rounded-t-2xl sm:rounded-2xl shadow-2xl w-full sm:max-w-md mx-auto flex flex-col"
        style={{ maxHeight: 'calc(100dvh - 72px)', background: 'hsl(255 12% 9%)', border: '1px solid rgba(255,255,255,0.1)' }}>
        {/* Sticky header */}
        <div className="flex-shrink-0 border-b px-5 py-4 rounded-t-2xl"
          style={{ background: 'hsl(255 12% 9%)', borderColor: 'rgba(255,255,255,0.1)' }}>
          <div className="flex items-center justify-between mb-3">
            <div>
              <h2 className="font-bold text-foreground">
                {isDemoUpgrade ? 'Simulate Upgrade Purchase' : isUpgrade ? 'Upgrade Live' : 'Buy Ticket'}
              </h2>
              <p className="text-xs text-muted-foreground">Section {listing.section} · Row {listing.row}</p>
            </div>
            <button onClick={handleClose} className="p-1.5 rounded-lg hover:bg-white/10 transition-colors text-foreground">
              <X className="w-5 h-5" />
            </button>
          </div>
          {/* Trust strip — context-aware */}
          {isDemoUpgrade ? (
            <div className="flex items-center gap-2 px-3 py-2 rounded-xl"
              style={{ background: 'rgba(191,95,255,0.08)', border: '1px solid rgba(191,95,255,0.2)' }}>
              <span className="text-sm">🧪</span>
              <p className="text-[10px] leading-tight" style={{ color: 'rgba(220,190,255,0.8)' }}>
                Demo simulation — no real payment, no ticket transfer, no geofencing
              </p>
            </div>
          ) : isUpgrade ? (
            <div className="grid grid-cols-2 gap-1.5">
              {[
                { icon: '🎟️', text: 'Existing admission required' },
                { icon: '🔒', text: 'Payment held in escrow' },
                { icon: '✅', text: 'You confirm before seller is paid' },
                { icon: '🛡️', text: 'Disputes supported' },
              ].map(({ icon, text }) => (
                <div key={text} className="flex items-start gap-1.5 px-2.5 py-2 rounded-xl"
                  style={{ background: 'rgba(255,140,0,0.05)', border: '1px solid rgba(255,140,0,0.15)' }}>
                  <span className="text-sm leading-none flex-shrink-0 mt-0.5">{icon}</span>
                  <p className="text-[10px] leading-tight" style={{ color: 'rgba(255,200,130,0.8)' }}>{text}</p>
                </div>
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-1.5">
              {[
                { icon: '🔒', text: 'Money held safely in escrow' },
                { icon: '✅', text: 'You confirm before seller is paid' },
                { icon: '🎫', text: 'Seller notified to transfer immediately' },
                { icon: '🛡️', text: 'Disputes supported if something goes wrong' },
              ].map(({ icon, text }) => (
                <div key={text} className="flex items-start gap-1.5 px-2.5 py-2 rounded-xl"
                  style={{ background: 'rgba(0,255,135,0.05)', border: '1px solid rgba(0,255,135,0.12)' }}>
                  <span className="text-sm leading-none flex-shrink-0 mt-0.5">{icon}</span>
                  <p className="text-[10px] leading-tight" style={{ color: 'rgba(200,255,230,0.7)' }}>{text}</p>
                </div>
              ))}
            </div>
          )}
        </div>
        {/* UX-8: Scrollable body — submit button is sticky-footed outside scroll to prevent iOS keyboard overlap */}
        <div className="flex-1 overflow-y-auto p-5 pb-2">
          {!stripePromise || !user ? (
            <div className="flex justify-center py-8">
              <span className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
            </div>
          ) : user.email === listing.seller_email ? (
            <div className="text-center py-8 space-y-3 px-4">
              <p className="text-4xl">🚫</p>
              <p className="font-bold text-foreground">You can't buy your own listing</p>
              <p className="text-sm text-muted-foreground">This ticket is listed by you. Share the event link with friends so they can buy it.</p>
              <button onClick={handleClose} className="mt-2 px-6 py-2.5 rounded-full font-bold text-sm"
                style={{ background: 'hsl(var(--muted))', color: 'hsl(var(--foreground))' }}>
                Close
              </button>
            </div>
          ) : (
            <Elements stripe={stripePromise}>
              <CheckoutForm event={event} listing={listing} buyerEmail={user.email} onClose={handleClose} onReserved={setReservedListingId} />
            </Elements>
          )}
        </div>
      </div>
    </div>
  );
}