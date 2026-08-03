/**
 * cleanupAbandonedCheckouts — Thin Deno wrapper for cleanupOrchestrator.
 *
 * All orchestration logic lives in base44/shared/cleanupOrchestrator.js.
 * This file sets up dependencies and delegates.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';
import Stripe from 'npm:stripe@14.21.0';
import { isMaintenanceActive } from '../../shared/maintenance.ts';
import { runCleanupAbandonedCheckouts } from '../../shared/cleanupOrchestrator.js';

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  if (isMaintenanceActive()) return Response.json({ ok: true, skipped: 'maintenance mode' });

  const secretKey = Deno.env.get('STRIPELIVESECRETKEY');
  if (!secretKey || (!secretKey.startsWith('sk_test_') && !secretKey.startsWith('sk_live_'))) {
    return Response.json({ error: 'Stripe secret key misconfigured' }, { status: 500 });
  }
  const stripe = new Stripe(secretKey);

  const deps = {
    entities: base44.asServiceRole.entities,
    stripe,
    now: () => Date.now(),
    isMaintenanceActive: () => isMaintenanceActive(),
  };

  const result = await runCleanupAbandonedCheckouts(deps);
  return Response.json(result.body, { status: result.status });
});