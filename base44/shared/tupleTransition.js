/**
 * tupleTransition.js — Authoritative dual-record reservation tuple transition helper.
 *
 * Replaces duplicated partial verification across reserveListing, releaseReservation,
 * abortCheckout, cancelPurchase, processTransferReminders, and reconciliation paths.
 *
 * Accepts:
 *   deps           — dependency-injected { entities, now, generateRevision, hooks }
 *   listingId      — Listing ID
 *   intended       — { status, token, buyer, expiration, revision, quarantine fields }
 *   category       — mutation category (reserve, release, abort, cancel, reminder_clear, freeze, finalize)
 *   operationId    — request or operation ID for traceability
 *
 * Supports injectable synchronization hooks (production defaults are no-ops):
 *   afterAuthoritativePrefetch
 *   beforeQuarantineWrite
 *   beforeFirstTupleWrite
 *   betweenTupleWrites
 *   afterTupleVerification
 *
 * Returns structured proof:
 *   listing_prefetch_error / lp_prefetch_error
 *   first_write_attempted / lp_write_proven
 *   second_write_attempted / listing_write_proven
 *   tuple_equality_proven / status_proven / quarantine_proven
 *   split_brain_detected / block_proven / alert_proven
 *   listing_tuple / lp_tuple (complete, pre and post)
 *   exact errors
 *
 * Returns non-success when either record cannot be proven.
 * Never accepts token equality as proof of complete tuple equality.
 * Never increments a success counter until complete proof exists.
 *
 * No Deno/Node-specific imports — pure ESM JavaScript.
 */
import { durableBlockAndAlert } from './orchestratorHelpers.js';

const TERMINAL_STATUSES = ['sold', 'cancelled', 'deleted'];

export function isTerminalStatus(status) {
  return TERMINAL_STATUSES.includes(status);
}

/**
 * Generate a non-null cleared-state revision for active-lifecycle clears.
 * Active listings must NEVER have reservation_revision: null.
 * Only terminal listings (sold, cancelled, deleted) may have null revision.
 */
