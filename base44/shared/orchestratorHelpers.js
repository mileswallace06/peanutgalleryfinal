/**
 * orchestratorHelpers.js — Entity-access helpers with dependency injection.
 *
 * deps = {
 *   entities: { Listing, ListingPrivate, Purchase, PurchasePrivate,
 *               User, UserSecurityProfile, AdminAlert, SeatInventory },
 *   stripe: StripeClient,
 *   now: () => number,
 * }
 *
 * No Deno/Node-specific imports — pure ESM JavaScript.
 */
import { verifyReservation, isQuarantined, QUARANTINE_DRAIN_MS } from './checkoutLogic.js';

// ── ListingPrivate ─────────────────────────────────────────────────────────
export async function getListingPrivate(deps, listing_id) {
  if (!listing_id) return null;
  const rows = await deps.entities.ListingPrivate.filter({ listing_id });
  return rows[0] || null;
}

export async function upsertListingPrivate(deps, listing_id, fields) {
  if (!listing_id) return null;
  const existing = await getListingPrivate(deps, listing_id);
  if (existing) {
    return deps.entities.ListingPrivate.update(existing.id, fields);
  }
  return deps.entities.ListingPrivate.create({ listing_id, ...fields });
}

export async function ensureListingPrivate(deps, listing_id, fields) {
  const existing = await getListingPrivate(deps, listing_id);
  if (existing) return existing;
  return deps.entities.ListingPrivate.create({ listing_id, ...fields });
}

// ── PurchasePrivate ─────────────────────────────────────────────────────────
export async function getPurchasePrivate(deps, purchase_id) {
  if (!purchase_id) return null;
  const rows = await deps.entities.PurchasePrivate.filter({ purchase_id });
  return rows[0] || null;
}

export async function upsertPurchasePrivate(deps, purchase_id, fields) {
  if (!purchase_id) return null;
  const existing = await getPurchasePrivate(deps, purchase_id);
  if (existing) {
    return deps.entities.PurchasePrivate.update(existing.id, fields);
  }
  return deps.entities.PurchasePrivate.create({ purchase_id, ...fields });
}

// ── UserSecurityProfile ────────────────────────────────────────────────────
export async function getUserSecurityProfile(deps, { user_id, user_email } = {}) {
  if (user_id) {
    const rows = await deps.entities.UserSecurityProfile.filter({ user_id });
    if (rows[0]) return rows[0];
  }
  if (user_email) {
    const rows = await deps.entities.UserSecurityProfile.filter({ user_email });
    if (rows[0]) return rows[0];
  }
  return null;
}

export async function upsertUserSecurityProfile(deps, { user_id, user_email }, fields) {
  const existing = await getUserSecurityProfile(deps, { user_id, user_email });
  if (existing) {
    return deps.entities.UserSecurityProfile.update(existing.id, fields);
  }
  if (!user_id || !user_email) return null;
  return deps.entities.UserSecurityProfile.create({ user_id, user_email, ...fields });
}

// ── Alerts ──────────────────────────────────────────────────────────────────
export async function alertPrivateWriteFailure(deps, { entity, reference_id, reference_type, error }) {
  try {
    await deps.entities.AdminAlert.create({
      alert_type: 'admin_action_required',
      priority: 'high',
      title: `Private write failure: ${entity}`,
      description: `Failed to write ${entity} for ${reference_type} ${reference_id}: ${error?.message || String(error)}`,
      reference_type,
      reference_id,
    });
  } catch (_) { /* alert failure must never throw */ }
}

// Helper: critical alert with PI ID (never throws)
async function criticalAlertForQuarantine(deps, listing_id, title, description, piId) {
  try {
    await deps.entities.AdminAlert.create({
      alert_type: 'admin_action_required',
      priority: 'critical',
      title,
      description: `${description} PI ID: ${piId || 'N/A'}.`,
      reference_type: 'listing',
      reference_id: listing_id,
    });
  } catch (_) { /* alert failure must never throw */ }
}

