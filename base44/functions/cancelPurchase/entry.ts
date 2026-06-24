import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';
import Stripe from 'npm:stripe@14.21.0';

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const user = await base44.auth.me();
  if (!user) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const secretKey = Deno.env.get('STRIPELIVESECRETKEY');
  if (!secretKey || (!secretKey.startsWith('sk_test_') && !secretKey.startsWith('sk_live_'))) {
    return Response.json({ error: 'Stripe secret key misconfigured' }, { status: 500 });
  }

  const stripe = new Stripe(secretKey);
  const { purchase_id } = await req.json();

  if (!purchase_id) {
    return Response.json({ error: 'purchase_id is required' }, { status: 400 });
  }

  const purchases = await base44.asServiceRole.entities.Purchase.filter({ id: purchase_id });
  const purchase = purchases[0];
  if (!purchase) {
    return Response.json({ error: 'Purchase not found' }, { status: 404 });
  }

  // Only buyer can cancel
  if (purchase.buyer_email !== user.email && user.role !== 'admin') {
    return Response.json({ error: 'Only the buyer can cancel a purchase' }, { status: 403 });
  }

  const terminal = ['completed', 'expired'];
  if (terminal.includes(purchase.transfer_status)) {
    return Response.json({ error: `Cannot cancel a ${purchase.transfer_status} purchase` }, { status: 409 });
  }
  // disputed purchases can be refunded (by admin or buyer)
  if (purchase.payment_captured) {
    return Response.json({ error: 'Payment already captured' }, { status: 409 });
  }

  // Cancel or refund the PaymentIntent
  const pi = await stripe.paymentIntents.retrieve(purchase.payment_intent_id);
  if (pi.status === 'requires_capture') {
    await stripe.paymentIntents.cancel(purchase.payment_intent_id);
  } else if (pi.status === 'succeeded') {
    await stripe.refunds.create({ payment_intent: purchase.payment_intent_id });
  }

  await base44.asServiceRole.entities.Purchase.update(purchase.id, {
    transfer_status: 'expired'
  });

  // Only restore listing to active if it's currently pending_transfer.
  // Don't override cancelled/sold/hidden — that would re-list a cancelled listing
  // or un-lock a sold listing, causing double-sale or inventory conflicts.
  const [currentListing] = await base44.asServiceRole.entities.Listing.filter({ id: purchase.listing_id });
  if (currentListing && currentListing.status === 'pending_transfer') {
    await base44.asServiceRole.entities.Listing.update(purchase.listing_id, {
      status: 'active',
      reservation_token: null,
      reservation_expires_at: null,
      reserved_by_email: null,
    });
  }

  // Notify seller that the purchase was cancelled — they may have already
  // initiated a ticket transfer on Ticketmaster/SeatGeek and must be warned.
  const sellerMessage = purchase.seller_confirmed
    ? 'The buyer cancelled after you confirmed transfer. If you already sent tickets on Ticketmaster/SeatGeek, please contact support immediately.'
    : 'The buyer cancelled their purchase. Your listing has been restored to active.';
  base44.asServiceRole.functions.invoke('sendUserNotification', {
    user_email: purchase.seller_email,
    title: 'Purchase cancelled',
    body: sellerMessage,
    type: 'listing_expired',
    purchase_id: purchase.id,
  }).catch(() => {});

  // If seller had already confirmed, alert admin — tickets may have been transferred
  if (purchase.seller_confirmed) {
    base44.asServiceRole.functions.invoke('sendNotificationEmail', {
      to: 'experience@peanutgallery.store',
      subject: `⚠️ Purchase cancelled after seller confirmed — ${purchase.id}`,
      body: `Buyer cancelled purchase AFTER seller confirmed transfer.\n\nPurchase: ${purchase.id}\nBuyer: ${purchase.buyer_email}\nSeller: ${purchase.seller_email}\nAmount: $${purchase.amount?.toFixed(2)}\nSeller had confirmed: ${purchase.seller_confirmed}\n\nINVESTIGATE: Were tickets already transferred? Contact seller to confirm.`,
    }).catch(() => {});
  }

  return Response.json({ status: 'cancelled' });
});