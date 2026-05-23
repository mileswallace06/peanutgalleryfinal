import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';
import Stripe from 'npm:stripe@14.21.0';

// Fire-and-forget email helper — never throws
async function sendEmail(base44, to, subject, body) {
  try {
    await base44.asServiceRole.functions.invoke('sendNotificationEmail', { to, subject, body });
  } catch (err) {
    console.error('[capturePayment] email failed to', to, '|', err?.message);
  }
}

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

    // ── Email: sale complete → notify seller ────────────────────────────────
    sendEmail(
      base44,
      purchase.seller_email,
      'Sale complete — your payout is processing 💸',
      `Hi,\n\nYour sale on Peanut Gallery is complete!\n\nBuyer: ${purchase.buyer_name || purchase.buyer_email}\nPurchase ID: ${purchase.id}\nAmount: $${purchase.amount?.toFixed(2)}\n\nThe buyer confirmed receipt of their tickets. Your payout of $${purchase.seller_payout?.toFixed(2)} is now processing via Stripe.\n\nPayouts typically arrive in 2–5 business days depending on your Stripe Express settings.\n\n— Peanut Gallery`
    );

    return Response.json({ status: 'completed', payment_captured: true, optimistic_id: optimistic_id });
  }

  // ── Email: mid-flow notifications ───────────────────────────────────────
  if (confirming_role === 'seller') {
    // Seller just confirmed transfer → notify buyer to check their email/app
    sendEmail(
      base44,
      purchase.buyer_email,
      'Your tickets were sent 🎟️',
      `Hi ${purchase.buyer_name || ''},\n\nGood news — the seller just confirmed they've transferred your tickets!\n\nCheck your email and your ticket app (Ticketmaster, SeatGeek, StubHub, etc.) for the transfer invite.\n\nOnce you've received the tickets, open the Peanut Gallery app and tap "I Received My Tickets" to release payment to the seller.\n\nPurchase ID: ${purchase.id}\n\nQuestions? Reply to this email.\n\n— Peanut Gallery`
    );
  }

  return Response.json({
    status: 'confirmed',
    buyer_confirmed: updatedBuyerConfirmed,
    seller_confirmed: updatedSellerConfirmed,
    optimistic_id: optimistic_id
  });
});