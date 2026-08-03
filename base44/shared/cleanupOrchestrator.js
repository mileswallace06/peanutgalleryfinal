/**
 * cleanupOrchestrator.js — 7C.6
 *
 * Key fixes (7C.6):
 *   1. Separate cleanup validation (verifyCleanupOwnership allows expired,
 *      requires purchase_id).
 *   2. Quarantine-lock release sequence: never make Listing active before
 *      ListingPrivate is safely cleared.
 *   3. New token detection at every re-fetch → quarantine, never erase.
 *   4. Real pagination using positional skip (not processedIds-only).
 *
 * deps = { entities, stripe, now, isMaintenanceActive }
 * Returns: { status, body }
 */
import {
  classifyCleanupOutcome,
  verifyCleanupOwnership,
  canRecoverQuarantine,
  isQuarantined,
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

// Helper: check for new token (never erase a new token)
function checkTokenStable(entity, originalToken, label) {
  if (!entity) return false;
  return entity.reservation_token === originalToken;
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

  // ── Phase 1: Process abandoned purchases (real pagination using skip) ──
  const processedIds = new Set();
  const quarantinedInPhase1 = new Set();
  // Wrapper that tracks which listings were quarantined during Phase 1,
  // so Phase 2 doesn't immediately recover them (7C.6 fix #3).
  const quarantineAndTrack = (listing_id, reason, purchase_id, pi_id) => {
    quarantinedInPhase1.add(listing_id);
    return quarantineListing(deps, listing_id, reason, purchase_id, pi_id);
  };
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

    // Track records that remain in the result set (not expired)
    // These advance the skip cursor
    let recordsRemainingPending = 0;

    for (const p of page) {
      if (processedIds.has(p.id)) { recordsRemainingPending++; continue; }
      processedIds.add(p.id);
      totalProcessed++;
      maxSkipReached = Math.max(maxSkipReached, skip + recordsRemainingPending);

      // Flag: does this record stay in the result set after processing?
      // true = Purchase remains 'pending_transfer' (skipped or quarantined-but-not-expired)
      // false = Purchase was expired (removed from result set)
      let staysInResultSet = true;

      try {
        const created = p.created_date ? new Date(p.created_date).getTime() : 0;
        if (currentTime - created < ABANDONED_MS) { skippedRecent++; recordsRemainingPending++; continue; }

        // PurchasePrivate is mandatory
        const pp = await getPurchasePrivate(deps, p.id);
        if (!pp) {
          await quarantineAndTrack(p.listing_id, `PurchasePrivate missing for purchase ${p.id}`, p.id, p.payment_intent_id);
          quarantined++; recordsRemainingPending++; continue;
        }

        // Require Purchase ↔ PurchasePrivate listing_id match
        if (p.listing_id !== pp.listing_id) {
          await quarantineAndTrack(p.listing_id, `Listing ID mismatch: Purchase=${p.listing_id}, PP=${pp.listing_id}`, p.id, p.payment_intent_id);
          quarantined++; recordsRemainingPending++; continue;
        }

        const piId = pp.payment_intent_id;
        if (!piId) {
          await quarantineAndTrack(p.listing_id, `No payment_intent_id for purchase ${p.id}`, p.id, null);
          quarantined++; recordsRemainingPending++; continue;
        }

        // Retrieve PI — failure → quarantine (fail-closed)
        let pi;
        let piStatus = null;
        try {
          pi = await stripe.paymentIntents.retrieve(piId);
          piStatus = pi.status;
        } catch (err) {
          await quarantineAndTrack(p.listing_id, `PI retrieval failed for ${piId}: ${err?.message}`, p.id, piId);
          quarantined++; recordsRemainingPending++; continue;
        }

        // Re-fetch Listing + LP for ownership check
        const [listing] = await entities.Listing.filter({ id: p.listing_id });
        const lp = await getListingPrivate(deps, p.listing_id);

        // Verify cleanup ownership (allows expired, requires purchase_id)
        const ownershipValid = verifyCleanupOwnership(p, pp, listing, lp, pi);

        // Classify cleanup outcome
        const ownsByBuyer = !!(listing && listing.reserved_by_email === pp.buyer_email);
        const ownsByToken = !!(pp.reservation_token && lp && lp.reservation_token === pp.reservation_token);
        const outcome = classifyCleanupOutcome(piStatus, ownsByBuyer, ownsByToken);

        if (outcome === 'keep_locked') { skippedAuthorized++; recordsRemainingPending++; continue; }

        if (outcome === 'quarantine' || !ownershipValid) {
          await quarantineAndTrack(p.listing_id, `Cleanup quarantine: PI status=${piStatus}, ownership_valid=${ownershipValid}, buyer_match=${ownsByBuyer}, token_match=${ownsByToken}`, p.id, piId);
          quarantined++; recordsRemainingPending++; continue;
        }

        // ══ QUARANTINE-LOCK RELEASE SEQUENCE (7C.6 fix #2) ══
        // Never make Listing active before ListingPrivate is safely cleared.

        // Capture original token for all subsequent checks
        const originalToken = pp.reservation_token;
        const originalBuyer = pp.buyer_email;

        // Step 1: Cancel PI and positively verify canceled
        if (piStatus === 'requires_payment_method' || piStatus === 'requires_action') {
          try {
            const canceled = await stripe.paymentIntents.cancel(piId);
            if (canceled.status !== 'canceled') {
              await quarantineAndTrack(p.listing_id, `PI cancel returned ${canceled.status}`, p.id, piId);
              quarantined++; recordsRemainingPending++; continue;
            }
            piStatus = 'canceled';
          } catch (err) {
            try {
              const retrieved = await stripe.paymentIntents.retrieve(piId);
              if (retrieved.status !== 'canceled') {
                await quarantineAndTrack(p.listing_id, `PI cancel failed: ${err?.message}, status=${retrieved.status}`, p.id, piId);
                quarantined++; recordsRemainingPending++; continue;
              }
              piStatus = 'canceled';
            } catch (__) {
              await quarantineAndTrack(p.listing_id, `PI cancel+retrieve failed: ${err?.message}`, p.id, piId);
              quarantined++; recordsRemainingPending++; continue;
            }
          }
        }

        // Step 2: Re-fetch and verify exact buyer/token/PI metadata
        const [listingFresh2] = await entities.Listing.filter({ id: p.listing_id });
        const lpFresh2 = await getListingPrivate(deps, p.listing_id);
        const [purchaseFresh] = await entities.Purchase.filter({ id: p.id });
        const ppFresh = await getPurchasePrivate(deps, p.id);
        let piFresh;
        try {
          piFresh = await stripe.paymentIntents.retrieve(piId);
        } catch (err) {
          await quarantineAndTrack(p.listing_id, `PI re-fetch failed: ${err?.message}`, p.id, piId);
          quarantined++; recordsRemainingPending++; continue;
        }

        // Check for new token (7C.6 fix #3: never erase a new token)
        if (!checkTokenStable(lpFresh2, originalToken, 'LP') || !checkTokenStable(listingFresh2, originalToken, 'Listing')) {
          await quarantineAndTrack(p.listing_id, `New reservation token appeared (was: ${originalToken}, LP: ${lpFresh2?.reservation_token}, Listing: ${listingFresh2?.reservation_token}) — manual resolution required`, p.id, piId);
          quarantined++; recordsRemainingPending++; continue;
        }

        // Verify cleanup ownership with fresh data
        if (!verifyCleanupOwnership(purchaseFresh, ppFresh, listingFresh2, lpFresh2, piFresh)) {
          await quarantineAndTrack(p.listing_id, 'State changed between ownership check and release — quarantined (no auto-release)', p.id, piId);
          quarantined++; recordsRemainingPending++; continue;
        }

        // Step 3: Hide/quarantine Listing + LP while PRESERVING tokens
        try {
          await entities.Listing.update(p.listing_id, {
            status: 'hidden',
            hidden_reason: 'checkout_quarantine',
            // PRESERVE reservation_token, reserved_by_email, reservation_expires_at
          });
        } catch (err) {
          await quarantineAndTrack(p.listing_id, `Listing quarantine-lock failed: ${err?.message}`, p.id, piId);
          quarantined++; recordsRemainingPending++; continue;
        }

        try {
          await upsertListingPrivate(deps, p.listing_id, {
            checkout_quarantined: true,
            checkout_quarantine_reason: 'Cleanup quarantine-lock sequence',
            checkout_quarantined_at: new Date(deps.now()).toISOString(),
            checkout_quarantine_pi_id: piId,
            // PRESERVE reservation_token, reserved_by_email, reservation_expires_at
          });
          quarantinedInPhase1.add(p.listing_id);
        } catch (err) {
          // LP quarantine-lock failed — ensure LP is also quarantined via quarantineListing
          quarantinedInPhase1.add(p.listing_id);
          await quarantineAndTrack(p.listing_id, `LP quarantine-lock failed: ${err?.message}`, p.id, piId);
          quarantined++; recordsRemainingPending++; continue;
        }

        // Step 4: Re-fetch and verify tokens are preserved (fault injection point)
        const [listingVerify1] = await entities.Listing.filter({ id: p.listing_id });
        const lpVerify1 = await getListingPrivate(deps, p.listing_id);

        if (!checkTokenStable(listingVerify1, originalToken, 'Listing') || !checkTokenStable(lpVerify1, originalToken, 'LP')) {
          // New token appeared — leave quarantined for manual resolution (7C.6 fix #3)
          await criticalAlert(deps, `NEW TOKEN DETECTED during cleanup for ${p.listing_id}`,
            `Original: ${originalToken}, Listing: ${listingVerify1?.reservation_token}, LP: ${lpVerify1?.reservation_token}. Left quarantined.`, p.listing_id);
          quarantined++; recordsRemainingPending++; continue;
        }

        // Step 5: Expire Purchase
        // Fault injection: re-fetch and check for new token immediately before Purchase.update (7C.6 fix #3)
        const [listingBeforeExpire] = await entities.Listing.filter({ id: p.listing_id });
        const lpBeforeExpire = await getListingPrivate(deps, p.listing_id);
        if (!checkTokenStable(listingBeforeExpire, originalToken, 'Listing') || !checkTokenStable(lpBeforeExpire, originalToken, 'LP')) {
          await criticalAlert(deps, `NEW TOKEN before Purchase expiry for ${p.listing_id}`,
            `Original: ${originalToken}, Listing: ${listingBeforeExpire?.reservation_token}, LP: ${lpBeforeExpire?.reservation_token}. Left quarantined.`, p.listing_id);
          quarantined++; recordsRemainingPending++; continue;
        }

        try {
          await entities.Purchase.update(p.id, { transfer_status: 'expired' });
          expired++;
          staysInResultSet = false; // Purchase is now expired — removed from result set
        } catch (err) {
          // Leave quarantined — Purchase still pending
          await criticalAlert(deps, `PURCHASE EXPIRY FAILED for ${p.id}`,
            `Error: ${err?.message}. Listing left quarantined.`, p.listing_id);
          quarantined++; recordsRemainingPending++; continue;
        }

        // Step 6: While still hidden, clear BOTH public/private reservation fields
        // Fault injection: re-fetch and check for new token immediately before Listing.update (7C.6 fix #3)
        const [listingBeforeClear] = await entities.Listing.filter({ id: p.listing_id });
        const lpBeforeClear = await getListingPrivate(deps, p.listing_id);
        if (!checkTokenStable(listingBeforeClear, originalToken, 'Listing') || !checkTokenStable(lpBeforeClear, originalToken, 'LP')) {
          // New token appeared — don't clear, leave quarantined (7C.6 fix #3)
          await criticalAlert(deps, `NEW TOKEN before clearing reservation for ${p.listing_id}`,
            `Original: ${originalToken}, Listing: ${listingBeforeClear?.reservation_token}, LP: ${lpBeforeClear?.reservation_token}. Left quarantined.`, p.listing_id);
          quarantined++; continue; // staysInResultSet is already false (Purchase expired)
        }

        try {
          await entities.Listing.update(p.listing_id, {
            reservation_token: null, reservation_expires_at: null, reserved_by_email: null,
            // status stays 'hidden', hidden_reason stays 'checkout_quarantine'
          });
        } catch (err) {
          await criticalAlert(deps, `LISTING CLEAR FAILED for ${p.listing_id}`,
            `Error: ${err?.message}. Listing left quarantined.`, p.listing_id);
          quarantined++; continue; // Purchase already expired
        }

        try {
          await upsertListingPrivate(deps, p.listing_id, {
            reservation_token: null, reservation_expires_at: null, reserved_by_email: null,
            // checkout_quarantined stays true for now
          });
        } catch (err) {
          // LP clear failed — Listing is cleared but LP is not — restore Listing reservation + quarantine
          try {
            await entities.Listing.update(p.listing_id, {
              reservation_token: originalToken,
              reservation_expires_at: listingBeforeClear?.reservation_expires_at || null,
              reserved_by_email: originalBuyer,
            });
          } catch (_) { /* best effort */ }
          await criticalAlert(deps, `LP CLEAR FAILED for ${p.listing_id}`,
            `Error: ${err?.message}. Listing reservation restored. Left quarantined.`, p.listing_id);
          quarantined++; continue; // Purchase already expired
        }

        // Step 7: Verify both are cleared
        const [listingCleared] = await entities.Listing.filter({ id: p.listing_id });
        const lpCleared = await getListingPrivate(deps, p.listing_id);

        if (!listingCleared || listingCleared.reservation_token !== null) {
          await quarantineAndTrack(p.listing_id, 'Listing reservation not cleared — quarantined', p.id, piId);
          quarantined++; continue; // Purchase already expired
        }
        if (!lpCleared || lpCleared.reservation_token !== null) {
          // LP not cleared — restore Listing to hidden quarantine
          try {
            await entities.Listing.update(p.listing_id, { status: 'hidden', hidden_reason: 'checkout_quarantine' });
          } catch (_) { /* best effort */ }
          await quarantineAndTrack(p.listing_id, 'LP reservation not cleared — quarantined', p.id, piId);
          quarantined++; continue; // Purchase already expired
        }

        // Step 8: Reactivate Listing → active (ONLY after LP is safely cleared)
        try {
          await entities.Listing.update(p.listing_id, {
            status: 'active', hidden_reason: null,
          });
        } catch (err) {
          await criticalAlert(deps, `LISTING REACTIVATION FAILED for ${p.listing_id}`,
            `Error: ${err?.message}. Listing left quarantined.`, p.listing_id);
          quarantined++; continue; // Purchase already expired
        }

        // Clear LP quarantine fields
        try {
          await upsertListingPrivate(deps, p.listing_id, {
            checkout_quarantined: false, checkout_quarantine_reason: null,
            checkout_quarantined_at: null, checkout_quarantine_pi_id: null,
          });
        } catch (err) {
          // LP quarantine clear failed — restore Listing to hidden quarantine (7C.6 fix #5)
          try {
            await entities.Listing.update(p.listing_id, { status: 'hidden', hidden_reason: 'checkout_quarantine' });
            await upsertListingPrivate(deps, p.listing_id, {
              checkout_quarantined: true,
              checkout_quarantine_reason: 'LP quarantine clear failed — restored',
              checkout_quarantine_pi_id: piId,
            });
          } catch (_) { /* best effort */ }
          await criticalAlert(deps, `LP QUARANTINE CLEAR FAILED for ${p.listing_id}`,
            `Error: ${err?.message}. Listing restored to quarantine. PI ID: ${piId}.`, p.listing_id);
          quarantined++; continue; // Purchase already expired
        }

        // Step 9: Verify final state
        const [finalListing] = await entities.Listing.filter({ id: p.listing_id });
        const finalLP = await getListingPrivate(deps, p.listing_id);

        if (!finalListing || finalListing.status !== 'active' || finalListing.reservation_token !== null || finalListing.hidden_reason !== null) {
          // Restore quarantine (7C.6 fix #5)
          try {
            await entities.Listing.update(p.listing_id, { status: 'hidden', hidden_reason: 'checkout_quarantine' });
            await upsertListingPrivate(deps, p.listing_id, {
              checkout_quarantined: true,
              checkout_quarantine_reason: 'Final verification failed — restored',
              checkout_quarantine_pi_id: piId,
            });
          } catch (_) { /* best effort */ }
          await criticalAlert(deps, `FINAL VERIFICATION FAILED for ${p.listing_id}`,
            `Listing not active/cleared. Restored to quarantine. PI ID: ${piId}.`, p.listing_id);
          quarantined++; continue; // Purchase already expired
        }
        if (!finalLP || finalLP.reservation_token !== null || finalLP.checkout_quarantined !== false) {
          // Restore quarantine (7C.6 fix #5)
          try {
            await entities.Listing.update(p.listing_id, { status: 'hidden', hidden_reason: 'checkout_quarantine' });
            await upsertListingPrivate(deps, p.listing_id, {
              checkout_quarantined: true,
              checkout_quarantine_reason: 'Final verification failed (LP) — restored',
              checkout_quarantine_pi_id: piId,
            });
          } catch (_) { /* best effort */ }
          await criticalAlert(deps, `FINAL VERIFICATION FAILED (LP) for ${p.listing_id}`,
            `LP still has reservation or quarantine. Restored to quarantine. PI ID: ${piId}.`, p.listing_id);
          quarantined++; continue; // Purchase already expired
        }

        released++;
        // staysInResultSet is already false (Purchase expired)
      } catch (err) {
        console.error('[cleanupAbandonedCheckouts] error processing', p.id, err?.message);
        errors++;
      }

      if (staysInResultSet) recordsRemainingPending++;
    }

    // Advance skip by records that remain in the result set (7C.6 fix #7)
    skip += recordsRemainingPending;

    if (page.length < PAGE_SIZE) hasMore = false;
  }

  // ── Phase 2: Process quarantined listings (quarantine recovery) ──
  let quarantinedListings = [];
  try {
    quarantinedListings = await entities.ListingPrivate.filter({ checkout_quarantined: true }, 'id', 200);
  } catch (err) { /* non-fatal */ }

  let quarantineResolved = 0;
  let quarantineRestoreFailed = 0;

  for (const lp of quarantinedListings) {
    // Skip listings quarantined during Phase 1 of this same run (7C.6 fix #3)
    // These may have new tokens or state changes that require manual resolution
    if (quarantinedInPhase1.has(lp.listing_id)) continue;
    try {
      const piId = lp.checkout_quarantine_pi_id;
      if (!piId) continue;

      // Re-fetch ALL entities before every write
      const [listingFresh] = await entities.Listing.filter({ id: lp.listing_id });
      const lpFresh = await getListingPrivate(deps, lp.listing_id);

      // Require Listing.status=hidden and hidden_reason=checkout_quarantine
      if (!listingFresh || listingFresh.status !== 'hidden' || listingFresh.hidden_reason !== 'checkout_quarantine') {
        continue;
      }
      if (!lpFresh || !lpFresh.checkout_quarantined) {
        continue;
      }

      // Never reactivate a seller-cancelled or otherwise changed listing
      if (listingFresh.status === 'cancelled') continue;

      // Retrieve PI
      let pi;
      try {
        pi = await stripe.paymentIntents.retrieve(piId);
      } catch (err) {
        continue;
      }

      // Check no pending purchases
      const pendingPurchases = await entities.Purchase.filter({
        listing_id: lp.listing_id, transfer_status: 'pending_transfer',
      });

      // Verify all recovery conditions
      if (!canRecoverQuarantine(listingFresh, lpFresh, pi, pendingPurchases)) {
        continue;
      }

      // Write Listing → active
      try {
        await entities.Listing.update(lp.listing_id, {
          status: 'active', reservation_token: null, reservation_expires_at: null,
          reserved_by_email: null, hidden_reason: null,
        });
      } catch (err) {
        // Restore hidden quarantine + critical alert (7C.6 fix #5)
        try {
          await entities.Listing.update(lp.listing_id, { status: 'hidden', hidden_reason: 'checkout_quarantine' });
          await upsertListingPrivate(deps, lp.listing_id, {
            checkout_quarantined: true,
            checkout_quarantine_reason: 'Recovery Listing write failed — restored',
            checkout_quarantine_pi_id: piId,
          });
        } catch (_) { /* best effort */ }
        await criticalAlert(deps, `QUARANTINE RECOVERY LISTING WRITE FAILED for ${lp.listing_id}`,
          `Error: ${err?.message}. Listing restored to quarantine. PI ID: ${piId}.`, lp.listing_id);
        quarantineRestoreFailed++;
        continue;
      }

      // Write LP → clear quarantine
      try {
        await upsertListingPrivate(deps, lp.listing_id, {
          reservation_token: null, reservation_expires_at: null, reserved_by_email: null,
          checkout_quarantined: false, checkout_quarantine_reason: null,
          checkout_quarantined_at: null, checkout_quarantine_pi_id: null,
        });
      } catch (err) {
        // LP write failed — restore hidden quarantine + critical alert (7C.6 fix #5)
        try {
          await entities.Listing.update(lp.listing_id, { status: 'hidden', hidden_reason: 'checkout_quarantine' });
          await upsertListingPrivate(deps, lp.listing_id, {
            checkout_quarantined: true,
            checkout_quarantine_reason: 'Recovery LP write failed — restored',
            checkout_quarantine_pi_id: piId,
          });
        } catch (_) { /* best effort */ }
        await criticalAlert(deps, `QUARANTINE RECOVERY LP WRITE FAILED for ${lp.listing_id}`,
          `Error: ${err?.message}. Listing restored to quarantine. PI ID: ${piId}.`, lp.listing_id);
        quarantineRestoreFailed++;
        continue;
      }

      // Post-write verification: both Listing AND ListingPrivate
      const [verifyListing] = await entities.Listing.filter({ id: lp.listing_id });
      const verifyLP = await getListingPrivate(deps, lp.listing_id);

      if (!verifyListing || verifyListing.status !== 'active' || verifyListing.reservation_token !== null) {
        // Restore hidden quarantine (7C.6 fix #5)
        try {
          await entities.Listing.update(lp.listing_id, { status: 'hidden', hidden_reason: 'checkout_quarantine' });
          await upsertListingPrivate(deps, lp.listing_id, {
            checkout_quarantined: true,
            checkout_quarantine_reason: 'Recovery verification failed (Listing) — restored',
            checkout_quarantine_pi_id: piId,
          });
        } catch (_) { /* best effort */ }
        await criticalAlert(deps, `QUARANTINE RECOVERY VERIFICATION FAILED for ${lp.listing_id}`,
          `Listing is not active after recovery. Restored to quarantine. PI ID: ${piId}.`, lp.listing_id);
        quarantineRestoreFailed++;
        continue;
      }
      if (!verifyLP || verifyLP.reservation_token !== null || verifyLP.checkout_quarantined) {
        // Restore hidden quarantine (7C.6 fix #5)
        try {
          await entities.Listing.update(lp.listing_id, { status: 'hidden', hidden_reason: 'checkout_quarantine' });
          await upsertListingPrivate(deps, lp.listing_id, {
            checkout_quarantined: true,
            checkout_quarantine_reason: 'Recovery verification failed (LP) — restored',
            checkout_quarantine_pi_id: piId,
          });
        } catch (_) { /* best effort */ }
        await criticalAlert(deps, `QUARANTINE RECOVERY LP VERIFICATION FAILED for ${lp.listing_id}`,
          `LP is still reserved or quarantined after recovery. Restored to quarantine. PI ID: ${piId}.`, lp.listing_id);
        quarantineRestoreFailed++;
        continue;
      }

      quarantineResolved++;
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