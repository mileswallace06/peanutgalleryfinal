/**
 * processTransferReminders
 * ────────────────────────
 * Scheduled function — runs every 5 minutes.
 * Sends conservative, non-spammy reminders for stalled transfers.
 *
 * Reminder cadence (measured from purchase created_date):
 *   Seller hasn't transferred:
 *     • 5 min  → first seller reminder
 *     • 15 min → final seller reminder
 *   Seller has transferred, buyer hasn't confirmed:
 *     • 5 min after seller_confirmed  → first buyer reminder
 *     • 15 min after seller_confirmed → final buyer reminder
 *
 * Idempotency: tracks sent reminders via Purchase.reminder_flags field
 * to prevent duplicates on retry.
 *
 * ADMIN ONLY — must not be callable by regular users.
 */

import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';
import Stripe from 'npm:stripe@14.21.0';

const SELLER_REMINDER_1_MS  =  5 * 60 * 1000;  //  5 min
const SELLER_REMINDER_2_MS  = 15 * 60 * 1000;  // 15 min
const BUYER_REMINDER_1_MS   =  5 * 60 * 1000;  //  5 min
const BUYER_REMINDER_2_MS   = 15 * 60 * 1000;  // 15 min

// CRITICAL-2: Escrow timeout — expire stale purchases before Stripe's 7-day auto-cancel
// 48 hours for seller to confirm; 24 hours for buyer to confirm after seller
const SELLER_EXPIRY_MS      = 48 * 60 * 60 * 1000;  // 48 hours
const BUYER_EXPIRY_MS       = 24 * 60 * 60 * 1000;  // 24 hours after seller confirmed

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);

  // Scheduled automations call without a real user session — allow service role only
  // but guard against direct user invocations
  let callerRole = null;
  try {
    const user = await base44.auth.me();
    callerRole = user?.role;
    if (callerRole && callerRole !== 'admin') {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }
  } catch (_) {
    // No session = called by automation scheduler — allow
  }

  const now = Date.now();
  let sent = 0;
  let skipped = 0;

  // Only look at active pending_transfer purchases
  const pending = await base44.asServiceRole.entities.Purchase.filter({
    transfer_status: 'pending_transfer',
  });

  for (const purchase of pending) {
    const flags = purchase.reminder_flags || {};
    const createdMs = new Date(purchase.created_date).getTime();
    const sellerConfirmedAt = purchase.seller_confirmed_at
      ? new Date(purchase.seller_confirmed_at).getTime()
      : null;

    // ── Seller reminders (hasn't confirmed transfer yet) ──────────────────
    if (!purchase.seller_confirmed) {
      const elapsedMs = now - createdMs;

      // Reminder 1: ~5 min after purchase
      if (elapsedMs >= SELLER_REMINDER_1_MS && !flags.seller_r1) {
        try {
          await base44.asServiceRole.functions.invoke('sendUserNotification', {
            user_email: purchase.seller_email,
            title: 'Transfer reminder',
            body: 'Your buyer is waiting. Send the tickets when you can.',
            type: 'seller_reminder',
            purchase_id: purchase.id,
          });
          await base44.asServiceRole.entities.Purchase.update(purchase.id, {
            reminder_flags: { ...flags, seller_r1: true },
          });
          sent++;
        } catch (err) {
          console.error('[reminders] seller_r1 failed for', purchase.id, err?.message);
        }
      }

      // Reminder 2: ~15 min after purchase (final)
      if (elapsedMs >= SELLER_REMINDER_2_MS && !flags.seller_r2) {
        try {
          await base44.asServiceRole.functions.invoke('sendUserNotification', {
            user_email: purchase.seller_email,
            title: 'Transfer reminder',
            body: 'Your buyer is waiting. Send the tickets when you can.',
            type: 'seller_reminder',
            purchase_id: purchase.id,
          });
          await base44.asServiceRole.entities.Purchase.update(purchase.id, {
            reminder_flags: { ...flags, seller_r2: true },
          });
          sent++;
        } catch (err) {
          console.error('[reminders] seller_r2 failed for', purchase.id, err?.message);
        }
      }
    }

    // ── Buyer reminders (seller confirmed, buyer hasn't yet) ──────────────
    if (purchase.seller_confirmed && !purchase.buyer_confirmed) {
      // Use seller_confirmed_at if stored, otherwise fall back to updated_date
      const confirmedAtMs = sellerConfirmedAt || new Date(purchase.updated_date).getTime();
      const elapsedSinceTransfer = now - confirmedAtMs;

      // Reminder 1: ~5 min after seller confirmed
      if (elapsedSinceTransfer >= BUYER_REMINDER_1_MS && !flags.buyer_r1) {
        try {
          await base44.asServiceRole.functions.invoke('sendUserNotification', {
            user_email: purchase.buyer_email,
            title: 'Confirm your tickets',
            body: "Let us know once your tickets are safely received.",
            type: 'buyer_reminder',
            purchase_id: purchase.id,
          });
          await base44.asServiceRole.entities.Purchase.update(purchase.id, {
            reminder_flags: { ...flags, buyer_r1: true },
          });
          sent++;
        } catch (err) {
          console.error('[reminders] buyer_r1 failed for', purchase.id, err?.message);
        }
      }

      // Reminder 2: ~15 min after seller confirmed (final)
      if (elapsedSinceTransfer >= BUYER_REMINDER_2_MS && !flags.buyer_r2) {
        try {
          await base44.asServiceRole.functions.invoke('sendUserNotification', {
            user_email: purchase.buyer_email,
            title: 'Confirm your tickets',
            body: "Let us know once your tickets are safely received.",
            type: 'buyer_reminder',
            purchase_id: purchase.id,
          });
          await base44.asServiceRole.entities.Purchase.update(purchase.id, {
            reminder_flags: { ...flags, buyer_r2: true },
          });
          sent++;
        } catch (err) {
          console.error('[reminders] buyer_r2 failed for', purchase.id, err?.message);
        }
      }
    }

    if (!sent) skipped++;

    // ── CRITICAL-2: Escrow timeout — auto-expire stale purchases ─────────────
    const elapsedTotal = now - createdMs;

    // Case A: Seller never confirmed within 48h
    if (!purchase.seller_confirmed && elapsedTotal >= SELLER_EXPIRY_MS) {
      try {
        const secretKey = Deno.env.get('STRIPELIVESECRETKEY');
        if (secretKey) {
          const stripe = new Stripe(secretKey);
          try {
            const pi = await stripe.paymentIntents.retrieve(purchase.payment_intent_id);
            if (pi.status === 'requires_capture') {
              await stripe.paymentIntents.cancel(purchase.payment_intent_id);
            }
          } catch (stripeErr) {
            console.error('[reminders] stripe cancel failed for', purchase.id, stripeErr?.message);
          }
        }
        await base44.asServiceRole.entities.Purchase.update(purchase.id, { transfer_status: 'expired' });
        await base44.asServiceRole.entities.Listing.update(purchase.listing_id, { status: 'active' });
        await base44.asServiceRole.functions.invoke('sendUserNotification', {
          user_email: purchase.buyer_email,
          title: 'Purchase expired — refund issued',
          body: 'The seller did not transfer your tickets in time. Your payment was not captured.',
          type: 'purchase_expired',
          purchase_id: purchase.id,
        }).catch(() => {});
        await base44.asServiceRole.functions.invoke('sendUserNotification', {
          user_email: purchase.seller_email,
          title: 'Your listing expired',
          body: 'You did not confirm the transfer within 48 hours. The listing has been restored.',
          type: 'listing_expired',
          purchase_id: purchase.id,
        }).catch(() => {});
        console.log('[reminders] AUTO-EXPIRED purchase (seller no-show):', purchase.id);
        sent++;
      } catch (err) {
        console.error('[reminders] expiry failed for', purchase.id, err?.message);
      }
      continue;
    }

    // Case B: Seller confirmed but buyer never confirmed within 24h
    if (purchase.seller_confirmed && !purchase.buyer_confirmed && sellerConfirmedAt) {
      const elapsedSinceTransfer = now - sellerConfirmedAt;
      if (elapsedSinceTransfer >= BUYER_EXPIRY_MS) {
        try {
          // Auto-complete on buyer's behalf after 24h (seller transferred, buyer just didn't tap confirm)
          await base44.asServiceRole.entities.Purchase.update(purchase.id, {
            transfer_status: 'completed',
            buyer_confirmed: true,
            payment_captured: true,
            transfer_notes: (purchase.transfer_notes || '') + ' [Auto-confirmed after 24h buyer inactivity]',
          });
          await base44.asServiceRole.entities.Listing.update(purchase.listing_id, { status: 'sold' });
          // Note: Stripe capture should have been attempted by the seller confirm step.
          // If not yet captured, attempt now.
          const secretKey = Deno.env.get('STRIPELIVESECRETKEY');
          if (secretKey && !purchase.payment_captured) {
            const stripe = new Stripe(secretKey);
            const pi = await stripe.paymentIntents.retrieve(purchase.payment_intent_id).catch(() => null);
            if (pi?.status === 'requires_capture') {
              await stripe.paymentIntents.capture(purchase.payment_intent_id, {
                idempotencyKey: `autocapture-${purchase.id}`,
              }).catch(err => console.error('[reminders] auto-capture failed:', err?.message));
            }
          }
          await base44.asServiceRole.functions.invoke('sendUserNotification', {
            user_email: purchase.seller_email,
            title: 'Sale auto-completed 💸',
            body: 'Your transfer was auto-confirmed after 24 hours. Payout is processing.',
            type: 'sale_complete',
            purchase_id: purchase.id,
          }).catch(() => {});
          console.log('[reminders] AUTO-COMPLETED purchase (buyer inactivity):', purchase.id);
          sent++;
        } catch (err) {
          console.error('[reminders] auto-complete failed for', purchase.id, err?.message);
        }
        continue;
      }
    }
  }

  console.log(`[processTransferReminders] done. sent=${sent} skipped=${skipped} total=${pending.length}`);
  return Response.json({ sent, skipped, total: pending.length });
});