/**
 * confirmCheckoutAuthorized — the ONLY way the frontend triggers the
 * post-authorization seller notification.
 *
 * CONCURRENCY & DELIVERY-INTEGRITY MODEL:
 *   1. Browser completes stripe.confirmCardPayment (authorize only).
 *   2. Browser calls this function with ONLY { purchase_id }.
 *   3. Backend authenticates the buyer + verifies the Purchase belongs to them.
 *   4. Authorization claim: if not already claimed, verify the Stripe PI is in
 *      an authorized state and atomically stamp `authorization_confirmed_at`
 *      (DB compare-and-set). Exactly one concurrent call does verification.
 *   5. Notification claim: a SEPARATE atomic compare-and-set on
 *      `seller_notified_at`. The winner creates the durable in-app Notification
 *      (awaited — the buyer request waits for this record before succeeding).
 *      A failed create releases the claim so a retry re-attempts; a crash in
 *      the tiny claim→create window is repaired by reconcilePurchaseOutcomes.
 *      `authorization_confirmed_at` is NOT proof of delivery.
 *   6. Push + email are attempted after the durable record and their per-channel
 *      status is recorded (seller_push_status / seller_email_status) so a failed
 *      channel can be retried without implying the in-app record is missing.
 *
 * If card authorization failed, `abortCheckout` is the cleanup path instead.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';
import Stripe from 'npm:stripe@14.21.0';
import { sendUserNotification } from '../../shared/notifications.ts';
import { releaseClaim } from '../../shared/atomicClaim.ts';

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

    // ── Step 1: Verify + claim authorization (exactly once) ──────────────────
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

      // Atomic claim: exactly one concurrent call records authorization.
      const nowIso = new Date().toISOString();
      const claimRes = await base44.asServiceRole.entities.Purchase.updateMany(
        { id: purchase.id, authorization_confirmed_at: null },
        { $set: { authorization_confirmed_at: nowIso } }
      ).catch(() => ({ updated: 0 }));
      // If claim lost, a concurrent call verified+claimed first — fall through.
      if ((claimRes?.updated || 0) === 0) {
        console.log('[confirmCheckoutAuthorized] authorization claim lost to concurrent call', purchase.id);
      }
    }

    // ── Step 2: Durable seller-sale notification (exactly once) ──────────────
    // Re-fetch latest (a concurrent call may have just notified).
    const [fresh] = await base44.asServiceRole.entities.Purchase.filter({ id: purchase.id });
    let sellerNotifiedAt = fresh?.seller_notified_at || null;

    if (!sellerNotifiedAt) {
      const nowIso = new Date().toISOString();
      const staleIso = new Date(Date.now() - 5 * 60000).toISOString();
      // Atomic claim with 5-min stale reclaim (self-heal after a crash).
      const claimRes = await base44.asServiceRole.entities.Purchase.updateMany(
        { id: purchase.id, $or: [ { seller_notified_at: null }, { seller_notified_at: '' }, { seller_notified_at: { $lt: staleIso } } ] },
        { $set: { seller_notified_at: nowIso } }
      ).catch(() => ({ updated: 0 }));

      if ((claimRes?.updated || 0) > 0) {
        const [listing] = await base44.asServiceRole.entities.Listing.filter({ id: purchase.listing_id }).catch(() => []);

        // Re-check for an existing durable notification (crash-reclaim safety).
        const existingNotif = await base44.asServiceRole.entities.Notification.filter({
          user_email: purchase.seller_email, type: 'sale_created', reference_id: purchase.id,
        }).catch(() => []);

        if (existingNotif.length === 0) {
          try {
            // Durable in-app record FIRST (await) — buyer request waits for this.
            await base44.asServiceRole.entities.Notification.create({
              user_email: purchase.seller_email,
              type: 'sale_created',
              title: '🎉 Your ticket sold!',
              body: `Tap to transfer your tickets and receive payment. Sec ${listing?.section || ''}, Row ${listing?.row || ''}.`,
              read: false,
              reference_type: 'purchase',
              reference_id: purchase.id,
              action_url: `/purchase/${purchase.id}`,
              icon: '🎟️',
            });
          } catch (err) {
            // Enqueue failed — release the claim so a retry re-attempts delivery.
            console.error('[confirmCheckoutAuthorized] notification create failed', purchase.id, err?.message);
            await releaseClaim(base44, 'Purchase', purchase.id, 'seller_notified_at', 'seller_notified_at');
            return Response.json({ error: 'Could not notify seller — please retry' }, { status: 500 });
          }
        }

        // Push + email: best-effort, tracked per channel (retryable later).
        let pushStatus = 'skipped', emailStatus = 'skipped';
        try {
          const dispatch = await sendUserNotification(base44, {
            user_email: purchase.seller_email,
            title: '🎉 Your ticket sold!',
            body: `Tap to transfer your tickets and receive payment. Sec ${listing?.section || ''}, Row ${listing?.row || ''}.`,
            type: 'sale_created',
            purchase_id: purchase.id,
          }).catch(() => ({}));
          pushStatus = dispatch?.push?.sent ? 'sent' : 'failed';
          emailStatus = dispatch?.email?.sent ? 'sent' : 'failed';
        } catch (_) {
          pushStatus = 'failed'; emailStatus = 'failed';
        }
        await base44.asServiceRole.entities.Purchase.update(purchase.id, {
          seller_push_status: pushStatus,
          seller_email_status: emailStatus,
        }).catch(() => {});
      }
      // If claim lost, a concurrent call is notifying/notified — nothing to do.
    }

    // Re-fetch final state for the response.
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