/**
 * abortCheckout — Purchase-scoped cleanup for an in-flight checkout.
 *
 * Called by the frontend whenever card confirmation fails or the dialog is
 * closed AFTER createCheckout has created a Purchase (and thus a PaymentIntent
 * + reservation). Replaces the generic releaseReservation for that phase.
 *
 *   1. Authenticate the buyer (or admin).
 *   2. Verify the Purchase belongs to that buyer.
 *   3. Refuse to abort captured / completed / disputed / demo purchases.
 *   4. Retrieve and safely cancel the PaymentIntent when its state allows it
 *      (requires_payment_method / requires_confirmation / requires_action /
 *      processing / requires_capture). Never touch a succeeded/canceled PI.
 *   5. Mark the abandoned Purchase expired.
 *   6. Release the Listing only if it still belongs to this Purchase/reservation.
 *   7. Idempotent — re-aborting an already-expired purchase is a no-op.
 *
 * Expiring a Purchase does NOT affect seller trust, buyer trust, points, or
 * transfer intelligence (recordTransferOutcome only acts on completed/disputed).
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';
import Stripe from 'npm:stripe@14.21.0';

const CANCELLABLE_STATUSES = [
  'requires_payment_method',
  'requires_confirmation',
  'requires_action',
  'processing',
  'requires_capture',
];

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const user = await base44.auth.me();
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  const secretKey = Deno.env.get('STRIPELIVESECRETKEY');
  if (!secretKey || (!secretKey.startsWith('sk_test_') && !secretKey.startsWith('sk_live_'))) {
    return Response.json({ error: 'Stripe secret key misconfigured' }, { status: 500 });
  }
  const stripe = new Stripe(secretKey);

  const { purchase_id } = await req.json().catch(() => ({}));
  if (!purchase_id) return Response.json({ error: 'purchase_id is required' }, { status: 400 });

  const [purchase] = await base44.asServiceRole.entities.Purchase.filter({ id: purchase_id });
  if (!purchase) return Response.json({ error: 'Purchase not found' }, { status: 404 });

  // Only the buyer (or admin) may abort their own checkout.
  if (purchase.buyer_email !== user.email && user.role !== 'admin') {
    return Response.json({ error: 'Not authorized' }, { status: 403 });
  }

  // Idempotent: already terminal.
  if (purchase.transfer_status === 'expired') return Response.json({ status: 'already_expired' });
  if (purchase.transfer_status === 'disputed') return Response.json({ status: 'already_disputed' });

  // Refuse to abort captured / completed purchases.
  if (purchase.payment_captured || purchase.transfer_status === 'completed') {
    return Response.json({ error: 'Cannot abort a completed purchase' }, { status: 409 });
  }
  if (purchase.is_demo) {
    return Response.json({ error: 'Cannot abort a demo purchase' }, { status: 409 });
  }

  // Safely cancel the PaymentIntent when appropriate.
  let piStatus = null;
  if (purchase.payment_intent_id) {
    try {
      const pi = await stripe.paymentIntents.retrieve(purchase.payment_intent_id);
      piStatus = pi.status;
      if (CANCELLABLE_STATUSES.includes(pi.status)) {
        try {
          await stripe.paymentIntents.cancel(purchase.payment_intent_id);
        } catch (e) {
          // Already canceled / incompatible state — safe to ignore.
          console.warn('[abortCheckout] cancel failed', purchase.id, e?.message);
        }
      }
    } catch (err) {
      console.warn('[abortCheckout] PI retrieve failed', purchase.id, err?.message);
    }
  }

  // Mark the abandoned Purchase expired.
  await base44.asServiceRole.entities.Purchase.update(purchase.id, { transfer_status: 'expired' }).catch(() => {});

  // Release the Listing only if it still belongs to this Purchase/reservation.
  const [listing] = await base44.asServiceRole.entities.Listing.filter({ id: purchase.listing_id }).catch(() => []);
  if (listing && listing.status === 'pending_transfer') {
    const ownsByBuyer = listing.reserved_by_email === purchase.buyer_email;
    const ownsByToken = !!(purchase.reservation_token && listing.reservation_token === purchase.reservation_token);
    if (ownsByBuyer || ownsByToken) {
      await base44.asServiceRole.entities.Listing.update(listing.id, {
        status: 'active',
        reservation_token: null,
        reservation_expires_at: null,
        reserved_by_email: null,
      }).catch(() => {});
    }
  }

  return Response.json({ status: 'expired', pi_status: piStatus });
});