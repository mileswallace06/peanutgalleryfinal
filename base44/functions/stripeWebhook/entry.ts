/**
 * stripeWebhook — Public Stripe webhook handler (no auth required)
 *
 * 7C.9B: Legacy webhook logic delegated to webhookOrchestrator.js.
 *
 * P0-01K: Canary-eligible authority-bound events are durably ingested into the
 * authority_v1 Postgres boundary (ingest_stripe_webhook_event) before any 2xx.
 * PostgreSQL is authoritative; Base44 is not a fallback. Non-canary events and
 * flag-OFF behavior fall through to the unchanged legacy path.
 *
 * STRIPE_WEBHOOK_SECRET is read via base44:runtime secrets inside request
 * handling — no Deno.env, no module-scope loading, no logging of secret material.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';
import { secrets } from 'base44:runtime';
import Stripe from 'npm:stripe@14.21.0';
import { runStripeWebhook } from '../../shared/webhookOrchestrator.js';
import { maybeRouteCanaryWebhook } from '../../shared/webhookCanaryIngress.js';
import { isCanaryEnabled } from '../../shared/authCanary.js';

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const secretKey = Deno.env.get('STRIPELIVESECRETKEY');
  const webhookSecret = await secrets.get('STRIPE_WEBHOOK_SECRET');

  if (!secretKey || !webhookSecret) {
    return Response.json({ error: 'Stripe not configured' }, { status: 500 });
  }

  const stripe = new Stripe(secretKey);
  const body = await req.text();
  const sig = req.headers.get('stripe-signature');

  if (!sig) {
    return new Response('Missing stripe-signature header', { status: 400 });
  }

  let event;
  try {
    event = await stripe.webhooks.constructEventAsync(body, sig, webhookSecret);
  } catch (err) {
    console.error('[stripeWebhook] Signature verification failed:', err.message);
    return new Response('Invalid signature', { status: 400 });
  }

  // ── Canary ingress (flag ON + authority-bound only) ──────────────────────
  // P0-01K privilege boundary: ingestion uses the RECORDER client, not executor.
  // Returns null for flag-OFF, non-canary, or no-authority → legacy path.
  // Returns {status, body} for canary-owned events (durable ack or fail-closed).
  const executorUrl = await secrets.get('AUTHORITY_V1_DB_URL_DEV_EXECUTOR');
  const recorderUrl = await secrets.get('AUTHORITY_V1_DB_URL_DEV_STRIPE_RECORDER');
  let recorderClient = null;
  if (executorUrl && recorderUrl) {
    try {
      const { createAuthorityV1Client } = await import('../../shared/authorityV1Client.js');
      const { createAuthorityV1StripeRecorderClient } = await import('../../shared/authorityV1StripeRecorderClient.js');
      const executorClient = createAuthorityV1Client(executorUrl);
      recorderClient = createAuthorityV1StripeRecorderClient(recorderUrl, executorClient.fingerprint);
    } catch (e) {
      console.error('[stripeWebhook] Recorder client creation failed:', e?.message);
    }
  }
  const canaryResult = await maybeRouteCanaryWebhook({
    canaryEnabled: isCanaryEnabled(),
    recorderUrl,
    recorderClient,
    event,
    rawBody: body,
  });
  if (canaryResult) {
    return Response.json(canaryResult.body, { status: canaryResult.status });
  }

  // ── Legacy path (non-canary + flag-OFF) — unchanged ───────────────────────
  const deps = {
    entities: base44.asServiceRole.entities,
    stripe,
    now: () => Date.now(),
  };

  const result = await runStripeWebhook(deps, event);

  return Response.json(result.body || { received: true }, { status: result.status });
});