import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';
import Stripe from 'npm:stripe@14.21.0';
import { awardPoints, notify, calcPlatformFee } from '../../shared/purchaseNotifications.ts';

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
  const { purchase_id, optimistic_id } = await req.json();

  if (!purchase_id) {
    return Response.json({ error: 'purchase_id is required' }, { status: 400 });
  }

  // ── Re-fetch the authoritative Purchase ──────────────────────────────────
  const purchases = await base44.asServiceRole.entities.Purchase.filter({ id: purchase_id });
  const purchase = purchases[0];
  if (!purchase) {
    return Response.json({ error: 'Purchase not found' }, { status: 404 });
  }

  // Demo purchases are never captured.
  if (purchase.is_demo) {
    return Response.json({ error: 'Cannot capture a demo purchase' }, { status: 409 });
  }

  if (purchase.transfer_status === 'completed') {
    return Response.json({ status: 'already_completed' });
  }
  if (purchase.transfer_status === 'disputed') {
    return Response.json({ error: 'Cannot capture payment on a disputed purchase' }, { status: 409 });
  }
  if (purchase.transfer_status === 'expired') {
    return Response.json({ error: 'Cannot capture payment on an expired purchase' }, { status: 409 });
  }

  // ── Authorization: only the buyer (or admin) may confirm receipt ──────────
  if (purchase.buyer_email !== user.email && user.role !== 'admin') {
    return Response.json({ error: 'Not authorized as buyer' }, { status: 403 });
  }

  // Buyer may not confirm before the seller has confirmed transfer.
  if (!purchase.seller_confirmed) {
    return Response.json({ error: 'Cannot confirm receipt before seller confirms transfer' }, { status: 409 });
  }

  // Set ONLY the buyer-confirmation field.
  await base44.asServiceRole.entities.Purchase.update(purchase.id, { buyer_confirmed: true });

  // If the seller has not yet confirmed, there is nothing to capture yet.
  if (!purchase.seller_confirmed) {
    return Response.json({ status: 'confirmed', buyer_confirmed: true, seller_confirmed: false, optimistic_id });
  }

  // ── Both confirmations present — verify + capture ─────────────────────────
  // Atomic guard: re-fetch before capturing to prevent double-charge.
  const [freshPurchase] = await base44.asServiceRole.entities.Purchase.filter({ id: purchase.id });
  if (freshPurchase?.payment_captured === true || freshPurchase?.transfer_status === 'completed') {
    return Response.json({ status: 'already_completed' });
  }

  // Re-fetch the authoritative Listing to verify reservation + seller.
  const [listing] = await base44.asServiceRole.entities.Listing.filter({ id: purchase.listing_id }).catch(() => []);
  if (!listing) {
    return Response.json({ error: 'Listing not found' }, { status: 404 });
  }

  // ── Verify the Stripe PaymentIntent matches the Purchase ──────────────────
  if (!purchase.payment_intent_id || purchase.payment_intent_id !== freshPurchase.payment_intent_id) {
    console.error('[capturePayment] PaymentIntent id mismatch', purchase.id);
    return Response.json({ error: 'Payment verification failed' }, { status: 500 });
  }

  let pi;
  try {
    pi = await stripe.paymentIntents.retrieve(purchase.payment_intent_id);
  } catch (err) {
    console.error('[capturePayment] Failed to retrieve PaymentIntent', purchase.id, err?.message);
    return Response.json({ error: 'Payment verification failed' }, { status: 500 });
  }

  // Verify Stripe metadata matches the authoritative Purchase + Listing.
  const md = pi.metadata || {};
  const metadataMatches =
    md.listing_id === purchase.listing_id &&
    md.event_id === (purchase.event_id || '') &&
    md.buyer_email === purchase.buyer_email &&
    md.seller_email === purchase.seller_email;
  if (!metadataMatches) {
    console.error('[capturePayment] Stripe metadata mismatch', purchase.id, { md, purchase });
    return Response.json({ error: 'Payment verification failed' }, { status: 500 });
  }

  // Verify amount + currency match the server-calculated values.
  const expectedSubtotal = Math.round(listing.asking_price * (listing.quantity || 1) * 100) / 100;
  const expectedPlatformFee = calcPlatformFee(expectedSubtotal);
  const expectedBuyerTotal = Math.round((expectedSubtotal + expectedPlatformFee) * 100) / 100;
  const expectedAmountCents = Math.round(expectedBuyerTotal * 100);
  if (pi.amount !== expectedAmountCents || (pi.currency || 'usd') !== 'usd') {
    console.error('[capturePayment] Amount/currency mismatch', purchase.id, { piAmount: pi.amount, expected: expectedAmountCents, currency: pi.currency });
    return Response.json({ error: 'Payment verification failed' }, { status: 500 });
  }
  // Cross-check the Purchase's stored amount against the recalculated value.
  if (Math.round((purchase.amount || 0) * 100) !== expectedAmountCents) {
    console.error('[capturePayment] Purchase amount mismatch', purchase.id, { stored: purchase.amount, expected: expectedBuyerTotal });
    return Response.json({ error: 'Payment verification failed' }, { status: 500 });
  }

  // Verify the connected Stripe account matches the seller on the Listing.
  const sellerUsersList = await base44.asServiceRole.entities.User.filter({ email: purchase.seller_email }).catch(() => []);
  const sellerRecord = sellerUsersList[0];
  const sellerStripeAccountId = sellerRecord?.stripe_account_id || null;
  if (sellerStripeAccountId && pi.transfer_data?.destination && pi.transfer_data.destination !== sellerStripeAccountId) {
    console.error('[capturePayment] Seller account mismatch', purchase.id, { piDest: pi.transfer_data.destination, seller: sellerStripeAccountId });
    return Response.json({ error: 'Payment verification failed' }, { status: 500 });
  }

  // Verify the reservation token on the Listing matches the PaymentIntent metadata.
  if (md.reservation_token && listing.reservation_token && md.reservation_token !== listing.reservation_token) {
    console.error('[capturePayment] Reservation token mismatch', purchase.id);
    return Response.json({ error: 'Payment verification failed' }, { status: 500 });
  }

  // ── Capture (idempotent) ───────────────────────────────────────────────────
  if (pi.status === 'requires_capture') {
    try {
      await stripe.paymentIntents.capture(purchase.payment_intent_id, {
        idempotencyKey: `capture-${purchase.id}`,
      });
    } catch (stripeErr) {
      console.error('[capturePayment] Stripe capture FAILED:', purchase.id, stripeErr?.message);
      await base44.asServiceRole.entities.Purchase.update(purchase.id, {
        payment_capture_failed: true,
      }).catch(() => {});
      base44.asServiceRole.functions.invoke('sendNotificationEmail', {
        to: 'experience@peanutgallery.store',
        subject: `🚨 Stripe Capture Failed — Purchase ${purchase.id}`,
        body: `Stripe payment capture failed.\n\nPurchase: ${purchase.id}\nBuyer: ${purchase.buyer_email}\nSeller: ${purchase.seller_email}\nAmount: $${purchase.amount?.toFixed(2)}\nError: ${stripeErr?.message}\n\nReview and retry capture in Stripe dashboard.`,
      }).catch(() => {});
      return Response.json({ error: 'Payment capture failed. Our team has been notified.' }, { status: 500 });
    }
  } else if (pi.status !== 'succeeded') {
    console.warn('[capturePayment] PI in unexpected state:', pi.status, purchase.payment_intent_id);
  }

  // Stripe capture succeeded — now mark DB complete.
  await base44.asServiceRole.entities.Purchase.update(purchase.id, {
    transfer_status: 'completed',
    payment_captured: true,
    payment_capture_failed: false,
  });

  // Clear listing reservation and mark sold.
  await base44.asServiceRole.entities.Listing.update(purchase.listing_id, {
    status: 'sold',
    reservation_token: null,
    reservation_expires_at: null,
    reserved_by_email: null,
  }).catch(() => {});

  // Award points only if not a self-purchase.
  const isSelfPurchase = purchase.seller_email === purchase.buyer_email;
  if (isSelfPurchase) {
    console.warn('[capturePayment] SELF-PURCHASE DETECTED — blocking point awards:', purchase.id);
  } else {
    awardPoints(base44, purchase.seller_email, 'sale_completed', purchase.id, 'purchase');
    awardPoints(base44, purchase.buyer_email, 'purchase', purchase.id, 'purchase');
  }

  notify(base44, purchase.seller_email, 'Sale complete 💸', 'Your payout is processing. Stripe deposits typically take 2–7 business days. First-time payouts may take up to 14 days.', 'sale_complete', purchase.id);
  notify(base44, purchase.buyer_email, 'Transfer confirmed ✅', 'You confirmed receiving your tickets. Payment has been released to the seller. Enjoy the show!', 'buyer_confirmed', purchase.id);

  // Quick buyer confirm bonus (within 1 hour of seller confirm).
  if (purchase.seller_confirmed_at) {
    const sentAt = new Date(purchase.seller_confirmed_at).getTime();
    const hoursElapsed = (Date.now() - sentAt) / 3600000;
    if (hoursElapsed <= 1 && !isSelfPurchase) {
      awardPoints(base44, purchase.buyer_email, 'buyer_confirm_1hr', purchase.id, 'purchase');
    }
  }

  return Response.json({ status: 'completed', payment_captured: true, optimistic_id });
});