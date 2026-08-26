/**
 * stripeWebhookProvider.js — Shared production Stripe provider for webhook processing.
 *
 * Used by the webhook processor (processWebhookEvents) to fetch the CURRENT
 * Stripe state for a PaymentIntent. The processor NEVER treats the stored
 * event envelope as proof that a capture/cancel/refund succeeded — it always
 * fetches live state from Stripe through this adapter.
 *
 * Imported by:
 *   - base44/functions/processWebhookEvents/entry.ts (production; key from
 *     base44:runtime secrets.get('STRIPE_SECRET_KEY'))
 *   - tests/webhook-processor.test.mjs (fake provider injected for testing)
 *
 * Uses the Stripe server SDK (npm:stripe@14.21.0).
 */
import Stripe from 'npm:stripe@14.21.0';

/**
 * Create a Stripe webhook provider.
 * @param {string} secretKey - Stripe secret key (sk_test_ or sk_live_)
 */
export function createStripeWebhookProvider(secretKey) {
  const stripe = new Stripe(secretKey);
  return {
    /**
     * Retrieve the current PaymentIntent state for capture/cancel reconciliation.
     * @returns {{ derived: 'succeeded'|'canceled'|'unknown', raw: object }}
     */
    async retrievePaymentIntentState(piId) {
      try {
        const pi = await stripe.paymentIntents.retrieve(piId);
        const derived = pi.status === 'succeeded' ? 'succeeded'
          : pi.status === 'canceled' ? 'canceled'
          : 'unknown';
        return {
          derived,
          raw: {
            pi_status: pi.status,
            livemode: pi.livemode,
            pi_id: pi.id,
            amount: pi.amount,
            currency: pi.currency,
          },
        };
      } catch (e) {
        return { derived: 'unknown', raw: { error: (e?.message || String(e)).slice(0, 200) } };
      }
    },

    /**
     * Retrieve the refund state for a PaymentIntent's charges.
     * @returns {{ derived: 'refunded'|'unknown', raw: object }}
     */
    async retrieveRefundState(piId) {
      try {
        const charges = await stripe.charges.list({ payment_intent: piId });
        const charge = charges.data[0];
        if (!charge) return { derived: 'unknown', raw: { error: 'no charge found for PI' } };
        const fullyRefunded = charge.refunded === true
          || (charge.amount > 0 && charge.amount_refunded >= charge.amount);
        return {
          derived: fullyRefunded ? 'refunded' : 'unknown',
          raw: {
            charge_status: charge.status,
            refunded: charge.refunded,
            amount_refunded: charge.amount_refunded,
            amount: charge.amount,
            livemode: charge.livemode,
            charge_id: charge.id,
          },
        };
      } catch (e) {
        return { derived: 'unknown', raw: { error: (e?.message || String(e)).slice(0, 200) } };
      }
    },
  };
}