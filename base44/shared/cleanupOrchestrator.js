/**
 * cleanupOrchestrator.js — 7C.7
 *
 * Two-pass architecture:
 *   Phase 1: Cancel/verify PI and quarantine only. Never clear tokens or
 *            reactivate in the same run.
 *   Phase 2: Recovery with drain period. Requires current Listing and LP values
 *            to exactly match the durable quarantine snapshot. Checks seller
 *            intent before and after every write. Never recovers an unknown token.
 *
 * deps = { entities, stripe, now, isMaintenanceActive }
 * Returns: { status, body }
 */
import {
  classifyCleanupOutcome,
  verifyCleanupOwnership,
  canRecoverQuarantine,
  isQuarantined,
  drainPeriodPassed,
  hasSellerCancelIntent,
  hasSellerPauseIntent,
  matchesQuarantineSnapshot,
} from './checkoutLogic.js';
import {
  getListingPrivate,
  getPurchasePrivate,
  upsertListingPrivate,
  quarantineListing,
} from './orchestratorHelpers.js';

const ABANDONED_MS = 10 * 60 * 1000;
const PAGE_SIZE = 200;
const MAX_ITERATIONS = 50;

// Helper: create a critical alert (never throws)
async function criticalAlert(deps, title, description, listingId) {
  try {
    await deps.entities.AdminAlert.create({
      alert_type: 'admin_action_required', priority: 'critical',
      title, description, reference_type: 'listing', reference_id: listingId,
    });
  } catch (_) { /* alert failure must never throw */ }
}

// Helper: restore quarantine on both entities (7C.7 fix #7)
async function restoreQuarantine(deps, listing_id, reason, piId) {
  try {
    await deps.entities.Listing.update(listing_id, { status: 'hidden', hidden_reason: 'checkout_quarantine' });
  } catch (_) { /* best effort */ }
  try {
    await upsertListingPrivate(deps, listing_id, {
      checkout_quarantined: true,
      checkout_quarantine_reason: reason,
      checkout_quarantine_pi_id: piId || null,
    });
  } catch (_) { /* best effort */ }
  await criticalAlert(deps, `QUARANTINE RESTORED for ${listing_id}`, `${reason}. PI ID: ${piId || 'N/A'}.`, listing_id);
}

