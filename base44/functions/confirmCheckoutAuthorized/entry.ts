/**
 * confirmCheckoutAuthorized — the ONLY way the frontend triggers the
 * post-authorization seller notification.
 *
 * 7C.9B: All confirmation logic is delegated to the shared, testable
 * confirmCheckoutOrchestrator.js. The existence of
 * PurchasePrivate.authorization_confirmed_at NEVER bypasses verification.
 *
 * P0-01H: Canary-eligible synthetic [AUTH_CANARY] records are routed to the
 * tested confirmCanaryOrchestrator (Postgres authoritative, Base44 mirror-only).
 * The canary path performs the authoritative `bind_payment_intent` transition
 * (creates payment binding with capture_state='authorized'). All non-canary
 * traffic and flag-OFF behavior remains identical to the legacy path.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';
import { secrets } from 'base44:runtime';
import Stripe from 'npm:stripe@14.21.0';
import { isMaintenanceActive, maintenance503 } from '../../shared/maintenance.ts';
import { runConfirmCheckoutAuthorized } from '../../shared/confirmCheckoutOrchestrator.js';
import { maybeRouteCanaryConfirm } from '../../shared/confirmCanaryOrchestrator.js';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json();
    const { purchase_id } = body;

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
      const secretKey = Deno.env.get('STRIPELIVESECRETKEY');
      const stripeAdapter = secretKey ? {
        async retrievePaymentIntent(piId: string) {
          const stripe = new Stripe(secretKey);
          return await stripe.paymentIntents.retrieve(piId);
        },
      } : null;

      const canaryResult = await maybeRouteCanaryConfirm({
        base44, user, body, listing, purchase,
        executorUrl,
        stripeAdapter,
      });
      if (canaryResult) return Response.json(canaryResult.body, { status: canaryResult.status });
    }

    // ── Legacy path (non-canary traffic + flag-OFF) — unchanged ──────────────
    if (isMaintenanceActive()) return maintenance503('Checkout confirmation is temporarily unavailable for scheduled maintenance.');

    const secretKey = Deno.env.get('STRIPELIVESECRETKEY');
    if (!secretKey || (!secretKey.startsWith('sk_test_') && !secretKey.startsWith('sk_live_'))) {
      return Response.json({ error: 'Stripe misconfigured' }, { status: 500 });
    }
    const stripe = new Stripe(secretKey);

    if (!purchase) return Response.json({ error: 'Purchase not found' }, { status: 404 });

    const deps = {
      entities: base44.asServiceRole.entities,
      stripe,
      user,
      now: () => Date.now(),
      isMaintenanceActive: () => isMaintenanceActive(),
    };

    const result = await runConfirmCheckoutAuthorized(deps, { purchase_id });

    return Response.json(result.body, { status: result.status });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
});