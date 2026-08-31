/**
 * stripeCaptureProvider.js — Shared production Stripe capture provider.
 *
 * The exact retrieve-then-conditionally-capture implementation used by the
 * capturePayment canary route. Imported and executed by BOTH:
 *   - base44/functions/capturePayment/entry.ts (canary route; key from
 *     base44:runtime secrets.get('STRIPE_SECRET_KEY'))
 *   - tests/capture-canary-real-stripe.test.mjs (P0-01J harness; owner-managed
 *     test key injected into this factory)
 *
 * No duplicated Stripe retrieve/capture logic exists in the harness — both
 * callers execute THIS module's capturePaymentIntent. The harness may wrap the
 * returned adapter in a thin observability proxy (counts + optional
 * lost-response throw) but never reimplements provider behavior.
 *
 * Uses the Stripe server SDK (npm:stripe@14.21.0), identical to the prior inline
 * handler adapter. The `raw` diagnostic payload is enriched with livemode,
 * amount, currency, and pi_id (data the SDK already returns) so the
 * certification harness can assert binding without a second provider call. The
 * control-flow mapping (derived) is unchanged from the prior inline adapter.
 */
import Stripe from 'npm:stripe@14.21.0';

/**
 * Create a Stripe capture provider.
 * @param {string} secretKey - Stripe secret key (sk_test_ or sk_live_)
 * @returns {{ capturePaymentIntent(piId: string, idemKey: string) => Promise<{derived: 'succeeded'|'failed'|'unknown', raw: object}> }}
 */
export function createStripeCaptureProvider(secretKey) {
  const stripe = new Stripe(secretKey);
  return {
    /** retrievePaymentIntent(piId) → raw Stripe PaymentIntent object.
     *  Used by the confirm-checkout canary (P0-01Q) which only needs to verify
     *  authorization status + metadata, never to capture. */
    async retrievePaymentIntent(piId) {
      return await stripe.paymentIntents.retrieve(piId);
    },
    async capturePaymentIntent(piId, idemKey) {
      try {
        const pi = await stripe.paymentIntents.retrieve(piId);
        if (pi.status === 'requires_capture') {
          try {
            const captured = await stripe.paymentIntents.capture(piId, { idempotencyKey: idemKey });
            return {
              derived: 'succeeded',
              raw: {
                status: captured.status,
                pi_status: pi.status,
                livemode: captured.livemode,
                amount: captured.amount,
                currency: captured.currency,
                pi_id: pi.id,
              },
            };
          } catch (e) {
            return {
              derived: 'failed',
              raw: {
                error: (e?.message || String(e)).slice(0, 200),
                pi_status: pi.status,
                livemode: pi.livemode,
                pi_id: pi.id,
              },
            };
          }
        }
        if (pi.status === 'succeeded') {
          return {
            derived: 'succeeded',
            raw: {
              status: 'already_succeeded',
              pi_status: pi.status,
              livemode: pi.livemode,
              amount: pi.amount,
              currency: pi.currency,
              pi_id: pi.id,
            },
          };
        }
        if (pi.status === 'canceled') {
          return {
            derived: 'failed',
            raw: {
              status: 'already_canceled',
              pi_status: pi.status,
              livemode: pi.livemode,
              pi_id: pi.id,
            },
          };
        }
        return {
          derived: 'unknown',
          raw: { pi_status: pi.status, livemode: pi.livemode, pi_id: pi.id },
        };
      } catch (e) {
        return {
          derived: 'unknown',
          raw: { error: (e?.message || String(e)).slice(0, 200) },
        };
      }
    },
  };
}