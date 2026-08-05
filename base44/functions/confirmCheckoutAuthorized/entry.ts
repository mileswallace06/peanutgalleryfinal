/**
 * confirmCheckoutAuthorized — the ONLY way the frontend triggers the
 * post-authorization seller notification.
 *
 * 7C.9B: All confirmation logic is delegated to the shared, testable
 * confirmCheckoutOrchestrator.js. The existence of
 * PurchasePrivate.authorization_confirmed_at NEVER bypasses verification.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';
import Stripe from 'npm:stripe@14.21.0';
import { isMaintenanceActive, maintenance503 } from '../../shared/maintenance.ts';
import { runConfirmCheckoutAuthorized } from '../../shared/confirmCheckoutOrchestrator.js';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    if (isMaintenanceActive()) return maintenance503('Checkout confirmation is temporarily unavailable for scheduled maintenance.');

    const secretKey = Deno.env.get('STRIPELIVESECRETKEY');
    if (!secretKey || (!secretKey.startsWith('sk_test_') && !secretKey.startsWith('sk_live_'))) {
      return Response.json({ error: 'Stripe misconfigured' }, { status: 500 });
    }
    const stripe = new Stripe(secretKey);

    const body = await req.json();
    const { purchase_id } = body;

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