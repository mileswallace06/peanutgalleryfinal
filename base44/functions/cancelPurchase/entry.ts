import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';
import Stripe from 'npm:stripe@14.21.0';
import { sendUserNotification, sendTransactionalEmail } from '../../shared/notifications.ts';

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

  // Only the buyer can cancel.
  if (purchase.buyer_email !== user.email && user.role !== 'admin') {
    return Response.json({ error: 'Only the buyer can cancel a purchase' }, { status: 403 });
  }

  // Demo purchases have no real payment — no refund path.
  if (purchase.is_demo) {
    await base44.asServiceRole.entities.Purchase.update(purchase.id, { transfer_status: 'expired' }).catch(() => {});
    return Response.json({ status: 'cancelled' });
  }

  const terminal = ['completed', 'expired'];
  if (terminal.includes(purchase.transfer_status)) {
    return Response.json({ error: `Cannot cancel a ${purchase.transfer_status} purchase` }, { status: 409 });
  }
  if (purchase.payment_captured) {
    return Response.json({ error: 'Payment already captured' }, { status: 409 });
  }

  // ── Prevent unsafe cancellation after the seller confirms transfer ────────
  // Once the seller has confirmed, the tickets may already have been sent.
  // A buyer cancellation must NOT immediately cancel/refund the PaymentIntent —
  // it opens a dispute / administrative-review state instead.
  if (purchase.seller_confirmed) {
    await base44.asServiceRole.entities.Purchase.update(purchase.id, {
      transfer_status: 'disputed',
      dispute_reason: 'Buyer cancelled after seller confirmed transfer',
    });

    sendUserNotification(base44, {
      user_email: purchase.seller_email,
      title: 'Buyer cancelled after you confirmed',
      body: 'The buyer cancelled after you confirmed transfer. If you already sent tickets on Ticketmaster/SeatGeek, please contact support immediately. The payment is frozen pending review.',
      type: 'listing_expired',
      purchase_id: purchase.id,
    }).catch(() => {});

    sendTransactionalEmail(base44, 'experience@peanutgallery.store',
      `⚠️ Buyer cancelled after seller confirmed — ${purchase.id}`,
      `Buyer cancelled purchase AFTER seller confirmed transfer. Payment is NOT refunded — dispute opened for admin review.\n\nPurchase: ${purchase.id}\nBuyer: ${purchase.buyer_email}\nSeller: ${purchase.seller_email}\nAmount: $${purchase.amount?.toFixed(2)}\n\nINVESTIGATE: Were tickets already transferred? Contact seller to confirm, then resolve the dispute in the admin panel.`
    ).catch(() => {});

    return Response.json({ status: 'disputed', message: 'Because the seller already confirmed transfer, your request has been opened as a dispute for admin review instead of an automatic refund.' });
  }

  // ── Safe cancellation (before seller confirmed) ───────────────────────────
  const pi = await stripe.paymentIntents.retrieve(purchase.payment_intent_id);
  if (pi.status === 'requires_capture') {
    await stripe.paymentIntents.cancel(purchase.payment_intent_id);
  } else if (pi.status === 'succeeded') {
    await stripe.refunds.create({ payment_intent: purchase.payment_intent_id });
  }

  await base44.asServiceRole.entities.Purchase.update(purchase.id, {
    transfer_status: 'expired',
  });

  // Only restore the listing if it is currently pending_transfer.
  const [currentListing] = await base44.asServiceRole.entities.Listing.filter({ id: purchase.listing_id });
  if (currentListing && currentListing.status === 'pending_transfer') {
    await base44.asServiceRole.entities.Listing.update(purchase.listing_id, {
      status: 'active',
      reservation_token: null,
      reservation_expires_at: null,
      reserved_by_email: null,
    });
  }

  sendUserNotification(base44, {
    user_email: purchase.seller_email,
    title: 'Purchase cancelled',
    body: 'The buyer cancelled their purchase. Your listing has been restored to active.',
    type: 'listing_expired',
    purchase_id: purchase.id,
  }).catch(() => {});

  return Response.json({ status: 'cancelled' });
});