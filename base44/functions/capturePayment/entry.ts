import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';
import Stripe from 'npm:stripe@14.21.0';
import { isMaintenanceActive, maintenance503 } from '../../shared/maintenance.ts';
import { awardPoints, notify, calcPlatformFee } from '../../shared/purchaseNotifications.ts';
import { sendTransactionalEmail } from '../../shared/notifications.ts';
import { recordTerminalOutcome } from '../../shared/recordOutcome.ts';
import { getPurchasePrivate, upsertPurchasePrivate, getListingPrivate, upsertListingPrivate, alertPrivateWriteFailure } from '../../shared/privateData.ts';

/**
 * capturePayment — STRICT state-machine for finalizing a real (non-demo) purchase.
 *
 * THE SINGLE TRUSTED TERMINAL-TRANSITION FUNCTION.
 *
 * CONCURRENCY MODEL (Base44 has NO atomic compare-and-set — proven):
 *   There is no DB-enforced claim available on this platform, so this function
 *   does NOT attempt one. Instead, each operation is safe under concurrency
 *   by construction:
 *     - The Stripe capture itself is exactly-once via `idempotencyKey`
 *       (Stripe enforces it).
 *     - Setting `transfer_status='completed'` / `payment_captured=true` is an
 *       idempotent $set (setting the same value twice is harmless).
 *     - Marking the Listing sold is an idempotent $set.
 *     - Terminal-outcome recording (TransferOutcome, TransferIntelligence,
 *       seller trust, prediction, alert) uses existence checks + DERIVED trust
 *       counters (recomputed, never incremented) — a duplicate invocation
 *       recomputes identical state; any duplicate record it creates is repaired
 *       to exactly-one by reconcilePurchaseOutcomes (eventual exactly-once).
 *     - Points use awardPointsInternal's isDuplicate guard (sequentially safe;
 *       a concurrent double-capture can rarely double-award, repaired by
 *       reconcilePurchaseOutcomes).
 *
 * Stripe PaymentIntent state transition table:
 *   requires_capture     | capture (idempotent), then require finalStatus==='succeeded'
 *                        |   capture throws → payment_capture_failed=true, STOP
 *   succeeded            | continue to completion (already captured)
 *   any other            | return 402 — do NOT complete, do NOT mark listing
 *                        | sold, do NOT award points, do NOT notify either party
 *
 * Only after Stripe confirms `succeeded` do we set payment_captured=true,
 * mark the Purchase completed, mark the Listing sold, record the terminal
 * outcome, award points, and notify.
 */
Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const user = await base44.auth.me();
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  if (isMaintenanceActive()) return maintenance503('Payment capture is temporarily unavailable for scheduled maintenance.');

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

  // Phase 1B: read authoritative buyer/seller identity, payment_intent_id, reservation_token from PurchasePrivate
  const pp = await getPurchasePrivate(base44, purchase.id);
  const authoritativeBuyerEmail = pp?.buyer_email ?? purchase.buyer_email;
  const authoritativeSellerEmail = pp?.seller_email ?? purchase.seller_email;
  const authoritativePaymentIntentId = pp?.payment_intent_id ?? purchase.payment_intent_id;
  const authoritativeReservationToken = pp?.reservation_token ?? purchase.reservation_token;

  if (purchase.is_demo) return Response.json({ error: 'Cannot capture a demo purchase' }, { status: 409 });

  if (purchase.transfer_status === 'completed') return Response.json({ status: 'already_completed' });
  if (purchase.transfer_status === 'disputed') return Response.json({ error: 'Cannot capture payment on a disputed purchase' }, { status: 409 });
  if (purchase.transfer_status === 'expired') return Response.json({ error: 'Cannot capture payment on an expired purchase' }, { status: 409 });

  // Authorization: only the buyer (or admin) may confirm receipt.
  if (authoritativeBuyerEmail !== user.email && user.role !== 'admin') {
    return Response.json({ error: 'Not authorized as buyer' }, { status: 403 });
  }

  // Buyer may not confirm before the seller has confirmed transfer.
  if (!purchase.seller_confirmed) {
    return Response.json({ error: 'Cannot confirm receipt before seller confirms transfer' }, { status: 409 });
  }

  // Set ONLY the buyer-confirmation field.
  await base44.asServiceRole.entities.Purchase.update(purchase.id, { buyer_confirmed: true });

  if (!authoritativePaymentIntentId) {
    console.error('[capturePayment] missing payment_intent_id', purchase.id);
    return Response.json({ error: 'Payment verification failed' }, { status: 500 });
  }

  let pi;
  try {
    pi = await stripe.paymentIntents.retrieve(authoritativePaymentIntentId);
  } catch (err) {
    console.error('[capturePayment] Failed to retrieve PaymentIntent', purchase.id, err?.message);
    return Response.json({ error: 'Payment verification failed' }, { status: 500 });
  }

  // ── Ensure purchase_id is present in Stripe metadata (add if missing) ────
  let md = pi.metadata || {};
  if (md.purchase_id !== purchase.id) {
    if (!md.purchase_id) {
      try {
        const updated = await stripe.paymentIntents.update(authoritativePaymentIntentId, { metadata: { purchase_id: purchase.id } });
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

  // ── Fetch the authoritative Listing + ListingPrivate ──────────────────────
  const [listing] = await base44.asServiceRole.entities.Listing.filter({ id: purchase.listing_id }).catch(() => []);
  if (!listing) {
    return Response.json({ error: 'Listing not found' }, { status: 404 });
  }
  const lp = await getListingPrivate(base44, listing.id);
  const authoritativeListingSeller = lp?.seller_email ?? listing.seller_email;
  const authoritativeListingResToken = lp?.reservation_token ?? listing.reservation_token;
  const authoritativeListingReservedBy = lp?.reserved_by_email ?? listing.reserved_by_email;

  // ── STRICT reservation-ownership verification (all required, no optional) ─
  if (authoritativeListingSeller !== authoritativeSellerEmail) {
    console.error('[capturePayment] Listing seller mismatch', purchase.id, { listingSeller: authoritativeListingSeller, purchaseSeller: authoritativeSellerEmail });
    return Response.json({ error: 'Payment verification failed' }, { status: 500 });
  }
  if (md.purchase_id !== purchase.id) {
    console.error('[capturePayment] metadata purchase_id mismatch', purchase.id);
    return Response.json({ error: 'Payment verification failed' }, { status: 500 });
  }
  if (!md.reservation_token || !authoritativeReservationToken || md.reservation_token !== authoritativeReservationToken) {
    console.error('[capturePayment] PI reservation token mismatch/missing', purchase.id);
    return Response.json({ error: 'Payment verification failed' }, { status: 500 });
  }
  if (!authoritativeReservationToken || !authoritativeListingResToken || authoritativeReservationToken !== authoritativeListingResToken) {
    console.error('[capturePayment] Listing reservation token mismatch/missing', purchase.id);
    return Response.json({ error: 'Payment verification failed' }, { status: 500 });
  }
  if (listing.status !== 'pending_transfer' || authoritativeListingReservedBy !== authoritativeBuyerEmail) {
    console.error('[capturePayment] Listing not in pending state for this buyer', purchase.id, { status: listing.status, reservedBy: authoritativeListingReservedBy });
    return Response.json({ error: 'Payment verification failed' }, { status: 500 });
  }

  const metadataMatches =
    md.listing_id === purchase.listing_id &&
    md.event_id === (purchase.event_id || '') &&
    md.buyer_email === authoritativeBuyerEmail &&
    md.seller_email === authoritativeSellerEmail;
  if (!metadataMatches) {
    console.error('[capturePayment] Stripe metadata mismatch', purchase.id, { md, purchase });
    return Response.json({ error: 'Payment verification failed' }, { status: 500 });
  }

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
  const sellerUsersList = await base44.asServiceRole.entities.User.filter({ email: authoritativeSellerEmail }).catch(() => []);
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
      // Phase 1B: mirror payment_capture_failed to PurchasePrivate (authoritative)
      try {
        await upsertPurchasePrivate(base44, purchase.id, { payment_capture_failed: true });
      } catch (err) {
        await alertPrivateWriteFailure(base44, { entity: 'PurchasePrivate', reference_id: purchase.id, reference_type: 'purchase', error: err });
      }
      sendTransactionalEmail(base44, 'experience@peanutgallery.store',
        `🚨 Stripe Capture Failed — Purchase ${purchase.id}`,
        `Stripe payment capture failed.\n\nPurchase: ${purchase.id}\nBuyer: ${authoritativeBuyerEmail}\nSeller: ${authoritativeSellerEmail}\nAmount: $${purchase.amount?.toFixed(2)}\nError: ${stripeErr?.message}\n\nReview and retry capture in Stripe dashboard.`
      ).catch(() => {});
      return Response.json({ error: 'Payment capture failed. Our team has been notified.' }, { status: 500 });
    }
  }

  if (finalStatus !== 'succeeded') {
    console.error('[capturePayment] PI not in succeeded state:', purchase.id, finalStatus);
    return Response.json({ error: `Payment not completed (status: ${finalStatus}). No charge was finalized.` }, { status: 402 });
  }

  // ── Stripe confirmed success — finalize (idempotent $sets) ─────────────────
  await base44.asServiceRole.entities.Purchase.update(purchase.id, {
    transfer_status: 'completed',
    payment_captured: true,
    payment_capture_failed: false,
  });
  // Phase 1B: mirror payment_captured + payment_capture_failed to PurchasePrivate (authoritative)
  // Financial terminal action — must not report success unless private and legacy agree.
  try {
    await upsertPurchasePrivate(base44, purchase.id, { payment_captured: true, payment_capture_failed: false });
  } catch (err) {
    await alertPrivateWriteFailure(base44, { entity: 'PurchasePrivate', reference_id: purchase.id, reference_type: 'purchase', error: err });
    return Response.json({ error: 'Payment captured but record sync failed. Please contact support.' }, { status: 500 });
  }

  // Phase 1B: mirror Listing reservation clear to ListingPrivate (authoritative), then legacy
  try {
    await upsertListingPrivate(base44, purchase.listing_id, {
      reserved_by_email: null, reservation_token: null, reservation_expires_at: null,
    });
  } catch (err) {
    await alertPrivateWriteFailure(base44, { entity: 'ListingPrivate', reference_id: purchase.listing_id, reference_type: 'listing', error: err });
  }
  await base44.asServiceRole.entities.Listing.update(purchase.listing_id, {
    status: 'sold',
    reservation_token: null,
    reservation_expires_at: null,
    reserved_by_email: null,
  }).catch(() => {});

  // ── Record the terminal outcome (shared, idempotent). Pass authoritative
  //    private values so trust/intelligence records use the correct identities.
  try {
    await recordTerminalOutcome(base44, { ...purchase, buyer_email: authoritativeBuyerEmail, seller_email: authoritativeSellerEmail });
  } catch (err) {
    console.error('[capturePayment] recordTerminalOutcome failed (automation/reconciliation will repair)', purchase.id, err?.message);
  }

  const isSelfPurchase = authoritativeSellerEmail === authoritativeBuyerEmail;
  if (isSelfPurchase) {
    console.warn('[capturePayment] SELF-PURCHASE DETECTED — blocking point awards:', purchase.id);
  } else {
    awardPoints(base44, authoritativeSellerEmail, 'sale_completed', purchase.id, 'purchase');
    awardPoints(base44, authoritativeBuyerEmail, 'purchase', purchase.id, 'purchase');
  }

  notify(base44, authoritativeSellerEmail, 'Sale complete 💸', 'Your payout is processing. Stripe deposits typically take 2–7 business days. First-time payouts may take up to 14 days.', 'sale_complete', purchase.id);
  notify(base44, authoritativeBuyerEmail, 'Transfer confirmed ✅', 'You confirmed receiving your tickets. Payment has been released to the seller. Enjoy the show!', 'buyer_confirmed', purchase.id);

  if (purchase.seller_confirmed_at) {
    const sentAt = new Date(purchase.seller_confirmed_at).getTime();
    const hoursElapsed = (Date.now() - sentAt) / 3600000;
    if (hoursElapsed <= 1 && !isSelfPurchase) {
      awardPoints(base44, authoritativeBuyerEmail, 'buyer_confirm_1hr', purchase.id, 'purchase');
    }
  }

  return Response.json({ status: 'completed', payment_captured: true, optimistic_id });
});