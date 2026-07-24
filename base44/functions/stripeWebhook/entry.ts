/**
 * stripeWebhook — Public Stripe webhook handler (no auth required)
 *
 * PUBLIC endpoint — no Base44 auth.me() call. Stripe calls this directly.
 * Verifies Stripe signature using STRIPE_WEBHOOK_SECRET.
 *
 * All push/email/in-app dispatch uses the shared `notifications` module
 * in-process (sendUserNotification / sendTransactionalEmail) — never invokes
 * a public function, so there is no spoofable internal-call header and no
 * dependency on an authenticated user session.
 *
 * Handles:
 *   payment_intent.payment_failed
 *   payment_intent.succeeded
 *   payout.failed
 *   transfer.failed
 *   charge.dispute.created
 *   charge.refunded
 */

import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';
import Stripe from 'npm:stripe@14.21.0';
import { sendUserNotification, sendTransactionalEmail } from '../../shared/notifications.ts';

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

  const type = event.type;
  const data = event.data?.object;

  console.log('[stripeWebhook] event received:', type, data?.id);

  try {
    if (type === 'payout.failed' || type === 'transfer.failed') {
      // Find purchases linked to this payout destination account
      const accountId = data.destination || data.source_transaction;
      const [sellerUser] = await base44.asServiceRole.entities.User.filter({ stripe_account_id: accountId }).catch(() => []);

      if (sellerUser) {
        await sendUserNotification(base44, {
          user_email: sellerUser.email,
          title: type === 'payout.failed' ? 'Payout failed ⚠️' : 'Transfer issue ⚠️',
          body: 'There was a problem with your payout. Please check your Stripe account and update your bank details.',
          type: 'admin_message',
          purchase_id: null,
        }).catch(() => {});

        // Notify admin
        await sendTransactionalEmail(base44, 'experience@peanutgallery.store',
          `⚠️ Stripe ${type} — ${sellerUser.email}`,
          `Stripe event: ${type}\nSeller: ${sellerUser.email}\nAccount: ${accountId}\nAmount: ${data.amount ? '$' + (data.amount / 100).toFixed(2) : 'unknown'}\nReason: ${data.failure_message || data.failure_code || 'unknown'}\n\nReview in Stripe dashboard.`
        ).catch(() => {});
      }
    }

    if (type === 'payment_intent.payment_failed') {
      const piId = data.id;
      const purchases = await base44.asServiceRole.entities.Purchase.filter({ payment_intent_id: piId }).catch(() => []);
      const purchase = purchases[0];

      if (purchase) {
        await sendUserNotification(base44, {
          user_email: purchase.buyer_email,
          title: 'Payment failed',
          body: 'Your payment could not be processed. Please try again or use a different card.',
          type: 'transfer_rejected',
          purchase_id: purchase.id,
        }).catch(() => {});

        // Restore listing
        if (purchase.transfer_status === 'pending_transfer') {
          await base44.asServiceRole.entities.Purchase.update(purchase.id, { transfer_status: 'expired' });
          await base44.asServiceRole.entities.Listing.update(purchase.listing_id, { status: 'active' }).catch(() => {});
        }
      }
    }

    if (type === 'payment_intent.succeeded') {
      const piId = data.id;
      const purchases = await base44.asServiceRole.entities.Purchase.filter({ payment_intent_id: piId }).catch(() => []);
      const purchase = purchases[0];
      if (purchase && !purchase.payment_captured) {
        // Mark payment as captured — Stripe has confirmed the money.
        await base44.asServiceRole.entities.Purchase.update(purchase.id, { payment_captured: true }).catch(() => {});

        // If the purchase is still pending_transfer, capturePayment didn't finish its
        // DB updates (possible crash after Stripe capture but before listing-sold update).
        // Alert admin so they can manually complete the purchase.
        if (purchase.transfer_status === 'pending_transfer') {
          await sendTransactionalEmail(base44, 'experience@peanutgallery.store',
            `⚠️ Payment captured but purchase not completed — ${purchase.id}`,
            `Stripe confirmed payment capture, but the purchase record was not fully updated (capturePayment may have crashed after capture).\n\nPurchase: ${purchase.id}\nBuyer: ${purchase.buyer_email}\nSeller: ${purchase.seller_email}\nAmount: $${purchase.amount?.toFixed(2)}\nPaymentIntent: ${piId}\n\nACTION: Verify in Stripe dashboard that payment is captured, then manually complete the purchase in the admin panel:\n1. Set transfer_status to 'completed'\n2. Mark listing as 'sold'\n3. Notify buyer and seller`
          ).catch(() => {});
        }
      }
      console.log('[stripeWebhook] payment_intent.succeeded:', piId);
    }

    if (type === 'charge.dispute.created') {
      const chargeId = data.payment_intent;
      const purchases = await base44.asServiceRole.entities.Purchase.filter({ payment_intent_id: chargeId }).catch(() => []);
      const purchase = purchases[0];
      const buyerEmail = purchase?.buyer_email || 'unknown';
      const amount = data.amount ? '$' + (data.amount / 100).toFixed(2) : 'unknown';

      await sendTransactionalEmail(base44, 'experience@peanutgallery.store',
        `🚨 Stripe Dispute Created — ${buyerEmail}`,
        `A chargeback dispute was created.\nBuyer: ${buyerEmail}\nAmount: ${amount}\nReason: ${data.reason || 'unknown'}\nDispute ID: ${data.id}\nPayment Intent: ${chargeId}\n\nReview in Stripe dashboard immediately.`
      ).catch(() => {});

      if (purchase) {
        await base44.asServiceRole.entities.Purchase.update(purchase.id, { transfer_status: 'disputed', dispute_reason: data.reason || 'chargeback' }).catch(() => {});
      }
      console.log('[stripeWebhook] dispute created:', data.id);
    }

    if (type === 'charge.refunded') {
      const piId = data.payment_intent;
      const purchases = await base44.asServiceRole.entities.Purchase.filter({ payment_intent_id: piId }).catch(() => []);
      const purchase = purchases[0];
      if (purchase) {
        await sendTransactionalEmail(base44, 'experience@peanutgallery.store',
          `💸 Stripe Refund — ${purchase.buyer_email}`,
          `A refund was issued.\nBuyer: ${purchase.buyer_email}\nAmount: $${(data.amount_refunded / 100).toFixed(2)}\nPayment Intent: ${piId}`
        ).catch(() => {});
      }
      console.log('[stripeWebhook] charge.refunded:', data.id);
    }

  } catch (err) {
    console.error('[stripeWebhook] handler error:', err.message);
    // Return 200 to prevent Stripe retries for non-retriable errors
    return Response.json({ received: true, warning: err.message });
  }

  return Response.json({ received: true });
});