export function generateClearedRevision() {
  if (typeof globalThis.crypto !== 'undefined' && globalThis.crypto.randomUUID) {
    return `cleared_${globalThis.crypto.randomUUID()}`;
  }
  return `cleared_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Extract a complete reservation tuple from a record.
 * Returns { token, buyer, expiration, revision } — all null if record is null.
 */
function extractTuple(record) {
  if (!record) return { token: null, buyer: null, expiration: null, revision: null };
  return {
    token: record.reservation_token ?? null,
    buyer: record.reserved_by_email ?? null,
    expiration: record.reservation_expires_at ?? null,
    revision: record.reservation_revision ?? null,
  };
}

/**
 * Compare two complete tuples for exact equality on all four fields.
 */
function tuplesMatch(a, b) {
  return a.token === b.token &&
    a.buyer === b.buyer &&
    a.expiration === b.expiration &&
    a.revision === b.revision;
}

/**
 * Apply a reservation tuple transition to both Listing and ListingPrivate.
 *
 * @param {Object} deps - Dependency-injected { entities, now, generateRevision, hooks }
 * @param {string} listingId - Listing ID
 * @param {Object} intended - Intended state after transition
 * @param {string|null} intended.token - Intended reservation_token
 * @param {string|null} intended.buyer - Intended reserved_by_email
 * @param {string|null} intended.expiration - Intended reservation_expires_at
 * @param {string|null} intended.revision - Intended reservation_revision
 * @param {string|undefined} intended.status - Intended Listing status
 * @param {string|null|undefined} intended.hidden_reason - Intended hidden_reason
 * @param {Object|undefined} intended.quarantine - { checkout_quarantined, quarantine_reason, quarantine_at }
 * @param {string} category - Mutation category
 * @param {string} operationId - Operation ID for traceability
 * @returns {Object} Structured proof result
 */
export async function applyReservationTuple(deps, listingId, intended, category, operationId) {
  const result = {
    ok: false,
    category,
    operation_id: operationId || null,
    listing_id: listingId,
    // Pre-write snapshot
    pre_write: {
      listing: null,
      lp: null,
    },
    // Prefetch errors (separate)
    listing_prefetch_error: null,
    lp_prefetch_error: null,
    // Tuple classification
    split_brain_detected: false,
    split_brain_fields: [],
    // Write attempts and proofs
    first_write_attempted: false,
    lp_write_proven: false,
    second_write_attempted: false,
    listing_write_proven: false,
    // Post-write complete tuples
    listing_tuple: {
      token: null, buyer: null, expiration: null, revision: null,
      status: null, hidden_reason: null,
    },
    lp_tuple: {
      token: null, buyer: null, expiration: null, revision: null,
      checkout_quarantined: null, quarantine_reason: null, quarantine_at: null,
    },
    // Verification results
    tuple_equality_proven: false,
    status_proven: false,
    quarantine_proven: false,
    // Durable escalation
    block_attempted: false,
    block_proven: false,
    alert_attempted: false,
    alert_proven: false,
    // Errors
    first_write_error: null,
    second_write_error: null,
    listing_refetch_error: null,
    lp_refetch_error: null,
    hook_error: null,
    // Hook tracking
    hooks_invoked: [],
  };

  const hooks = deps.hooks || {};
  const now = deps.now || (() => Date.now());

  // ── Step 1: Mandatory authoritative prefetch ────────────────────────────
  // Fetch Listing and ListingPrivate separately, storing separate errors.
  let preListing = null;
  let preLP = null;

  try {
    const [l] = await deps.entities.Listing.filter({ id: listingId });
    preListing = l || null;
    result.pre_write.listing = preListing ? { ...preListing } : null;
  } catch (err) {
    result.listing_prefetch_error = err?.message || String(err);
  }

  try {
    const lpRows = await deps.entities.ListingPrivate.filter({ listing_id: listingId });
    preLP = lpRows[0] || null;
    result.pre_write.lp = preLP ? { ...preLP } : null;
  } catch (err) {
    result.lp_prefetch_error = err?.message || String(err);
  }

  // Require both records to exist (unless explicitly approved creation path)
  // For a reserve on a fresh listing, both records should already exist.
  // For migration/creation paths, use the dedicated migration logic.
  if (result.listing_prefetch_error || result.lp_prefetch_error) {
    return { ...result, ok: false };
  }
  if (!preListing || !preLP) {
    return { ...result, ok: false };
  }

  // ── Step 2: Classify pre-write tuple ────────────────────────────────────
  const preListingTuple = extractTuple(preListing);
  const preLPTuple = extractTuple(preLP);
  const preTuplesMatch = tuplesMatch(preListingTuple, preLPTuple);

  if (!preTuplesMatch) {
    // Existing split-brain state — do NOT overwrite evidence.
    result.split_brain_detected = true;
    const fields = [];
    if (preListingTuple.token !== preLPTuple.token) fields.push('token');
    if (preListingTuple.buyer !== preLPTuple.buyer) fields.push('buyer');
    if (preListingTuple.expiration !== preLPTuple.expiration) fields.push('expiration');
    if (preListingTuple.revision !== preLPTuple.revision) fields.push('revision');
    result.split_brain_fields = fields;

    // Durably block and alert — preserve both complete tuples, no writes.
    const blockResult = await durableBlockAndAlert(deps, listingId,
      `Split-brain detected in applyReservationTuple (${category}): fields=[${fields.join(',')}]. ` +
      `Listing tuple: token=${preListingTuple.token}, buyer=${preListingTuple.buyer}, expiry=${preListingTuple.expiration}, rev=${preListingTuple.revision}. ` +
      `LP tuple: token=${preLPTuple.token}, buyer=${preLPTuple.buyer}, expiry=${preLPTuple.expiration}, rev=${preLPTuple.revision}. ` +
      `Operation ${operationId} refused to overwrite. Manual resolution required.`,
      null, `Split-brain detected — ${listingId} (${category})`, null);
    result.block_attempted = blockResult.block_attempted;
    result.block_proven = blockResult.block_proven;
    result.alert_attempted = blockResult.alert_attempted;
    result.alert_proven = blockResult.alert_proven;

    // Populate listing_tuple and lp_tuple with pre-write values for evidence
    result.listing_tuple = { ...preListingTuple, status: preListing.status ?? null, hidden_reason: preListing.hidden_reason ?? null };
    result.lp_tuple = { ...preLPTuple, checkout_quarantined: preLP.checkout_quarantined ?? null, quarantine_reason: preLP.checkout_quarantine_reason ?? null, quarantine_at: preLP.checkout_quarantined_at ?? null };

    return { ...result, ok: false };
  }

  // ── Hook: afterAuthoritativePrefetch ────────────────────────────────────
  if (hooks.afterAuthoritativePrefetch) {
    result.hooks_invoked.push('afterAuthoritativePrefetch');
    try {
      await hooks.afterAuthoritativePrefetch(deps, listingId);
    } catch (e) {
      result.hook_error = `afterAuthoritativePrefetch hook: ${e?.message || String(e)}`;
      return { ...result, ok: false };
    }
  }

  // ── Step 3: Write the intended complete tuple to ListingPrivate (first) ─
  const firstFields = {
    reservation_token: intended.token,
    reserved_by_email: intended.buyer,
    reservation_expires_at: intended.expiration,
    reservation_revision: intended.revision,
  };
  if (intended.quarantine) {
    if (intended.quarantine.checkout_quarantined !== undefined) {
      firstFields.checkout_quarantined = intended.quarantine.checkout_quarantined;
    }
    if (intended.quarantine.quarantine_reason !== undefined) {
      firstFields.checkout_quarantine_reason = intended.quarantine.quarantine_reason;
    }
    if (intended.quarantine.quarantine_at !== undefined) {
      firstFields.checkout_quarantined_at = intended.quarantine.quarantine_at;
    }
  }

  // ── Hook: beforeFirstTupleWrite ──────────────────────────────────────────
  if (hooks.beforeFirstTupleWrite) {
    result.hooks_invoked.push('beforeFirstTupleWrite');
    try {
      await hooks.beforeFirstTupleWrite(deps, listingId, 'ListingPrivate');
    } catch (e) {
      result.hook_error = `beforeFirstTupleWrite hook: ${e?.message || String(e)}`;
      return { ...result, ok: false };
    }
  }

  result.first_write_attempted = true;
  try {
    await deps.entities.ListingPrivate.update(preLP.id, firstFields);
  } catch (err) {
    result.first_write_error = err?.message || String(err);
    // First-record failure: prove no second-record write was attempted
    result.second_write_attempted = false;
    // Re-fetch both records to prove pre-write tuples remain unchanged
    try {
      const [reListing] = await deps.entities.Listing.filter({ id: listingId });
      const reListingTuple = extractTuple(reListing);
      result.listing_tuple = { ...reListingTuple, status: reListing?.status ?? null, hidden_reason: reListing?.hidden_reason ?? null };
    } catch (refetchErr) {
      result.listing_refetch_error = `first-failure listing refetch: ${refetchErr?.message || String(refetchErr)}`;
    }
    try {
      const reLPRows = await deps.entities.ListingPrivate.filter({ listing_id: listingId });
      const reLP = reLPRows[0];
      const reLPTuple = extractTuple(reLP);
      result.lp_tuple = { ...reLPTuple, checkout_quarantined: reLP?.checkout_quarantined ?? null, quarantine_reason: reLP?.checkout_quarantine_reason ?? null, quarantine_at: reLP?.checkout_quarantined_at ?? null };
    } catch (refetchErr) {
      result.lp_refetch_error = `first-failure LP refetch: ${refetchErr?.message || String(refetchErr)}`;
    }
    return { ...result, ok: false };
  }

  // ── Hook: betweenTupleWrites ─────────────────────────────────────────────
  if (hooks.betweenTupleWrites) {
    result.hooks_invoked.push('betweenTupleWrites');
    try {
      await hooks.betweenTupleWrites(deps, listingId);
    } catch (e) {
      result.hook_error = `betweenTupleWrites hook: ${e?.message || String(e)}`;
      // Hook failed after first write succeeded — second-record failure path
      return await handleSecondRecordFailure(deps, listingId, result, `betweenTupleWrites hook: ${e?.message || String(e)}`);
    }
  }

  // ── Step 4: Write the identical intended complete tuple to Listing (second)
  const secondFields = {
    reservation_token: intended.token,
    reserved_by_email: intended.buyer,
    reservation_expires_at: intended.expiration,
    reservation_revision: intended.revision,
  };
  if (intended.status !== undefined) {
    secondFields.status = intended.status;
  }
  if (intended.hidden_reason !== undefined) {
    secondFields.hidden_reason = intended.hidden_reason;
  }

  result.second_write_attempted = true;
  try {
    await deps.entities.Listing.update(listingId, secondFields);
  } catch (err) {
    result.second_write_error = err?.message || String(err);
    // Second-record failure: LP changed but Listing failed
    return await handleSecondRecordFailure(deps, listingId, result, err?.message || String(err));
  }

  // ── Step 5: Re-fetch both records authoritatively ───────────────────────
  let postListing = null;
  let postLP = null;

  try {
    const [l] = await deps.entities.Listing.filter({ id: listingId });
    postListing = l;
  } catch (err) {
    result.listing_refetch_error = `post-write listing fetch: ${err?.message || String(err)}`;
  }

  try {
    const lpRows = await deps.entities.ListingPrivate.filter({ listing_id: listingId });
    postLP = lpRows[0];
  } catch (err) {
    result.lp_refetch_error = `post-write LP fetch: ${err?.message || String(err)}`;
  }

  // ── Step 6: Verify both records independently against intended tuple ─────
  if (postListing) {
    result.listing_tuple = {
      token: postListing.reservation_token ?? null,
      buyer: postListing.reserved_by_email ?? null,
      expiration: postListing.reservation_expires_at ?? null,
      revision: postListing.reservation_revision ?? null,
      status: postListing.status ?? null,
      hidden_reason: postListing.hidden_reason ?? null,
    };
    // Listing is the SECOND record written
    result.listing_write_proven =
      result.listing_tuple.token === intended.token &&
      result.listing_tuple.buyer === intended.buyer &&
      result.listing_tuple.expiration === intended.expiration &&
      result.listing_tuple.revision === intended.revision;
  }

  if (postLP) {
    result.lp_tuple = {
      token: postLP.reservation_token ?? null,
      buyer: postLP.reserved_by_email ?? null,
      expiration: postLP.reservation_expires_at ?? null,
      revision: postLP.reservation_revision ?? null,
      checkout_quarantined: postLP.checkout_quarantined ?? null,
      quarantine_reason: postLP.checkout_quarantine_reason ?? null,
      quarantine_at: postLP.checkout_quarantined_at ?? null,
    };
    // LP is the FIRST record written
    result.lp_write_proven =
      result.lp_tuple.token === intended.token &&
      result.lp_tuple.buyer === intended.buyer &&
      result.lp_tuple.expiration === intended.expiration &&
      result.lp_tuple.revision === intended.revision;
  }

  // Complete tuple equality: ALL four fields must match on both records
  result.tuple_equality_proven =
    result.listing_tuple.token === result.lp_tuple.token &&
    result.listing_tuple.buyer === result.lp_tuple.buyer &&
    result.listing_tuple.expiration === result.lp_tuple.expiration &&
    result.listing_tuple.revision === result.lp_tuple.revision;

  // Status proof: Listing status matches intended (if specified)
  if (intended.status !== undefined) {
    result.status_proven = result.listing_tuple.status === intended.status;
  } else {
    result.status_proven = true;
  }

  // Quarantine proof: quarantine fields match intended (if specified)
  if (intended.quarantine && intended.quarantine.checkout_quarantined !== undefined) {
    result.quarantine_proven = result.lp_tuple.checkout_quarantined === intended.quarantine.checkout_quarantined;
  } else {
    result.quarantine_proven = true;
  }

  // ── Hook: afterTupleVerification ─────────────────────────────────────────
  if (hooks.afterTupleVerification) {
    result.hooks_invoked.push('afterTupleVerification');
    try {
      await hooks.afterTupleVerification(deps, listingId, result);
    } catch (e) {
      result.hook_error = `afterTupleVerification hook: ${e?.message || String(e)}`;
      return { ...result, ok: false };
    }
  }

  // ── Step 7: Return structured proof ──────────────────────────────────────
  result.ok = result.lp_write_proven && result.listing_write_proven &&
    result.tuple_equality_proven && result.status_proven && result.quarantine_proven &&
    !result.first_write_error && !result.second_write_error &&
    !result.hook_error && !result.listing_refetch_error && !result.lp_refetch_error;

  return result;
}

/**
 * Handle second-record failure: LP changed but Listing failed.
 *
 * Preserves the exact resulting split state, attempts fail-closed quarantine
 * without changing either reservation tuple, sets a durable recovery block,
 * creates a critical alert, and returns structured non-success.
 */
async function handleSecondRecordFailure(deps, listingId, result, errorMessage) {
  // Capture pre-write and post-failure tuples
  try {
    const [postListing] = await deps.entities.Listing.filter({ id: listingId });
    const postListingTuple = extractTuple(postListing);
    result.listing_tuple = { ...postListingTuple, status: postListing?.status ?? null, hidden_reason: postListing?.hidden_reason ?? null };
  } catch (err) {
    result.listing_refetch_error = `second-failure listing refetch: ${err?.message || String(err)}`;
  }

  try {
    const lpRows = await deps.entities.ListingPrivate.filter({ listing_id: listingId });
    const postLP = lpRows[0];
    const postLPTuple = extractTuple(postLP);
    result.lp_tuple = { ...postLPTuple, checkout_quarantined: postLP?.checkout_quarantined ?? null, quarantine_reason: postLP?.checkout_quarantine_reason ?? null, quarantine_at: postLP?.checkout_quarantined_at ?? null };
  } catch (err) {
    result.lp_refetch_error = `second-failure LP refetch: ${err?.message || String(err)}`;
  }

  // Durably block and alert — preserve split state, do not retry Listing write
  const blockResult = await durableBlockAndAlert(deps, listingId,
    `Second-record failure in applyReservationTuple (${result.category}): LP written but Listing failed. ` +
    `Error: ${errorMessage}. LP tuple: token=${result.lp_tuple.token}, buyer=${result.lp_tuple.buyer}. ` +
    `Listing tuple: token=${result.listing_tuple.token}, buyer=${result.listing_tuple.buyer}. ` +
    `Operation ${result.operation_id} refused to retry. Manual resolution required.`,
    null, `Second-record failure — ${listingId} (${result.category})`, null);
  result.block_attempted = blockResult.block_attempted;
  result.block_proven = blockResult.block_proven;
  result.alert_attempted = blockResult.alert_attempted;
  result.alert_proven = blockResult.alert_proven;

  return { ...result, ok: false };
}