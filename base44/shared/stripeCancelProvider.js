/**
 * stripeCancelProvider.js — Shared production Stripe cancel provider.
 *
 * The exact retrieve-then-conditionally-cancel implementation used by the
 * cancelPurchase canary route (P0-01L). Imported and executed by BOTH:
 *   - base44/functions/cancelPurchase/entry.ts (canary route; key from
 *     base44:runtime secrets.get('STRIPE_SECRET_KEY'))
 *   - tests/cancel-purchase-canary.test.mjs (P0-01L harness; owner-managed
 *     test key injected into this factory)
 *
 * No duplicated Stripe retrieve/cancel logic exists in the harness — both
 * callers execute THIS module's cancelPaymentIntent. The harness may wrap the
 * returned adapter in a thin observability proxy (counts + optional
 * lost-response throw) but never reimplements provider behavior.
 *
 * Uses the Stripe server SDK (npm:stripe@14.21.0), identical to the capture
 * provider. The `raw` diagnostic payload is enriched with livemode, pi_status,
 * and pi_id (data the SDK already returns) so the certification harness can
 * assert binding without a second provider call.
 *
 * SEMANTICS:
 *   - PI in a cancellable status (requires_payment_method, requires_confirmation,
 *     requires_action, processing, requires_capture) → cancel with idempotency
 *     key → 'succeeded' (or 'failed' if the cancel API call throws).
 *   - PI already 'canceled' → 'succeeded' (already_canceled, no API call).
 *   - PI 'succeeded' (captured) → 'failed' (already_succeeded — cannot cancel a
 *     captured PI; refund is a separate flow out of scope for P0-01L).
 *   - Any other PI status → 'unknown'.
 *   - Retrieve or cancel network error → 'unknown'.
 */
import Stripe from 'npm:stripe@14.21.0';

const CANCELLABLE_STATUSES = [
  'requires_payment_method',
  'requires_confirmation',
  'requires_action',
  'processing',
  'requires_capture',
];

/**
 * Create a Stripe cancel provider.
 * @param {string} secretKey - Stripe secret key (sk_test_ or sk_live_)
 * @returns {{ cancelPaymentIntent(piId: string, idemKey: string) => Promise<{derived: 'succeeded'|'failed'|'unknown', raw: object}> }}
 */
export function createStripeCancelProvider(secretKey) {
  const stripe = new Stripe(secretKey);
  return {
    async cancelPaymentIntent(piId, idemKey) {
      try {
        const pi = await stripe.paymentIntents.retrieve(piId);
        if (CANCELLABLE_STATUSES.includes(pi.status)) {
          try {
            const canceled = await stripe.paymentIntents.cancel(piId, { idempotencyKey: idemKey });
            return {
              derived: 'succeeded',
              raw: {
                status: canceled.status,
                pi_status: pi.status,
                livemode: canceled.livemode,
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
        if (pi.status === 'canceled') {
          return {
            derived: 'succeeded',
            raw: {
              status: 'already_canceled',
              pi_status: pi.status,
              livemode: pi.livemode,
              pi_id: pi.id,
            },
          };
        }
        if (pi.status === 'succeeded') {
          return {
            derived: 'failed',
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