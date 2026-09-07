/**
 * createCheckout — Thin Deno wrapper for checkoutOrchestrator.
 *
 * All orchestration logic lives in base44/shared/checkoutOrchestrator.js.
 * This file sets up dependencies and delegates.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';
import Stripe from 'npm:stripe@14.21.0';
import { secrets } from 'base44:runtime';
import { createMission1Runtime } from '../../shared/mission1Runtime.js';
import { isMaintenanceActive } from '../../shared/maintenance.ts';
import { runCreateCheckout } from '../../shared/checkoutOrchestrator.js';

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const user = await base44.auth.me();
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  const secretKey = Deno.env.get('STRIPELIVESECRETKEY');
  if (!secretKey || (!secretKey.startsWith('sk_test_') && !secretKey.startsWith('sk_live_'))) {
    return Response.json({ error: 'Stripe secret key misconfigured' }, { status: 500 });
  }
  const stripe = new Stripe(secretKey);
  const body = await req.json().catch(() => ({}));

  let runtime;
  try { runtime = await createMission1Runtime({ entities: base44.asServiceRole.entities, stripe, user, secrets }); }
  catch (error) { return Response.json({ code: error.message }, { status: 503 }); }

  const deps = {
    ...runtime,
    entities: base44.asServiceRole.entities,
    stripe,
    user,
    now: () => Date.now(),
    isMaintenanceActive: () => isMaintenanceActive(),
    isLiveMode: secretKey.startsWith('sk_live_'),
  };

  const result = await runCreateCheckout(deps, body);
  return Response.json(result.body, { status: result.status });
});