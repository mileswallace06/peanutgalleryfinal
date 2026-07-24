/**
 * cleanupAbandonedCheckouts — scheduled recovery for abandoned server-created
 * checkouts whose PaymentIntents were never successfully authorized.
 *
 * Runs every 10 minutes. For each pending, non-captured, non-demo Purchase
 * older than the 10-minute checkout window:
 *
 *   1. Retrieve the PaymentIntent.
 *   2. If it never reached `requires_capture` or `succeeded`, cancel it when
 *      possible.
 *   3. Mark the Purchase `expired`.
 *   4. Release the Listing + reservation if it still belongs to this buyer.
 *
 * This is NOT treated as a seller transfer failure: no points, no trust
 * changes, no transfer intelligence, no admin alerts (recordTransferOutcome
 * only acts on completed/disputed transitions). It guarantees an abandoned
 * pending Purchase does not permanently prevent reservation cleanup.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';
import Stripe from 'npm:stripe@14.21.0';

const ABANDONED_MS = 10 * 60 * 1000; // 10-minute checkout window

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);

  const secretKey = Deno.env.get('STRIPELIVESECRETKEY');
  if (!secretKey || (!secretKey.startsWith('sk_test_') && !secretKey.startsWith('sk_live_'))) {
    return Response.json({ error: 'Stripe secret key misconfigured' }, { status: 500 });
  }
  const stripe = new Stripe(secretKey);

  const pending = await base44.asServiceRole.entities.Purchase.filter({
    transfer_status: 'pending_transfer',
    payment_captured: false,
  }).catch(() => []);

  const now = Date.now();
  let expired = 0;
  let released = 0;
  let skippedRecent = 0;
  let skippedAuthorized = 0;
  let skippedDemo = 0;
  let errors = 0;

  for (const p of pending) {
    try {
      // Skip demo purchases — they never involve real authorization.
      if (p.is_demo === true) { skippedDemo++; continue; }

      // Only process purchases older than the checkout window.
      const created = p.created_date ? new Date(p.created_date).getTime() : 0;
      if (now - created < ABANDONED_MS) { skippedRecent++; continue; }

      // Retrieve the PaymentIntent to determine its actual state.
      let piStatus = null;
      if (p.payment_intent_id) {
        try {
          const pi = await stripe.paymentIntents.retrieve(p.payment_intent_id);
          piStatus = pi.status;
        } catch (err) {
          console.warn('[cleanupAbandonedCheckouts] PI retrieve failed', p.id, err?.message);
        }
      }

      // If the PI reached an authorized state (requires_capture or succeeded),
      // the buyer may still confirm — leave it alone.
      if (piStatus && ['requires_capture', 'succeeded'].includes(piStatus)) {
        skippedAuthorized++;
        continue;
      }

      // Never authorized — cancel the PI when possible.
      if (p.payment_intent_id && piStatus) {
        try {
          await stripe.paymentIntents.cancel(p.payment_intent_id);
        } catch (_) {
          // Already canceled / incompatible — ignore.
        }
      }

      // Mark the Purchase expired.
      await base44.asServiceRole.entities.Purchase.update(p.id, { transfer_status: 'expired' }).catch(() => {});
      expired++;

      // Release the Listing if it still belongs to this buyer/reservation.
      const [listing] = await base44.asServiceRole.entities.Listing.filter({ id: p.listing_id }).catch(() => []);
      if (listing && listing.status === 'pending_transfer') {
        const ownsByBuyer = listing.reserved_by_email === p.buyer_email;
        const ownsByToken = !!(p.reservation_token && listing.reservation_token === p.reservation_token);
        if (ownsByBuyer || ownsByToken) {
          await base44.asServiceRole.entities.Listing.update(listing.id, {
            status: 'active',
            reservation_token: null,
            reservation_expires_at: null,
            reserved_by_email: null,
          }).catch(() => {});
          released++;
        }
      }
    } catch (err) {
      console.error('[cleanupAbandonedCheckouts] error processing', p.id, err?.message);
      errors++;
    }
  }

  return Response.json({
    processed: pending.length,
    expired,
    released,
    skipped_recent: skippedRecent,
    skipped_authorized: skippedAuthorized,
    skipped_demo: skippedDemo,
    errors,
  });
});