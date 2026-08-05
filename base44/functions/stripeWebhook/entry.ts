/**
 * stripeWebhook — Public Stripe webhook handler (no auth required)
 *
 * 7C.9B: All webhook logic is delegated to the shared, testable
 * webhookOrchestrator.js. This entry.ts is a thin Deno wrapper that:
 *   1. Verifies the Stripe webhook signature.
 *   2. Injects Deno-specific dependencies.
 *   3. Calls runStripeWebhook and returns the HTTP response.
 *
 * No external push/email — all notifications queued via webhookNotifications.
 * The durable in-app Notification record IS the delivery mechanism.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';
import Stripe from 'npm:stripe@14.21.0';
import { runStripeWebhook } from '../../shared/webhookOrchestrator.js';

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const secretKey = Deno.env.get('STRIPELIVESECRETKEY');
  const webhookSecret = Deno.env.get('STRIPE_WEBHOOK_SECRET');

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

  const deps = {
    entities: base44.asServiceRole.entities,
    stripe,
    now: () => Date.now(),
  };

  const result = await runStripeWebhook(deps, event);

  return Response.json(result.body || { received: true }, { status: result.status });
});