/**
 * cleanupOrchestrator.js — 7C.8
 *
 * Two-pass architecture:
 *   Phase 1: Cancel/verify PI and quarantine only. Never clear tokens or
 *            reactivate in the same run. PurchasePrivate is the authoritative
 *            source for payment_captured and is_demo — public Purchase fields
 *            are never trusted for these decisions.
 *   Phase 2: Recovery with drain period. Captures generation, PI ID, purchase
 *            ID, and snapshot at the start and re-checks before and after
 *            every mutation. After clearing reservation fields, re-fetches
 *            and verifies BOTH Listing and LP have null reservation_token.
 *            If any token survived (concurrent write), restores quarantine.
 *            Checks seller intent before and after every write.
 *            Paginates through ALL quarantined records, not just the first 200.
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
  isRecoveryBlocked,
  snapshotMatchesCurrentState,
  reservationFieldsAlreadyNull,
  verifyGenerationMatch,
  isTokenBearingQuarantine,
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
const RECOVERY_PAGE_SIZE = 200;
const RECOVERY_MAX_ITERATIONS = 50;

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
  let skippedDemo = 0, skippedCaptured = 0;
  let totalProcessed = 0;
  let maxSkipReached = 0;

  // ═══════════════════════════════════════════════════════════════════════════
  // Phase 1: Process abandoned purchases — quarantine ONLY (7C.7 fix #4)
  // Never clear tokens or reactivate listings in the same run.
  // 7C.8 fix #4: PurchasePrivate is authoritative for payment_captured and is_demo.
  // 7C.8 fix #5: Do not expire a Purchase unless quarantineListing returns quarantined=true.
  // ═══════════════════════════════════════════════════════════════════════════
  const processedIds = new Set();
  let skip = 0;
  let hasMore = true;
  let iteration = 0;

  while (hasMore && iteration < MAX_ITERATIONS) {
    iteration++;
    let page;
    try {
      // 7C.8 fix #4: Filter by workflow status ONLY — not payment_captured or is_demo.
      // These fields come from PurchasePrivate (authoritative).
      page = await entities.Purchase.filter({
        transfer_status: 'pending_transfer',
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

        // 7C.8 fix #4: PurchasePrivate is mandatory — fail closed if missing
        const pp = await getPurchasePrivate(deps, p.id);
        if (!pp) {
          // Missing PP — quarantine listing + critical alert, do NOT expire purchase
          const qResult = await quarantineListing(deps, p.listing_id, `PurchasePrivate missing for purchase ${p.id}`, p.id, p.payment_intent_id);
          if (qResult.quarantined) {
            quarantined++;
          } else {
            // 7C.8 fix #5: Quarantine failed — keep Purchase pending, alert, increment errors
            await criticalAlert(deps, `QUARANTINE FAILED — PurchasePrivate missing for ${p.id}`,
              `Purchase ${p.id} left pending. PI ID: ${p.payment_intent_id || 'N/A'}. Manual resolution required.`, p.listing_id);
            errors++;
          }
          recordsRemainingPending++; continue;
        }

        // Require Purchase ↔ PurchasePrivate listing_id match
        if (p.listing_id !== pp.listing_id) {
          const qResult = await quarantineListing(deps, p.listing_id, `Listing ID mismatch: Purchase=${p.listing_id}, PP=${pp.listing_id}`, p.id, p.payment_intent_id);
          if (qResult.quarantined) { quarantined++; } else { errors++; await criticalAlert(deps, `QUARANTINE FAILED for ${p.listing_id}`, `Listing ID mismatch. Purchase ${p.id} left pending.`, p.listing_id); }
          recordsRemainingPending++; continue;
        }

        // 7C.8 fix #4: Use PurchasePrivate.payment_captured and PurchasePrivate.is_demo EXCLUSIVELY
        // Private captured=true must NEVER be canceled/expired because public captured=false.
        if (pp.payment_captured === true) { skippedCaptured++; recordsRemainingPending++; continue; }
        // Private is_demo=true must be skipped
        if (pp.is_demo === true) { skippedDemo++; recordsRemainingPending++; continue; }

        const piId = pp.payment_intent_id;
        if (!piId) {
          const qResult = await quarantineListing(deps, p.listing_id, `No payment_intent_id for purchase ${p.id}`, p.id, null);
          if (qResult.quarantined) { quarantined++; } else { errors++; await criticalAlert(deps, `QUARANTINE FAILED for ${p.listing_id}`, `No PI ID. Purchase ${p.id} left pending.`, p.listing_id); }
          recordsRemainingPending++; continue;
        }

        // Retrieve PI — failure → quarantine + critical alert (7C.7 fix #1)
        let pi;
        let piStatus = null;
        try {
          pi = await stripe.paymentIntents.retrieve(piId);
          piStatus = pi.status;
        } catch (err) {
          const qResult = await quarantineListing(deps, p.listing_id, `PI retrieval failed for ${piId}: ${err?.message}`, p.id, piId);
          if (qResult.quarantined) { quarantined++; } else { errors++; await criticalAlert(deps, `QUARANTINE FAILED for ${p.listing_id}`, `PI retrieval failed. Purchase ${p.id} left pending. PI ID: ${piId}.`, p.listing_id); }
          await criticalAlert(deps, `PI RETRIEVAL FAILED for ${p.listing_id}`, `PI ID: ${piId}. Error: ${err?.message}. Manual resolution required.`, p.listing_id);
          recordsRemainingPending++; continue;
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
            const qResult = await quarantineListing(deps, p.listing_id, `PI cancel failed during cleanup. PI ID: ${piId}. Error: ${cancelError?.message || 'unknown'}`, p.id, piId);
            if (qResult.quarantined) { quarantined++; } else { errors++; await criticalAlert(deps, `QUARANTINE FAILED for ${p.listing_id}`, `PI cancel failed. Purchase ${p.id} left pending. PI ID: ${piId}.`, p.listing_id); }
            await criticalAlert(deps, `PI CANCEL FAILED for ${p.listing_id}`, `PI ID: ${piId}. Cancel error: ${cancelError?.message || 'unknown'}. Manual cancellation required.`, p.listing_id);
            recordsRemainingPending++; continue;
          }
          piStatus = 'canceled';
        }

        // 7C.8 fix #5: Quarantine BEFORE expiry — do not expire Purchase unless quarantine succeeds
        const qResult = await quarantineListing(deps, p.listing_id,
          `Cleanup Phase 1 quarantine: PI status=${piStatus}, ownership_valid=${ownershipValid}, buyer_match=${ownsByBuyer}, token_match=${ownsByToken}`,
          p.id, piId);

        if (!qResult.quarantined) {
          // 7C.8 fix #5: Quarantine failed — keep Purchase PENDING, create critical alert, increment errors
          await criticalAlert(deps, `QUARANTINE FAILED for ${p.listing_id}`,
            `Phase 1 quarantine write failed. Purchase ${p.id} LEFT PENDING. PI ID: ${piId}. Manual resolution required.`, p.listing_id);
          errors++;
          recordsRemainingPending++; continue;
        }

        // Quarantine succeeded — NOW expire the Purchase
        try {
          await entities.Purchase.update(p.id, { transfer_status: 'expired' });
          expired++;
          staysInResultSet = false;
        } catch (err) {
          // Expiry failed — listing is quarantined, purchase still pending. Alert.
          await criticalAlert(deps, `PURCHASE EXPIRY FAILED for ${p.id}`,
            `Error: ${err?.message}. Listing is quarantined. Purchase left pending. PI ID: ${piId}.`, p.listing_id);
          errors++;
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
  // Phase 2: Quarantine recovery (7C.8 fixes #2, #3, #7)
  // 7C.8 fix #7: Paginate through ALL checkout_quarantined LPs, not just first 200.
  // 7C.8 fix #2: Capture generation, PI ID, purchase ID, snapshot at start.
  //              Re-fetch and require exact equality before and after every mutation.
  // 7C.8 fix #3: After clearing reservation fields, re-fetch and verify BOTH
  //              Listing and LP have null reservation_token. If any token survived,
  //              restore quarantine and skip.
  // ═══════════════════════════════════════════════════════════════════════════
  let quarantineResolved = 0;
  let quarantineRestoreFailed = 0;
  const recoveryProcessedIds = new Set();
  let recoverySkip = 0;
  let recoveryHasMore = true;
  let recoveryIteration = 0;

  while (recoveryHasMore && recoveryIteration < RECOVERY_MAX_ITERATIONS) {
    recoveryIteration++;
    let quarantinedListings;
    try {
      quarantinedListings = await entities.ListingPrivate.filter(
        { checkout_quarantined: true }, 'id', RECOVERY_PAGE_SIZE, recoverySkip
      );
    } catch (err) { break; }

    if (quarantinedListings.length === 0) { recoveryHasMore = false; break; }

    let recoveryRecordsRemaining = 0;

    for (const lp of quarantinedListings) {
      if (recoveryProcessedIds.has(lp.listing_id)) { recoveryRecordsRemaining++; continue; }
      recoveryProcessedIds.add(lp.listing_id);

      try {
        const piId = lp.checkout_quarantine_pi_id;
        if (!piId) { recoveryRecordsRemaining++; continue; }

        // 7C.8 fix #1: Check recovery_blocked marker — skip if blocked
        if (isRecoveryBlocked(lp)) { recoveryRecordsRemaining++; continue; }

        // 7C.7 fix #4: Check drain period
        if (!drainPeriodPassed(lp, deps.now())) { recoveryRecordsRemaining++; continue; }

        // Re-fetch ALL entities before every write
        const [listingFresh] = await entities.Listing.filter({ id: lp.listing_id });
        const lpFresh = await getListingPrivate(deps, lp.listing_id);

        if (!listingFresh || listingFresh.status !== 'hidden' || listingFresh.hidden_reason !== 'checkout_quarantine') { recoveryRecordsRemaining++; continue; }
        if (!lpFresh || !lpFresh.checkout_quarantined) { recoveryRecordsRemaining++; continue; }

        // 7C.7 fix #5: Check seller cancel intent BEFORE any write
        if (hasSellerCancelIntent(lpFresh) || hasSellerPauseIntent(lpFresh)) { recoveryRecordsRemaining++; continue; }

        // Never reactivate a seller-cancelled listing
        if (listingFresh.status === 'cancelled') { recoveryRecordsRemaining++; continue; }

        // 7C.8 fix #1: Check recovery_blocked on fresh LP
        if (isRecoveryBlocked(lpFresh)) { recoveryRecordsRemaining++; continue; }

        // 7C.8 fix #2: Capture generation, PI ID, purchase ID, snapshot at the beginning
        const capturedGeneration = lpFresh.quarantine_generation;
        const capturedPiId = piId;
        const capturedPurchaseId = lpFresh.quarantined_purchase_id;

        // Retrieve PI
        let pi;
        try {
          pi = await stripe.paymentIntents.retrieve(piId);
        } catch (err) { recoveryRecordsRemaining++; continue; }

        // Check no pending purchases
        const pendingPurchases = await entities.Purchase.filter({
          listing_id: lp.listing_id, transfer_status: 'pending_transfer',
        });

        // Basic recovery conditions
        if (!canRecoverQuarantine(listingFresh, lpFresh, pi, pendingPurchases)) { recoveryRecordsRemaining++; continue; }

        // 7C.7 fix #4: Require current LP values to match durable quarantine snapshot
        if (!matchesQuarantineSnapshot(lpFresh)) { recoveryRecordsRemaining++; continue; }

        // 7C.8 fix #2: Re-verify generation match before any mutation
        const lpGenCheck = await getListingPrivate(deps, lp.listing_id);
        if (!verifyGenerationMatch(capturedGeneration, capturedPiId, capturedPurchaseId, lpGenCheck)) {
          // Newer generation or different PI/purchase — cannot safely recover
          await criticalAlert(deps, `GENERATION MISMATCH for ${lp.listing_id}`,
            `Captured gen=${capturedGeneration}, current gen=${lpGenCheck?.quarantine_generation}. PI: ${capturedPiId} vs ${lpGenCheck?.checkout_quarantine_pi_id}. Manual resolution required.`, lp.listing_id);
          recoveryRecordsRemaining++; continue;
        }

        // ── Step 1: Pre-clear verification ──────────────────────────────
        const lpPreClear = await getListingPrivate(deps, lp.listing_id);
        if (!lpPreClear || !matchesQuarantineSnapshot(lpPreClear)) {
          await criticalAlert(deps, `NEW TOKEN DETECTED before recovery clearing for ${lp.listing_id}`,
            `Snapshot: ${lp.quarantined_reservation_token}, Current: ${lpPreClear?.reservation_token}. Left quarantined.`, lp.listing_id);
          recoveryRecordsRemaining++; continue;
        }
        // 7C.8 fix #2: Verify generation still matches
        if (!verifyGenerationMatch(capturedGeneration, capturedPiId, capturedPurchaseId, lpPreClear)) {
          recoveryRecordsRemaining++; continue;
        }

        // ── Step 2a: Clear Listing reservation fields ──────────────────
        try {
          await entities.Listing.update(lp.listing_id, {
            reservation_token: null, reservation_expires_at: null, reserved_by_email: null,
          });
        } catch (err) {
          await criticalAlert(deps, `LISTING CLEAR FAILED for ${lp.listing_id}`, `Error: ${err?.message}. PI ID: ${piId}.`, lp.listing_id);
          quarantineRestoreFailed++;
          recoveryRecordsRemaining++; continue;
        }

        // ── Step 2b: Re-fetch LP and check token still matches snapshot ─
        const lpMidClear = await getListingPrivate(deps, lp.listing_id);
        if (!lpMidClear || !matchesQuarantineSnapshot(lpMidClear)) {
          await restoreQuarantine(deps, lp.listing_id, 'New token detected during Listing clear — token preserved', piId);
          quarantineRestoreFailed++; recoveryRecordsRemaining++; continue;
        }
        // 7C.8 fix #2: Verify generation still matches
        if (!verifyGenerationMatch(capturedGeneration, capturedPiId, capturedPurchaseId, lpMidClear)) {
          await restoreQuarantine(deps, lp.listing_id, 'Generation mismatch during Listing clear', piId);
          quarantineRestoreFailed++; recoveryRecordsRemaining++; continue;
        }

        // ── Step 2c: Clear LP reservation fields ────────────────────────
        try {
          await upsertListingPrivate(deps, lp.listing_id, {
            reservation_token: null, reservation_expires_at: null, reserved_by_email: null,
          });
        } catch (err) {
          try {
            await entities.Listing.update(lp.listing_id, {
              reservation_token: lp.quarantined_reservation_token,
              reservation_expires_at: lp.quarantined_expiration,
              reserved_by_email: lp.quarantined_buyer,
            });
          } catch (_) { /* best effort */ }
          await criticalAlert(deps, `LP CLEAR FAILED for ${lp.listing_id}`, `Error: ${err?.message}. PI ID: ${piId}.`, lp.listing_id);
          quarantineRestoreFailed++;
          recoveryRecordsRemaining++; continue;
        }

        // ── Step 3: 7C.8 fix #3 — Verify BOTH Listing and LP have null reservation_token
        // After clearing, re-fetch and verify no token survived. If a concurrent write
        // injected a new token, it must be detected here and the listing must stay quarantined.
        const [listingCleared] = await entities.Listing.filter({ id: lp.listing_id });
        const lpCleared = await getListingPrivate(deps, lp.listing_id);
        if (!listingCleared || listingCleared.reservation_token !== null) {
          await restoreQuarantine(deps, lp.listing_id, 'Listing reservation not cleared after recovery — token survived', piId);
          quarantineRestoreFailed++; recoveryRecordsRemaining++; continue;
        }
        if (!lpCleared || lpCleared.reservation_token !== null) {
          await restoreQuarantine(deps, lp.listing_id, 'LP reservation not cleared after recovery — token survived', piId);
          quarantineRestoreFailed++; recoveryRecordsRemaining++; continue;
        }
        // 7C.8 fix #2: Verify generation still matches after clearing
        if (!verifyGenerationMatch(capturedGeneration, capturedPiId, capturedPurchaseId, lpCleared)) {
          await restoreQuarantine(deps, lp.listing_id, 'Generation mismatch after clearing', piId);
          quarantineRestoreFailed++; recoveryRecordsRemaining++; continue;
        }

        // ── Step 4: Check seller intent BEFORE activating ───────────────
        const lpBeforeActivate = await getListingPrivate(deps, lp.listing_id);
        if (hasSellerCancelIntent(lpBeforeActivate) || hasSellerPauseIntent(lpBeforeActivate)) {
          await restoreQuarantine(deps, lp.listing_id, 'Seller intent detected before activation', piId);
          recoveryRecordsRemaining++; continue;
        }
        if (!verifyGenerationMatch(capturedGeneration, capturedPiId, capturedPurchaseId, lpBeforeActivate)) {
          await restoreQuarantine(deps, lp.listing_id, 'Generation mismatch before activation', piId);
          quarantineRestoreFailed++; recoveryRecordsRemaining++; continue;
        }

        // ── Step 5: Activate Listing while LP quarantine is still true ──
        try {
          await entities.Listing.update(lp.listing_id, {
            status: 'active', hidden_reason: null,
          });
        } catch (err) {
          await restoreQuarantine(deps, lp.listing_id, `Recovery Listing activation failed: ${err?.message}`, piId);
          quarantineRestoreFailed++; recoveryRecordsRemaining++; continue;
        }

        // ── Step 6: Re-fetch seller intent AFTER activation ────────────
        const lpAfterActivate = await getListingPrivate(deps, lp.listing_id);
        if (hasSellerCancelIntent(lpAfterActivate) || hasSellerPauseIntent(lpAfterActivate)) {
          await restoreQuarantine(deps, lp.listing_id, 'Seller cancel detected after activation', piId);
          await criticalAlert(deps, `SELLER CANCEL DURING RECOVERY for ${lp.listing_id}`,
            `Seller intent appeared between Listing activation and LP quarantine clearing. Restored to quarantine. PI ID: ${piId}.`, lp.listing_id);
          quarantineRestoreFailed++; recoveryRecordsRemaining++; continue;
        }
        // 7C.8 fix #2: Verify generation still matches after activation
        if (!verifyGenerationMatch(capturedGeneration, capturedPiId, capturedPurchaseId, lpAfterActivate)) {
          await restoreQuarantine(deps, lp.listing_id, 'Generation mismatch after activation', piId);
          quarantineRestoreFailed++; recoveryRecordsRemaining++; continue;
        }

        // ── Step 7: Clear LP quarantine only after verification ────────
        try {
          await upsertListingPrivate(deps, lp.listing_id, {
            checkout_quarantined: false, checkout_quarantine_reason: null,
            checkout_quarantined_at: null, checkout_quarantine_pi_id: null,
            quarantined_reservation_token: null, quarantined_buyer: null,
            quarantined_expiration: null, quarantined_purchase_id: null,
            quarantine_generation: null, recovery_not_before: null,
          });
        } catch (err) {
          await restoreQuarantine(deps, lp.listing_id, `Recovery LP quarantine clear failed: ${err?.message}`, piId);
          quarantineRestoreFailed++; recoveryRecordsRemaining++; continue;
        }

        // ── Step 8: Post-verify both entities ──────────────────────────
        const [verifyListing] = await entities.Listing.filter({ id: lp.listing_id });
        const verifyLP = await getListingPrivate(deps, lp.listing_id);

        if (!verifyListing || verifyListing.status !== 'active' || verifyListing.reservation_token !== null || verifyListing.hidden_reason !== null) {
          await restoreQuarantine(deps, lp.listing_id, 'Post-verify failed (Listing not active/cleared)', piId);
          quarantineRestoreFailed++; recoveryRecordsRemaining++; continue;
        }
        if (!verifyLP || verifyLP.reservation_token !== null || verifyLP.checkout_quarantined !== false) {
          await restoreQuarantine(deps, lp.listing_id, 'Post-verify failed (LP still reserved/quarantined)', piId);
          quarantineRestoreFailed++; recoveryRecordsRemaining++; continue;
        }

        // ── Step 9: Check seller intent AFTER all writes ────────────────
        if (hasSellerCancelIntent(verifyLP) || hasSellerPauseIntent(verifyLP)) {
          await restoreQuarantine(deps, lp.listing_id, 'Seller intent detected after post-verify', piId);
          quarantineRestoreFailed++; recoveryRecordsRemaining++; continue;
        }

        quarantineResolved++;
        released++;
        // Successfully recovered — leaves the result set
      } catch (err) {
        console.error('[cleanupAbandonedCheckouts] quarantine resolve error', lp.listing_id, err?.message);
        errors++;
        recoveryRecordsRemaining++;
      }
    }

    recoverySkip += recoveryRecordsRemaining;
    if (quarantinedListings.length < RECOVERY_PAGE_SIZE) recoveryHasMore = false;
  }

  return {
    status: 200,
    body: {
      processed: totalProcessed,
      expired, released, quarantined,
      skipped_recent: skippedRecent, skipped_authorized: skippedAuthorized,
      skipped_demo: skippedDemo, skipped_captured: skippedCaptured,
      errors, quarantine_resolved: quarantineResolved,
      quarantine_restore_failed: quarantineRestoreFailed,
      max_skip_reached: maxSkipReached,
    },
  };
}