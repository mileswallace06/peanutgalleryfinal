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
  const { purchase_id, confirming_role, optimistic_id } = await req.json();

  if (!purchase_id || !confirming_role) {
    return Response.json({ error: 'purchase_id and confirming_role are required' }, { status: 400 });
  }

  const purchases = await base44.asServiceRole.entities.Purchase.filter({ id: purchase_id });
  const purchase = purchases[0];
  if (!purchase) {
    return Response.json({ error: 'Purchase not found' }, { status: 404 });
  }

  if (purchase.transfer_status === 'completed') {
    return Response.json({ status: 'already_completed' });
  }

  if (purchase.transfer_status === 'disputed') {
    return Response.json({ error: 'Cannot capture payment on a disputed purchase' }, { status: 409 });
  }

  // Update the confirming party
  const update = {};
  if (confirming_role === 'seller') {
    if (purchase.seller_email !== user.email && user.role !== 'admin') {
      return Response.json({ error: 'Not authorized as seller' }, { status: 403 });
    }
    update.seller_confirmed = true;
  } else if (confirming_role === 'buyer') {
    if (purchase.buyer_email !== user.email && user.role !== 'admin') {
      return Response.json({ error: 'Not authorized as buyer' }, { status: 403 });
    }
    update.buyer_confirmed = true;
  } else {
    return Response.json({ error: 'confirming_role must be buyer or seller' }, { status: 400 });
  }

  await base44.asServiceRole.entities.Purchase.update(purchase.id, update);

  const updatedBuyerConfirmed = confirming_role === 'buyer' ? true : purchase.buyer_confirmed;
  const updatedSellerConfirmed = confirming_role === 'seller' ? true : purchase.seller_confirmed;

  if (updatedBuyerConfirmed && updatedSellerConfirmed) {
    // Capture the payment
    const pi = await stripe.paymentIntents.retrieve(purchase.payment_intent_id);
    if (pi.status === 'requires_capture') {
      await stripe.paymentIntents.capture(purchase.payment_intent_id);
    }

    await base44.asServiceRole.entities.Purchase.update(purchase.id, {
      transfer_status: 'completed',
      payment_captured: true
    });
    await base44.asServiceRole.entities.Listing.update(purchase.listing_id, { status: 'sold' });

    return Response.json({ status: 'completed', payment_captured: true, optimistic_id: optimistic_id });
  }

  return Response.json({
    status: 'confirmed',
    buyer_confirmed: updatedBuyerConfirmed,
    seller_confirmed: updatedSellerConfirmed,
    optimistic_id: optimistic_id
  });
});