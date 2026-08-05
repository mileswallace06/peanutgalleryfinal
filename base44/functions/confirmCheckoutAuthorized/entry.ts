/**
 * confirmCheckoutAuthorized — the ONLY way the frontend triggers the
 * post-authorization seller notification.
 *
 * All confirmation logic is delegated to the shared, testable
 * confirmCheckoutOrchestrator.js. This entry.ts is a thin Deno wrapper that:
 *   1. Authenticates the user.
 *   2. Validates Stripe configuration.
 *   3. Injects Deno-specific dependencies.
 *   4. Calls runConfirmCheckoutAuthorized and returns the HTTP response.
 *
 * KEY PRINCIPLES (see confirmCheckoutOrchestrator.js for full details):
 *   - Require PurchasePrivate and ListingPrivate — no public fallbacks.
 *   - Use PurchasePrivate.authorization_confirmed_at as the authoritative marker.
 *   - Always validate exact PI metadata; do not repair missing metadata here.
 *   - Validate current Listing + ListingPrivate token, buyer, matching expiration,
 *     pending_transfer status, non-expiry, and isFailClosed=false before enqueueing.
 *   - Use authoritativePaymentIntentId everywhere.
 *   - Repair partial public/private marker divergence before returning success.
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

    // Inject Deno-specific dependencies
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