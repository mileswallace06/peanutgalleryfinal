/**
 * cleanupOrchestrator.js — 7C.8
 *
 * Two-pass architecture:
 *   Phase 1: Cancel/verify PI and quarantine only. Never clear tokens or
 *            reactivate in the same run. PurchasePrivate is the authoritative
 *            source for payment_captured and is_demo — public Purchase fields
 *            are never trusted for these decisions.
 *   Phase 2: Recovery with drain period. Prohibits automatic clearing of
 *            token-bearing quarantines. Automatic activation is allowed ONLY
 *            when Listing and LP reservation fields are already null AND
 *            the immutable snapshot is also null. Never writes
 *            reservation_token:null to Listing or LP — only activates and
 *            clears quarantine-specific fields. After clearing, re-fetches
 *            and verifies no reservation_token appeared (concurrent write
 *            detection). Checks seller intent before and after every write.
 *            Paginates through ALL quarantined records.
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

// Helper: restore quarantine on both entities — verified, fail-closed
// Returns { restored, listingVerified, lpVerified, actualState }
// Never describes quarantine as restored unless both Listing and ListingPrivate verify.
// Preserves immutable snapshot/generation/PI/purchase fields (not written here).
// On restoration failure, persists recovery_blocked=true and a critical AdminAlert
// with PI ID and actual post-failure state.
async function restoreQuarantine(deps, listing_id, reason, piId) {
  const result = { restored: false, listingVerified: false, lpVerified: false, actualState: {} };

  // Step 1: Write Listing to hidden/checkout_quarantine — awaited, no catch-and-ignore
  let listingWriteError = null;
  try {
    await deps.entities.Listing.update(listing_id, { status: 'hidden', hidden_reason: 'checkout_quarantine' });
  } catch (err) {
    listingWriteError = err;
  }

  // Step 2: Write ListingPrivate quarantine fields — awaited, no catch-and-ignore
  // Immutable fields (snapshot, generation, PI, purchase) are NOT written here — preserved by merge.
  let lpWriteError = null;
  try {
    await upsertListingPrivate(deps, listing_id, {
      checkout_quarantined: true,
      checkout_quarantine_reason: reason,
    });
  } catch (err) {
    lpWriteError = err;
  }

  // Step 3: Re-fetch and verify both entities
  let listingFinal = null;
  try {
    const rows = await deps.entities.Listing.filter({ id: listing_id });
    listingFinal = rows[0];
  } catch (err) {
    result.actualState.listingFetchError = err?.message;
  }

  let lpFinal = null;
  try {
    lpFinal = await getListingPrivate(deps, listing_id);
  } catch (err) {
    result.actualState.lpFetchError = err?.message;
  }

  if (listingFinal && listingFinal.status === 'hidden' && listingFinal.hidden_reason === 'checkout_quarantine') {
    result.listingVerified = true;
  }
  if (lpFinal && lpFinal.checkout_quarantined === true) {
    result.lpVerified = true;
  }

  result.actualState.listingStatus = listingFinal?.status;
  result.actualState.listingHiddenReason = listingFinal?.hidden_reason;
  result.actualState.listingReservationToken = listingFinal?.reservation_token;
  result.actualState.lpQuarantined = lpFinal?.checkout_quarantined;
  result.actualState.lpReservationToken = lpFinal?.reservation_token;
  result.actualState.lpRecoveryBlocked = lpFinal?.recovery_blocked;
  result.actualState.listingWriteError = listingWriteError?.message;
  result.actualState.lpWriteError = lpWriteError?.message;

  result.restored = result.listingVerified && result.lpVerified;

  // Step 4: If restoration failed, persist recovery_blocked=true + critical alert with PI ID
  if (!result.restored) {
    try {
      await upsertListingPrivate(deps, listing_id, {
        recovery_blocked: true,
        recovery_blocked_reason: `Quarantine restoration failed: ${reason}. Listing verified: ${result.listingVerified}, LP verified: ${result.lpVerified}. Actual state: ${JSON.stringify(result.actualState)}. PI ID: ${piId || 'N/A'}.`,
        recovery_blocked_at: new Date(deps.now()).toISOString(),
      });
    } catch (_) { /* best effort — alert is the durable record */ }
    await criticalAlert(deps, `QUARANTINE RESTORATION FAILED for ${listing_id}`,
      `Restoration failed. Reason: ${reason}. Listing verified: ${result.listingVerified}, LP verified: ${result.lpVerified}. PI ID: ${piId || 'N/A'}. Actual state: ${JSON.stringify(result.actualState)}. Manual resolution required.`,
      listing_id);
  }

  return result;
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
  // Phase 1: Process abandoned purchases — quarantine ONLY
  // Never clear tokens or reactivate listings in the same run.
  // PurchasePrivate is authoritative for payment_captured and is_demo.
  // Do not expire a Purchase unless quarantineListing returns quarantined=true.
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

        // PurchasePrivate is mandatory — fail closed if missing
        const pp = await getPurchasePrivate(deps, p.id);
        if (!pp) {
          const qResult = await quarantineListing(deps, p.listing_id, `PurchasePrivate missing for purchase ${p.id}`, p.id, p.payment_intent_id);
          if (qResult.quarantined) {
            quarantined++;
          } else {
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

        // Use PurchasePrivate.payment_captured and PurchasePrivate.is_demo EXCLUSIVELY
        if (pp.payment_captured === true) { skippedCaptured++; recordsRemainingPending++; continue; }
        if (pp.is_demo === true) { skippedDemo++; recordsRemainingPending++; continue; }

        const piId = pp.payment_intent_id;
        if (!piId) {
          const qResult = await quarantineListing(deps, p.listing_id, `No payment_intent_id for purchase ${p.id}`, p.id, null);
          if (qResult.quarantined) { quarantined++; } else { errors++; await criticalAlert(deps, `QUARANTINE FAILED for ${p.listing_id}`, `No PI ID. Purchase ${p.id} left pending.`, p.listing_id); }
          recordsRemainingPending++; continue;
        }

        // Retrieve PI — failure → quarantine + critical alert
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

        // Quarantine BEFORE expiry — do not expire Purchase unless quarantine succeeds
        const qResult = await quarantineListing(deps, p.listing_id,
          `Cleanup Phase 1 quarantine: PI status=${piStatus}, ownership_valid=${ownershipValid}, buyer_match=${ownsByBuyer}, token_match=${ownsByToken}`,
          p.id, piId);

        if (!qResult.quarantined) {
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
  // Phase 2: Quarantine recovery
  // PROHIBITS automatic clearing of token-bearing quarantines.
  //   - If quarantined_reservation_token is non-null, OR Listing/LP currently
  //     have any reservation token/buyer/expiry, do not clear. Block recovery.
  //   - Automatic activation is allowed ONLY when Listing and LP reservation
  //     fields are already null AND the immutable snapshot is also null.
  //   - Never writes reservation_token:null to Listing or LP — only activates
  //     and clears quarantine-specific fields.
  //   - After clearing, re-fetches and verifies no reservation_token appeared.
  // ═══════════════════════════════════════════════════════════════════════════
  let quarantineResolved = 0;
  let quarantineRestoreFailed = 0;
  let quarantineBlocked = 0;
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

        // Check recovery_blocked marker — skip if blocked
        if (isRecoveryBlocked(lp)) { recoveryRecordsRemaining++; continue; }

        // Check drain period
        if (!drainPeriodPassed(lp, deps.now())) { recoveryRecordsRemaining++; continue; }

        // Re-fetch ALL entities before every write
        const [listingFresh] = await entities.Listing.filter({ id: lp.listing_id });
        const lpFresh = await getListingPrivate(deps, lp.listing_id);

        if (!listingFresh || listingFresh.status !== 'hidden' || listingFresh.hidden_reason !== 'checkout_quarantine') { recoveryRecordsRemaining++; continue; }
        if (!lpFresh || !lpFresh.checkout_quarantined) { recoveryRecordsRemaining++; continue; }

        // Check seller cancel/pause intent BEFORE any write
        if (hasSellerCancelIntent(lpFresh) || hasSellerPauseIntent(lpFresh)) { recoveryRecordsRemaining++; continue; }

        // Never reactivate a seller-cancelled listing
        if (listingFresh.status === 'cancelled') { recoveryRecordsRemaining++; continue; }

        // Check recovery_blocked on fresh LP
        if (isRecoveryBlocked(lpFresh)) { recoveryRecordsRemaining++; continue; }

        // Capture generation, PI ID, purchase ID at the beginning
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

        // Require current LP values to match durable quarantine snapshot
        if (!matchesQuarantineSnapshot(lpFresh)) { recoveryRecordsRemaining++; continue; }

        // Verify generation match before any mutation
        const lpGenCheck = await getListingPrivate(deps, lp.listing_id);
        if (!verifyGenerationMatch(capturedGeneration, capturedPiId, capturedPurchaseId, lpGenCheck)) {
          await criticalAlert(deps, `GENERATION MISMATCH for ${lp.listing_id}`,
            `Captured gen=${capturedGeneration}, current gen=${lpGenCheck?.quarantine_generation}. PI: ${capturedPiId} vs ${lpGenCheck?.checkout_quarantine_pi_id}. Manual resolution required.`, lp.listing_id);
          recoveryRecordsRemaining++; continue;
        }

        // ── PROHIBIT automatic clearing of token-bearing quarantines ──
        // If the immutable snapshot has a reservation token, block recovery.
        if (isTokenBearingQuarantine(lpFresh)) {
          try {
            await upsertListingPrivate(deps, lp.listing_id, {
              recovery_blocked: true,
              recovery_blocked_reason: `Token-bearing quarantine cannot be auto-cleared. Snapshot token: ${lpFresh.quarantined_reservation_token}. Manual resolution required.`,
              recovery_blocked_at: new Date(deps.now()).toISOString(),
            });
          } catch (_) { /* best effort */ }
          await criticalAlert(deps, `TOKEN-BEARING QUARANTINE BLOCKED for ${lp.listing_id}`,
            `Snapshot token: ${lpFresh.quarantined_reservation_token}. Cannot auto-clear. Manual resolution required. PI ID: ${piId}.`, lp.listing_id);
          quarantineBlocked++;
          recoveryRecordsRemaining++; continue;
        }

        // If Listing or LP currently have any reservation fields, block recovery.
        if (!reservationFieldsAlreadyNull(listingFresh, lpFresh)) {
          try {
            await upsertListingPrivate(deps, lp.listing_id, {
              recovery_blocked: true,
              recovery_blocked_reason: `Listing/LP have active reservation fields. Listing token: ${listingFresh?.reservation_token}, LP token: ${lpFresh?.reservation_token}. Manual resolution required.`,
              recovery_blocked_at: new Date(deps.now()).toISOString(),
            });
          } catch (_) { /* best effort */ }
          await criticalAlert(deps, `RESERVATION FIELDS BLOCKED for ${lp.listing_id}`,
            `Listing/LP have active reservation fields. Cannot auto-clear. Manual resolution required. PI ID: ${piId}.`, lp.listing_id);
          quarantineBlocked++;
          recoveryRecordsRemaining++; continue;
        }

        // Verify snapshot also matches current state (both null) — redundant safety
        if (!snapshotMatchesCurrentState(lpFresh)) {
          recoveryRecordsRemaining++; continue;
        }

        // ── Step 1: Check seller intent BEFORE activating ──────────────
        const lpBeforeActivate = await getListingPrivate(deps, lp.listing_id);
        if (hasSellerCancelIntent(lpBeforeActivate) || hasSellerPauseIntent(lpBeforeActivate)) {
          recoveryRecordsRemaining++; continue;
        }
        if (!verifyGenerationMatch(capturedGeneration, capturedPiId, capturedPurchaseId, lpBeforeActivate)) {
          recoveryRecordsRemaining++; continue;
        }

        // ── Step 2: Activate Listing (DO NOT touch reservation fields) ──
        try {
          await entities.Listing.update(lp.listing_id, {
            status: 'active', hidden_reason: null,
          });
        } catch (err) {
          await criticalAlert(deps, `RECOVERY LISTING ACTIVATION FAILED for ${lp.listing_id}`, `Error: ${err?.message}. PI ID: ${piId}.`, lp.listing_id);
          quarantineRestoreFailed++; recoveryRecordsRemaining++; continue;
        }

        // ── Step 3: Re-fetch seller intent AFTER activation ────────────
        const lpAfterActivate = await getListingPrivate(deps, lp.listing_id);
        if (hasSellerCancelIntent(lpAfterActivate) || hasSellerPauseIntent(lpAfterActivate)) {
          const restoreResult = await restoreQuarantine(deps, lp.listing_id, 'Seller cancel detected after activation', piId);
          if (!restoreResult.restored) quarantineRestoreFailed++;
          recoveryRecordsRemaining++; continue;
        }
        if (!verifyGenerationMatch(capturedGeneration, capturedPiId, capturedPurchaseId, lpAfterActivate)) {
          // Generation/PI/purchase tuple differs — preserve current tuple exactly,
          // set recovery_blocked=true, alert, require manual resolution.
          const restoreResult = await restoreQuarantine(deps, lp.listing_id, 'Generation mismatch after activation', piId);
          const currentGen = lpAfterActivate?.quarantine_generation;
          const currentPi = lpAfterActivate?.checkout_quarantine_pi_id;
          const currentPurchase = lpAfterActivate?.quarantined_purchase_id;
          try {
            await upsertListingPrivate(deps, lp.listing_id, {
              recovery_blocked: true,
              recovery_blocked_reason: `Generation mismatch during recovery. Captured gen=${capturedGeneration}, PI=${capturedPiId}, purchase=${capturedPurchaseId}. Current gen=${currentGen}, PI=${currentPi}, purchase=${currentPurchase}. Current tuple preserved. Manual resolution required.`,
              recovery_blocked_at: new Date(deps.now()).toISOString(),
            });
          } catch (_) { /* best effort */ }
          await criticalAlert(deps, `GENERATION MISMATCH — RECOVERY BLOCKED for ${lp.listing_id}`,
            `Captured gen=${capturedGeneration}, PI=${capturedPiId}, purchase=${capturedPurchaseId}. Current gen=${currentGen}, PI=${currentPi}, purchase=${currentPurchase}. Current tuple preserved unchanged. PI ID: ${piId}. Manual resolution required.`, lp.listing_id);
          if (!restoreResult.restored) quarantineRestoreFailed++;
          quarantineBlocked++;
          recoveryRecordsRemaining++; continue;
        }

        // ── Step 4: Clear LP quarantine ONLY (DO NOT touch reservation fields) ──
        // This is the critical step where a concurrent token injection must be
        // detected. We do NOT write reservation_token:null — only quarantine-
        // specific fields. A token injected via before_ListingPrivate_update
        // survives because the update data does not include reservation_token.
        try {
          // ONLY clear quarantine-specific fields. Preserve identity/snapshot/
          // generation/recovery_not_before as inert audit data while checkout_quarantined=false.
          await upsertListingPrivate(deps, lp.listing_id, {
            checkout_quarantined: false, checkout_quarantine_reason: null,
            checkout_quarantined_at: null,
          });
        } catch (err) {
          const restoreResult = await restoreQuarantine(deps, lp.listing_id, `Recovery LP quarantine clear failed: ${err?.message}`, piId);
          if (!restoreResult.restored) quarantineRestoreFailed++;
          recoveryRecordsRemaining++; continue;
        }

        // ── Step 5: Post-verify both entities ──────────────────────────
        // Verify Listing is active with no reservation token.
        // Verify LP quarantine is cleared AND no reservation token appeared
        // (a concurrent write may have injected one during the update).
        const [verifyListing] = await entities.Listing.filter({ id: lp.listing_id });
        const verifyLP = await getListingPrivate(deps, lp.listing_id);

        if (!verifyListing || verifyListing.status !== 'active' || verifyListing.reservation_token !== null || verifyListing.hidden_reason !== null) {
          const restoreResult = await restoreQuarantine(deps, lp.listing_id, 'Post-verify failed (Listing not active/cleared)', piId);
          if (!restoreResult.restored) quarantineRestoreFailed++;
          recoveryRecordsRemaining++; continue;
        }
        if (!verifyLP || verifyLP.reservation_token !== null || verifyLP.checkout_quarantined !== false) {
          const restoreResult = await restoreQuarantine(deps, lp.listing_id, 'Post-verify failed (LP has reservation token or still quarantined)', piId);
          if (!restoreResult.restored) quarantineRestoreFailed++;
          recoveryRecordsRemaining++; continue;
        }

        // ── Step 6: Check seller intent AFTER all writes ────────────────
        if (hasSellerCancelIntent(verifyLP) || hasSellerPauseIntent(verifyLP)) {
          const restoreResult = await restoreQuarantine(deps, lp.listing_id, 'Seller intent detected after post-verify', piId);
          if (!restoreResult.restored) quarantineRestoreFailed++;
          recoveryRecordsRemaining++; continue;
        }

        quarantineResolved++;
        released++;
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
      quarantine_blocked: quarantineBlocked,
      max_skip_reached: maxSkipReached,
    },
  };
}