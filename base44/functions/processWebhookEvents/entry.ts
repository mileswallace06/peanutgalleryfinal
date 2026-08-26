/**
 * processWebhookEvents — Scheduled webhook business-state processor (P0-01K).
 *
 * Drains durable pending Stripe webhook events from the authority_v1 Postgres
 * boundary. PostgreSQL is authoritative; Base44 receives mirror/outbox effects
 * only — no fallback, no direct authoritative Purchase/Listing writes.
 *
 * PRIVILEGE BOUNDARY:
 *   - Executor client: claim/complete/recover/escalate + resolve/incident/flag.
 *   - Recorder client: record verified Stripe outcomes (record_*_result).
 *   - Never uses admin credentials at runtime.
 *
 * Rule 10: The ingress kill switch (canary flag) stops new admissions but the
 * worker continues draining already-accepted events. This handler does NOT
 * check isCanaryEnabled or isMaintenanceActive — it always drains pending work.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';
import { secrets } from 'base44:runtime';
import { createAuthorityV1Client } from '../../shared/authorityV1Client.js';
import { createAuthorityV1StripeRecorderClient } from '../../shared/authorityV1StripeRecorderClient.js';
import { createStripeWebhookProvider } from '../../shared/stripeWebhookProvider.js';
import { processWebhookEvents } from '../../shared/webhookProcessor.js';

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const user = await base44.auth.me();
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  if (user.role !== 'admin') return Response.json({ error: 'Admin required' }, { status: 403 });

  const executorUrl = await secrets.get('AUTHORITY_V1_DB_URL_DEV_EXECUTOR');
  const recorderUrl = await secrets.get('AUTHORITY_V1_DB_URL_DEV_STRIPE_RECORDER');
  const secretKey = await secrets.get('STRIPE_SECRET_KEY');

  if (!executorUrl || !recorderUrl) {
    return Response.json({ error: 'Authority not configured' }, { status: 503 });
  }

  const executorClient = createAuthorityV1Client(executorUrl);
  const recorderClient = createAuthorityV1StripeRecorderClient(recorderUrl, executorClient.fingerprint);
  const stripeProvider = secretKey ? createStripeWebhookProvider(secretKey) : null;

  // Rule 10: always drain pending events regardless of canary flag or maintenance.
  const result = await processWebhookEvents({
    executorClient,
    recorderClient,
    stripeProvider,
    entities: base44.asServiceRole.entities,
  });

  return Response.json(result);
});