// ── Quarantine listing (writes to BOTH Listing and ListingPrivate, verifies) ──
// 7C.8: IMMUTABLE QUARANTINE SNAPSHOT — original snapshot AND generation are
// never mutated by repeated quarantines. Divergence blocks recovery and
// preserves the original identity (generation is NOT incremented). Same-state
// repeated quarantine is an idempotent no-op that does not replace pi_id,
// purchase_id, generation, recovery_not_before, or any snapshot field.
// All protection writes are awaited and verified. If either fails, returns
// quarantined:false — never returns quarantined:true based on best-effort writes.
export async function quarantineListing(deps, listing_id, reason, purchase_id, pi_id) {
  const quarantineAt = new Date(deps.now()).toISOString();
  const drainUntil = new Date(deps.now() + QUARANTINE_DRAIN_MS).toISOString();

  // Capture state BEFORE quarantining
  const [listingBefore] = await deps.entities.Listing.filter({ id: listing_id });
  const lpBefore = await getListingPrivate(deps, listing_id);
  const currentGeneration = lpBefore?.quarantine_generation || 0;

  const alreadyQuarantined = lpBefore?.checkout_quarantined === true;

  if (alreadyQuarantined) {
    // Check for state divergence between current reservation fields and original snapshot
    const snapToken = lpBefore?.quarantined_reservation_token ?? null;
    const snapBuyer = lpBefore?.quarantined_buyer ?? null;
    const snapExpiry = lpBefore?.quarantined_expiration ?? null;
    const currentToken = lpBefore?.reservation_token ?? listingBefore?.reservation_token ?? null;
    const currentBuyer = lpBefore?.reserved_by_email ?? listingBefore?.reserved_by_email ?? null;
    const currentExpiry = lpBefore?.reservation_expires_at ?? listingBefore?.reservation_expires_at ?? null;

    const hasDivergence = currentToken !== snapToken || currentBuyer !== snapBuyer || currentExpiry !== snapExpiry;

    if (hasDivergence) {
      // DIVERGENCE: Current state differs from original snapshot.
      // Block recovery, alert, preserve ORIGINAL snapshot AND generation.
      // Do NOT increment generation. Do NOT overwrite snapshot fields.

      // Step 1: Write recovery_blocked and VERIFY
      try {
        await upsertListingPrivate(deps, listing_id, {
          recovery_blocked: true,
          recovery_blocked_reason: `Repeated quarantine detected state divergence. Snap token=${snapToken}, current=${currentToken}. Manual resolution required. PI ID: ${pi_id || 'N/A'}.`,
          recovery_blocked_at: quarantineAt,
        });
      } catch (err) {
        await criticalAlertForQuarantine(deps, listing_id, `RECOVERY_BLOCKED WRITE FAILED for ${listing_id}`, `Error: ${err?.message}. ${reason}.`, pi_id);
        return { quarantined: false, error: err };
      }
      const lpVerifyBlock = await getListingPrivate(deps, listing_id);
      if (!lpVerifyBlock || lpVerifyBlock.recovery_blocked !== true) {
        await criticalAlertForQuarantine(deps, listing_id, `RECOVERY_BLOCKED VERIFICATION FAILED for ${listing_id}`, `recovery_blocked not set after write. ${reason}.`, pi_id);
        return { quarantined: false, error: new Error('recovery_blocked verification failed') };
      }

      // Step 2: Ensure Listing is hidden + quarantine and VERIFY
      try {
        await deps.entities.Listing.update(listing_id, { status: 'hidden', hidden_reason: 'checkout_quarantine' });
      } catch (err) {
        await criticalAlertForQuarantine(deps, listing_id, `QUARANTINE LISTING WRITE FAILED for ${listing_id}`, `Error: ${err?.message}. ${reason}.`, pi_id);
        return { quarantined: false, error: err };
      }
      const [verifyListingDiv] = await deps.entities.Listing.filter({ id: listing_id });
      if (!verifyListingDiv || verifyListingDiv.status !== 'hidden' || verifyListingDiv.hidden_reason !== 'checkout_quarantine') {
        await criticalAlertForQuarantine(deps, listing_id, `QUARANTINE LISTING VERIFICATION FAILED for ${listing_id}`, `Status: ${verifyListingDiv?.status}, reason: ${verifyListingDiv?.hidden_reason}. ${reason}.`, pi_id);
        return { quarantined: false, error: new Error('Listing hidden verification failed') };
      }

      // Original snapshot AND generation preserved (NOT incremented)
      return { quarantined: true, recovery_blocked: true };
    }

    // SAME-STATE: Repeated quarantine with matching state.
    // Idempotent no-op — do NOT replace checkout_quarantine_pi_id,
    // quarantined_purchase_id, quarantine_generation, recovery_not_before,
    // or any snapshot field. Only ensure Listing is hidden + quarantine.
    const [listingCheck] = await deps.entities.Listing.filter({ id: listing_id });
    if (!listingCheck || listingCheck.status !== 'hidden' || listingCheck.hidden_reason !== 'checkout_quarantine') {
      try {
        await deps.entities.Listing.update(listing_id, { status: 'hidden', hidden_reason: 'checkout_quarantine' });
      } catch (err) {
        await criticalAlertForQuarantine(deps, listing_id, `QUARANTINE LISTING WRITE FAILED for ${listing_id}`, `Error: ${err?.message}. ${reason}.`, pi_id);
        return { quarantined: false, error: err };
      }
      const [verifyListingSame] = await deps.entities.Listing.filter({ id: listing_id });
      if (!verifyListingSame || verifyListingSame.status !== 'hidden' || verifyListingSame.hidden_reason !== 'checkout_quarantine') {
        await criticalAlertForQuarantine(deps, listing_id, `QUARANTINE LISTING VERIFICATION FAILED for ${listing_id}`, `${reason}.`, pi_id);
        return { quarantined: false, error: new Error('Listing hidden verification failed') };
      }
    }
    // Do NOT write any identity fields to LP — idempotent no-op
    return { quarantined: true };
  }

  // First-time quarantine — capture snapshot from current state
  const snapshot = {
    quarantined_reservation_token: lpBefore?.reservation_token ?? listingBefore?.reservation_token ?? null,
    quarantined_buyer: lpBefore?.reserved_by_email ?? listingBefore?.reserved_by_email ?? null,
    quarantined_expiration: lpBefore?.reservation_expires_at ?? listingBefore?.reservation_expires_at ?? null,
    quarantined_purchase_id: purchase_id || null,
    quarantine_generation: currentGeneration + 1,
    recovery_not_before: drainUntil,
  };

  try {
    await deps.entities.Listing.update(listing_id, {
      status: 'hidden',
      hidden_reason: 'checkout_quarantine',
    });
  } catch (err) {
    await criticalAlertForQuarantine(deps, listing_id, `QUARANTINE LISTING WRITE FAILED for ${listing_id}`, `${reason}. Error: ${err?.message}. Purchase: ${purchase_id || 'N/A'}.`, pi_id);
    return { quarantined: false, error: err };
  }

  try {
    await upsertListingPrivate(deps, listing_id, {
      checkout_quarantined: true,
      checkout_quarantine_reason: reason,
      checkout_quarantined_at: quarantineAt,
      checkout_quarantine_pi_id: pi_id || null,
      ...snapshot,
    });
  } catch (err) {
    await criticalAlertForQuarantine(deps, listing_id, `QUARANTINE LP WRITE FAILED for ${listing_id}`, `${reason}. Error: ${err?.message}. Purchase: ${purchase_id || 'N/A'}. PI ID: ${pi_id || 'N/A'}.`, pi_id);
    return { quarantined: false, error: err };
  }

  // Post-write verification
  const [verifyListing] = await deps.entities.Listing.filter({ id: listing_id });
  const verifyLP = await getListingPrivate(deps, listing_id);

  if (!verifyListing || verifyListing.status !== 'hidden' || verifyListing.hidden_reason !== 'checkout_quarantine') {
    await criticalAlertForQuarantine(deps, listing_id, `QUARANTINE LISTING VERIFICATION FAILED for ${listing_id}`, `Status: ${verifyListing?.status}, reason: ${verifyListing?.hidden_reason}.`, pi_id);
    return { quarantined: false, error: new Error('Listing post-write verification failed') };
  }

  if (!verifyLP || !verifyLP.checkout_quarantined) {
    await criticalAlertForQuarantine(deps, listing_id, `QUARANTINE LP VERIFICATION FAILED for ${listing_id}`, `Post-write verification failed. checkout_quarantined not set.`, pi_id);
    return { quarantined: false, error: new Error('ListingPrivate post-write verification failed') };
  }

  return { quarantined: true };
}

