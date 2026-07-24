/**
 * confirmCheckoutAuthorized — the ONLY way the frontend triggers the
 * post-authorization seller notification.
 *
 * Secure sequence:
 *   1. Browser completes stripe.confirmCardPayment (authorize only).
 *   2. Browser calls this function with ONLY { purchase_id }.
 *   3. Backend authenticates the buyer.
 *   4. Backend verifies the Purchase belongs to that buyer.
 *   5. Backend retrieves the Stripe PaymentIntent.
 *   6. Backend requires it to be `requires_capture` or already `succeeded`.
 *   7. Backend verifies PI metadata (purchase/listing/buyer/seller) + amount
 *      match the authoritative Purchase + Listing.
 *   8. Backend stamps `authorization_confirmed_at` (idempotency).
 *   9. Backend sends the predefined "ticket sold" notification to the seller
 *      via the shared module — the buyer cannot influence the content.
 *  10. Duplicate calls do not re-notify.
 *
 * If card authorization failed, `abortCheckout` is the cleanup path instead.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';
import Stripe from 'npm:stripe@14.21.0';
import { recordNotification } from '../../shared/notifications.ts';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { purchase_id } = await req.json();
    if (!purchase_id) return Response.json({ error: 'purchase_id is required' }, { status: 400 });

    const [purchase] = await base44.asServiceRole.entities.Purchase.filter({ id: purchase_id });
    if (!purchase) return Response.json({ error: 'Purchase not found' }, { status: 404 });

    // Only the buyer (or admin) may confirm their own checkout.
    if (purchase.buyer_email !== user.email && user.role !== 'admin') {
      return Response.json({ error: 'Not authorized for this purchase' }, { status: 403 });
    }
    if (purchase.is_demo) return Response.json({ status: 'demo' });
    if (purchase.transfer_status === 'expired') return Response.json({ error: 'Purchase is expired' }, { status: 409 });
    if (purchase.transfer_status === 'disputed') return Response.json({ error: 'Purchase is disputed' }, { status: 409 });
    if (purchase.transfer_status === 'completed') return Response.json({ status: 'already_completed' });

    // Idempotency: a repeat confirmation does not re-notify the seller.
    if (purchase.authorization_confirmed_at) {
      return Response.json({ status: 'already_confirmed', authorization_confirmed_at: purchase.authorization_confirmed_at });
    }

    const secretKey = Deno.env.get('STRIPELIVESECRETKEY');
    if (!secretKey || (!secretKey.startsWith('sk_test_') && !secretKey.startsWith('sk_live_'))) {
      return Response.json({ error: 'Stripe misconfigured' }, { status: 500 });
    }
    const stripe = new Stripe(secretKey);

    if (!purchase.payment_intent_id) {
      console.error('[confirmCheckoutAuthorized] missing payment_intent_id', purchase.id);
      return Response.json({ error: 'Payment verification failed' }, { status: 500 });
    }

    let pi;
    try {
      pi = await stripe.paymentIntents.retrieve(purchase.payment_intent_id);
    } catch (err) {
      console.error('[confirmCheckoutAuthorized] PI retrieve failed', purchase.id, err?.message);
      return Response.json({ error: 'Payment verification failed' }, { status: 500 });
    }

    // Require an authorized state.
    if (!['requires_capture', 'succeeded'].includes(pi.status)) {
      console.warn('[confirmCheckoutAuthorized] PI not authorized', purchase.id, pi.status);
      return Response.json({ error: 'Payment not authorized' }, { status: 402 });
    }

    // Verify PI metadata + amount tie this intent to the authoritative Purchase.
    let md = pi.metadata || {};
    if (md.purchase_id !== purchase.id) {
      if (!md.purchase_id) {
        try {
          const updated = await stripe.paymentIntents.update(purchase.payment_intent_id, { metadata: { purchase_id: purchase.id } });
          md = updated.metadata || md;
          md.purchase_id = purchase.id;
        } catch (err) {
          console.error('[confirmCheckoutAuthorized] failed to set purchase_id metadata', purchase.id, err?.message);
          return Response.json({ error: 'Payment verification failed' }, { status: 500 });
        }
      } else {
        console.error('[confirmCheckoutAuthorized] metadata purchase_id mismatch', purchase.id);
        return Response.json({ error: 'Payment verification failed' }, { status: 500 });
      }
    }
    if (md.listing_id !== purchase.listing_id || md.buyer_email !== purchase.buyer_email || md.seller_email !== purchase.seller_email) {
      console.error('[confirmCheckoutAuthorized] metadata mismatch', purchase.id);
      return Response.json({ error: 'Payment verification failed' }, { status: 500 });
    }
    if (Math.round((purchase.amount || 0) * 100) !== pi.amount) {
      console.error('[confirmCheckoutAuthorized] amount mismatch', purchase.id);
      return Response.json({ error: 'Payment verification failed' }, { status: 500 });
    }

    // Verify the listing + seller match the Purchase.
    const [listing] = await base44.asServiceRole.entities.Listing.filter({ id: purchase.listing_id }).catch(() => []);
    if (!listing || listing.seller_email !== purchase.seller_email) {
      console.error('[confirmCheckoutAuthorized] listing/seller mismatch', purchase.id);
      return Response.json({ error: 'Payment verification failed' }, { status: 500 });
    }

    // Stamp idempotency field BEFORE notifying so a concurrent duplicate call
    // re-fetches and short-circuits.
    const nowIso = new Date().toISOString();
    await base44.asServiceRole.entities.Purchase.update(purchase.id, { authorization_confirmed_at: nowIso });

    // Predefined seller notification — content is server-side, buyer-independent.
    recordNotification(base44, {
      user_email: purchase.seller_email,
      type: 'sale_created',
      title: '🎉 Your ticket sold!',
      body: `Tap to transfer your tickets and receive payment. Sec ${listing.section}, Row ${listing.row}.`,
      reference_type: 'purchase',
      reference_id: purchase.id,
      action_url: `/purchase/${purchase.id}`,
    }).catch(err => console.error('[confirmCheckoutAuthorized] seller notify failed', err?.message));

    return Response.json({ status: 'confirmed', authorization_confirmed_at: nowIso });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
});