/**
 * abortCheckout — Purchase-scoped cleanup for an in-flight checkout.
 *
 * Called by the frontend whenever card confirmation fails or the dialog is
 * closed AFTER createCheckout has created a Purchase (and thus a PaymentIntent
 * + reservation). Replaces the generic releaseReservation for that phase.
 *
 *   1. Authenticate the buyer (or admin).
 *   2. Verify the Purchase belongs to that buyer.
 *   3. Refuse to abort captured / completed / disputed / demo purchases.
 *   4. Retrieve and safely cancel the PaymentIntent when its state allows it
 *      (requires_payment_method / requires_confirmation / requires_action /
 *      processing / requires_capture). Never touch a succeeded/canceled PI.
 *   5. Mark the abandoned Purchase expired.
 *   6. Release the Listing only if it still belongs to this Purchase/reservation.
 *   7. Idempotent — re-aborting an already-expired purchase is a no-op.
 *
 * P0-01G: Canary-eligible synthetic [AUTH_CANARY] records are routed to the
 * tested abortCanaryOrchestrator (Postgres authoritative, Base44 mirror-only).
 * All non-canary traffic and flag-OFF behavior remains identical to the
 * legacy path.
 *
 * Expiring a Purchase does NOT affect seller trust, buyer trust, points, or
 * transfer intelligence (recordTransferOutcome only acts on completed/disputed).
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';
import { secrets } from 'base44:runtime';
import Stripe from 'npm:stripe@14.21.0';
import { isMaintenanceActive, maintenance503 } from '../../shared/maintenance.ts';
import { getPurchasePrivate, getListingPrivate, upsertListingPrivate, alertPrivateWriteFailure } from '../../shared/privateData.ts';
import { isCanaryEnabled } from '../../shared/authCanary.js';
import { createStripeCancelProvider } from '../../shared/stripeCancelProvider.js';
import { maybeRouteCanaryAbort } from '../../shared/abortCanaryOrchestrator.js';

const CANCELLABLE_STATUSES = [
  'requires_payment_method',
  'requires_confirmation',
  'requires_action',
  'processing',
  'requires_capture',
];

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const user = await base44.auth.me();
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const { purchase_id } = body;
  if (!purchase_id) return Response.json({ error: 'purchase_id is required' }, { status: 400 });

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

  // ── Canary guard (admin + synthetic [AUTH_CANARY] listing only) ─────────
  // Returns null for normal listings/requests → fall through to the
  // maintenance-gated legacy path. Returns {status, body} for any canary-eligible
  // or canary-rejected request — synthetic listings never reach the normal path.
  if (listing && purchase) {
    const executorUrl = secrets.get('AUTHORITY_V1_DB_URL_DEV_EXECUTOR');
    const recorderUrl = secrets.get('AUTHORITY_V1_DB_URL_DEV_STRIPE_RECORDER');
    const secretKey = secrets.get('STRIPE_SECRET_KEY');
    const stripeAdapter = secretKey ? createStripeCancelProvider(secretKey) : null;

    const canaryResult = await maybeRouteCanaryAbort({
      base44, user, body, listing, purchase,
      executorUrl, recorderUrl,
      stripeAdapter,
      canaryEnabled: isCanaryEnabled(),
    });
    if (canaryResult) return Response.json(canaryResult.body, { status: canaryResult.status });
  }

  // ── Legacy path (non-canary traffic + flag-OFF) — unchanged ──────────────
  if (isMaintenanceActive()) return maintenance503('Checkout abort is temporarily unavailable for scheduled maintenance.');

  const secretKey = Deno.env.get('STRIPELIVESECRETKEY');
  if (!secretKey || (!secretKey.startsWith('sk_test_') && !secretKey.startsWith('sk_live_'))) {
    return Response.json({ error: 'Stripe secret key misconfigured' }, { status: 500 });
  }
  const stripe = new Stripe(secretKey);

  if (!purchase) return Response.json({ error: 'Purchase not found' }, { status: 404 });

  // Phase 1B: read authoritative buyer identity, payment_intent_id, payment_captured from PurchasePrivate
  const pp = await getPurchasePrivate(base44, purchase.id);
  const authoritativeBuyerEmail = pp?.buyer_email ?? purchase.buyer_email;
  const authoritativePaymentIntentId = pp?.payment_intent_id ?? purchase.payment_intent_id;
  const authoritativePaymentCaptured = pp?.payment_captured ?? purchase.payment_captured;

  // Only the buyer (or admin) may abort their own checkout.
  if (authoritativeBuyerEmail !== user.email && user.role !== 'admin') {
    return Response.json({ error: 'Not authorized' }, { status: 403 });
  }

  // Idempotent: already terminal.
  if (purchase.transfer_status === 'expired') return Response.json({ status: 'already_expired' });
  if (purchase.transfer_status === 'disputed') return Response.json({ status: 'already_disputed' });

  // Refuse to abort captured / completed purchases.
  if (authoritativePaymentCaptured || purchase.transfer_status === 'completed') {
    return Response.json({ error: 'Cannot abort a completed purchase' }, { status: 409 });
  }
  if (purchase.is_demo) {
    return Response.json({ error: 'Cannot abort a demo purchase' }, { status: 409 });
  }

  // Safely cancel the PaymentIntent when appropriate.
  let piStatus = null;
  if (authoritativePaymentIntentId) {
    try {
      const pi = await stripe.paymentIntents.retrieve(authoritativePaymentIntentId);
      piStatus = pi.status;
      if (CANCELLABLE_STATUSES.includes(pi.status)) {
        try {
          await stripe.paymentIntents.cancel(authoritativePaymentIntentId);
        } catch (e) {
          // Already canceled / incompatible state — safe to ignore.
          console.warn('[abortCheckout] cancel failed', purchase.id, e?.message);
        }
      }
    } catch (err) {
      console.warn('[abortCheckout] PI retrieve failed', purchase.id, err?.message);
    }
  }

  // Mark the abandoned Purchase expired.
  try {
    await base44.asServiceRole.entities.Purchase.update(purchase.id, { transfer_status: 'expired' });
  } catch (err) {
    await alertPrivateWriteFailure(base44, { entity: 'Purchase', reference_id: purchase.id, reference_type: 'purchase', error: err });
  }

  // Release the Listing only if it still belongs to this Purchase/reservation.
  // Reuse listing fetched above; re-fetch if null (may have been skipped for non-canary).
  if (!listing && purchase.listing_id) {
    try {
      const listings = await base44.asServiceRole.entities.Listing.filter({ id: purchase.listing_id });
      listing = listings[0] || null;
    } catch (err) {
      await alertPrivateWriteFailure(base44, { entity: 'Listing', reference_id: purchase.listing_id, reference_type: 'listing', error: err });
    }
  }
  const lp = listing ? await getListingPrivate(base44, listing.id) : null;
  const authoritativeReservedBy = lp?.reserved_by_email ?? listing?.reserved_by_email;
  const authoritativeResToken = lp?.reservation_token ?? listing?.reservation_token;
  if (listing && listing.status === 'pending_transfer') {
    const ownsByBuyer = authoritativeReservedBy === authoritativeBuyerEmail;
    const ownsByToken = !!(purchase.reservation_token && authoritativeResToken === purchase.reservation_token);
    if (ownsByBuyer || ownsByToken) {
      // Phase 1B: write authoritative ListingPrivate first, then legacy Listing mirror
      try {
        await upsertListingPrivate(base44, listing.id, {
          reserved_by_email: null, reservation_token: null, reservation_expires_at: null, reservation_revision: null,
        });
      } catch (err) {
        await alertPrivateWriteFailure(base44, { entity: 'ListingPrivate', reference_id: listing.id, reference_type: 'listing', error: err });
        return Response.json({ error: 'Failed to release listing reservation. Please try again.' }, { status: 500 });
      }
      try {
        await base44.asServiceRole.entities.Listing.update(listing.id, {
          status: 'active',
          reservation_token: null,
          reservation_expires_at: null,
          reserved_by_email: null,
          reservation_revision: null,
        });
        // Verify Listing cleared
        const [verifyListing] = await base44.asServiceRole.entities.Listing.filter({ id: listing.id });
        if (verifyListing?.reservation_token || verifyListing?.reserved_by_email) {
          await alertPrivateWriteFailure(base44, { entity: 'Listing (clear verify)', reference_id: listing.id, reference_type: 'listing', error: new Error('Listing reservation fields not cleared after abort') });
        }
      } catch (err) {
        await alertPrivateWriteFailure(base44, { entity: 'Listing (legacy mirror)', reference_id: listing.id, reference_type: 'listing', error: err });
      }
    }
  }

  return Response.json({ status: 'expired', pi_status: piStatus });
});