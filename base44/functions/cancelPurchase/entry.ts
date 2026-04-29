import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';
import Stripe from 'npm:stripe@14.21.0';

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const user = await base44.auth.me();
  if (!user) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const secretKey = Deno.env.get('STRIPE_SECRET_KEY');
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
  await base44.asServiceRole.entities.Listing.update(purchase.listing_id, { status: 'active' });

  return Response.json({ status: 'cancelled' });
});