/**
 * processTransferReminders
 * ────────────────────────
 * Scheduled function — runs every 5 minutes.
 * Sends reminders for stalled transfers and expires/auto-reviews stale purchases.
 *
 * CRITICAL-B FIX: Auto-complete is replaced with auto_confirmed_pending_review.
 * No automatic Stripe capture happens without admin approval.
 *
 * Dispatch (push/email/in-app + transactional email) uses the shared `notifications`
 * module in-process — never invokes a public function, so there is no spoofable
 * internal-call header and no dependency on an authenticated user session.
 *
 * Also handles:
 * - Expired listing reservations (clears reservation_token after 10min)
 * - Stale PI safety net (purchases > 6 days old alert admin)
 */

import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';
import Stripe from 'npm:stripe@14.21.0';
import { secrets } from 'base44:runtime';
import { isMaintenanceActive } from '../../shared/maintenance.ts';
import { sendUserNotification, sendTransactionalEmail } from '../../shared/notifications.ts';
import { getPurchasePrivate, upsertPurchasePrivate } from '../../shared/privateData.ts';
import { isCanaryListing, isCanaryEnabled } from '../../shared/authCanary.js';
import { expirePurchaseSafely, assertNoPurchaseForReservation, readCleanupRows } from '../../shared/purchaseExpiry.js';
import { runReleaseReservation } from '../../shared/releaseOrchestrator.js';
import { createMission1Runtime, authorizeMission1Worker } from '../../shared/mission1Runtime.js';
import { runCanaryScheduledRelease } from '../../shared/canaryScheduledRelease.js';

const SELLER_REMINDER_1_MS  =  5 * 60 * 1000;  //  5 min
const SELLER_REMINDER_2_MS  = 15 * 60 * 1000;  // 15 min
const BUYER_REMINDER_1_MS   =  5 * 60 * 1000;
const BUYER_REMINDER_2_MS   = 15 * 60 * 1000;

