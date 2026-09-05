/**
 * capturePayment — STRICT state-machine for finalizing a real (non-demo) purchase.
 *
 * 7C.9B: All capture logic is delegated to the shared, testable
 * captureOrchestrator.js which uses reconcileCapturedPayment for idempotent
 * four-record reconciliation. This entry.ts is a thin Deno wrapper.
 *
 * P0-01I: Canary-eligible synthetic [AUTH_CANARY] records are routed to the
 * tested captureCanaryOrchestrator (Postgres authoritative, Base44 mirror-only).
 * All non-canary traffic and flag-OFF behavior remains identical to the
 * legacy path.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';
import { secrets } from 'base44:runtime';
import Stripe from 'npm:stripe@14.21.0';
import { isMaintenanceActive, maintenance503 } from '../../shared/maintenance.ts';
import { awardPoints, notify } from '../../shared/purchaseNotifications.ts';
import { recordTerminalOutcome } from '../../shared/recordOutcome.ts';
import { getPurchasePrivate } from '../../shared/privateData.ts';
import { runCapturePayment } from '../../shared/captureOrchestrator.js';
import { maybeRouteCanaryCapture } from '../../shared/captureCanaryOrchestrator.js';
import { maybeRouteCanaryBuyerConfirm } from '../../shared/buyerConfirmTransferCanaryOrchestrator.js';
import { isCanaryEnabled } from '../../shared/authCanary.js';
import { createStripeCaptureProvider } from '../../shared/stripeCaptureProvider.js';

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const user = await base44.auth.me();
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const { purchase_id, optimistic_id } = body;

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

  // ── P0-01T: Canary buyer-confirmation route (before capture canary) ──────
  // P0-01T-CORRECTIVE-4: Canary secrets are NOT read here. The routing
  // function reads them lazily ONLY after confirming canary eligibility.
  // Normal non-canary traffic reaches maintenance/legacy fallthrough without
  // depending on any canary secret.
  if (listing && purchase && body?.confirming_role === 'buyer') {
    const canaryBuyerResult = await maybeRouteCanaryBuyerConfirm({
      base44, user, body, listing, purchase,
      secrets,
      canaryEnabled: isCanaryEnabled(),
    });
    if (canaryBuyerResult) return Response.json(canaryBuyerResult.body, { status: canaryBuyerResult.status });
  }

  // ── Canary guard (admin + synthetic [AUTH_CANARY] listing only) ─────────
  // P0-01T-CORRECTIVE-4: Canary secrets are NOT read here. The routing
  // function reads them lazily ONLY after confirming canary eligibility.
  if (listing && purchase) {
    const canaryResult = await maybeRouteCanaryCapture({
      base44, user, body, listing, purchase,
      secrets,
      canaryEnabled: isCanaryEnabled(),
    });
    if (canaryResult) return Response.json(canaryResult.body, { status: canaryResult.status });
  }

  // ── Legacy path (non-canary traffic + flag-OFF) — unchanged ──────────────
  if (isMaintenanceActive()) return maintenance503('Payment capture is temporarily unavailable for scheduled maintenance.');

  const secretKey = Deno.env.get('STRIPELIVESECRETKEY');
  if (!secretKey || (!secretKey.startsWith('sk_test_') && !secretKey.startsWith('sk_live_'))) {
    return Response.json({ error: 'Stripe secret key misconfigured' }, { status: 500 });
  }
  const stripe = new Stripe(secretKey);

  const deps = {
    entities: base44.asServiceRole.entities,
    stripe,
    user,
    now: () => Date.now(),
    isMaintenanceActive: () => isMaintenanceActive(),
    isLiveMode: false,
  };

  const result = await runCapturePayment(deps, { purchase_id, optimistic_id });

  // Post-capture side effects (fire-and-forget, best-effort)
  if (result.status === 200 && result.body?.status === 'completed') {
    const [capturedPurchase] = await base44.asServiceRole.entities.Purchase.filter({ id: purchase_id }).catch(() => []);
    if (capturedPurchase) {
      const pp = await getPurchasePrivate(base44, capturedPurchase.id);
      const authoritativeBuyerEmail = pp?.buyer_email ?? capturedPurchase.buyer_email;
      const authoritativeSellerEmail = pp?.seller_email ?? capturedPurchase.seller_email;

      try {
        await recordTerminalOutcome(base44, { ...capturedPurchase, buyer_email: authoritativeBuyerEmail, seller_email: authoritativeSellerEmail });
      } catch (err) {
        console.error('[capturePayment] recordTerminalOutcome failed:', capturedPurchase.id, err?.message);
      }

      const isSelfPurchase = authoritativeSellerEmail === authoritativeBuyerEmail;
      if (!isSelfPurchase) {
        awardPoints(base44, authoritativeSellerEmail, 'sale_completed', capturedPurchase.id, 'purchase');
        awardPoints(base44, authoritativeBuyerEmail, 'purchase', capturedPurchase.id, 'purchase');
      }

      notify(base44, authoritativeSellerEmail, 'Sale complete 💸', 'Your payout is processing. Stripe deposits typically take 2–7 business days. First-time payouts may take up to 14 days.', 'sale_complete', capturedPurchase.id);
      notify(base44, authoritativeBuyerEmail, 'Transfer confirmed ✅', 'You confirmed receiving your tickets. Payment has been released to the seller. Enjoy the show!', 'buyer_confirmed', capturedPurchase.id);

      if (capturedPurchase.seller_confirmed_at && !isSelfPurchase) {
        const sentAt = new Date(capturedPurchase.seller_confirmed_at).getTime();
        const hoursElapsed = (Date.now() - sentAt) / 3600000;
        if (hoursElapsed <= 1) {
          awardPoints(base44, authoritativeBuyerEmail, 'buyer_confirm_1hr', capturedPurchase.id, 'purchase');
        }
      }
    }
  }

  return Response.json(result.body, { status: result.status });
});