/**
 * tupleTransition.js — Authoritative dual-record reservation tuple transition helper.
 *
 * Replaces duplicated partial verification across reserveListing, releaseReservation,
 * abortCheckout, cancelPurchase, processTransferReminders, and reconciliation paths.
 *
 * 7C.9C.2 safety guarantees:
 *   - Intended tuple invariant validation before any write
 *   - Stale-prefetch race detection (re-fetch before first write)
 *   - Conditional second write (Listing must match pre-write generation)
 *   - Split-brain quarantine of BOTH records (not just block/alert)
 *   - Second-record failure quarantine of BOTH records
 *   - First-record failure proof (tuples unchanged, no second write)
 *   - Separate quarantine proof fields (flag, reason, timestamp)
 *   - Durable escalation requires BOTH block AND alert
 *
 * No Deno/Node-specific imports — pure ESM JavaScript.
 */
import { durableBlockAndAlert } from './orchestratorHelpers.js';

const TERMINAL_STATUSES = ['sold', 'cancelled', 'deleted'];

export function isTerminalStatus(status) {
  return TERMINAL_STATUSES.includes(status);
}

export function generateClearedRevision() {
  if (typeof globalThis.crypto !== 'undefined' && globalThis.crypto.randomUUID) {
    return `cleared_${globalThis.crypto.randomUUID()}`;
  }
  return `cleared_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function extractTuple(record) {
  if (!record) return { token: null, buyer: null, expiration: null, revision: null };
  return {
    token: record.reservation_token ?? null,
    buyer: record.reserved_by_email ?? null,
    expiration: record.reservation_expires_at ?? null,
    revision: record.reservation_revision ?? null,
  };
}

function tuplesMatch(a, b) {
  return a.token === b.token &&
    a.buyer === b.buyer &&
    a.expiration === b.expiration &&
    a.revision === b.revision;
}

// ── Validate intended tuple invariants before writing ──────────────────────
export function validateIntendedTuple(intended) {
  const isTerminal = isTerminalStatus(intended.status);

  // Terminal statuses require token, buyer, expiration, and revision to be EXPLICITLY null
  // Undefined and empty strings are rejected — no implicit normalization
  if (isTerminal) {
    if (intended.token !== null)
      return { valid: false, error: 'Terminal status requires explicitly null token' };
    if (intended.buyer !== null)
      return { valid: false, error: 'Terminal status requires explicitly null buyer' };
    if (intended.expiration !== null)
      return { valid: false, error: 'Terminal status requires explicitly null expiration' };
    if (intended.revision !== null)
      return { valid: false, error: 'Terminal status requires explicitly null revision' };
    return { valid: true };
  }

  // Active lifecycle status requires a defined, non-null, non-empty revision
  if (intended.status) {
    if (intended.revision === null || intended.revision === undefined)
      return { valid: false, error: 'Active lifecycle status requires non-null revision' };
    if (typeof intended.revision !== 'string' || intended.revision === '')
      return { valid: false, error: 'Active lifecycle status requires non-empty revision' };
  }

  // Empty string token is invalid
  if (intended.token === '') {
    return { valid: false, error: 'Empty string is not a valid token' };
  }

  // Non-null token requires non-null, non-empty buyer, expiration, and revision
  if (intended.token) {
    if (typeof intended.token !== 'string' || intended.token === '')
      return { valid: false, error: 'Token must be a non-empty string' };
    if (!intended.buyer)
      return { valid: false, error: 'Non-null token requires non-null buyer' };
    if (typeof intended.buyer !== 'string' || intended.buyer === '')
      return { valid: false, error: 'Non-null token requires non-empty buyer' };
    if (!intended.expiration)
      return { valid: false, error: 'Non-null token requires non-null expiration' };
    if (typeof intended.expiration !== 'string' || intended.expiration === '')
      return { valid: false, error: 'Non-null token requires non-empty expiration' };
    if (!intended.revision)
      return { valid: false, error: 'Non-null token requires non-null revision' };
  }

  // Null token requires explicitly null buyer and expiration
  if (intended.token === null) {
    if (intended.buyer !== null)
      return { valid: false, error: 'Null token requires explicitly null buyer' };
    if (intended.expiration !== null)
      return { valid: false, error: 'Null token requires explicitly null expiration' };
  }

  // Quarantine reason and timestamp required when quarantine is newly set
  if (intended.quarantine && intended.quarantine.checkout_quarantined === true) {
    if (!intended.quarantine.quarantine_reason)
      return { valid: false, error: 'Quarantine reason required when quarantine is newly set' };
    if (typeof intended.quarantine.quarantine_reason !== 'string' || intended.quarantine.quarantine_reason === '')
      return { valid: false, error: 'Quarantine reason must be non-empty' };
    if (!intended.quarantine.quarantine_at)
      return { valid: false, error: 'Quarantine timestamp required when quarantine is newly set' };
    // Validate timestamp is a valid ISO date
    const ts = new Date(intended.quarantine.quarantine_at);
    if (isNaN(ts.getTime()))
      return { valid: false, error: 'Quarantine timestamp must be a valid ISO date' };
  }

  return { valid: true };
}

// ── Quarantine both records without changing reservation fields ───────────
async function quarantineBothRecords(deps, listingId, reason, operationId) {
  const proof = {
    quarantine_attempted: false,
    listing_quarantine_proven: false,
    lp_quarantine_proven: false,
    quarantine_flag_proven: false,
    quarantine_reason_proven: false,
    quarantine_timestamp_proven: false,
    listing_quarantine_error: null,
    lp_quarantine_error: null,
    listing_refetch_error: null,
    lp_refetch_error: null,
    quarantine_reason: reason,
    quarantine_at: null,
    // Pre/post tuple snapshots (#5: prove tuples survive quarantine)
    pre_quarantine_listing_tuple: null,
    pre_quarantine_lp_tuple: null,
    post_quarantine_listing_tuple: null,
    post_quarantine_lp_tuple: null,
    listing_tuple_preserved: false,
    lp_tuple_preserved: false,
    pre_existing_disagreement_preserved: false,
    // Protection completeness (#6)
    protection_incomplete: false,
  };

  const quarantineAt = new Date(deps.now()).toISOString();
  proof.quarantine_at = quarantineAt;
  proof.quarantine_attempted = true;

  // ── Capture pre-quarantine tuples ──────────────────────────────────────────
  try {
    const [preListing] = await deps.entities.Listing.filter({ id: listingId });
    if (preListing) {
      proof.pre_quarantine_listing_tuple = extractTuple(preListing);
    }
  } catch (err) {
    proof.listing_refetch_error = `pre-quarantine listing fetch: ${err?.message || String(err)}`;
  }
  try {
    const preLpRows = await deps.entities.ListingPrivate.filter({ listing_id: listingId });
    if (preLpRows[0]) {
      proof.pre_quarantine_lp_tuple = extractTuple(preLpRows[0]);
    }
  } catch (err) {
    proof.lp_refetch_error = `pre-quarantine LP fetch: ${err?.message || String(err)}`;
  }

  // Quarantine Listing — status and hidden_reason ONLY (no reservation field changes)
  try {
    await deps.entities.Listing.update(listingId, {
      status: 'hidden',
      hidden_reason: 'checkout_quarantine',
    });
  } catch (err) {
    proof.listing_quarantine_error = err?.message || String(err);
  }

  // Quarantine ListingPrivate — quarantine fields ONLY (no reservation field changes)
  try {
    const lpRows = await deps.entities.ListingPrivate.filter({ listing_id: listingId });
    const lp = lpRows[0];
    if (lp) {
      await deps.entities.ListingPrivate.update(lp.id, {
        checkout_quarantined: true,
        checkout_quarantine_reason: reason,
        checkout_quarantined_at: quarantineAt,
      });
    } else {
      proof.lp_quarantine_error = 'ListingPrivate not found';
    }
  } catch (err) {
    proof.lp_quarantine_error = err?.message || String(err);
  }

  // Re-fetch and verify Listing quarantine
  try {
    const [listing] = await deps.entities.Listing.filter({ id: listingId });
    proof.listing_quarantine_proven =
      listing?.status === 'hidden' && listing?.hidden_reason === 'checkout_quarantine';
    if (listing) {
      proof.post_quarantine_listing_tuple = extractTuple(listing);
    }
  } catch (err) {
    proof.listing_refetch_error = err?.message || String(err);
  }

  // Re-fetch and verify ListingPrivate quarantine
  try {
    const lpRows = await deps.entities.ListingPrivate.filter({ listing_id: listingId });
    const lp = lpRows[0];
    if (lp) {
      proof.lp_quarantine_proven = lp.checkout_quarantined === true;
      proof.quarantine_flag_proven = lp.checkout_quarantined === true;
      proof.quarantine_reason_proven = lp.checkout_quarantine_reason === reason;
      proof.quarantine_timestamp_proven = lp.checkout_quarantined_at === quarantineAt;
      proof.post_quarantine_lp_tuple = extractTuple(lp);
    }
  } catch (err) {
    proof.lp_refetch_error = err?.message || String(err);
  }

  // ── Verify tuples survived quarantine (#5) ─────────────────────────────────
  if (proof.pre_quarantine_listing_tuple && proof.post_quarantine_listing_tuple) {
    const pre = proof.pre_quarantine_listing_tuple;
    const post = proof.post_quarantine_listing_tuple;
    proof.listing_tuple_preserved =
      pre.token === post.token && pre.buyer === post.buyer &&
      pre.expiration === post.expiration && pre.revision === post.revision;
  }
  if (proof.pre_quarantine_lp_tuple && proof.post_quarantine_lp_tuple) {
    const pre = proof.pre_quarantine_lp_tuple;
    const post = proof.post_quarantine_lp_tuple;
    proof.lp_tuple_preserved =
      pre.token === post.token && pre.buyer === post.buyer &&
      pre.expiration === post.expiration && pre.revision === post.revision;
  }
  // Pre-existing disagreement must be preserved
  if (proof.pre_quarantine_listing_tuple && proof.pre_quarantine_lp_tuple) {
    const preDisagreed = !tuplesMatch(proof.pre_quarantine_listing_tuple, proof.pre_quarantine_lp_tuple);
    if (preDisagreed && proof.post_quarantine_listing_tuple && proof.post_quarantine_lp_tuple) {
      const postDisagreed = !tuplesMatch(proof.post_quarantine_listing_tuple, proof.post_quarantine_lp_tuple);
      proof.pre_existing_disagreement_preserved = preDisagreed && postDisagreed;
    } else {
      proof.pre_existing_disagreement_preserved = true;
    }
  } else {
    proof.pre_existing_disagreement_preserved = true;
  }

  // Protection incomplete if any component cannot be proven (#6)
  proof.protection_incomplete = !proof.listing_quarantine_proven ||
    !proof.lp_quarantine_proven ||
    !proof.listing_tuple_preserved ||
    !proof.lp_tuple_preserved;

  return proof;
}

export async function applyReservationTuple(deps, listingId, intended, category, operationId) {
  const result = {
    ok: false,
    category,
    operation_id: operationId || null,
    listing_id: listingId,
    // Validation
    validation_error: null,
    // Pre-write snapshot
    pre_write: { listing: null, lp: null },
    // Prefetch errors
    listing_prefetch_error: null,
    lp_prefetch_error: null,
    // Tuple classification
    split_brain_detected: false,
    split_brain_fields: [],
    // Stale-prefetch race
    stale_prefetch_detected: false,
    stale_prefetch_fields: [],
    // Write attempts and proofs
    first_write_attempted: false,
    lp_write_proven: false,
    second_write_attempted: false,
    listing_write_proven: false,
    // First-record failure proof
    listing_unchanged_proven: false,
    lp_unchanged_proven: false,
    no_second_write_proven: false,
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
    // Separate quarantine proof fields
    quarantine_flag_proven: false,
    quarantine_reason_proven: false,
    quarantine_timestamp_proven: false,
    // Quarantine proof (from quarantineBothRecords)
    listing_quarantine_proven: false,
    lp_quarantine_proven: false,
    // Tuple preservation proof (#5)
    pre_quarantine_listing_tuple: null,
    pre_quarantine_lp_tuple: null,
    post_quarantine_listing_tuple: null,
    post_quarantine_lp_tuple: null,
    listing_tuple_preserved: false,
    lp_tuple_preserved: false,
    pre_existing_disagreement_preserved: false,
    // Protection completeness (#6)
    protection_incomplete: false,
    // Durable escalation
    block_attempted: false,
    block_proven: false,
    alert_attempted: false,
    alert_proven: false,
    alert_created: false,
    alert_updated: false,
    alert_deduplicated: false,
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

  // ── Step 0: Validate intended tuple invariants ───────────────────────────
  const validation = validateIntendedTuple(intended);
  if (!validation.valid) {
    result.validation_error = validation.error;
    return { ...result, ok: false };
  }

  // ── Step 1: Mandatory authoritative prefetch ────────────────────────────
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

  if (result.listing_prefetch_error || result.lp_prefetch_error) {
    return { ...result, ok: false };
  }
  if (!preListing || !preLP) {
    return { ...result, ok: false };
  }

  // ── Step 2: Classify pre-write tuple — split-brain detection ─────────────
  const preListingTuple = extractTuple(preListing);
  const preLPTuple = extractTuple(preLP);
  const preTuplesMatch = tuplesMatch(preListingTuple, preLPTuple);

  if (!preTuplesMatch) {
    // Pre-existing split-brain — quarantine BOTH records, preserve tuples
    result.split_brain_detected = true;
    const fields = [];
    if (preListingTuple.token !== preLPTuple.token) fields.push('token');
    if (preListingTuple.buyer !== preLPTuple.buyer) fields.push('buyer');
    if (preListingTuple.expiration !== preLPTuple.expiration) fields.push('expiration');
    if (preListingTuple.revision !== preLPTuple.revision) fields.push('revision');
    result.split_brain_fields = fields;

    // Quarantine both records WITHOUT changing reservation fields
    const quarantineReason = `Split-brain detected in applyReservationTuple (${category}): fields=[${fields.join(',')}]. ` +
      `Listing tuple: token=${preListingTuple.token}, buyer=${preListingTuple.buyer}, expiry=${preListingTuple.expiration}, rev=${preListingTuple.revision}. ` +
      `LP tuple: token=${preLPTuple.token}, buyer=${preLPTuple.buyer}, expiry=${preLPTuple.expiration}, rev=${preLPTuple.revision}. ` +
      `Operation ${operationId} refused to overwrite. Manual resolution required.`;
    const qProof = await quarantineBothRecords(deps, listingId, quarantineReason, operationId);
    result.listing_quarantine_proven = qProof.listing_quarantine_proven;
    result.lp_quarantine_proven = qProof.lp_quarantine_proven;
    result.quarantine_flag_proven = qProof.quarantine_flag_proven;
    result.quarantine_reason_proven = qProof.quarantine_reason_proven;
    result.quarantine_timestamp_proven = qProof.quarantine_timestamp_proven;
    result.pre_quarantine_listing_tuple = qProof.pre_quarantine_listing_tuple;
    result.pre_quarantine_lp_tuple = qProof.pre_quarantine_lp_tuple;
    result.post_quarantine_listing_tuple = qProof.post_quarantine_listing_tuple;
    result.post_quarantine_lp_tuple = qProof.post_quarantine_lp_tuple;
    result.listing_tuple_preserved = qProof.listing_tuple_preserved;
    result.lp_tuple_preserved = qProof.lp_tuple_preserved;
    result.pre_existing_disagreement_preserved = qProof.pre_existing_disagreement_preserved;
    result.protection_incomplete = qProof.protection_incomplete;

    // Durably block and alert — require BOTH
    const blockResult = await durableBlockAndAlert(deps, listingId,
      quarantineReason,
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

  // ── Step 2b: Stale-prefetch race check ──────────────────────────────────
  // Re-fetch both records and compare to prefetch snapshots.
  // If either record changed in token, buyer, expiration, or revision,
  // do NOT write the intended tuple — preserve newer values.
  let staleListing = null;
  let staleLP = null;
  try {
    const [l] = await deps.entities.Listing.filter({ id: listingId });
    staleListing = l;
  } catch (err) {
    result.listing_refetch_error = `stale-prefetch listing fetch: ${err?.message || String(err)}`;
    return { ...result, ok: false };
  }
  try {
    const lpRows = await deps.entities.ListingPrivate.filter({ listing_id: listingId });
    staleLP = lpRows[0];
  } catch (err) {
    result.lp_refetch_error = `stale-prefetch LP fetch: ${err?.message || String(err)}`;
    return { ...result, ok: false };
  }

  const staleListingTuple = extractTuple(staleListing);
  const staleLPTuple = extractTuple(staleLP);
  const listingChanged = !tuplesMatch(preListingTuple, staleListingTuple);
  const lpChanged = !tuplesMatch(preLPTuple, staleLPTuple);

  if (listingChanged || lpChanged) {
    result.stale_prefetch_detected = true;
    const fields = [];
    if (staleListingTuple.token !== preListingTuple.token) fields.push('listing_token');
    if (staleListingTuple.buyer !== preListingTuple.buyer) fields.push('listing_buyer');
    if (staleListingTuple.expiration !== preListingTuple.expiration) fields.push('listing_expiration');
    if (staleListingTuple.revision !== preListingTuple.revision) fields.push('listing_revision');
    if (staleLPTuple.token !== preLPTuple.token) fields.push('lp_token');
    if (staleLPTuple.buyer !== preLPTuple.buyer) fields.push('lp_buyer');
    if (staleLPTuple.expiration !== preLPTuple.expiration) fields.push('lp_expiration');
    if (staleLPTuple.revision !== preLPTuple.revision) fields.push('lp_revision');
    result.stale_prefetch_fields = fields;

    // Quarantine both records — preserve newer values, do not overwrite
    const quarantineReason = `Stale-prefetch race detected in applyReservationTuple (${category}): fields=[${fields.join(',')}]. ` +
      `Prefetch Listing tuple: token=${preListingTuple.token}, buyer=${preListingTuple.buyer}. ` +
      `Current Listing tuple: token=${staleListingTuple.token}, buyer=${staleListingTuple.buyer}. ` +
      `Prefetch LP tuple: token=${preLPTuple.token}, buyer=${preLPTuple.buyer}. ` +
      `Current LP tuple: token=${staleLPTuple.token}, buyer=${staleLPTuple.buyer}. ` +
      `Operation ${operationId} refused to overwrite newer values. Manual resolution required.`;
    const qProof = await quarantineBothRecords(deps, listingId, quarantineReason, operationId);
    result.listing_quarantine_proven = qProof.listing_quarantine_proven;
    result.lp_quarantine_proven = qProof.lp_quarantine_proven;
    result.quarantine_flag_proven = qProof.quarantine_flag_proven;
    result.quarantine_reason_proven = qProof.quarantine_reason_proven;
    result.quarantine_timestamp_proven = qProof.quarantine_timestamp_proven;
    result.pre_quarantine_listing_tuple = qProof.pre_quarantine_listing_tuple;
    result.pre_quarantine_lp_tuple = qProof.pre_quarantine_lp_tuple;
    result.post_quarantine_listing_tuple = qProof.post_quarantine_listing_tuple;
    result.post_quarantine_lp_tuple = qProof.post_quarantine_lp_tuple;
    result.listing_tuple_preserved = qProof.listing_tuple_preserved;
    result.lp_tuple_preserved = qProof.lp_tuple_preserved;
    result.pre_existing_disagreement_preserved = qProof.pre_existing_disagreement_preserved;
    result.protection_incomplete = qProof.protection_incomplete;

    const blockResult = await durableBlockAndAlert(deps, listingId,
      quarantineReason,
      null, `Stale-prefetch race — ${listingId} (${category})`, null);
    result.block_attempted = blockResult.block_attempted;
    result.block_proven = blockResult.block_proven;
    result.alert_attempted = blockResult.alert_attempted;
    result.alert_proven = blockResult.alert_proven;

    // Populate tuples with current (newer) values
    result.listing_tuple = { ...staleListingTuple, status: staleListing?.status ?? null, hidden_reason: staleListing?.hidden_reason ?? null };
    result.lp_tuple = { ...staleLPTuple, checkout_quarantined: staleLP?.checkout_quarantined ?? null, quarantine_reason: staleLP?.checkout_quarantine_reason ?? null, quarantine_at: staleLP?.checkout_quarantined_at ?? null };

    return { ...result, ok: false };
  }

  // Update pre-fetch references to the stale-checked (current) values
  preListing = staleListing;
  preLP = staleLP;

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
    // First-record failure: prove no second write and tuples unchanged
    result.second_write_attempted = false;
    result.no_second_write_proven = true;

    // Re-fetch both records and compare each field to pre-write snapshot
    try {
      const [reListing] = await deps.entities.Listing.filter({ id: listingId });
      const reListingTuple = extractTuple(reListing);
      result.listing_tuple = { ...reListingTuple, status: reListing?.status ?? null, hidden_reason: reListing?.hidden_reason ?? null };
      result.listing_unchanged_proven =
        reListingTuple.token === preListingTuple.token &&
        reListingTuple.buyer === preListingTuple.buyer &&
        reListingTuple.expiration === preListingTuple.expiration &&
        reListingTuple.revision === preListingTuple.revision;
    } catch (refetchErr) {
      result.listing_refetch_error = `first-failure listing refetch: ${refetchErr?.message || String(refetchErr)}`;
    }
    try {
      const reLPRows = await deps.entities.ListingPrivate.filter({ listing_id: listingId });
      const reLP = reLPRows[0];
      const reLPTuple = extractTuple(reLP);
      result.lp_tuple = { ...reLPTuple, checkout_quarantined: reLP?.checkout_quarantined ?? null, quarantine_reason: reLP?.checkout_quarantine_reason ?? null, quarantine_at: reLP?.checkout_quarantined_at ?? null };
      result.lp_unchanged_proven =
        reLPTuple.token === preLPTuple.token &&
        reLPTuple.buyer === preLPTuple.buyer &&
        reLPTuple.expiration === preLPTuple.expiration &&
        reLPTuple.revision === preLPTuple.revision;
    } catch (refetchErr) {
      result.lp_refetch_error = `first-failure LP refetch: ${refetchErr?.message || String(refetchErr)}`;
    }
    return { ...result, ok: false };
  }

  // ── Hook: afterListingPrivateWrite ────────────────────────────────────────
  if (hooks.afterListingPrivateWrite) {
    result.hooks_invoked.push('afterListingPrivateWrite');
    try {
      await hooks.afterListingPrivateWrite(deps, listingId);
    } catch (e) {
      result.hook_error = `afterListingPrivateWrite hook: ${e?.message || String(e)}`;
      return await handleSecondRecordFailure(deps, listingId, result, preListingTuple, preLPTuple, `afterListingPrivateWrite hook: ${e?.message || String(e)}`);
    }
  }

  // ── Hook: betweenTupleWrites ─────────────────────────────────────────────
  if (hooks.betweenTupleWrites) {
    result.hooks_invoked.push('betweenTupleWrites');
    try {
      await hooks.betweenTupleWrites(deps, listingId);
    } catch (e) {
      result.hook_error = `betweenTupleWrites hook: ${e?.message || String(e)}`;
      return await handleSecondRecordFailure(deps, listingId, result, preListingTuple, preLPTuple, `betweenTupleWrites hook: ${e?.message || String(e)}`);
    }
  }

  // ── Step 3b: Conditional check before second write ─────────────────────
  // Re-fetch Listing and verify it still matches the expected pre-write generation.
  // A newer Listing mutation must never be overwritten.
  let preSecondWriteListing = null;
  try {
    const [l] = await deps.entities.Listing.filter({ id: listingId });
    preSecondWriteListing = l;
  } catch (err) {
    result.listing_refetch_error = `pre-second-write listing fetch: ${err?.message || String(err)}`;
    return await handleSecondRecordFailure(deps, listingId, result, preListingTuple, preLPTuple, `pre-second-write listing fetch failed: ${err?.message || String(err)}`);
  }

  const preSecondWriteListingTuple = extractTuple(preSecondWriteListing);
  if (!tuplesMatch(preSecondWriteListingTuple, preListingTuple)) {
    // Listing changed between writes — do not overwrite the newer value
    return await handleSecondRecordFailure(deps, listingId, result, preListingTuple, preLPTuple,
      `Listing changed between writes. Pre-write token=${preListingTuple.token}, current token=${preSecondWriteListingTuple.token}. Refused to overwrite newer Listing mutation.`);
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

  // ── Hook: beforeListingUpdate ─────────────────────────────────────────────
  if (hooks.beforeListingUpdate) {
    result.hooks_invoked.push('beforeListingUpdate');
    try {
      await hooks.beforeListingUpdate(deps, listingId);
    } catch (e) {
      result.hook_error = `beforeListingUpdate hook: ${e?.message || String(e)}`;
      return await handleSecondRecordFailure(deps, listingId, result, preListingTuple, preLPTuple, `beforeListingUpdate hook: ${e?.message || String(e)}`);
    }
  }

  result.second_write_attempted = true;
  try {
    await deps.entities.Listing.update(listingId, secondFields);
  } catch (err) {
    result.second_write_error = err?.message || String(err);
    return await handleSecondRecordFailure(deps, listingId, result, preListingTuple, preLPTuple, err?.message || String(err));
  }

  // ── Hook: afterListingUpdate ──────────────────────────────────────────────
  if (hooks.afterListingUpdate) {
    result.hooks_invoked.push('afterListingUpdate');
    try {
      await hooks.afterListingUpdate(deps, listingId);
    } catch (e) {
      result.hook_error = `afterListingUpdate hook: ${e?.message || String(e)}`;
      return await handleSecondRecordFailure(deps, listingId, result, preListingTuple, preLPTuple, `afterListingUpdate hook: ${e?.message || String(e)}`);
    }
  }

  // ── Hook: beforePostWriteVerification ──────────────────────────────────────
  if (hooks.beforePostWriteVerification) {
    result.hooks_invoked.push('beforePostWriteVerification');
    try {
      await hooks.beforePostWriteVerification(deps, listingId);
    } catch (e) {
      result.hook_error = `beforePostWriteVerification hook: ${e?.message || String(e)}`;
      return await handleSecondRecordFailure(deps, listingId, result, preListingTuple, preLPTuple, `beforePostWriteVerification hook: ${e?.message || String(e)}`);
    }
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
    result.lp_write_proven =
      result.lp_tuple.token === intended.token &&
      result.lp_tuple.buyer === intended.buyer &&
      result.lp_tuple.expiration === intended.expiration &&
      result.lp_tuple.revision === intended.revision;
  }

  result.tuple_equality_proven =
    result.listing_tuple.token === result.lp_tuple.token &&
    result.listing_tuple.buyer === result.lp_tuple.buyer &&
    result.listing_tuple.expiration === result.lp_tuple.expiration &&
    result.listing_tuple.revision === result.lp_tuple.revision;

  if (intended.status !== undefined) {
    result.status_proven = result.listing_tuple.status === intended.status;
  } else {
    result.status_proven = true;
  }

  // Separate quarantine proof fields
  if (intended.quarantine && intended.quarantine.checkout_quarantined !== undefined) {
    result.quarantine_flag_proven = result.lp_tuple.checkout_quarantined === intended.quarantine.checkout_quarantined;
    if (intended.quarantine.quarantine_reason !== undefined) {
      result.quarantine_reason_proven = result.lp_tuple.quarantine_reason === intended.quarantine.quarantine_reason;
    } else {
      result.quarantine_reason_proven = true;
    }
    if (intended.quarantine.quarantine_at !== undefined) {
      result.quarantine_timestamp_proven = result.lp_tuple.quarantine_at === intended.quarantine.quarantine_at;
    } else {
      result.quarantine_timestamp_proven = true;
    }
  } else {
    result.quarantine_flag_proven = true;
    result.quarantine_reason_proven = true;
    result.quarantine_timestamp_proven = true;
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
    result.tuple_equality_proven && result.status_proven &&
    result.quarantine_flag_proven && result.quarantine_reason_proven && result.quarantine_timestamp_proven &&
    !result.first_write_error && !result.second_write_error &&
    !result.hook_error && !result.listing_refetch_error && !result.lp_refetch_error;

  return result;
}

// ── Handle second-record failure: LP written but Listing failed ────────────
// Quarantines BOTH records without changing reservation tuples,
// durably blocks and alerts (requires BOTH), classifies split state,
// and returns structured non-success.
async function handleSecondRecordFailure(deps, listingId, result, preListingTuple, preLPTuple, errorMessage) {
  // Capture post-failure tuples
  let postListingTuple = preListingTuple;
  let postLPTuple = preLPTuple;

  try {
    const [postListing] = await deps.entities.Listing.filter({ id: listingId });
    postListingTuple = extractTuple(postListing);
    result.listing_tuple = { ...postListingTuple, status: postListing?.status ?? null, hidden_reason: postListing?.hidden_reason ?? null };
  } catch (err) {
    result.listing_refetch_error = `second-failure listing refetch: ${err?.message || String(err)}`;
  }

  try {
    const lpRows = await deps.entities.ListingPrivate.filter({ listing_id: listingId });
    const postLP = lpRows[0];
    postLPTuple = extractTuple(postLP);
    result.lp_tuple = { ...postLPTuple, checkout_quarantined: postLP?.checkout_quarantined ?? null, quarantine_reason: postLP?.checkout_quarantine_reason ?? null, quarantine_at: postLP?.checkout_quarantined_at ?? null };
  } catch (err) {
    result.lp_refetch_error = `second-failure LP refetch: ${err?.message || String(err)}`;
  }

  // Quarantine both records WITHOUT changing reservation tuples
  const quarantineReason = `Second-record failure in applyReservationTuple (${result.category}): LP written but Listing failed. ` +
    `Error: ${errorMessage}. ` +
    `LP tuple: token=${postLPTuple.token}, buyer=${postLPTuple.buyer}, expiry=${postLPTuple.expiration}, rev=${postLPTuple.revision}. ` +
    `Listing tuple: token=${postListingTuple.token}, buyer=${postListingTuple.buyer}, expiry=${postListingTuple.expiration}, rev=${postListingTuple.revision}. ` +
    `Operation ${result.operation_id} refused to retry. Manual resolution required.`;
  const qProof = await quarantineBothRecords(deps, listingId, quarantineReason, result.operation_id);
  result.listing_quarantine_proven = qProof.listing_quarantine_proven;
  result.lp_quarantine_proven = qProof.lp_quarantine_proven;
  result.quarantine_flag_proven = qProof.quarantine_flag_proven;
  result.quarantine_reason_proven = qProof.quarantine_reason_proven;
  result.quarantine_timestamp_proven = qProof.quarantine_timestamp_proven;

  // Durably block and alert — require BOTH
  const blockResult = await durableBlockAndAlert(deps, listingId,
    quarantineReason,
    null, `Second-record failure — ${listingId} (${result.category})`, null);
  result.block_attempted = blockResult.block_attempted;
  result.block_proven = blockResult.block_proven;
  result.alert_attempted = blockResult.alert_attempted;
  result.alert_proven = blockResult.alert_proven;

  // Classify the split state
  result.split_brain_detected = !tuplesMatch(postListingTuple, postLPTuple);
  if (result.split_brain_detected) {
    if (postListingTuple.token !== postLPTuple.token) result.split_brain_fields.push('token');
    if (postListingTuple.buyer !== postLPTuple.buyer) result.split_brain_fields.push('buyer');
    if (postListingTuple.expiration !== postLPTuple.expiration) result.split_brain_fields.push('expiration');
    if (postListingTuple.revision !== postLPTuple.revision) result.split_brain_fields.push('revision');
  }

  return { ...result, ok: false };
}