// ── Cancel PI and quarantine — compensation for checkout failures ──────────
// Cancels the PI, verifies canceled, expires Purchase (if provided), quarantines listing.
// If cancel fails, persists an AdminAlert with the PI ID (recoverable record).
export async function cancelPIAndQuarantine(deps, paymentIntentId, listing_id, purchase_id, reason) {
  let piCanceled = false;
  let piStatus = null;

  // Step 1: Cancel PI and verify
  try {
    const canceled = await deps.stripe.paymentIntents.cancel(paymentIntentId);
    piStatus = canceled.status;
    piCanceled = canceled.status === 'canceled';
  } catch (_) {
    try {
      const retrieved = await deps.stripe.paymentIntents.retrieve(paymentIntentId);
      piStatus = retrieved.status;
      piCanceled = retrieved.status === 'canceled';
    } catch (__) {
      piStatus = 'unknown';
    }
  }

  if (!piCanceled) {
    // Persist recoverable record with PI ID
    try {
      await deps.entities.AdminAlert.create({
        alert_type: 'admin_action_required',
        priority: 'critical',
        title: `ORPHAN PI: ${paymentIntentId} — cancellation uncertain`,
        description: `${reason}. PI status: ${piStatus}. Listing: ${listing_id}. Purchase: ${purchase_id || 'N/A'}. Manual cancellation required.`,
        reference_type: 'listing',
        reference_id: listing_id,
      });
    } catch (alertErr) {
      console.error(`[CRITICAL] Alert creation failed for orphan PI: ${alertErr?.message}`);
    }
    // Still quarantine the listing
    await quarantineListing(deps, listing_id, `PI cancellation uncertain (status: ${piStatus}). ${reason}`, purchase_id, paymentIntentId);
    return { cancelOk: false, allStepsOk: false };
  }

  // Step 2: Expire Purchase (if provided)
  if (purchase_id) {
    try {
      await deps.entities.Purchase.update(purchase_id, { transfer_status: 'expired' });
    } catch (err) {
      await quarantineListing(deps, listing_id, `Purchase ${purchase_id} expiry write failed: ${err?.message}. ${reason}`, purchase_id, paymentIntentId);
      return { cancelOk: true, allStepsOk: false };
    }
  }

  // Step 3: Quarantine listing
  const qResult = await quarantineListing(deps, listing_id, `Checkout compensation: ${reason}`, purchase_id, paymentIntentId);
  if (!qResult.quarantined) {
    return { cancelOk: true, allStepsOk: false };
  }

  return { cancelOk: true, allStepsOk: true };
}

