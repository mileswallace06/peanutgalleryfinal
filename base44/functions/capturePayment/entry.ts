import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';
import Stripe from 'npm:stripe@14.21.0';
import { awardPoints, notify, calcPlatformFee } from '../../shared/purchaseNotifications.ts';

/**
 * capturePayment — STRICT state-machine for finalizing a real (non-demo) purchase.
 *
 * Stripe PaymentIntent state transition table:
 *
 *   PI status            | Action
 *   -------------------- + ----------------------------------------------------
 *   requires_capture     | capture (idempotent), then require finalStatus==='succeeded'
 *                        |   capture throws   → error, payment_capture_failed=true, STOP
 *   succeeded            | continue to completion (already captured)
 *   requires_payment_method / requires_confirmation / requires_action /
 *   processing / canceled / any other
 *                        | return 402 error — do NOT complete, do NOT mark listing
 *                        | sold, do NOT award points, do NOT notify either party
 *
 * Only after Stripe confirms `succeeded` do we set payment_captured=true,
 * mark the Purchase completed, mark the Listing sold, award points, and notify.
 */
Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const user = await base44.auth.me();
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  const secretKey = Deno.env.get('STRIPELIVESECRETKEY');
  if (!secretKey || (!secretKey.startsWith('sk_test_') && !secretKey.startsWith('sk_live_'))) {
    return Response.json({ error: 'Stripe secret key misconfigured' }, { status: 500 });
  }
  const stripe = new Stripe(secretKey);

  const { purchase_id, optimistic_id } = await req.json();
  if (!purchase_id) return Response.json({ error: 'purchase_id is required' }, { status: 400 });

  // ── Re-fetch the authoritative Purchase ──────────────────────────────────
  const [purchase] = await base44.asServiceRole.entities.Purchase.filter({ id: purchase_id });
  if (!purchase) return Response.json({ error: 'Purchase not found' }, { status: 404 });

  if (purchase.is_demo) return Response.json({ error: 'Cannot capture a demo purchase' }, { status: 409 });

  if (purchase.transfer_status === 'completed') return Response.json({ status: 'already_completed' });
  if (purchase.transfer_status === 'disputed') return Response.json({ error: 'Cannot capture payment on a disputed purchase' }, { status: 409 });
  if (purchase.transfer_status === 'expired') return Response.json({ error: 'Cannot capture payment on an expired purchase' }, { status: 409 });

  // Authorization: only the buyer (or admin) may confirm receipt.
  if (purchase.buyer_email !== user.email && user.role !== 'admin') {
    return Response.json({ error: 'Not authorized as buyer' }, { status: 403 });
  }

  // Buyer may not confirm before the seller has confirmed transfer.
  if (!purchase.seller_confirmed) {
    return Response.json({ error: 'Cannot confirm receipt before seller confirms transfer' }, { status: 409 });
  }

  // Set ONLY the buyer-confirmation field.
  await base44.asServiceRole.entities.Purchase.update(purchase.id, { buyer_confirmed: true });

  // Atomic guard: re-fetch before capturing to prevent double-charge.
  const [freshPurchase] = await base44.asServiceRole.entities.Purchase.filter({ id: purchase.id });
  if (freshPurchase?.payment_captured === true || freshPurchase?.transfer_status === 'completed') {
    return Response.json({ status: 'already_completed' });
  }

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

  // ── Ensure purchase_id is present in Stripe metadata (add if missing) ────
  let md = pi.metadata || {};
  if (md.purchase_id !== purchase.id) {
    if (!md.purchase_id) {
      try {
        const updated = await stripe.paymentIntents.update(purchase.payment_intent_id, { metadata: { purchase_id: purchase.id } });
        md = updated.metadata || md;
        md.purchase_id = purchase.id;
      } catch (err) {
        console.error('[capturePayment] Failed to set purchase_id metadata', purchase.id, err?.message);
        return Response.json({ error: 'Payment verification failed' }, { status: 500 });
      }
    } else {
      console.error('[capturePayment] metadata purchase_id mismatch', purchase.id, { md_pid: md.purchase_id });
      return Response.json({ error: 'Payment verification failed' }, { status: 500 });
    }
  }

  // ── Fetch the authoritative Listing ──────────────────────────────────────
  const [listing] = await base44.asServiceRole.entities.Listing.filter({ id: purchase.listing_id }).catch(() => []);
  if (!listing) return Response.json({ error: 'Listing not found' }, { status: 404 });

  // ── STRICT reservation-ownership verification (all required, no optional) ─
  // 1. Listing ID matches Purchase (asserted by the filter above).
  // 2. Listing seller matches Purchase seller.
  if (listing.seller_email !== purchase.seller_email) {
    console.error('[capturePayment] Listing seller mismatch', purchase.id, { listingSeller: listing.seller_email, purchaseSeller: purchase.seller_email });
    return Response.json({ error: 'Payment verification failed' }, { status: 500 });
  }
  // 3. PI metadata Purchase ID matches the Purchase.
  if (md.purchase_id !== purchase.id) {
    console.error('[capturePayment] metadata purchase_id mismatch', purchase.id);
    return Response.json({ error: 'Payment verification failed' }, { status: 500 });
  }
  // 4. PI reservation token matches the Purchase's stored reservation token (both must exist).
  if (!md.reservation_token || !purchase.reservation_token || md.reservation_token !== purchase.reservation_token) {
    console.error('[capturePayment] PI reservation token mismatch/missing', purchase.id);
    return Response.json({ error: 'Payment verification failed' }, { status: 500 });
  }
  // 5. Purchase reservation token matches the Listing reservation token (both must exist).
  if (!purchase.reservation_token || !listing.reservation_token || purchase.reservation_token !== listing.reservation_token) {
    console.error('[capturePayment] Listing reservation token mismatch/missing', purchase.id);
    return Response.json({ error: 'Payment verification failed' }, { status: 500 });
  }
  // 6. Listing is still in the correct pending state for this Purchase.
  if (listing.status !== 'pending_transfer' || listing.reserved_by_email !== purchase.buyer_email) {
    console.error('[capturePayment] Listing not in pending state for this buyer', purchase.id, { status: listing.status, reservedBy: listing.reserved_by_email });
    return Response.json({ error: 'Payment verification failed' }, { status: 500 });
  }

  // Verify Stripe metadata matches the authoritative Purchase + Listing.
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
  if (Math.round((purchase.amount || 0) * 100) !== expectedAmountCents) {
    console.error('[capturePayment] Purchase amount mismatch', purchase.id, { stored: purchase.amount, expected: expectedBuyerTotal });
    return Response.json({ error: 'Payment verification failed' }, { status: 500 });
  }

  // ── STRICT Stripe destination verification ───────────────────────────────
  // For real non-demo purchases where the seller has a Stripe Connect account,
  // the PaymentIntent MUST route funds to that seller's connected account.
  // Both the existence and exact match are required.
  const sellerUsersList = await base44.asServiceRole.entities.User.filter({ email: purchase.seller_email }).catch(() => []);
  const sellerRecord = sellerUsersList[0];
  const sellerStripeAccountId = sellerRecord?.stripe_account_id || null;
  if (sellerStripeAccountId) {
    if (!pi.transfer_data?.destination) {
      console.error('[capturePayment] Missing transfer_data.destination for connected seller', purchase.id, { seller: sellerStripeAccountId });
      return Response.json({ error: 'Payment verification failed' }, { status: 500 });
    }
    if (pi.transfer_data.destination !== sellerStripeAccountId) {
      console.error('[capturePayment] Destination account mismatch', purchase.id, { piDest: pi.transfer_data.destination, seller: sellerStripeAccountId });
      return Response.json({ error: 'Payment verification failed' }, { status: 500 });
    }
  }
  // NOTE: admin/test listings created without a connected destination (no
  // sellerStripeAccountId) are permitted — createCheckout allows checkout for
  // test/admin listings (notes include [TEST] or seller.role === 'admin') with
  // no transfer_data. There is no destination to verify for those.

  // ── STRICT state transition: capture (if needed) then require success ─────
  let finalStatus = pi.status;
  if (pi.status === 'requires_capture') {
    try {
      const captured = await stripe.paymentIntents.capture(purchase.payment_intent_id, {
        idempotencyKey: `capture-${purchase.id}`,
      });
      finalStatus = captured.status;
    } catch (stripeErr) {
      console.error('[capturePayment] Stripe capture FAILED:', purchase.id, stripeErr?.message);
      await base44.asServiceRole.entities.Purchase.update(purchase.id, { payment_capture_failed: true }).catch(() => {});
      base44.asServiceRole.functions.invoke('sendNotificationEmail', {
        to: 'experience@peanutgallery.store',
        subject: `🚨 Stripe Capture Failed — Purchase ${purchase.id}`,
        body: `Stripe payment capture failed.\n\nPurchase: ${purchase.id}\nBuyer: ${purchase.buyer_email}\nSeller: ${purchase.seller_email}\nAmount: $${purchase.amount?.toFixed(2)}\nError: ${stripeErr?.message}\n\nReview and retry capture in Stripe dashboard.`,
      }).catch(() => {});
      return Response.json({ error: 'Payment capture failed. Our team has been notified.' }, { status: 500 });
    }
  }

  // Require confirmed success before completing. Any non-succeeded state
  // (requires_payment_method / requires_confirmation / requires_action /
  // processing / canceled / anything else) blocks completion entirely.
  if (finalStatus !== 'succeeded') {
    console.error('[capturePayment] PI not in succeeded state:', purchase.id, finalStatus);
    // Do NOT mark completed. Do NOT mark listing sold. Do NOT award points.
    // Do NOT notify. Do NOT set payment_capture_failed (non-success is not a
    // hard capture failure — the webhook may still report success later).
    return Response.json({ error: `Payment not completed (status: ${finalStatus}). No charge was finalized.` }, { status: 402 });
  }

  // ── Stripe confirmed success — finalize ──────────────────────────────────
  await base44.asServiceRole.entities.Purchase.update(purchase.id, {
    transfer_status: 'completed',
    payment_captured: true,
    payment_capture_failed: false,
  });

  await base44.asServiceRole.entities.Listing.update(purchase.listing_id, {
    status: 'sold',
    reservation_token: null,
    reservation_expires_at: null,
    reserved_by_email: null,
  }).catch(() => {});

  const isSelfPurchase = purchase.seller_email === purchase.buyer_email;
  if (isSelfPurchase) {
    console.warn('[capturePayment] SELF-PURCHASE DETECTED — blocking point awards:', purchase.id);
  } else {
    awardPoints(base44, purchase.seller_email, 'sale_completed', purchase.id, 'purchase');
    awardPoints(base44, purchase.buyer_email, 'purchase', purchase.id, 'purchase');
  }

  notify(base44, purchase.seller_email, 'Sale complete 💸', 'Your payout is processing. Stripe deposits typically take 2–7 business days. First-time payouts may take up to 14 days.', 'sale_complete', purchase.id);
  notify(base44, purchase.buyer_email, 'Transfer confirmed ✅', 'You confirmed receiving your tickets. Payment has been released to the seller. Enjoy the show!', 'buyer_confirmed', purchase.id);

  if (purchase.seller_confirmed_at) {
    const sentAt = new Date(purchase.seller_confirmed_at).getTime();
    const hoursElapsed = (Date.now() - sentAt) / 3600000;
    if (hoursElapsed <= 1 && !isSelfPurchase) {
      awardPoints(base44, purchase.buyer_email, 'buyer_confirm_1hr', purchase.id, 'purchase');
    }
  }

  return Response.json({ status: 'completed', payment_captured: true, optimistic_id });
});