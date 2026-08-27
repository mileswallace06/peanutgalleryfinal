/**
 * cancelPurchase — Buyer-initiated purchase cancellation.
 *
 * P0-01L: Canary-eligible synthetic [AUTH_CANARY] purchases are routed to the
 * authority-backed cancel-purchase canary orchestrator (Postgres authoritative,
 * Base44 mirror-only). The canary path handles PRE-CAPTURE cancellation only:
 *   - authority 'reserved' (authorized but uncaptured PI) → begin_cancel →
 *     shared Stripe cancel provider → record_cancel_result
 *   - authority 'frozen' (capture in-flight) → fail closed
 *   - authority 'sold' (captured) → structured conflict + incident (out of scope)
 *   - All pre-capture cancels → cancel money + quarantine (never relist)
 *
 * All non-canary traffic and flag-OFF behavior remains identical to the legacy
 * path. The canary route is wired BEFORE the maintenance gate; the legacy path
 * is unchanged.
 *
 * The canary path uses base44:runtime secrets (no Deno.env), executor for
 * command initiation, recorder for provider results, no admin fallback, and
 * no test-controlled production bypass (trusted canaryEnabled DI).
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';
import { secrets } from 'base44:runtime';
import Stripe from 'npm:stripe@14.21.0';
import { isMaintenanceActive, maintenance503 } from '../../shared/maintenance.ts';
import { sendUserNotification, sendTransactionalEmail } from '../../shared/notifications.ts';
import { getPurchasePrivate, upsertPurchasePrivate, upsertListingPrivate, alertPrivateWriteFailure } from '../../shared/privateData.ts';
import { isCanaryEnabled } from '../../shared/authCanary.js';
import { maybeRouteCanaryCancelPurchase } from '../../shared/cancelPurchaseCanaryOrchestrator.js';
import { createStripeCancelProvider } from '../../shared/stripeCancelProvider.js';

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const user = await base44.auth.me();
  if (!user) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { purchase_id } = await req.json().catch(() => ({}));
  if (!purchase_id) {
    return Response.json({ error: 'purchase_id is required' }, { status: 400 });
  }

  // ── Fetch purchase + listing for canary eligibility check (before maintenance) ──
  let purchase: any = null;
  try {
    const [p] = await base44.asServiceRole.entities.Purchase.filter({ id: purchase_id });
    purchase = p || null;
  } catch (_) {}

  let listing: any = null;
  if (purchase?.listing_id) {
    try {
      const [l] = await base44.asServiceRole.entities.Listing.filter({ id: purchase.listing_id });
      listing = l || null;
    } catch (_) {}
  }

  // ── Canary route (synthetic [AUTH_CANARY] listings only) — before maintenance gate ──
  // Returns null for normal listings → fall through to the maintenance-gated
  // legacy path. Returns {status, body} for any canary-eligible or canary-rejected
  // request — synthetic listings never reach the normal path.
  if (listing && purchase) {
    const executorUrl = secrets.get('AUTHORITY_V1_DB_URL_DEV_EXECUTOR');
    const recorderUrl = secrets.get('AUTHORITY_V1_DB_URL_DEV_STRIPE_RECORDER');
    const secretKey = secrets.get('STRIPE_SECRET_KEY');
    const stripeAdapter = secretKey ? createStripeCancelProvider(secretKey) : null;

    // Idempotent notification callback — only called after authoritative commitment.
    // action_id is a stable deduplication key. All cancel-quarantine notifications
    // use type 'cancel_quarantined' — the listing is NEVER relisted.
    const sendNotification = async (info: any) => {
      if (info.type === 'cancel_quarantined') {
        const sellerEmail = purchase.seller_email;
        if (sellerEmail) {
          await sendUserNotification(base44, {
            user_email: sellerEmail,
            title: 'Buyer cancelled — listing quarantined',
            body: 'The buyer cancelled their purchase. Payment was canceled but your listing is quarantined pending transfer resolution. Please contact support.',
            type: 'listing_expired',
            purchase_id: purchase.id,
          }).catch(() => {});
        }
      }
    };

    const canaryResult = await maybeRouteCanaryCancelPurchase({
      base44, user, listing, purchase,
      executorUrl, recorderUrl,
      stripeAdapter,
      canaryEnabled: isCanaryEnabled(),
      sendNotification,
    });
    if (canaryResult) return Response.json(canaryResult.body, { status: canaryResult.status });
  }

  // ── Legacy path (non-canary traffic + flag-OFF) — unchanged ──────────────
  if (isMaintenanceActive()) return maintenance503('Purchase cancellation is temporarily unavailable for scheduled maintenance.');

  const secretKey = Deno.env.get('STRIPELIVESECRETKEY');
  if (!secretKey || (!secretKey.startsWith('sk_test_') && !secretKey.startsWith('sk_live_'))) {
    return Response.json({ error: 'Stripe secret key misconfigured' }, { status: 500 });
  }

  const stripe = new Stripe(secretKey);

  if (!purchase) {
    return Response.json({ error: 'Purchase not found' }, { status: 404 });
  }

  // Phase 1B: read authoritative buyer/seller identity, payment_intent_id, payment_captured from PurchasePrivate
  const pp = await getPurchasePrivate(base44, purchase.id);
  const authoritativeBuyerEmail = pp?.buyer_email ?? purchase.buyer_email;
  const authoritativeSellerEmail = pp?.seller_email ?? purchase.seller_email;
  const authoritativePaymentIntentId = pp?.payment_intent_id ?? purchase.payment_intent_id;
  const authoritativePaymentCaptured = pp?.payment_captured ?? purchase.payment_captured;

  // Only the buyer can cancel.
  if (authoritativeBuyerEmail !== user.email && user.role !== 'admin') {
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
  if (authoritativePaymentCaptured) {
    return Response.json({ error: 'Payment already captured' }, { status: 409 });
  }

  // ── Prevent unsafe cancellation after the seller confirms transfer ────────
  // Once the seller has confirmed, the tickets may already have been sent.
  // A buyer cancellation must NOT immediately cancel/refund the PaymentIntent —
  // it opens a dispute / administrative-review state instead.
  if (purchase.seller_confirmed) {
    const disputeReason = 'Buyer cancelled after seller confirmed transfer';
    await base44.asServiceRole.entities.Purchase.update(purchase.id, {
      transfer_status: 'disputed',
      dispute_reason: disputeReason,
    });
    // Phase 1B: mirror dispute_reason to PurchasePrivate (authoritative)
    try {
      await upsertPurchasePrivate(base44, purchase.id, { dispute_reason: disputeReason });
    } catch (err) {
      await alertPrivateWriteFailure(base44, { entity: 'PurchasePrivate', reference_id: purchase.id, reference_type: 'purchase', error: err });
      return Response.json({ error: 'Failed to record dispute. Please try again.' }, { status: 500 });
    }

    sendUserNotification(base44, {
      user_email: authoritativeSellerEmail,
      title: 'Buyer cancelled after you confirmed',
      body: 'The buyer cancelled after you confirmed transfer. If you already sent tickets on Ticketmaster/SeatGeek, please contact support immediately. The payment is frozen pending review.',
      type: 'listing_expired',
      purchase_id: purchase.id,
    }).catch(() => {});

    sendTransactionalEmail(base44, 'experience@peanutgallery.store',
      `⚠️ Buyer cancelled after seller confirmed — ${purchase.id}`,
      `Buyer cancelled purchase AFTER seller confirmed transfer. Payment is NOT refunded — dispute opened for admin review.\n\nPurchase: ${purchase.id}\nBuyer: ${authoritativeBuyerEmail}\nSeller: ${authoritativeSellerEmail}\nAmount: $${purchase.amount?.toFixed(2)}\n\nINVESTIGATE: Were tickets already transferred? Contact seller to confirm, then resolve the dispute in the admin panel.`
    ).catch(() => {});

    return Response.json({ status: 'disputed', message: 'Because the seller already confirmed transfer, your request has been opened as a dispute for admin review instead of an automatic refund.' });
  }

  // ── Safe cancellation (before seller confirmed) ───────────────────────────
  const pi = await stripe.paymentIntents.retrieve(authoritativePaymentIntentId);
  if (pi.status === 'requires_capture') {
    await stripe.paymentIntents.cancel(authoritativePaymentIntentId);
  } else if (pi.status === 'succeeded') {
    await stripe.refunds.create({ payment_intent: authoritativePaymentIntentId });
  }

  try {
    await base44.asServiceRole.entities.Purchase.update(purchase.id, {
      transfer_status: 'expired',
    });
  } catch (err) {
    await alertPrivateWriteFailure(base44, { entity: 'Purchase', reference_id: purchase.id, reference_type: 'purchase', error: err });
  }

  // Only restore the listing if it is currently pending_transfer.
  const [currentListing] = await base44.asServiceRole.entities.Listing.filter({ id: purchase.listing_id });
  if (currentListing && currentListing.status === 'pending_transfer') {
    // Phase 1B: write authoritative ListingPrivate first, then legacy Listing mirror
    try {
      await upsertListingPrivate(base44, purchase.listing_id, {
        reserved_by_email: null, reservation_token: null, reservation_expires_at: null, reservation_revision: null,
      });
    } catch (err) {
      await alertPrivateWriteFailure(base44, { entity: 'ListingPrivate', reference_id: purchase.listing_id, reference_type: 'listing', error: err });
      return Response.json({ error: 'Failed to restore listing. Please contact support.' }, { status: 500 });
    }
    try {
      await base44.asServiceRole.entities.Listing.update(purchase.listing_id, {
        status: 'active',
        reservation_token: null,
        reservation_expires_at: null,
        reserved_by_email: null,
        reservation_revision: null,
      });
      // Verify Listing cleared
      const [verifyListing] = await base44.asServiceRole.entities.Listing.filter({ id: purchase.listing_id });
      if (verifyListing?.reservation_token || verifyListing?.reserved_by_email) {
        await alertPrivateWriteFailure(base44, { entity: 'Listing (clear verify)', reference_id: purchase.listing_id, reference_type: 'listing', error: new Error('Listing reservation fields not cleared after cancel') });
      }
    } catch (err) {
      await alertPrivateWriteFailure(base44, { entity: 'Listing (legacy mirror)', reference_id: purchase.listing_id, reference_type: 'listing', error: err });
    }
  }

  sendUserNotification(base44, {
    user_email: authoritativeSellerEmail,
    title: 'Purchase cancelled',
    body: 'The buyer cancelled their purchase. Your listing has been restored to active.',
    type: 'listing_expired',
    purchase_id: purchase.id,
  }).catch(() => {});

  return Response.json({ status: 'cancelled' });
});