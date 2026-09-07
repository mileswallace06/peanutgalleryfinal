import { expirePurchaseSafely, assertNoPurchaseForReservation, readCleanupRows } from './purchaseExpiry.js';
/**
 * remindersOrchestrator.js — Shared transfer reminders and reservation cleanup logic.
 *
 * Used by:
 *   - base44/functions/processTransferReminders/entry.ts (Deno)
 *   - tests/mutation-paths.test.mjs (Node.js ESM)
 *
 * deps = { entities, now, isMaintenanceActive, sendUserNotification, hooks }
 * Returns: { status, body }
 */
import { runReleaseReservation } from './releaseOrchestrator.js';

const releaseExpired = (deps, listing) => runReleaseReservation({
  ...deps, user: { id: 'reminder-worker', email: listing.reserved_by_email, role: 'admin' },
}, { listing_id: listing.id });

const SELLER_EXPIRY_MS = 48 * 60 * 60 * 1000;

export async function runProcessTransferReminders(deps) {
  const { entities, now, isMaintenanceActive } = deps;

  if (isMaintenanceActive && isMaintenanceActive()) return { status: 200, body: { ok: true, skipped: 'maintenance mode' } };

  const currentTime = now();
  let expired = 0;
  let reservationsCleared = 0;
  const failedIds = [];
  const errors = [];

  // ── Process pending purchases for seller no-show expiry ──────────────────
  let pending;
  try { pending = await readCleanupRows(entities.Purchase, { transfer_status: 'pending_transfer' }); }
  catch (err) { return { status: 500, body: { ok: false, code: err.message } }; }

  for (const purchase of pending) {
    const createdMs = new Date(purchase.created_date).getTime();
    const elapsedTotal = currentTime - createdMs;

    // Case A: Seller never confirmed within 48h → expire
    if (!purchase.seller_confirmed && elapsedTotal >= SELLER_EXPIRY_MS) {
      const result = await expirePurchaseSafely(deps, purchase.id, { sellerExpiry: true });
      if (result.status === 200) {
        if (!result.body.already_completed) { expired++; reservationsCleared++; }
      } else {
        failedIds.push({ id: purchase.id, reason: result.body.code });
        errors.push(result.body.code);
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
    reservedListings = null;
  }
  if (reservedListings) for (const l of reservedListings) {
    if (l.reservation_token && l.reservation_expires_at) {
      const expiredMs = new Date(l.reservation_expires_at).getTime();
      if (expiredMs < currentTime) {
        let activePurchases;
        try {
          activePurchases = await entities.Purchase.filter({ listing_id: l.id, transfer_status: 'pending_transfer' });
        } catch (err) {
          errors.push(`DATA_STORE_FAILURE: Failed to fetch active purchases for listing ${l.id}: ${err?.message}`);
          failedIds.push({ id: l.id, reason: 'active_purchase_lookup_failed', error: err?.message });
          continue; // FAIL-CLOSED: do NOT clear when availability cannot be safely determined
        }
        if (activePurchases.length === 0) {
          try { await assertNoPurchaseForReservation(entities, l); }
          catch (err) { errors.push(err.message); continue; }
          const release = await releaseExpired(deps, l);
          const tupleResult = { ok: release.status === 200, first_write_error: release.body.code };

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
    activeListings = null;
  }
  if (activeListings) for (const l of activeListings) {
    if (l.reserved_by_email && l.reservation_expires_at) {
      const expiredMs = new Date(l.reservation_expires_at).getTime();
      if (expiredMs < currentTime) {
        try { await assertNoPurchaseForReservation(entities, l); }
        catch (err) { errors.push(err.message); continue; }
        const release = await releaseExpired(deps, l);
        const tupleResult = { ok: release.status === 200, first_write_error: release.body.code };

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