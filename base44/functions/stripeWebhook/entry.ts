/**
 * stripeWebhook — INV-2: Handle Stripe failure events
 *
 * Listens for:
 *   - payout.failed         → notify seller, flag for admin
 *   - transfer.failed       → notify seller, flag for admin
 *   - payment_intent.payment_failed → notify buyer
 *
 * Register this endpoint URL in your Stripe dashboard:
 *   Dashboard → Developers → Webhooks → Add endpoint
 *   URL: <your-function-url>/stripeWebhook
 *   Events: payout.failed, transfer.failed, payment_intent.payment_failed
 */

import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';
import Stripe from 'npm:stripe@14.21.0';

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const secretKey = Deno.env.get('STRIPELIVESECRETKEY');
  const webhookSecret = Deno.env.get('STRIPE_WEBHOOK_SECRET');

  if (!secretKey) {
    return Response.json({ error: 'Stripe not configured' }, { status: 500 });
  }

  const stripe = new Stripe(secretKey);
  const body = await req.text();
  const sig = req.headers.get('stripe-signature');

  let event;
  if (webhookSecret && sig) {
    try {
      event = await stripe.webhooks.constructEventAsync(body, sig, webhookSecret);
    } catch (err) {
      console.error('[stripeWebhook] Signature verification failed:', err.message);
      return Response.json({ error: 'Invalid signature' }, { status: 400 });
    }
  } else {
    // No webhook secret configured — parse raw (dev/test only)
    try {
      event = JSON.parse(body);
    } catch {
      return Response.json({ error: 'Invalid JSON' }, { status: 400 });
    }
    console.warn('[stripeWebhook] No STRIPE_WEBHOOK_SECRET set — skipping signature verification (unsafe in production)');
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
        await base44.asServiceRole.functions.invoke('sendUserNotification', {
          user_email: sellerUser.email,
          title: type === 'payout.failed' ? 'Payout failed ⚠️' : 'Transfer issue ⚠️',
          body: 'There was a problem with your payout. Please check your Stripe account and update your bank details.',
          type: 'payout_failed',
          purchase_id: null,
        }).catch(() => {});

        // Notify admin
        await base44.asServiceRole.functions.invoke('sendNotificationEmail', {
          to: 'experience@peanutgallery.store',
          subject: `⚠️ Stripe ${type} — ${sellerUser.email}`,
          body: `Stripe event: ${type}\nSeller: ${sellerUser.email}\nAccount: ${accountId}\nAmount: ${data.amount ? '$' + (data.amount / 100).toFixed(2) : 'unknown'}\nReason: ${data.failure_message || data.failure_code || 'unknown'}\n\nReview in Stripe dashboard.`,
        }).catch(() => {});
      }
    }

    if (type === 'payment_intent.payment_failed') {
      const piId = data.id;
      // Find the purchase with this PI
      const purchases = await base44.asServiceRole.entities.Purchase.filter({ payment_intent_id: piId }).catch(() => []);
      const purchase = purchases[0];

      if (purchase) {
        await base44.asServiceRole.functions.invoke('sendUserNotification', {
          user_email: purchase.buyer_email,
          title: 'Payment failed',
          body: 'Your payment could not be processed. Please try again or use a different card.',
          type: 'payment_failed',
          purchase_id: purchase.id,
        }).catch(() => {});

        // Restore listing
        if (purchase.transfer_status === 'pending_transfer') {
          await base44.asServiceRole.entities.Purchase.update(purchase.id, { transfer_status: 'expired' });
          await base44.asServiceRole.entities.Listing.update(purchase.listing_id, { status: 'active' }).catch(() => {});
        }
      }
    }
  } catch (err) {
    console.error('[stripeWebhook] handler error:', err.message);
    // Return 200 to prevent Stripe retries for non-retriable errors
    return Response.json({ received: true, warning: err.message });
  }

  return Response.json({ received: true });
});