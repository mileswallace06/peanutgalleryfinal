/**
 * stripeWebhook — Public Stripe webhook handler (no auth required)
 *
 * PUBLIC endpoint — no Base44 auth.me() call. Stripe calls this directly.
 * Verifies Stripe signature using STRIPE_WEBHOOK_SECRET.
 *
 * All webhook logic is delegated to the shared, testable webhookOrchestrator.js.
 * This entry.ts is a thin Deno wrapper that:
 *   1. Verifies the Stripe webhook signature.
 *   2. Injects Deno-specific dependencies (Stripe client, base44 service-role entities).
 *   3. Calls runStripeWebhook and returns the HTTP response.
 *
 * KEY PRINCIPLES (see webhookOrchestrator.js for full details):
 *   - Purchase resolution through PurchasePrivate FIRST — no legacy fallback.
 *   - payment_failed: quarantine first, never activate inline, never clear unknown tokens.
 *   - payment_succeeded: write PP first, non-2xx on private-write failure.
 *   - No inline push/email. All notifications queued via webhookNotifications.
 *   - Stripe event.id is the deterministic idempotency key.
 */

import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';
import Stripe from 'npm:stripe@14.21.0';
import { sendUserNotification, sendTransactionalEmail } from '../../shared/notifications.ts';
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

  // Inject Deno-specific dependencies
  const deps = {
    entities: base44.asServiceRole.entities,
    stripe,
    now: () => Date.now(),
    sendUserNotification,
    sendTransactionalEmail,
  };

  const result = await runStripeWebhook(deps, event);

  return Response.json(result.body || { received: true }, { status: result.status });
});