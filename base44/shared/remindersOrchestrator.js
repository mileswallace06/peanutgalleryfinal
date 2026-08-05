/**
 * remindersOrchestrator.js — Shared transfer reminders and reservation cleanup logic.
 *
 * Used by:
 *   - base44/functions/processTransferReminders/entry.ts (Deno)
 *   - tests/mutation-paths.test.mjs (Node.js ESM)
 *
 * deps = { entities, stripe, now, isMaintenanceActive, sendUserNotification, hooks }
 * Returns: { status, body }
 */
import { getPurchasePrivate, upsertPurchasePrivate, getListingPrivate, alertPrivateWriteFailure } from './orchestratorHelpers.js';
import { applyReservationTuple, generateClearedRevision } from './tupleTransition.js';

const SELLER_EXPIRY_MS = 48 * 60 * 60 * 1000;

export async function runProcessTransferReminders(deps) {
  const { entities, stripe, now, isMaintenanceActive } = deps;

  if (isMaintenanceActive && isMaintenanceActive()) return { status: 200, body: { ok: true, skipped: 'maintenance mode' } };

  const currentTime = now();
  let expired = 0;
  let reservationsCleared = 0;
  const failedIds = [];
  const errors = [];

  // ── Process pending purchases for seller no-show expiry ──────────────────
  const cutoff = new Date(currentTime - 72 * 60 * 60 * 1000).toISOString();
  const pending = await entities.Purchase.filter({
    transfer_status: 'pending_transfer',
    created_date: { $gte: cutoff },
  }, '-created_date', 500);

  for (const purchase of pending) {
    const pp = await getPurchasePrivate(deps, purchase.id);
    const createdMs = new Date(purchase.created_date).getTime();
    const elapsedTotal = currentTime - createdMs;

    // Case A: Seller never confirmed within 48h → expire
    if (!purchase.seller_confirmed && elapsedTotal >= SELLER_EXPIRY_MS) {
      try {
        if (stripe && purchase.payment_intent_id) {
          try {
            const pi = await stripe.paymentIntents.retrieve(purchase.payment_intent_id);
            if (pi.status === 'requires_capture') {
              await stripe.paymentIntents.cancel(purchase.payment_intent_id);
            }
          } catch (stripeErr) { /* stripe cancel failed */ }
        }

        // Expire Purchase — must be proven
        await entities.Purchase.update(purchase.id, { transfer_status: 'expired' });
        const [verifyPurchase] = await entities.Purchase.filter({ id: purchase.id });
        if (!verifyPurchase || verifyPurchase.transfer_status !== 'expired') {
          failedIds.push({ id: purchase.id, reason: 'purchase_expiry_not_verified' });
          errors.push(`Purchase ${purchase.id} expiry not verified`);
          continue;
        }

        // Clear listing reservation — active-lifecycle clear with non-null cleared-state revision
        const clearedRev = generateClearedRevision();
        const tupleResult = await applyReservationTuple(deps, purchase.listing_id, {
          status: 'active',
          token: null,
          buyer: null,
          expiration: null,
          revision: clearedRev,
          hidden_reason: null,
        }, 'reminder_clear_case_a', `processTransferReminders:${purchase.id}`);

        if (tupleResult.ok) {
          reservationsCleared++;
        } else {
          failedIds.push({ id: purchase.listing_id, reason: 'listing_clear_failed', error: tupleResult.first_write_error || tupleResult.second_write_error });
          errors.push(`Listing ${purchase.listing_id} clear failed: ${tupleResult.first_write_error || tupleResult.second_write_error}`);
          // Critical admin recovery signal for unresolved split state
          await alertPrivateWriteFailure(deps, { entity: 'RemindersOrchestrator', reference_id: purchase.listing_id, reference_type: 'listing', error: new Error(`Case A clear failed: ${tupleResult.first_write_error || tupleResult.second_write_error}`) });
        }
        expired++;
      } catch (err) {
        failedIds.push({ id: purchase.id, reason: 'case_a_error', error: err?.message });
        errors.push(`Case A error for ${purchase.id}: ${err?.message}`);
      }
      continue;
    }
  }

  // ── Clear expired listing reservations (pending_transfer, older than 10 min) ──
  let reservedListings;
  try {
    reservedListings = await entities.Listing.filter({ status: 'pending_transfer' }, '-created_date', 500);
  } catch (err) {
    errors.push(`DATA_STORE_FAILURE: Failed to fetch pending_transfer listings: ${err?.message}`);
    reservedListings = [];
  }
  for (const l of reservedListings) {
    if (l.reservation_token && l.reservation_expires_at) {
      const expiredMs = new Date(l.reservation_expires_at).getTime();
      if (expiredMs < currentTime) {
        let activePurchases;
        try {
          activePurchases = await entities.Purchase.filter({ listing_id: l.id, transfer_status: 'pending_transfer' });
        } catch (err) {
          errors.push(`DATA_STORE_FAILURE: Failed to fetch active purchases for listing ${l.id}: ${err?.message}`);
          activePurchases = [];
        }
        if (activePurchases.length === 0) {
          const clearedRev = generateClearedRevision();
          const tupleResult = await applyReservationTuple(deps, l.id, {
            status: 'active',
            token: null,
            buyer: null,
            expiration: null,
            revision: clearedRev,
            hidden_reason: null,
          }, 'reminder_clear_expired', `processTransferReminders:expired:${l.id}`);

          if (tupleResult.ok) {
            reservationsCleared++;
          } else {
            failedIds.push({ id: l.id, reason: 'expired_clear_failed', error: tupleResult.first_write_error || tupleResult.second_write_error });
            errors.push(`Expired reservation clear failed for ${l.id}: ${tupleResult.first_write_error || tupleResult.second_write_error}`);
          }
        }
      }
    }
  }

  // ── Clean up expired reservations on ACTIVE listings ────────────────────
  let activeListings;
  try {
    activeListings = await entities.Listing.filter({ status: 'active' }, '-created_date', 500);
  } catch (err) {
    errors.push(`DATA_STORE_FAILURE: Failed to fetch active listings: ${err?.message}`);
    activeListings = [];
  }
  for (const l of activeListings) {
    if (l.reserved_by_email && l.reservation_expires_at) {
      const expiredMs = new Date(l.reservation_expires_at).getTime();
      if (expiredMs < currentTime) {
        const clearedRev = generateClearedRevision();
        const tupleResult = await applyReservationTuple(deps, l.id, {
          status: 'active',
          token: null,
          buyer: null,
          expiration: null,
          revision: clearedRev,
          hidden_reason: null,
        }, 'reminder_clear_active', `processTransferReminders:active:${l.id}`);

        if (tupleResult.ok) {
          reservationsCleared++;
        } else {
          failedIds.push({ id: l.id, reason: 'active_clear_failed', error: tupleResult.first_write_error || tupleResult.second_write_error });
          errors.push(`Active listing clear failed for ${l.id}: ${tupleResult.first_write_error || tupleResult.second_write_error}`);
        }
      }
    }
  }

  return {
    status: failedIds.length > 0 || errors.length > 0 ? 500 : 200,
    body: {
      expired,
      reservationsCleared,
      total: pending.length,
      failedIds,
      errors,
    },
  };
}