/**
 * processTransferReminders
 * ────────────────────────
 * Scheduled function — runs every 5 minutes.
 * Sends reminders for stalled transfers and expires/auto-reviews stale purchases.
 *
 * CRITICAL-B FIX: Auto-complete is replaced with auto_confirmed_pending_review.
 * No automatic Stripe capture happens without admin approval.
 *
 * Also handles:
 * - Expired listing reservations (clears reservation_token after 10min)
 * - Stale PI safety net (purchases > 6 days old alert admin)
 */

import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';
import Stripe from 'npm:stripe@14.21.0';

const SELLER_REMINDER_1_MS  =  5 * 60 * 1000;  //  5 min
const SELLER_REMINDER_2_MS  = 15 * 60 * 1000;  // 15 min
const BUYER_REMINDER_1_MS   =  5 * 60 * 1000;
const BUYER_REMINDER_2_MS   = 15 * 60 * 1000;

const SELLER_EXPIRY_MS      = 48 * 60 * 60 * 1000;  // 48h seller expiry
const BUYER_REVIEW_MS       = 24 * 60 * 60 * 1000;  // 24h → admin review (no auto-capture)
const STALE_PI_WARN_MS      =  6 * 24 * 60 * 60 * 1000; // 6 days → warn before 7-day Stripe expiry

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);

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
  let expired = 0;
  let reviewed = 0;
  let reservationsCleared = 0;

  const secretKey = Deno.env.get('STRIPELIVESECRETKEY');
  const stripe = secretKey ? new Stripe(secretKey) : null;

  // ── SCALE-1: Only process purchases from last 72h + higher limit
  const cutoff = new Date(now - 72 * 60 * 60 * 1000).toISOString();
  const pending = await base44.asServiceRole.entities.Purchase.filter({
    transfer_status: 'pending_transfer',
    created_date: { $gte: cutoff },
  }, '-created_date', 500);

  for (const purchase of pending) {
    const flags = purchase.reminder_flags || {};
    const createdMs = new Date(purchase.created_date).getTime();
    const sellerConfirmedAt = purchase.seller_confirmed_at
      ? new Date(purchase.seller_confirmed_at).getTime()
      : null;

    // ── Seller reminders ─────────────────────────────────────────────────────
    if (!purchase.seller_confirmed) {
      const elapsedMs = now - createdMs;

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

      if (elapsedMs >= SELLER_REMINDER_2_MS && !flags.seller_r2) {
        try {
          await base44.asServiceRole.functions.invoke('sendUserNotification', {
            user_email: purchase.seller_email,
            title: '⚠️ Final transfer reminder',
            body: 'Please transfer tickets within 48 hours or the purchase will be cancelled.',
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

    // ── Buyer reminders ──────────────────────────────────────────────────────
    if (purchase.seller_confirmed && !purchase.buyer_confirmed) {
      const confirmedAtMs = sellerConfirmedAt || new Date(purchase.updated_date).getTime();
      const elapsedSinceTransfer = now - confirmedAtMs;

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

      if (elapsedSinceTransfer >= BUYER_REMINDER_2_MS && !flags.buyer_r2) {
        try {
          await base44.asServiceRole.functions.invoke('sendUserNotification', {
            user_email: purchase.buyer_email,
            title: '⏰ Please confirm your tickets',
            body: "Your seller says tickets are transferred. If you haven't received them, open a dispute.",
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

    const elapsedTotal = now - createdMs;

    // ── Case A: Seller never confirmed within 48h → expire ───────────────────
    if (!purchase.seller_confirmed && elapsedTotal >= SELLER_EXPIRY_MS) {
      try {
        if (stripe) {
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
        await base44.asServiceRole.entities.Listing.update(purchase.listing_id, {
          status: 'active',
          reservation_token: null,
          reservation_expires_at: null,
          reserved_by_email: null,
        }).catch(() => {});
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
        expired++;
      } catch (err) {
        console.error('[reminders] expiry failed for', purchase.id, err?.message);
      }
      continue;
    }

    // ── Case B: CRITICAL-B FIX — Seller confirmed, buyer inactive 24h
    // Do NOT auto-capture. Flag for admin review instead.
    if (purchase.seller_confirmed && !purchase.buyer_confirmed && sellerConfirmedAt) {
      const elapsedSinceTransfer = now - sellerConfirmedAt;
      if (elapsedSinceTransfer >= BUYER_REVIEW_MS && !purchase.auto_review_flagged) {
        try {
          await base44.asServiceRole.entities.Purchase.update(purchase.id, {
            auto_review_flagged: true,
            auto_review_flagged_at: new Date().toISOString(),
            transfer_notes: (purchase.transfer_notes || '') + ' [Flagged: buyer inactive 24h — pending admin review]',
          });

          // Notify admin
          await base44.asServiceRole.functions.invoke('sendNotificationEmail', {
            to: 'experience@peanutgallery.store',
            subject: `⏰ Admin Review Required — Buyer Inactive 24h — Purchase ${purchase.id}`,
            body: `A purchase needs admin review.\n\nBuyer (${purchase.buyer_email}) has not confirmed ticket receipt 24 hours after seller confirmation.\n\nPurchase ID: ${purchase.id}\nSeller: ${purchase.seller_email}\nAmount: $${purchase.amount?.toFixed(2)}\nSeller confirmed at: ${purchase.seller_confirmed_at}\n\nOptions:\n1. Approve capture via admin panel if transfer is confirmed legitimate\n2. Open dispute if seller transfer cannot be verified\n3. Wait longer — Stripe PI valid for 7 days from purchase\n\nDo NOT ignore — Stripe PI expires ${new Date(new Date(purchase.created_date).getTime() + 7*24*60*60*1000).toLocaleDateString()}.`,
          }).catch(() => {});

          // Notify buyer with urgency
          await base44.asServiceRole.functions.invoke('sendUserNotification', {
            user_email: purchase.buyer_email,
            title: '⚠️ Action required — confirm your tickets',
            body: 'Your seller confirmed your tickets were sent 24h ago. Please confirm receipt or open a dispute. Your payment is on hold.',
            type: 'buyer_action_required',
            purchase_id: purchase.id,
          }).catch(() => {});

          // Notify seller
          await base44.asServiceRole.functions.invoke('sendUserNotification', {
            user_email: purchase.seller_email,
            title: 'Awaiting admin review',
            body: 'Your buyer has not confirmed receipt. Our team is reviewing your transfer. Payout may be slightly delayed.',
            type: 'seller_info',
            purchase_id: purchase.id,
          }).catch(() => {});

          console.log('[reminders] FLAGGED for admin review (buyer inactive 24h):', purchase.id);
          reviewed++;
        } catch (err) {
          console.error('[reminders] auto-review flag failed for', purchase.id, err?.message);
        }
        continue;
      }
    }

    // ── Stale PI safety net: warn admin if purchase > 6 days old ─────────────
    if (elapsedTotal >= STALE_PI_WARN_MS && !flags.stale_pi_warned) {
      try {
        await base44.asServiceRole.functions.invoke('sendNotificationEmail', {
          to: 'experience@peanutgallery.store',
          subject: `🚨 Stripe PI Expiring Tomorrow — Purchase ${purchase.id}`,
          body: `A Stripe PaymentIntent is expiring in less than 24 hours.\n\nPurchase: ${purchase.id}\nBuyer: ${purchase.buyer_email}\nSeller: ${purchase.seller_email}\nAmount: $${purchase.amount?.toFixed(2)}\nCreated: ${purchase.created_date}\n\nSTRIPE WILL AUTO-CANCEL THIS PI AT 7 DAYS. Either capture or cancel immediately.`,
        }).catch(() => {});
        await base44.asServiceRole.entities.Purchase.update(purchase.id, {
          reminder_flags: { ...flags, stale_pi_warned: true },
        });
        console.log('[reminders] STALE PI warning sent for:', purchase.id);
      } catch (err) {
        console.error('[reminders] stale PI warn failed:', purchase.id, err?.message);
      }
    }
  }

  // ── Clear expired listing reservations (older than 10 min) ───────────────
  // Find listings stuck in pending_transfer with expired reservation tokens
  try {
    const reservedListings = await base44.asServiceRole.entities.Listing.filter({
      status: 'pending_transfer',
    }, '-created_date', 500).catch(() => []);

    for (const l of reservedListings) {
      if (l.reservation_token && l.reservation_expires_at) {
        const expiredMs = new Date(l.reservation_expires_at).getTime();
        if (expiredMs < now) {
          // Check there's no active pending purchase for this listing
          const activePurchases = await base44.asServiceRole.entities.Purchase.filter({
            listing_id: l.id,
            transfer_status: 'pending_transfer',
          }).catch(() => []);
          if (activePurchases.length === 0) {
            await base44.asServiceRole.entities.Listing.update(l.id, {
              status: 'active',
              reservation_token: null,
              reservation_expires_at: null,
              reserved_by_email: null,
            }).catch(() => {});
            reservationsCleared++;
            console.log('[reminders] Cleared expired reservation for listing:', l.id);
          }
        }
      }
    }
  } catch (err) {
    console.error('[reminders] reservation cleanup error:', err?.message);
  }

  // ── Clean up expired reservations on ACTIVE listings ────────────────────
  // With pre-checkout reservation, listings stay 'active' but get reservation
  // fields set. This clears expired ones so the listing returns to fully available.
  try {
    const activeListings = await base44.asServiceRole.entities.Listing.filter({
      status: 'active',
    }, '-created_date', 500).catch(() => []);

    for (const l of activeListings) {
      if (l.reserved_by_email && l.reservation_expires_at) {
        const expiredMs = new Date(l.reservation_expires_at).getTime();
        if (expiredMs < now) {
          await base44.asServiceRole.entities.Listing.update(l.id, {
            reserved_by_email: null,
            reservation_token: null,
            reservation_expires_at: null,
          }).catch(() => {});
          reservationsCleared++;
          console.log('[reminders] Cleared expired reservation on active listing:', l.id);
        }
      }
    }
  } catch (err) {
    console.error('[reminders] active reservation cleanup error:', err?.message);
  }

  console.log(`[processTransferReminders] done. sent=${sent} expired=${expired} reviewed=${reviewed} reservationsCleared=${reservationsCleared} total=${pending.length}`);
  return Response.json({ sent, expired, reviewed, reservationsCleared, total: pending.length });
});