// ── Revision generation ───────────────────────────────────────────────────
// Shared monotonic revision generator. Every legitimate mutation of token,
// buyer, or expiration must call this and write the result to BOTH Listing
// and ListingPrivate. Every clear operation must set reservation_revision to
// null on both records as part of a verified terminal clear.
export function generateRevision() {
  if (typeof globalThis.crypto !== 'undefined' && globalThis.crypto.randomUUID) {
    return globalThis.crypto.randomUUID();
  }
  return `rev_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

// ── Durable block and alert ────────────────────────────────────────────────
// REQUIRED conflict handling: replaces all `.catch(() => {})` and unverified
// best-effort persistence. Captures the exact attempted block timestamp BEFORE
// writing, attempts to set recovery_blocked=true, re-fetches and verifies ALL
// block fields (including exact timestamp), creates a critical AdminAlert, and
// verifies ALL alert fields through re-query (including complete reason in
// description, expected PI ID, listing ID, and purchase ID when available).
// Reports exactly which durable action was proven via structured result fields.
// Never says "blocked" or "alerted" unless the corresponding proof flag is true.
//
// TOLERANCE RULE for recovery_blocked_at:
//   The timestamp is captured BEFORE the write. If the store's update path
//   also sets updated_date via Date.now(), the stored value may differ by
//   a few milliseconds. We accept an exact match OR a match within a
//   5-second tolerance window (documented: the write is non-atomic, so the
//   store may apply its own timestamp). The captured timestamp is always
//   included in the result for audit.
//
// Returns: {
//   block_attempted: boolean,
//   block_proven: boolean,
//   alert_attempted: boolean,
//   alert_proven: boolean,
//   block_error: string | null,
//   alert_error: string | null,
//   blocked: boolean,    // backward-compatible alias for block_proven
//   alerted: boolean,    // backward-compatible alias for alert_proven
//   attempted_block_timestamp: string,  // captured BEFORE write
// }
export async function durableBlockAndAlert(deps, listing_id, reason, piId, title, purchaseId) {
  const result = {
    block_attempted: false,
    block_proven: false,
    alert_attempted: false,
    alert_proven: false,
    block_error: null,
    alert_error: null,
    blocked: false,
    alerted: false,
    attempted_block_timestamp: null,
  };

  const expectedTitle = title || `Finalization conflict — ${listing_id}`;
  // Description must contain the complete reason AND the PI ID AND purchase ID when available
  const expectedDescription = `${reason} PI ID: ${piId || 'N/A'}.${purchaseId ? ` Purchase ID: ${purchaseId}.` : ''}`;

  // 1. Capture the exact attempted block timestamp BEFORE writing
  const attemptedBlockTimestamp = new Date(deps.now()).toISOString();
  result.attempted_block_timestamp = attemptedBlockTimestamp;

  // 2. Attempt to set recovery_blocked=true
  result.block_attempted = true;
  try {
    await upsertListingPrivate(deps, listing_id, {
      recovery_blocked: true,
      recovery_blocked_reason: reason,
      recovery_blocked_at: attemptedBlockTimestamp,
    });
  } catch (err) {
    result.block_error = err?.message || String(err);
  }

  // 3. Re-fetch LP and verify ALL block fields
  if (!result.block_error) {
    try {
      const lpVerify = await getListingPrivate(deps, listing_id);
      if (lpVerify &&
          lpVerify.listing_id === listing_id &&
          lpVerify.recovery_blocked === true &&
          lpVerify.recovery_blocked_reason === reason &&
          lpVerify.recovery_blocked_at) {
        // Timestamp verification: EXACT equality required.
        // The code explicitly writes attemptedBlockTimestamp into recovery_blocked_at,
        // so the stored value must match exactly. updated_date behavior does not
        // justify accepting a different recovery_blocked_at.
        const storedTs = lpVerify.recovery_blocked_at;
        if (storedTs === attemptedBlockTimestamp) {
          result.block_proven = true;
          result.blocked = true;
        } else {
          result.block_error = `block verification failed — timestamp mismatch (stored=${storedTs}, attempted=${attemptedBlockTimestamp})`;
        }
      } else {
        result.block_error = 'block verification failed — fields do not match expected values';
      }
    } catch (err) {
      result.block_error = `re-fetch failed: ${err?.message || String(err)}`;
    }
  }

  // 4. Attempt to create the critical AdminAlert
  result.alert_attempted = true;
  let alertId = null;
  try {
    const alert = await deps.entities.AdminAlert.create({
      alert_type: 'admin_action_required',
      priority: 'critical',
      title: expectedTitle,
      description: expectedDescription,
      reference_type: 'listing',
      reference_id: listing_id,
    });
    alertId = alert?.id;
  } catch (err) {
    result.alert_error = err?.message || String(err);
  }

  // 5. Verify the alert through re-query — check ALL fields
  //    Must verify: exact alert ID, type, priority, title, description containing
  //    the complete expected reason (not just PI ID), expected PI ID, expected
  //    listing ID, expected purchase ID when available, reference type and ID.
  if (alertId) {
    try {
      const alerts = await deps.entities.AdminAlert.filter({ id: alertId });
      if (alerts.length > 0) {
        const a = alerts[0];
        // Check ALL required fields
        const idMatch = a.id === alertId;
        const typeMatch = a.alert_type === 'admin_action_required';
        const priorityMatch = a.priority === 'critical';
        const titleMatch = a.title === expectedTitle;
        const refTypeMatch = a.reference_type === 'listing';
        const refIdMatch = a.reference_id === listing_id;
        // Description must contain the COMPLETE reason (not just PI ID)
        const descHasReason = a.description && a.description.includes(reason);
        // Description must contain the expected PI ID
        const descHasPiId = a.description && a.description.includes(`PI ID: ${piId || 'N/A'}.`);
        // Description must contain purchase ID when available
        const descHasPurchaseId = !purchaseId || (a.description && a.description.includes(`Purchase ID: ${purchaseId}.`));

        if (idMatch && typeMatch && priorityMatch && titleMatch &&
            refTypeMatch && refIdMatch && descHasReason && descHasPiId && descHasPurchaseId) {
          result.alert_proven = true;
          result.alerted = true;
        } else {
          const failures = [];
          if (!idMatch) failures.push('alert ID mismatch');
          if (!typeMatch) failures.push('alert type mismatch');
          if (!priorityMatch) failures.push('priority mismatch');
          if (!titleMatch) failures.push('title mismatch');
          if (!refTypeMatch) failures.push('reference_type mismatch');
          if (!refIdMatch) failures.push('reference_id mismatch');
          if (!descHasReason) failures.push('description missing complete reason');
          if (!descHasPiId) failures.push('description missing PI ID');
          if (!descHasPurchaseId) failures.push('description missing purchase ID');
          result.alert_error = `alert verification failed — ${failures.join(', ')}`;
        }
      } else {
        result.alert_error = 'alert re-query returned 0 records';
      }
    } catch (err) {
      result.alert_error = `alert re-query failed: ${err?.message || String(err)}`;
    }
  }

  return result;
}

// ── Fail-closed helper for legacy revision failures ──────────────────────
// Shared fail-closed helper for ALL unsafe legacy-revision states.
// Preserves the complete current tuple and revision evidence, attempts to
// quarantine BOTH Listing and ListingPrivate, re-fetches and proves whether
// each quarantine write persisted, durably blocks and creates a critical alert,
// and returns structured proof. Never says "quarantined," "blocked," or
// "alerted" unless re-fetch proves it.
//
// Returns: {
//   listing_quarantine_attempted: boolean,
//   listing_quarantine_proven: boolean,
//   lp_quarantine_attempted: boolean,
//   lp_quarantine_proven: boolean,
//   block_proven: boolean,
//   alert_proven: boolean,
//   ok: false,  // always false — this is a failure path
//   error: string,
//   state: string,
// }
export async function failClosedLegacyRevision(deps, listing_id, reason, piId, purchaseId, state) {
  const result = {
    listing_quarantine_attempted: false,
    listing_quarantine_proven: false,
    lp_quarantine_attempted: false,
    lp_quarantine_proven: false,
    block_proven: false,
    alert_proven: false,
    ok: false,
    error: reason,
    state: state || 'fail_closed',
    // Structured error fields (replace all empty catches)
    listing_quarantine_write_error: null,
    lp_quarantine_write_error: null,
    listing_quarantine_refetch_error: null,
    lp_quarantine_refetch_error: null,
    // Pre-quarantine snapshot
    pre_quarantine_listing_tuple: null,
    pre_quarantine_lp_tuple: null,
    // Post-quarantine snapshot
    post_quarantine_listing_tuple: null,
    post_quarantine_lp_tuple: null,
    // Tuple preservation proof
    listing_tuple_preserved: false,
    lp_tuple_preserved: false,
    pre_existing_disagreement_preserved: false,
    // Quarantine timestamp proof
    quarantine_timestamp_proven: false,
  };

  const quarantineAt = new Date(deps.now()).toISOString();

  // ── Snapshot Listing and LP tuples BEFORE quarantine ──────────────────────
  try {
    const [listingBefore] = await deps.entities.Listing.filter({ id: listing_id });
    if (listingBefore) {
      result.pre_quarantine_listing_tuple = {
        token: listingBefore.reservation_token ?? null,
        buyer: listingBefore.reserved_by_email ?? null,
        expiration: listingBefore.reservation_expires_at ?? null,
        revision: listingBefore.reservation_revision ?? null,
        status: listingBefore.status ?? null,
      };
    }
  } catch (err) {
    result.listing_quarantine_refetch_error = `pre-snapshot listing fetch: ${err?.message || String(err)}`;
  }

  try {
    const lpBefore = await getListingPrivate(deps, listing_id);
    if (lpBefore) {
      result.pre_quarantine_lp_tuple = {
        token: lpBefore.reservation_token ?? null,
        buyer: lpBefore.reserved_by_email ?? null,
        expiration: lpBefore.reservation_expires_at ?? null,
        revision: lpBefore.reservation_revision ?? null,
        checkout_quarantined: lpBefore.checkout_quarantined ?? null,
      };
    }
  } catch (err) {
    result.lp_quarantine_refetch_error = `pre-snapshot LP fetch: ${err?.message || String(err)}`;
  }

  // ── 1. Attempt to quarantine Listing ─────────────────────────────────────
  result.listing_quarantine_attempted = true;
  try {
    await deps.entities.Listing.update(listing_id, {
      status: 'hidden',
      hidden_reason: 'checkout_quarantine',
    });
  } catch (err) {
    result.listing_quarantine_write_error = err?.message || String(err);
  }

  // ── 2. Attempt to quarantine ListingPrivate ──────────────────────────────
  result.lp_quarantine_attempted = true;
  try {
    await upsertListingPrivate(deps, listing_id, {
      checkout_quarantined: true,
      checkout_quarantine_reason: reason,
      checkout_quarantined_at: quarantineAt,
    });
  } catch (err) {
    result.lp_quarantine_write_error = err?.message || String(err);
  }

  // ── 3. Re-fetch both records and prove quarantine persisted ───────────────
  try {
    const [verifyListing] = await deps.entities.Listing.filter({ id: listing_id });
    if (verifyListing) {
      result.listing_quarantine_proven = verifyListing.status === 'hidden' &&
        verifyListing.hidden_reason === 'checkout_quarantine';
      result.post_quarantine_listing_tuple = {
        token: verifyListing.reservation_token ?? null,
        buyer: verifyListing.reserved_by_email ?? null,
        expiration: verifyListing.reservation_expires_at ?? null,
        revision: verifyListing.reservation_revision ?? null,
        status: verifyListing.status ?? null,
      };
    }
  } catch (err) {
    result.listing_quarantine_refetch_error = `post-quarantine listing fetch: ${err?.message || String(err)}`;
  }

  try {
    const verifyLP = await getListingPrivate(deps, listing_id);
    if (verifyLP) {
      result.lp_quarantine_proven = verifyLP.checkout_quarantined === true &&
        verifyLP.checkout_quarantine_reason === reason &&
        !!verifyLP.checkout_quarantined_at;
      // Verify quarantine timestamp equals exact attempted timestamp
      result.quarantine_timestamp_proven = verifyLP.checkout_quarantined_at === quarantineAt;
      result.post_quarantine_lp_tuple = {
        token: verifyLP.reservation_token ?? null,
        buyer: verifyLP.reserved_by_email ?? null,
        expiration: verifyLP.reservation_expires_at ?? null,
        revision: verifyLP.reservation_revision ?? null,
        checkout_quarantined: verifyLP.checkout_quarantined ?? null,
      };
    }
  } catch (err) {
    result.lp_quarantine_refetch_error = `post-quarantine LP fetch: ${err?.message || String(err)}`;
  }

  // ── 4. Verify tuples unchanged ───────────────────────────────────────────
  // Only quarantine and recovery fields should have changed.
  // The Listing tuple (token, buyer, expiration, revision) must be unchanged.
  if (result.pre_quarantine_listing_tuple && result.post_quarantine_listing_tuple) {
    const pre = result.pre_quarantine_listing_tuple;
    const post = result.post_quarantine_listing_tuple;
    result.listing_tuple_preserved =
      pre.token === post.token && pre.buyer === post.buyer &&
      pre.expiration === post.expiration && pre.revision === post.revision;
  }

  if (result.pre_quarantine_lp_tuple && result.post_quarantine_lp_tuple) {
    const pre = result.pre_quarantine_lp_tuple;
    const post = result.post_quarantine_lp_tuple;
    result.lp_tuple_preserved =
      pre.token === post.token && pre.buyer === post.buyer &&
      pre.expiration === post.expiration && pre.revision === post.revision;
  }

  // Any pre-existing disagreement between Listing and LP tuples must remain preserved
  if (result.pre_quarantine_listing_tuple && result.pre_quarantine_lp_tuple) {
    const preDisagreed =
      result.pre_quarantine_listing_tuple.token !== result.pre_quarantine_lp_tuple.token ||
      result.pre_quarantine_listing_tuple.buyer !== result.pre_quarantine_lp_tuple.buyer ||
      result.pre_quarantine_listing_tuple.expiration !== result.pre_quarantine_lp_tuple.expiration;
    if (preDisagreed && result.post_quarantine_listing_tuple && result.post_quarantine_lp_tuple) {
      const postDisagreed =
        result.post_quarantine_listing_tuple.token !== result.post_quarantine_lp_tuple.token ||
        result.post_quarantine_listing_tuple.buyer !== result.post_quarantine_lp_tuple.buyer ||
        result.post_quarantine_listing_tuple.expiration !== result.post_quarantine_lp_tuple.expiration;
      result.pre_existing_disagreement_preserved = preDisagreed && postDisagreed;
    } else {
      result.pre_existing_disagreement_preserved = true; // no pre-existing disagreement
    }
  } else {
    result.pre_existing_disagreement_preserved = true; // one record missing — no disagreement to preserve
  }

  // ── 5. Durably block and create a critical alert ─────────────────────────
  const blockResult = await durableBlockAndAlert(deps, listing_id, reason, piId,
    `Legacy revision failure — ${listing_id} (${state})`, purchaseId);
  result.block_proven = blockResult.block_proven;
  result.alert_proven = blockResult.alert_proven;
  result.block_error = blockResult.block_error;
  result.alert_error = blockResult.alert_error;
  result.attempted_block_timestamp = blockResult.attempted_block_timestamp;

  return result;
}

// ── Legacy revision initialization ─────────────────────────────────────────
// Safe compatibility path for reservations created before reservation_revision
// existed. Implements an explicit state table:
//
// L1: both revisions exist and are equal
//     Return success ONLY after proving both complete tuples are non-null,
//     exactly match, and both revisions exactly match.
//
// L2: both revisions are absent
//     Initialize ONLY when both complete tuples are non-null, token matches,
//     buyer matches, expiration matches, and neither record changes between
//     the authoritative read and the revision writes. Generate one unique
//     revision, write the exact same value to both records. After both writes,
//     re-fetch and prove: Listing tuple unchanged, LP tuple unchanged, both
//     tuples exactly match each other, both revisions equal the generated
//     revision, and no unrelated reservation field changed.
//
// L3: exactly one revision exists
//     Do NOT initialize or overwrite either revision. Quarantine where
//     possible, durably block or alert, preserve both tuples, return non-2xx.
//
// L4: both revisions exist but differ
//     Do NOT generate a third revision. Do NOT overwrite either revision.
//     Quarantine where possible, durably block or alert, preserve both tuples
//     and both mismatched revisions, return non-2xx.
//
// PARTIAL WRITE HANDLING:
// If the first revision write succeeds and the second throws, silently fails,
// returns stale data, cannot be re-fetched, or sees a concurrent tuple
// mutation: preserve the current tuple and revision evidence, quarantine
// where possible, durably block or create a durable critical alert, return
// non-2xx. A retry must never generate a second contradictory revision.
//
// Supports an injectable deterministic revision generator via
// deps.generateRevision for testability. The generated value is a unique
// reservation generation identifier, not a monotonically ordered sequence.
//
// Returns: { ok: boolean, revision?: string, error?: string,
//            blocked?: boolean, alerted?: boolean, state?: string }
export async function initializeLegacyRevision(deps, listing_id) {
  const revGen = deps.generateRevision || generateRevision;

  // ── Authoritative read ──────────────────────────────────────────────────
  const [listing] = await deps.entities.Listing.filter({ id: listing_id });
  const lp = await getListingPrivate(deps, listing_id);

  if (!listing || !lp) return { ok: false, error: 'missing records', state: 'missing' };

  const listingRev = listing.reservation_revision || null;
  const lpRev = lp.reservation_revision || null;
  const listingToken = listing.reservation_token || null;
  const lpToken = lp.reservation_token || null;
  const listingBuyer = listing.reserved_by_email || null;
  const lpBuyer = lp.reserved_by_email || null;
  const listingExpiry = listing.reservation_expires_at || null;
  const lpExpiry = lp.reservation_expires_at || null;

  // ── State L1: both revisions exist and are equal ─────────────────────────
  if (listingRev && lpRev && listingRev === lpRev) {
    // Return success ONLY after proving both complete tuples are non-null,
    // exactly match, and both revisions exactly match.
    if (!listingToken || !listingBuyer || !listingExpiry) {
      const r = await failClosedLegacyRevision(deps, listing_id,
        `Legacy revision L1: Listing tuple is null or partially null (token=${listingToken}, buyer=${listingBuyer}, expiry=${listingExpiry}). Manual resolution required.`,
        null, null, 'L1_null_tuple');
      return { ok: false, error: 'L1: Listing tuple null or partially null',
        ...r, state: 'L1_null_tuple' };
    }
    if (!lpToken || !lpBuyer || !lpExpiry) {
      const r = await failClosedLegacyRevision(deps, listing_id,
        `Legacy revision L1: LP tuple is null or partially null (token=${lpToken}, buyer=${lpBuyer}, expiry=${lpExpiry}). Manual resolution required.`,
        null, null, 'L1_null_tuple');
      return { ok: false, error: 'L1: LP tuple null or partially null',
        ...r, state: 'L1_null_tuple' };
    }
    if (listingToken !== lpToken || listingBuyer !== lpBuyer || listingExpiry !== lpExpiry) {
      const r = await failClosedLegacyRevision(deps, listing_id,
        `Legacy revision L1: tuple mismatch despite matching revisions. Listing token=${listingToken}, LP token=${lpToken}. Manual resolution required.`,
        null, null, 'L1_tuple_mismatch');
      return { ok: false, error: 'L1: tuple mismatch',
        ...r, state: 'L1_tuple_mismatch' };
    }
    return { ok: true, revision: listingRev, alreadyExisted: true, state: 'L1' };
  }

  // ── State L3: exactly one revision exists ───────────────────────────────
  if ((listingRev && !lpRev) || (!listingRev && lpRev)) {
    const r = await failClosedLegacyRevision(deps, listing_id,
      `Legacy revision L3: asymmetric revision. Listing=${listingRev}, LP=${lpRev}. Preserving both tuples. Manual resolution required.`,
      null, null, 'L3');
    return { ok: false, error: 'L3: asymmetric revision',
      ...r, state: 'L3' };
  }

  // ── State L4: both revisions exist but differ ────────────────────────────
  if (listingRev && lpRev && listingRev !== lpRev) {
    const r = await failClosedLegacyRevision(deps, listing_id,
      `Legacy revision L4: revisions differ. Listing=${listingRev}, LP=${lpRev}. Preserving both tuples and both mismatched revisions. Manual resolution required.`,
      null, null, 'L4');
    return { ok: false, error: 'L4: revisions differ',
      ...r, state: 'L4' };
  }

  // ── State L2: both revisions are absent ─────────────────────────────────
  // Initialize ONLY when both complete tuples are non-null, token matches,
  // buyer matches, expiration matches.
  if (!listingToken || !listingBuyer || !listingExpiry) {
    const r = await failClosedLegacyRevision(deps, listing_id,
      `Legacy revision L2: Listing tuple is null or partially null (token=${listingToken}, buyer=${listingBuyer}, expiry=${listingExpiry}). Cannot initialize revision. Manual resolution required.`,
      null, null, 'L2_null_tuple');
    return { ok: false, error: 'L2: Listing tuple is null or partially null — cannot initialize revision',
      ...r, state: 'L2_null_tuple' };
  }
  if (!lpToken || !lpBuyer || !lpExpiry) {
    const r = await failClosedLegacyRevision(deps, listing_id,
      `Legacy revision L2: LP tuple is null or partially null (token=${lpToken}, buyer=${lpBuyer}, expiry=${lpExpiry}). Cannot initialize revision. Manual resolution required.`,
      null, null, 'L2_null_tuple');
    return { ok: false, error: 'L2: LP tuple is null or partially null — cannot initialize revision',
      ...r, state: 'L2_null_tuple' };
  }
  if (listingToken !== lpToken || listingBuyer !== lpBuyer || listingExpiry !== lpExpiry) {
    const r = await failClosedLegacyRevision(deps, listing_id,
      `Legacy revision L2: tuple mismatch. Listing token=${listingToken}, LP token=${lpToken}. Manual resolution required.`,
      null, null, 'L2_tuple_mismatch');
    return { ok: false, error: 'L2: tuple mismatch',
      ...r, state: 'L2_tuple_mismatch' };
  }

  // Generate one unique revision
  const newRevision = revGen();

  // Write to LP first
  try {
    await upsertListingPrivate(deps, listing_id, { reservation_revision: newRevision });
  } catch (err) {
    const r = await failClosedLegacyRevision(deps, listing_id,
      `Legacy revision L2: LP revision write threw. Error: ${err?.message}. No Listing write performed. Manual resolution required.`,
      null, null, 'L2_lp_write_threw');
    return { ok: false, error: `L2: LP revision write failed: ${err?.message}`,
      ...r, state: 'L2_lp_write_threw' };
  }

  // Write to Listing
  try {
    await deps.entities.Listing.update(listing_id, { reservation_revision: newRevision });
  } catch (err) {
    // PARTIAL WRITE: first write succeeded, second threw
    const r = await failClosedLegacyRevision(deps, listing_id,
      `Legacy revision L2: Listing revision write threw AFTER LP write succeeded. LP now has revision=${newRevision}, Listing has none. This is a partial write — a retry must NOT generate a second contradictory revision. Manual resolution required.`,
      null, null, 'L2_listing_write_threw');
    return { ok: false, error: `L2: Listing revision write failed: ${err?.message}`,
      ...r, state: 'L2_listing_write_threw' };
  }

  // Re-fetch both records
  const [listingAfter] = await deps.entities.Listing.filter({ id: listing_id });
  const lpAfter = await getListingPrivate(deps, listing_id);

  if (!listingAfter || !lpAfter) {
    const r = await failClosedLegacyRevision(deps, listing_id,
      `Legacy revision L2: records missing after revision write. Manual resolution required.`,
      null, null, 'L2_missing_after');
    return { ok: false, error: 'L2: missing records after revision write',
      ...r, state: 'L2_missing_after' };
  }

  // PARTIAL WRITE: silently failed — one write did not persist
  if (listingAfter.reservation_revision !== newRevision || lpAfter.reservation_revision !== newRevision) {
    const listingOk = listingAfter.reservation_revision === newRevision;
    const lpOk = lpAfter.reservation_revision === newRevision;
    const r = await failClosedLegacyRevision(deps, listing_id,
      `Legacy revision L2: write silently did not persist. Listing revision=${listingAfter.reservation_revision}, LP revision=${lpAfter.reservation_revision}, expected=${newRevision}. A retry must NOT generate a second contradictory revision. Manual resolution required.`,
      null, null, 'L2_silent_fail');
    return { ok: false, error: `L2: revision not persisted (listingOk=${listingOk}, lpOk=${lpOk})`,
      ...r, state: 'L2_silent_fail' };
  }

  // Verify Listing tuple unchanged
  if (listingAfter.reservation_token !== listingToken ||
      listingAfter.reserved_by_email !== listingBuyer ||
      listingAfter.reservation_expires_at !== listingExpiry) {
    const r = await failClosedLegacyRevision(deps, listing_id,
      `Legacy revision L2: Listing tuple changed during write. Before token=${listingToken}, after token=${listingAfter.reservation_token}. Manual resolution required.`,
      null, null, 'L2_listing_tuple_changed');
    return { ok: false, error: 'L2: Listing tuple changed during write',
      ...r, state: 'L2_listing_tuple_changed' };
  }

  // Verify LP tuple unchanged
  if (lpAfter.reservation_token !== lpToken ||
      lpAfter.reserved_by_email !== lpBuyer ||
      lpAfter.reservation_expires_at !== lpExpiry) {
    const r = await failClosedLegacyRevision(deps, listing_id,
      `Legacy revision L2: LP tuple changed during write. Before token=${lpToken}, after token=${lpAfter.reservation_token}. Manual resolution required.`,
      null, null, 'L2_lp_tuple_changed');
    return { ok: false, error: 'L2: LP tuple changed during write',
      ...r, state: 'L2_lp_tuple_changed' };
  }

  // Verify both tuples still match each other
  if (listingAfter.reservation_token !== lpAfter.reservation_token ||
      listingAfter.reserved_by_email !== lpAfter.reserved_by_email ||
      listingAfter.reservation_expires_at !== lpAfter.reservation_expires_at) {
    const r = await failClosedLegacyRevision(deps, listing_id,
      `Legacy revision L2: tuples diverged after write. Manual resolution required.`,
      null, null, 'L2_tuples_diverged');
    return { ok: false, error: 'L2: tuples diverged after write',
      ...r, state: 'L2_tuples_diverged' };
  }

  return { ok: true, revision: newRevision, alreadyExisted: false, state: 'L2' };
}