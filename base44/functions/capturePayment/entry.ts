/**
 * capturePayment — STRICT state-machine for finalizing a real (non-demo) purchase.
 *
 * 7C.9B: All capture logic is delegated to the shared, testable
 * captureOrchestrator.js which uses reconcileCapturedPayment for idempotent
 * four-record reconciliation. This entry.ts is a thin Deno wrapper.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';
import Stripe from 'npm:stripe@14.21.0';
import { isMaintenanceActive, maintenance503 } from '../../shared/maintenance.ts';
import { awardPoints, notify } from '../../shared/purchaseNotifications.ts';
import { recordTerminalOutcome } from '../../shared/recordOutcome.ts';
import { getPurchasePrivate } from '../../shared/privateData.ts';
import { runCapturePayment } from '../../shared/captureOrchestrator.js';

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

  const body = await req.json();
  const { purchase_id, optimistic_id } = body;

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
    const [purchase] = await base44.asServiceRole.entities.Purchase.filter({ id: purchase_id }).catch(() => []);
    if (purchase) {
      const pp = await getPurchasePrivate(base44, purchase.id);
      const authoritativeBuyerEmail = pp?.buyer_email ?? purchase.buyer_email;
      const authoritativeSellerEmail = pp?.seller_email ?? purchase.seller_email;

      try {
        await recordTerminalOutcome(base44, { ...purchase, buyer_email: authoritativeBuyerEmail, seller_email: authoritativeSellerEmail });
      } catch (err) {
        console.error('[capturePayment] recordTerminalOutcome failed:', purchase.id, err?.message);
      }

      const isSelfPurchase = authoritativeSellerEmail === authoritativeBuyerEmail;
      if (!isSelfPurchase) {
        awardPoints(base44, authoritativeSellerEmail, 'sale_completed', purchase.id, 'purchase');
        awardPoints(base44, authoritativeBuyerEmail, 'purchase', purchase.id, 'purchase');
      }

      notify(base44, authoritativeSellerEmail, 'Sale complete 💸', 'Your payout is processing. Stripe deposits typically take 2–7 business days. First-time payouts may take up to 14 days.', 'sale_complete', purchase.id);
      notify(base44, authoritativeBuyerEmail, 'Transfer confirmed ✅', 'You confirmed receiving your tickets. Payment has been released to the seller. Enjoy the show!', 'buyer_confirmed', purchase.id);

      if (purchase.seller_confirmed_at && !isSelfPurchase) {
        const sentAt = new Date(purchase.seller_confirmed_at).getTime();
        const hoursElapsed = (Date.now() - sentAt) / 3600000;
        if (hoursElapsed <= 1) {
          awardPoints(base44, authoritativeBuyerEmail, 'buyer_confirm_1hr', purchase.id, 'purchase');
        }
      }
    }
  }

  return Response.json(result.body, { status: result.status });
});