const SELLER_EXPIRY_MS      = 48 * 60 * 60 * 1000;  // 48h seller expiry
const BUYER_REVIEW_MS       = 24 * 60 * 60 * 1000;  // 24h → admin review (no auto-capture)
const STALE_PI_WARN_MS      =  6 * 24 * 60 * 60 * 1000; // 6 days → warn before 7-day Stripe expiry

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);

  let workerUser;
  try { workerUser = await authorizeMission1Worker(req, base44, secrets); }
  catch (error) { return Response.json({ code: error.message }, { status: 403 }); }
  const body = await req.json().catch(() => ({}));
  const secretKey = Deno.env.get('STRIPELIVESECRETKEY');
  const stripe = secretKey ? new Stripe(secretKey) : null;
  let cleanupDeps;
  try { cleanupDeps = await createMission1Runtime({ entities: base44.asServiceRole.entities, stripe, user: workerUser, secrets }); }
  catch (error) { return Response.json({ ok: false, code: error.message }, { status: 500 }); }
  // Recovery always uses stored identity and freshly retrieved provider state.
  // Alert resolution, status flags and epochs in request JSON are never inputs.
  let recoveryFailures = [];
  try {
    if (body.action === 'recovery_status') return Response.json(await cleanupDeps.recoveryStatus());
    if (body.action === 'recover_purchase' && typeof body.purchase_id === 'string') {
      const result = await cleanupDeps.recoverPurchase(body.purchase_id);
      return Response.json(result.body, { status: result.status });
    }
    if (body.action === 'recover_admission' && typeof body.operation_id === 'string') {
      const result = await cleanupDeps.recoverAdmission(body.operation_id, body.payment_intent_id);
      return Response.json(result);
    }
    if (body.action && body.action !== 'drain_recovery') return Response.json({ code: 'INVALID_RECOVERY_ACTION' }, { status: 400 });
    const recovered = await cleanupDeps.drainRecovery();
    recoveryFailures = recovered.results.filter(result => !result.ok);
    if (body.action === 'drain_recovery') return Response.json(recovered, { status: recovered.ok ? 200 : 500 });
  } catch (error) { return Response.json({ ok: false, code: error.message }, { status: 500 }); }
  if (isMaintenanceActive()) return Response.json({ ok: recoveryFailures.length === 0, skipped: 'maintenance mode', failures: recoveryFailures }, { status: recoveryFailures.length ? 500 : 200 });
  const now = Date.now();
  const failures = [...recoveryFailures];
  let sent = 0;
  let expired = 0;
  let reviewed = 0;
  let reservationsCleared = 0;

  // Failed expiry work must remain retryable beyond the old 72-hour window.
  let pending;
  try { pending = await readCleanupRows(cleanupDeps.entities.Purchase, { transfer_status: 'pending_transfer' }); }
  catch (err) { return Response.json({ ok: false, code: err.message }, { status: 500 }); }

  for (const purchase of pending) {
    // Phase 1B: read authoritative identities + reminder flags from PurchasePrivate
    const pp = await getPurchasePrivate(base44, purchase.id);
    const authoritativeSellerEmail = pp?.seller_email ?? purchase.seller_email;
    const authoritativeBuyerEmail = pp?.buyer_email ?? purchase.buyer_email;
    const flags = pp?.reminder_flags ?? purchase.reminder_flags ?? {};
    const createdMs = new Date(purchase.created_date).getTime();
    const sellerConfirmedAt = purchase.seller_confirmed_at
      ? new Date(purchase.seller_confirmed_at).getTime()
      : null;

    // ── Seller reminders ─────────────────────────────────────────────────────
    if (!purchase.seller_confirmed) {
      const elapsedMs = now - createdMs;

      if (elapsedMs >= SELLER_REMINDER_1_MS && !flags.seller_r1) {
        try {
          await sendUserNotification(base44, {
            user_email: authoritativeSellerEmail,
            title: 'Transfer reminder',
            body: 'Your buyer is waiting. Send the tickets when you can.',
            type: 'seller_reminder',
            purchase_id: purchase.id,
          });
          await base44.asServiceRole.entities.Purchase.update(purchase.id, {
            reminder_flags: { ...flags, seller_r1: true },
          });
          try { await upsertPurchasePrivate(base44, purchase.id, { reminder_flags: { ...flags, seller_r1: true } }); } catch {}
          sent++;
        } catch (err) {
          console.error('[reminders] seller_r1 failed for', purchase.id, err?.message);
        }
      }

      if (elapsedMs >= SELLER_REMINDER_2_MS && !flags.seller_r2) {
        try {
          await sendUserNotification(base44, {
            user_email: authoritativeSellerEmail,
            title: '⚠️ Final transfer reminder',
            body: 'Please transfer tickets within 48 hours or the purchase will be cancelled.',
            type: 'seller_reminder',
            purchase_id: purchase.id,
          });
          await base44.asServiceRole.entities.Purchase.update(purchase.id, {
            reminder_flags: { ...flags, seller_r2: true },
          });
          try { await upsertPurchasePrivate(base44, purchase.id, { reminder_flags: { ...flags, seller_r2: true } }); } catch {}
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
          await sendUserNotification(base44, {
            user_email: authoritativeBuyerEmail,
            title: 'Confirm your tickets',
            body: "Let us know once your tickets are safely received.",
            type: 'buyer_reminder',
            purchase_id: purchase.id,
          });
          await base44.asServiceRole.entities.Purchase.update(purchase.id, {
            reminder_flags: { ...flags, buyer_r1: true },
          });
          try { await upsertPurchasePrivate(base44, purchase.id, { reminder_flags: { ...flags, buyer_r1: true } }); } catch {}
          sent++;
        } catch (err) {
          console.error('[reminders] buyer_r1 failed for', purchase.id, err?.message);
        }
      }

      if (elapsedSinceTransfer >= BUYER_REMINDER_2_MS && !flags.buyer_r2) {
        try {
          await sendUserNotification(base44, {
            user_email: authoritativeBuyerEmail,
            title: '⏰ Please confirm your tickets',
            body: "Your seller says tickets are transferred. If you haven't received them, open a dispute.",
            type: 'buyer_reminder',
            purchase_id: purchase.id,
          });
          await base44.asServiceRole.entities.Purchase.update(purchase.id, {
            reminder_flags: { ...flags, buyer_r2: true },
          });
          try { await upsertPurchasePrivate(base44, purchase.id, { reminder_flags: { ...flags, buyer_r2: true } }); } catch {}
          sent++;
        } catch (err) {
          console.error('[reminders] buyer_r2 failed for', purchase.id, err?.message);
        }
      }
    }

    const elapsedTotal = now - createdMs;

    // ── Case A: Seller never confirmed within 48h → expire ───────────────────
    if (!purchase.seller_confirmed && elapsedTotal >= SELLER_EXPIRY_MS) {
      const result = await expirePurchaseSafely(cleanupDeps, purchase.id, { sellerExpiry: true });
      if (result.status === 200) {
        if (!result.body.already_completed) {
          expired++;
          await sendUserNotification(base44, {
            user_email: authoritativeBuyerEmail, title: 'Purchase expired',
            body: result.body.settlement === 'refunded' ? 'Your payment refund has been verified.' : 'The seller did not transfer your tickets in time. Your payment authorization has been released.',
            type: 'listing_expired', purchase_id: purchase.id,
          }).catch(() => {});
          await sendUserNotification(base44, {
            user_email: authoritativeSellerEmail, title: 'Your listing expired',
            body: 'The transfer deadline passed. Payment release was verified and your listing has been restored.',
            type: 'listing_expired', purchase_id: purchase.id,
          }).catch(() => {});
        }
      } else {
        failures.push({ purchase_id: purchase.id, ...result.body });
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
          await sendTransactionalEmail(base44, 'experience@peanutgallery.store',
            `⏰ Admin Review Required — Buyer Inactive 24h — Purchase ${purchase.id}`,
            `A purchase needs admin review.\n\nBuyer (${authoritativeBuyerEmail}) has not confirmed ticket receipt 24 hours after seller confirmation.\n\nPurchase ID: ${purchase.id}\nSeller: ${authoritativeSellerEmail}\nAmount: $${purchase.amount?.toFixed(2)}\nSeller confirmed at: ${purchase.seller_confirmed_at}\n\nOptions:\n1. Approve capture via admin panel if transfer is confirmed legitimate\n2. Open dispute if seller transfer cannot be verified\n3. Wait longer — Stripe PI valid for 7 days from purchase\n\nDo NOT ignore — Stripe PI expires ${new Date(new Date(purchase.created_date).getTime() + 7*24*60*60*1000).toLocaleDateString()}.`
          ).catch(() => {});

          // Notify buyer with urgency
          await sendUserNotification(base44, {
            user_email: authoritativeBuyerEmail,
            title: '⚠️ Action required — confirm your tickets',
            body: 'Your seller confirmed your tickets were sent 24h ago. Please confirm receipt or open a dispute. Your payment is on hold.',
            type: 'buyer_reminder',
            purchase_id: purchase.id,
          }).catch(() => {});

          // Notify seller
          await sendUserNotification(base44, {
            user_email: authoritativeSellerEmail,
            title: 'Awaiting admin review',
            body: 'Your buyer has not confirmed receipt. Our team is reviewing your transfer. Payout may be slightly delayed.',
            type: 'seller_reminder',
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
        await sendTransactionalEmail(base44, 'experience@peanutgallery.store',
          `🚨 Stripe PI Expiring Tomorrow — Purchase ${purchase.id}`,
          `A Stripe PaymentIntent is expiring in less than 24 hours.\n\nPurchase: ${purchase.id}\nBuyer: ${authoritativeBuyerEmail}\nSeller: ${authoritativeSellerEmail}\nAmount: $${purchase.amount?.toFixed(2)}\nCreated: ${purchase.created_date}\n\nSTRIPE WILL AUTO-CANCEL THIS PI AT 7 DAYS. Either capture or cancel immediately.`
        ).catch(() => {});
        await base44.asServiceRole.entities.Purchase.update(purchase.id, {
          reminder_flags: { ...flags, stale_pi_warned: true },
        });
        try { await upsertPurchasePrivate(base44, purchase.id, { reminder_flags: { ...flags, stale_pi_warned: true } }); } catch {}
        console.log('[reminders] STALE PI warning sent for:', purchase.id);
      } catch (err) {
        console.error('[reminders] stale PI warn failed:', purchase.id, err?.message);
      }
    }
  }

  // ── Clear expired listing reservations (older than 10 min) ───────────────
  try {
    const reservedListings = await base44.asServiceRole.entities.Listing.filter({
      status: 'pending_transfer',
    }, '-created_date', 500);

    for (const l of reservedListings) {
      if (l.reservation_token && l.reservation_expires_at) {
        const expiredMs = new Date(l.reservation_expires_at).getTime();
        if (expiredMs < now) {
          // ── Canary routing for synthetic [AUTH_CANARY] listings ──
          if (isCanaryListing(l) && isCanaryEnabled()) {
            try {
              const canaryResult = await runCanaryScheduledRelease({
                entities: base44.asServiceRole.entities,
                executorUrl: secrets.get('AUTHORITY_V1_DB_URL_DEV_EXECUTOR'),
                listing_id: l.id,
              });
              if (canaryResult.status === 200) reservationsCleared++;
              else console.log('[reminders] canary scheduled release skipped:', l.id, canaryResult.body?.code);
            } catch (e) {
              console.error('[reminders] canary scheduled release error:', l.id, e?.message);
            }
            continue;
          }
          try {
            // An ongoing purchase intentionally keeps this reservation locked.
            // Only lookup uncertainty or an actual expiry failure is an error.
            const activePurchases = await readCleanupRows(cleanupDeps.entities.Purchase, {
              listing_id: l.id, transfer_status: 'pending_transfer',
            });
            if (activePurchases.length > 0) continue;
            await assertNoPurchaseForReservation(cleanupDeps.entities, l);
            const result = await runReleaseReservation(cleanupDeps, { listing_id: l.id });
            if (result.status !== 200) throw new Error(result.body.code || 'UNPAID_RELEASE_UNVERIFIED');
            reservationsCleared++;
          } catch (err) {
            failures.push({ listing_id: l.id, code: err.message });
          }
        }
      }
    }
  } catch (err) {
    failures.push({ code: 'RESERVATION_LOOKUP_FAILED', error: err.message });
  }

  // ── Clean up expired reservations on ACTIVE listings ────────────────────
  try {
    const activeListings = await base44.asServiceRole.entities.Listing.filter({
      status: 'active',
    }, '-created_date', 500);

    for (const l of activeListings) {
      if (l.reserved_by_email && l.reservation_expires_at) {
        const expiredMs = new Date(l.reservation_expires_at).getTime();
        if (expiredMs < now) {
          // ── Canary routing for synthetic [AUTH_CANARY] listings ──
          if (isCanaryListing(l) && isCanaryEnabled()) {
            try {
              const canaryResult = await runCanaryScheduledRelease({
                entities: base44.asServiceRole.entities,
                executorUrl: secrets.get('AUTHORITY_V1_DB_URL_DEV_EXECUTOR'),
                listing_id: l.id,
              });
              if (canaryResult.status === 200) reservationsCleared++;
              else console.log('[reminders] canary scheduled release skipped:', l.id, canaryResult.body?.code);
            } catch (e) {
              console.error('[reminders] canary scheduled release error:', l.id, e?.message);
            }
            continue;
          }
          try {
            await assertNoPurchaseForReservation(cleanupDeps.entities, l);
            const result = await runReleaseReservation(cleanupDeps, { listing_id: l.id });
            if (result.status !== 200) throw new Error(result.body.code || 'UNPAID_RELEASE_UNVERIFIED');
            reservationsCleared++;
          } catch (err) {
            failures.push({ listing_id: l.id, code: err.message });
          }
        }
      }
    }
  } catch (err) {
    failures.push({ code: 'RESERVATION_LOOKUP_FAILED', error: err.message });
  }

  console.log(`[processTransferReminders] done. sent=${sent} expired=${expired} reviewed=${reviewed} reservationsCleared=${reservationsCleared} total=${pending.length}`);
  return Response.json({ ok: failures.length === 0, sent, expired, reviewed, reservationsCleared, total: pending.length, failures }, { status: failures.length ? 500 : 200 });
});