export async function runCleanupAbandonedCheckouts(deps) {
  const { entities, stripe, now, isMaintenanceActive } = deps;

  if (isMaintenanceActive()) {
    return { status: 200, body: { ok: true, skipped: 'maintenance mode' } };
  }

  const currentTime = now();
  let expired = 0, released = 0, quarantined = 0, skippedRecent = 0, skippedAuthorized = 0, errors = 0;
  let totalProcessed = 0;
  let maxSkipReached = 0;

  // ═══════════════════════════════════════════════════════════════════════════
  // Phase 1: Process abandoned purchases — quarantine ONLY (7C.7 fix #4)
  // Never clear tokens or reactivate listings in the same run.
  // ═══════════════════════════════════════════════════════════════════════════
  const processedIds = new Set();
  let skip = 0;
  let hasMore = true;
  let iteration = 0;

  while (hasMore && iteration < MAX_ITERATIONS) {
    iteration++;
    let page;
    try {
      page = await entities.Purchase.filter({
        transfer_status: 'pending_transfer',
        payment_captured: false,
        is_demo: false,
      }, 'created_date', PAGE_SIZE, skip);
    } catch (err) {
      return { status: 500, body: { error: 'Failed to fetch pending purchases' } };
    }

    if (page.length === 0) { hasMore = false; break; }

    let recordsRemainingPending = 0;

    for (const p of page) {
      if (processedIds.has(p.id)) { recordsRemainingPending++; continue; }
      processedIds.add(p.id);
      totalProcessed++;
      maxSkipReached = Math.max(maxSkipReached, skip + recordsRemainingPending);

      let staysInResultSet = true;

      try {
        const created = p.created_date ? new Date(p.created_date).getTime() : 0;
        if (currentTime - created < ABANDONED_MS) { skippedRecent++; recordsRemainingPending++; continue; }

        // PurchasePrivate is mandatory
        const pp = await getPurchasePrivate(deps, p.id);
        if (!pp) {
          await quarantineListing(deps, p.listing_id, `PurchasePrivate missing for purchase ${p.id}`, p.id, p.payment_intent_id);
          quarantined++; recordsRemainingPending++; continue;
        }

        // Require Purchase ↔ PurchasePrivate listing_id match
        if (p.listing_id !== pp.listing_id) {
          await quarantineListing(deps, p.listing_id, `Listing ID mismatch: Purchase=${p.listing_id}, PP=${pp.listing_id}`, p.id, p.payment_intent_id);
          quarantined++; recordsRemainingPending++; continue;
        }

        const piId = pp.payment_intent_id;
        if (!piId) {
          await quarantineListing(deps, p.listing_id, `No payment_intent_id for purchase ${p.id}`, p.id, null);
          quarantined++; recordsRemainingPending++; continue;
        }

        // Retrieve PI — failure → quarantine + critical alert with PI ID (7C.7 fix #1)
        let pi;
        let piStatus = null;
        try {
          pi = await stripe.paymentIntents.retrieve(piId);
          piStatus = pi.status;
        } catch (err) {
          await quarantineListing(deps, p.listing_id, `PI retrieval failed for ${piId}: ${err?.message}`, p.id, piId);
          await criticalAlert(deps, `PI RETRIEVAL FAILED for ${p.listing_id}`, `PI ID: ${piId}. Error: ${err?.message}. Manual resolution required.`, p.listing_id);
          quarantined++; recordsRemainingPending++; continue;
        }

        // Re-fetch Listing + LP for ownership check
        const [listing] = await entities.Listing.filter({ id: p.listing_id });
        const lp = await getListingPrivate(deps, p.listing_id);

        // Verify cleanup ownership
        const ownershipValid = verifyCleanupOwnership(p, pp, listing, lp, pi);
        const ownsByBuyer = !!(listing && listing.reserved_by_email === pp.buyer_email);
        const ownsByToken = !!(pp.reservation_token && lp && lp.reservation_token === pp.reservation_token);
        const outcome = classifyCleanupOutcome(piStatus, ownsByBuyer, ownsByToken);

        // Keep locked if PI is authorized — buyer may still confirm
        if (outcome === 'keep_locked') { skippedAuthorized++; recordsRemainingPending++; continue; }

        // For 'release' outcome: cancel PI if retryable, then quarantine
        if (outcome === 'release' && (piStatus === 'requires_payment_method' || piStatus === 'requires_action')) {
          let cancelVerified = false;
          let cancelError = null;
          try {
            const canceled = await stripe.paymentIntents.cancel(piId);
            cancelVerified = canceled.status === 'canceled';
          } catch (err) {
            cancelError = err;
            try {
              const retrieved = await stripe.paymentIntents.retrieve(piId);
              cancelVerified = retrieved.status === 'canceled';
            } catch (__) { cancelVerified = false; }
          }
          if (!cancelVerified) {
            await quarantineListing(deps, p.listing_id, `PI cancel failed during cleanup. PI ID: ${piId}. Error: ${cancelError?.message || 'unknown'}`, p.id, piId);
            await criticalAlert(deps, `PI CANCEL FAILED for ${p.listing_id}`, `PI ID: ${piId}. Cancel error: ${cancelError?.message || 'unknown'}. Manual cancellation required.`, p.listing_id);
            quarantined++; recordsRemainingPending++; continue;
          }
          piStatus = 'canceled';
        }

        // Quarantine with durable snapshot (captures current tokens before any write)
        // 7C.7 fix #4: Phase 1 quarantines ONLY — never clear tokens or reactivate
        const qResult = await quarantineListing(deps, p.listing_id,
          `Cleanup Phase 1 quarantine: PI status=${piStatus}, ownership_valid=${ownershipValid}, buyer_match=${ownsByBuyer}, token_match=${ownsByToken}`,
          p.id, piId);
        if (!qResult.quarantined) {
          await criticalAlert(deps, `QUARANTINE FAILED for ${p.listing_id}`, `Phase 1 quarantine write failed. PI ID: ${piId}.`, p.listing_id);
        }

        // Expire Purchase
        try {
          await entities.Purchase.update(p.id, { transfer_status: 'expired' });
          expired++;
          staysInResultSet = false;
        } catch (err) {
          await criticalAlert(deps, `PURCHASE EXPIRY FAILED for ${p.id}`, `Error: ${err?.message}. Listing left quarantined. PI ID: ${piId}.`, p.listing_id);
        }
        quarantined++;
      } catch (err) {
        console.error('[cleanupAbandonedCheckouts] error processing', p.id, err?.message);
        errors++;
      }

      if (staysInResultSet) recordsRemainingPending++;
    }

    skip += recordsRemainingPending;
    if (page.length < PAGE_SIZE) hasMore = false;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Phase 2: Quarantine recovery (7C.7 fix #4, #5, #7)
  // Recovery requires:
  //   - Drain period passed (recovery_not_before)
  //   - No seller cancel/pause intent
  //   - Current LP values match durable quarantine snapshot
  //   - PI is canceled, no pending purchases
  //   - Seller intent checked before AND after every write
  // ═══════════════════════════════════════════════════════════════════════════
  let quarantinedListings = [];
  try {
    quarantinedListings = await entities.ListingPrivate.filter({ checkout_quarantined: true }, 'id', 200);
  } catch (err) { /* non-fatal */ }

  let quarantineResolved = 0;
  let quarantineRestoreFailed = 0;

  for (const lp of quarantinedListings) {
    try {
      const piId = lp.checkout_quarantine_pi_id;
      if (!piId) continue;

      // 7C.7 fix #4: Check drain period — don't recover in the same run as quarantine
      if (!drainPeriodPassed(lp, deps.now())) continue;

      // Re-fetch ALL entities before every write
      const [listingFresh] = await entities.Listing.filter({ id: lp.listing_id });
      const lpFresh = await getListingPrivate(deps, lp.listing_id);

      // Require Listing.status=hidden and hidden_reason=checkout_quarantine
      if (!listingFresh || listingFresh.status !== 'hidden' || listingFresh.hidden_reason !== 'checkout_quarantine') continue;
      if (!lpFresh || !lpFresh.checkout_quarantined) continue;

      // 7C.7 fix #5: Check seller cancel intent BEFORE any write
      if (hasSellerCancelIntent(lpFresh) || hasSellerPauseIntent(lpFresh)) continue;

      // Never reactivate a seller-cancelled listing
      if (listingFresh.status === 'cancelled') continue;

      // Retrieve PI
      let pi;
      try {
        pi = await stripe.paymentIntents.retrieve(piId);
      } catch (err) { continue; }

      // Check no pending purchases
      const pendingPurchases = await entities.Purchase.filter({
        listing_id: lp.listing_id, transfer_status: 'pending_transfer',
      });

      // Basic recovery conditions
      if (!canRecoverQuarantine(listingFresh, lpFresh, pi, pendingPurchases)) continue;

      // 7C.7 fix #4: Require current LP values to match durable quarantine snapshot
      // If any token, buyer, or expiry differs, leave quarantined for manual resolution
      if (!matchesQuarantineSnapshot(lpFresh)) continue;

      // ── Recovery ordering (7C.7 fix #7) ──────────────────────────────────
      // Step 1: Re-fetch LP and check token still matches snapshot (fault injection point)
      const lpPreClear = await getListingPrivate(deps, lp.listing_id);
      if (!lpPreClear || !matchesQuarantineSnapshot(lpPreClear)) {
        // New token appeared after snapshot check — leave quarantined (7C.7 fix #3)
        await criticalAlert(deps, `NEW TOKEN DETECTED before recovery clearing for ${lp.listing_id}`,
          `Snapshot: ${lp.quarantined_reservation_token}, Current: ${lpPreClear?.reservation_token}. Left quarantined.`, lp.listing_id);
        continue;
      }

      // Step 2a: Clear Listing reservation fields
      try {
        await entities.Listing.update(lp.listing_id, {
          reservation_token: null, reservation_expires_at: null, reserved_by_email: null,
          // status stays 'hidden', hidden_reason stays 'checkout_quarantine'
        });
      } catch (err) {
        await criticalAlert(deps, `LISTING CLEAR FAILED for ${lp.listing_id}`, `Error: ${err?.message}. PI ID: ${piId}.`, lp.listing_id);
        quarantineRestoreFailed++;
        continue;
      }

      // Step 2b: Re-fetch LP and check token still matches snapshot (7C.7 fix #3)
      // A new token may have appeared between the pre-clear check and the Listing.update
      const lpMidClear = await getListingPrivate(deps, lp.listing_id);
      if (!lpMidClear || !matchesQuarantineSnapshot(lpMidClear)) {
        await restoreQuarantine(deps, lp.listing_id, 'New token detected during Listing clear — token preserved', piId);
        quarantineRestoreFailed++; continue;
      }

      // Step 2c: Clear LP reservation fields
      try {
        await upsertListingPrivate(deps, lp.listing_id, {
          reservation_token: null, reservation_expires_at: null, reserved_by_email: null,
          // checkout_quarantined stays true for now
        });
      } catch (err) {
        // LP clear failed — restore Listing reservation
        try {
          await entities.Listing.update(lp.listing_id, {
            reservation_token: lp.quarantined_reservation_token,
            reservation_expires_at: lp.quarantined_expiration,
            reserved_by_email: lp.quarantined_buyer,
          });
        } catch (_) { /* best effort */ }
        await criticalAlert(deps, `LP CLEAR FAILED for ${lp.listing_id}`, `Error: ${err?.message}. PI ID: ${piId}.`, lp.listing_id);
        quarantineRestoreFailed++;
        continue;
      }

      // Step 3: Verify both are cleared
      const [listingCleared] = await entities.Listing.filter({ id: lp.listing_id });
      const lpCleared = await getListingPrivate(deps, lp.listing_id);
      if (!listingCleared || listingCleared.reservation_token !== null) {
        await restoreQuarantine(deps, lp.listing_id, 'Listing reservation not cleared after recovery', piId);
        quarantineRestoreFailed++; continue;
      }
      if (!lpCleared || lpCleared.reservation_token !== null) {
        await restoreQuarantine(deps, lp.listing_id, 'LP reservation not cleared after recovery', piId);
        quarantineRestoreFailed++; continue;
      }

      // Step 4: Check seller intent BEFORE activating (7C.7 fix #5)
      const lpBeforeActivate = await getListingPrivate(deps, lp.listing_id);
      if (hasSellerCancelIntent(lpBeforeActivate) || hasSellerPauseIntent(lpBeforeActivate)) {
        await restoreQuarantine(deps, lp.listing_id, 'Seller intent detected before activation', piId);
        continue;
      }

      // Step 5: Activate Listing while LP quarantine is still true (7C.7 fix #7)
      try {
        await entities.Listing.update(lp.listing_id, {
          status: 'active', hidden_reason: null,
        });
      } catch (err) {
        await restoreQuarantine(deps, lp.listing_id, `Recovery Listing activation failed: ${err?.message}`, piId);
        quarantineRestoreFailed++; continue;
      }

      // Step 6: Re-fetch seller intent AFTER activation (7C.7 fix #5, #7)
      const lpAfterActivate = await getListingPrivate(deps, lp.listing_id);
      if (hasSellerCancelIntent(lpAfterActivate) || hasSellerPauseIntent(lpAfterActivate)) {
        // Seller cancelled between activation and LP clearing — restore quarantine
        await restoreQuarantine(deps, lp.listing_id, 'Seller cancel detected after activation', piId);
        await criticalAlert(deps, `SELLER CANCEL DURING RECOVERY for ${lp.listing_id}`,
          `Seller intent appeared between Listing activation and LP quarantine clearing. Restored to quarantine. PI ID: ${piId}.`, lp.listing_id);
        quarantineRestoreFailed++; continue;
      }

      // Step 7: Clear LP quarantine only after verification (7C.7 fix #7)
      try {
        await upsertListingPrivate(deps, lp.listing_id, {
          checkout_quarantined: false, checkout_quarantine_reason: null,
          checkout_quarantined_at: null, checkout_quarantine_pi_id: null,
          quarantined_reservation_token: null, quarantined_buyer: null,
          quarantined_expiration: null, quarantined_purchase_id: null,
          quarantine_generation: null, recovery_not_before: null,
        });
      } catch (err) {
        // LP quarantine clear failed — restore Listing to hidden quarantine
        await restoreQuarantine(deps, lp.listing_id, `Recovery LP quarantine clear failed: ${err?.message}`, piId);
        quarantineRestoreFailed++; continue;
      }

      // Step 8: Post-verify both entities (7C.7 fix #7)
      const [verifyListing] = await entities.Listing.filter({ id: lp.listing_id });
      const verifyLP = await getListingPrivate(deps, lp.listing_id);

      if (!verifyListing || verifyListing.status !== 'active' || verifyListing.reservation_token !== null || verifyListing.hidden_reason !== null) {
        await restoreQuarantine(deps, lp.listing_id, 'Post-verify failed (Listing not active/cleared)', piId);
        quarantineRestoreFailed++; continue;
      }
      if (!verifyLP || verifyLP.reservation_token !== null || verifyLP.checkout_quarantined !== false) {
        await restoreQuarantine(deps, lp.listing_id, 'Post-verify failed (LP still reserved/quarantined)', piId);
        quarantineRestoreFailed++; continue;
      }

      // Step 9: Check seller intent AFTER all writes (7C.7 fix #5)
      if (hasSellerCancelIntent(verifyLP) || hasSellerPauseIntent(verifyLP)) {
        await restoreQuarantine(deps, lp.listing_id, 'Seller intent detected after post-verify', piId);
        quarantineRestoreFailed++; continue;
      }

      quarantineResolved++;
      released++;
    } catch (err) {
      console.error('[cleanupAbandonedCheckouts] quarantine resolve error', lp.listing_id, err?.message);
      errors++;
    }
  }

  return {
    status: 200,
    body: {
      processed: totalProcessed,
      expired, released, quarantined,
      skipped_recent: skippedRecent, skipped_authorized: skippedAuthorized,
      errors, quarantine_resolved: quarantineResolved,
      quarantine_restore_failed: quarantineRestoreFailed,
      max_skip_reached: maxSkipReached,
    },
  };
}