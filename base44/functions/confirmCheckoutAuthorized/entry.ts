/**
 * confirmCheckoutAuthorized — the ONLY way the frontend triggers the
 * post-authorization seller notification.
 *
 * CONCURRENCY & DELIVERY-INTEGRITY MODEL (Base44 has NO atomic claim — proven):
 *   1. Browser completes stripe.confirmCardPayment (authorize only).
 *   2. Browser calls this function with ONLY { purchase_id }.
 *   3. Backend authenticates the buyer + verifies the Purchase belongs to them.
 *   4. Authorization: verify the Stripe PI is authorized (idempotent retrieve),
 *      then stamp `authorization_confirmed_at` with an idempotent $set. The PI
 *      retrieve is safe to repeat; the timestamp is a marker (last writer wins,
 *      harmless). No conditional claim — it is non-atomic on this platform.
 *   5. Durable seller-sale Notification: existence check (filter for an existing
 *      sale_created notification for this purchase). Create only if absent
 *      (sequentially safe). Set `seller_notified_at` (idempotent marker) after.
 *      Concurrent calls can rarely win the existence-check race and create a
 *      duplicate notification; reconcilePurchaseOutcomes dedupes these to one.
 *   6. Push + email are attempted after the durable record and their per-channel
 *      status is recorded (seller_push_status / seller_email_status) so a failed
 *      channel can be retried without implying the in-app record is missing.
 *
 * If card authorization failed, `abortCheckout` is the cleanup path instead.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';
import Stripe from 'npm:stripe@14.21.0';
import { enqueueSaleNotification } from '../../shared/saleNotification.ts';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { purchase_id } = await req.json();
    if (!purchase_id) return Response.json({ error: 'purchase_id is required' }, { status: 400 });

    const [purchase] = await base44.asServiceRole.entities.Purchase.filter({ id: purchase_id });
    if (!purchase) return Response.json({ error: 'Purchase not found' }, { status: 404 });

    if (purchase.buyer_email !== user.email && user.role !== 'admin') {
      return Response.json({ error: 'Not authorized for this purchase' }, { status: 403 });
    }
    if (purchase.is_demo) return Response.json({ status: 'demo' });
    if (purchase.transfer_status === 'expired') return Response.json({ error: 'Purchase is expired' }, { status: 409 });
    if (purchase.transfer_status === 'disputed') return Response.json({ error: 'Purchase is disputed' }, { status: 409 });
    if (purchase.transfer_status === 'completed') return Response.json({ status: 'already_completed' });

    // ── Step 1: Verify authorization (idempotent; skip if already confirmed) ──
    if (!purchase.authorization_confirmed_at) {
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

      if (!['requires_capture', 'succeeded'].includes(pi.status)) {
        console.warn('[confirmCheckoutAuthorized] PI not authorized', purchase.id, pi.status);
        return Response.json({ error: 'Payment not authorized' }, { status: 402 });
      }

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

      const [listing] = await base44.asServiceRole.entities.Listing.filter({ id: purchase.listing_id }).catch(() => []);
      if (!listing || listing.seller_email !== purchase.seller_email) {
        console.error('[confirmCheckoutAuthorized] listing/seller mismatch', purchase.id);
        return Response.json({ error: 'Payment verification failed' }, { status: 500 });
      }

      // Idempotent marker — concurrent calls both set it (last timestamp wins,
      // harmless). No conditional claim (non-atomic on this platform).
      await base44.asServiceRole.entities.Purchase.update(purchase.id, {
        authorization_confirmed_at: new Date().toISOString(),
      }).catch(() => {});
    }

    // ── Step 2: Enqueue the seller-sale notification (NO inline send) ──────────
    // Delivery is WITHHELD until the scheduled dispatcher (dispatchSaleNotifications,
    // every 1 min) selects ONE canonical record per idempotency key and sends. This
    // holds provider calls to <=1 push and <=1 email per logical sale notification
    // even when N concurrent calls each win the existence-check race —
    // reconciliation can dedupe DB records but cannot un-send a delivered push/email.
    const [listing] = await base44.asServiceRole.entities.Listing.filter({ id: purchase.listing_id }).catch(() => []);
    try {
      await enqueueSaleNotification(base44, purchase, listing);
    } catch (err) {
      console.error('[confirmCheckoutAuthorized] enqueue failed', purchase.id, err?.message);
      return Response.json({ error: 'Could not notify seller — please retry' }, { status: 500 });
    }

    const [finalPurchase] = await base44.asServiceRole.entities.Purchase.filter({ id: purchase.id });
    return Response.json({
      status: 'confirmed',
      authorization_confirmed_at: finalPurchase?.authorization_confirmed_at || null,
      seller_notified_at: finalPurchase?.seller_notified_at || null,
    });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
});