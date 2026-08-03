/**
 * cleanupOrchestrator.js — Dependency-injected cleanup orchestration.
 *
 * This is the ACTUAL production cleanup workflow. Tests invoke this module
 * directly with mock deps — they do NOT simulate the workflow separately.
 *
 * Key fixes (7C.5):
 *   1. Re-fetch ALL entities (Listing, LP, Purchase, PP, PI) before every write.
 *      Never clear using previously fetched state.
 *   2. If state changes at any point, leave hidden/quarantined. Do not auto-release.
 *   3. Quarantine recovery: re-fetch before writes, never reactivate seller-cancelled,
 *      restore hidden quarantine if write/verification fails.
 *   4. Oldest-first pagination with processedIds tracking.
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

export async function runCleanupAbandonedCheckouts(deps) {
  const { entities, stripe, now, isMaintenanceActive } = deps;

  if (isMaintenanceActive()) {
    return { status: 200, body: { ok: true, skipped: 'maintenance mode' } };
  }

  const currentTime = now();
  let expired = 0, released = 0, quarantined = 0, skippedRecent = 0, skippedAuthorized = 0, errors = 0;
  let totalProcessed = 0;

  // ── Phase 1: Process abandoned purchases (oldest-first, paginated) ──
  const processedIds = new Set();
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
      }, 'created_date', PAGE_SIZE); // oldest first
    } catch (err) {
      return { status: 500, body: { error: 'Failed to fetch pending purchases' } };
    }

    const unprocessed = page.filter(p => !processedIds.has(p.id));
    if (unprocessed.length === 0) { hasMore = false; break; }

    for (const p of unprocessed) {
      processedIds.add(p.id);
      totalProcessed++;

      try {
        const created = p.created_date ? new Date(p.created_date).getTime() : 0;
        if (currentTime - created < ABANDONED_MS) { skippedRecent++; continue; }

        // PurchasePrivate is mandatory
        const pp = await getPurchasePrivate(deps, p.id);
        if (!pp) {
          await quarantineListing(deps, p.listing_id, `PurchasePrivate missing for purchase ${p.id}`, p.id, p.payment_intent_id);
          quarantined++; continue;
        }

        // Require Purchase ↔ PurchasePrivate listing_id match
        if (p.listing_id !== pp.listing_id) {
          await quarantineListing(deps, p.listing_id, `Listing ID mismatch: Purchase=${p.listing_id}, PP=${pp.listing_id}`, p.id, p.payment_intent_id);
          quarantined++; continue;
        }

        const piId = pp.payment_intent_id;
        if (!piId) {
          await quarantineListing(deps, p.listing_id, `No payment_intent_id for purchase ${p.id}`, p.id, null);
          quarantined++; continue;
        }

        // Retrieve PI — failure → quarantine (fail-closed)
        let pi;
        let piStatus = null;
        try {
          pi = await stripe.paymentIntents.retrieve(piId);
          piStatus = pi.status;
        } catch (err) {
          await quarantineListing(deps, p.listing_id, `PI retrieval failed for ${piId}: ${err?.message}`, p.id, piId);
          quarantined++; continue;
        }

        // Re-fetch Listing + LP for ownership check (never use cached state)
        const [listing] = await entities.Listing.filter({ id: p.listing_id });
        const lp = await getListingPrivate(deps, p.listing_id);

        // Verify cleanup ownership: Purchase ↔ PP ↔ Listing ↔ LP ↔ PI
        const ownershipValid = verifyCleanupOwnership(p, pp, listing, lp, pi);

        // Classify cleanup outcome
        const ownsByBuyer = !!(listing && listing.reserved_by_email === pp.buyer_email);
        const ownsByToken = !!(pp.reservation_token && lp && lp.reservation_token === pp.reservation_token);
        const outcome = classifyCleanupOutcome(piStatus, ownsByBuyer, ownsByToken);

        if (outcome === 'keep_locked') { skippedAuthorized++; continue; }

        if (outcome === 'quarantine' || !ownershipValid) {
          await quarantineListing(deps, p.listing_id, `Cleanup quarantine: PI status=${piStatus}, ownership_valid=${ownershipValid}, buyer_match=${ownsByBuyer}, token_match=${ownsByToken}`, p.id, piId);
          quarantined++; continue;
        }

        // outcome === 'release' — cancel PI first (if not already canceled)
        if (piStatus === 'requires_payment_method' || piStatus === 'requires_action') {
          try {
            const canceled = await stripe.paymentIntents.cancel(piId);
            if (canceled.status !== 'canceled') {
              await quarantineListing(deps, p.listing_id, `PI cancel returned ${canceled.status}`, p.id, piId);
              quarantined++; continue;
            }
            piStatus = 'canceled';
          } catch (err) {
            try {
              const retrieved = await stripe.paymentIntents.retrieve(piId);
              if (retrieved.status !== 'canceled') {
                await quarantineListing(deps, p.listing_id, `PI cancel failed: ${err?.message}, status=${retrieved.status}`, p.id, piId);
                quarantined++; continue;
              }
              piStatus = 'canceled';
            } catch (__) {
              await quarantineListing(deps, p.listing_id, `PI cancel+retrieve failed: ${err?.message}`, p.id, piId);
              quarantined++; continue;
            }
          }
        }

        // ── Re-fetch ALL entities before writes (never use previously fetched state) ──
        const [listingFresh2] = await entities.Listing.filter({ id: p.listing_id });
        const lpFresh2 = await getListingPrivate(deps, p.listing_id);
        const [purchaseFresh] = await entities.Purchase.filter({ id: p.id });
        const ppFresh = await getPurchasePrivate(deps, p.id);

        // Re-verify ownership with fresh data — if state changed, quarantine (don't release)
        if (!verifyCleanupOwnership(purchaseFresh, ppFresh, listingFresh2, lpFresh2, pi)) {
          await quarantineListing(deps, p.listing_id, 'State changed between ownership check and release — quarantined (no auto-release)', p.id, piId);
          quarantined++; continue;
        }

        // Expire Purchase
        try {
          await entities.Purchase.update(p.id, { transfer_status: 'expired' });
        } catch (err) {
          await quarantineListing(deps, p.listing_id, `Purchase expiry failed: ${err?.message}`, p.id, piId);
          quarantined++; continue;
        }

        // Release listing (BOTH buyer AND token already verified by verifyCleanupOwnership)
        if (listingFresh2 && listingFresh2.status === 'pending_transfer') {
          try {
            await entities.Listing.update(listingFresh2.id, {
              status: 'active', reservation_token: null, reservation_expires_at: null,
              reserved_by_email: null, hidden_reason: null,
            });
          } catch (err) {
            await quarantineListing(deps, listingFresh2.id, `Listing release failed: ${err?.message}`, p.id, piId);
            quarantined++; continue;
          }

          try {
            await upsertListingPrivate(deps, listingFresh2.id, {
              reservation_token: null, reservation_expires_at: null, reserved_by_email: null,
              checkout_quarantined: false, checkout_quarantine_reason: null,
              checkout_quarantined_at: null, checkout_quarantine_pi_id: null,
            });
          } catch (err) {
            // LP release failed — restore hidden quarantine + critical alert
            try {
              await entities.Listing.update(listingFresh2.id, { status: 'hidden', hidden_reason: 'checkout_quarantine' });
            } catch (_) { /* best effort */ }
            await quarantineListing(deps, listingFresh2.id, `LP release failed: ${err?.message} — restored to quarantine`, p.id, piId);
            quarantined++; continue;
          }

          // Post-write verification: Purchase, Listing, AND ListingPrivate
          const [verifyListing] = await entities.Listing.filter({ id: listingFresh2.id });
          const verifyLP = await getListingPrivate(deps, listingFresh2.id);
          const [verifyPurchase] = await entities.Purchase.filter({ id: p.id });

          if (!verifyPurchase || verifyPurchase.transfer_status !== 'expired') {
            await quarantineListing(deps, listingFresh2.id, 'Post-write verification failed (Purchase not expired)', p.id, piId);
            quarantined++; continue;
          }
          if (!verifyListing || verifyListing.status !== 'active' || verifyListing.reservation_token !== null) {
            await quarantineListing(deps, listingFresh2.id, 'Post-write verification failed (Listing)', p.id, piId);
            quarantined++; continue;
          }
          if (!verifyLP || verifyLP.reservation_token !== null || verifyLP.checkout_quarantined) {
            // LP still reserved or quarantined — restore hidden quarantine
            try {
              await entities.Listing.update(listingFresh2.id, { status: 'hidden', hidden_reason: 'checkout_quarantine' });
            } catch (_) { /* best effort */ }
            await quarantineListing(deps, listingFresh2.id, 'Post-write verification failed (LP still reserved/quarantined) — restored', p.id, piId);
            quarantined++; continue;
          }

          released++;
        }
        expired++;
      } catch (err) {
        console.error('[cleanupAbandonedCheckouts] error processing', p.id, err?.message);
        errors++;
      }
    }

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
    try {
      const piId = lp.checkout_quarantine_pi_id;
      if (!piId) continue;

      // Re-fetch ALL entities before every write
      const [listingFresh] = await entities.Listing.filter({ id: lp.listing_id });
      const lpFresh = await getListingPrivate(deps, lp.listing_id);

      // Require Listing.status=hidden and hidden_reason=checkout_quarantine
      if (!listingFresh || listingFresh.status !== 'hidden' || listingFresh.hidden_reason !== 'checkout_quarantine') {
        continue; // Not in quarantine state — skip
      }
      if (!lpFresh || !lpFresh.checkout_quarantined) {
        continue; // LP not quarantined — skip
      }

      // Never reactivate a seller-cancelled or otherwise changed listing
      if (listingFresh.status === 'cancelled') continue;

      // Retrieve PI
      let pi;
      try {
        pi = await stripe.paymentIntents.retrieve(piId);
      } catch (err) {
        continue; // Can't verify — leave quarantined
      }

      // Check no pending purchases
      const pendingPurchases = await entities.Purchase.filter({
        listing_id: lp.listing_id, transfer_status: 'pending_transfer',
      });

      // Verify all recovery conditions
      if (!canRecoverQuarantine(listingFresh, lpFresh, pi, pendingPurchases)) {
        continue; // Conditions not met — leave quarantined
      }

      // Write Listing → active
      try {
        await entities.Listing.update(lp.listing_id, {
          status: 'active', reservation_token: null, reservation_expires_at: null,
          reserved_by_email: null, hidden_reason: null,
        });
      } catch (err) {
        // Restore hidden quarantine + critical alert
        try {
          await entities.Listing.update(lp.listing_id, { status: 'hidden', hidden_reason: 'checkout_quarantine' });
        } catch (_) { /* best effort */ }
        try {
          await deps.entities.AdminAlert.create({
            alert_type: 'admin_action_required', priority: 'critical',
            title: `QUARANTINE RECOVERY LISTING WRITE FAILED for ${lp.listing_id}`,
            description: `Error: ${err?.message}. Listing restored to quarantine.`,
            reference_type: 'listing', reference_id: lp.listing_id,
          });
        } catch (_) { /* best effort */ }
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
        // LP write failed — restore hidden quarantine + critical alert
        try {
          await entities.Listing.update(lp.listing_id, { status: 'hidden', hidden_reason: 'checkout_quarantine' });
        } catch (_) { /* best effort */ }
        try {
          await deps.entities.AdminAlert.create({
            alert_type: 'admin_action_required', priority: 'critical',
            title: `QUARANTINE RECOVERY LP WRITE FAILED for ${lp.listing_id}`,
            description: `Error: ${err?.message}. Listing restored to quarantine. LP may still be in inconsistent state.`,
            reference_type: 'listing', reference_id: lp.listing_id,
          });
        } catch (_) { /* best effort */ }
        quarantineRestoreFailed++;
        continue;
      }

      // Post-write verification: both Listing AND ListingPrivate
      const [verifyListing] = await entities.Listing.filter({ id: lp.listing_id });
      const verifyLP = await getListingPrivate(deps, lp.listing_id);

      if (!verifyListing || verifyListing.status !== 'active' || verifyListing.reservation_token !== null) {
        // Listing not active — restore hidden quarantine + critical alert
        try {
          await entities.Listing.update(lp.listing_id, { status: 'hidden', hidden_reason: 'checkout_quarantine' });
        } catch (_) { /* best effort */ }
        try {
          await deps.entities.AdminAlert.create({
            alert_type: 'admin_action_required', priority: 'critical',
            title: `QUARANTINE RECOVERY VERIFICATION FAILED for ${lp.listing_id}`,
            description: 'Listing is not active after recovery write. Restored to quarantine.',
            reference_type: 'listing', reference_id: lp.listing_id,
          });
        } catch (_) { /* best effort */ }
        quarantineRestoreFailed++;
        continue;
      }
      if (!verifyLP || verifyLP.reservation_token !== null || verifyLP.checkout_quarantined) {
        // LP still reserved or quarantined — restore hidden quarantine + critical alert
        try {
          await entities.Listing.update(lp.listing_id, { status: 'hidden', hidden_reason: 'checkout_quarantine' });
        } catch (_) { /* best effort */ }
        try {
          await deps.entities.AdminAlert.create({
            alert_type: 'admin_action_required', priority: 'critical',
            title: `QUARANTINE RECOVERY LP VERIFICATION FAILED for ${lp.listing_id}`,
            description: 'LP is still reserved or quarantined after recovery. Listing restored to quarantine.',
            reference_type: 'listing', reference_id: lp.listing_id,
          });
        } catch (_) { /* best effort */ }
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
    },
  };
}