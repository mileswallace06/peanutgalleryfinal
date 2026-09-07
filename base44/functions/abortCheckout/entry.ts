import { expirePurchaseSafely } from '../../shared/purchaseExpiry.js';
import { createMission1Runtime } from '../../shared/mission1Runtime.js';
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
 *      requires_capture). Captured payments require explicit reconciliation.
 *   5. Mark the abandoned Purchase expired.
 *   6. Release the Listing only if it still belongs to this Purchase/reservation.
 *   7. Idempotent — durable completion is required; interrupted expiry resumes.
 *
 * P0-01G: Canary-eligible synthetic [AUTH_CANARY] records are routed to the
 * tested abortCanaryOrchestrator (Postgres authoritative, Base44 mirror-only).
 * Non-canary traffic uses the Mission 1 authority and verified projector.
 *
 * Expiring a Purchase does NOT affect seller trust, buyer trust, points, or
 * transfer intelligence (recordTransferOutcome only acts on completed/disputed).
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';
import { secrets } from 'base44:runtime';
import Stripe from 'npm:stripe@14.21.0';
import { isMaintenanceActive, maintenance503 } from '../../shared/maintenance.ts';
import { getPurchasePrivate } from '../../shared/privateData.ts';
import { isCanaryEnabled } from '../../shared/authCanary.js';
import { createStripeCancelProvider } from '../../shared/stripeCancelProvider.js';
import { maybeRouteCanaryAbort } from '../../shared/abortCanaryOrchestrator.js';


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
  } catch {}

  let listing: any = null;
  if (purchase?.listing_id) {
    try {
      const [l] = await base44.asServiceRole.entities.Listing.filter({ id: purchase.listing_id });
      listing = l || null;
    } catch {}
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

  // ── Mission 1 path (non-canary traffic + flag-OFF) ──────────────────────
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

  const authoritativePaymentCaptured = pp?.payment_captured ?? purchase.payment_captured;

  // Only the buyer (or admin) may abort their own checkout.
  if (authoritativeBuyerEmail !== user.email && user.role !== 'admin') {
    return Response.json({ error: 'Not authorized' }, { status: 403 });
  }

  // Idempotent: already terminal.
  if (purchase.transfer_status === 'disputed') return Response.json({ status: 'already_disputed' });

  // Refuse to abort captured / completed purchases.
  if (authoritativePaymentCaptured || purchase.transfer_status === 'completed') {
    return Response.json({ error: 'Cannot abort a completed purchase' }, { status: 409 });
  }
  if (purchase.is_demo) {
    return Response.json({ error: 'Cannot abort a demo purchase' }, { status: 409 });
  }

  let runtime;
  try { runtime = await createMission1Runtime({ entities: base44.asServiceRole.entities, stripe, user, secrets }); }
  catch (error) { return Response.json({ code: error.message }, { status: 503 }); }
  const result = await expirePurchaseSafely(runtime, purchase.id, { allowRefund: false });
  return Response.json(result.body, { status: result.status });
});
