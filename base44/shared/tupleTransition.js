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
 *   first_write_attempted / first_write_proven
 *   second_write_attempted / second_write_proven
 *   listing_tuple / lp_tuple (complete)
 *   tuple_equality
 *   status_proof / quarantine_proof
 *   exact errors
 *
 * Returns non-success when either record cannot be proven.
 * Never accepts token equality as proof of complete tuple equality.
 * Never increments a success counter until complete proof exists.
 *
 * No Deno/Node-specific imports — pure ESM JavaScript.
 */
import { generateRevision as defaultGenerateRevision } from './orchestratorHelpers.js';

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
 * Apply a reservation tuple transition to both Listing and ListingPrivate.
 *
 * @param {Object} deps - Dependency-injected { entities, now, generateRevision, hooks }
 * @param {string} listingId - Listing ID
 * @param {Object} intended - Intended state after transition
 * @param {string} intended.status - Intended Listing status
 * @param {string|null} intended.token - Intended reservation_token
 * @param {string|null} intended.buyer - Intended reserved_by_email
 * @param {string|null} intended.expiration - Intended reservation_expires_at
 * @param {string|null} intended.revision - Intended reservation_revision
 * @param {Object} intended.quarantine - { checkout_quarantined, quarantine_reason, quarantine_at }
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
    // Write attempts and proofs
    first_write_attempted: false,
    first_write_proven: false,
    second_write_attempted: false,
    second_write_proven: false,
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
    tuple_equality: false,
    status_proof: false,
    quarantine_proof: false,
    // Errors
    first_write_error: null,
    second_write_error: null,
    first_refetch_error: null,
    second_refetch_error: null,
    verification_error: null,
    // Hook tracking
    hooks_invoked: [],
  };

  const hooks = deps.hooks || {};
  const now = deps.now || (() => Date.now());

  // ── Step 1: Capture pre-write Listing and ListingPrivate records ────────
  try {
    const [listing] = await deps.entities.Listing.filter({ id: listingId });
    result.pre_write.listing = listing ? { ...listing } : null;
  } catch (err) {
    result.first_refetch_error = `pre-write listing fetch: ${err?.message || String(err)}`;
  }

  try {
    const lpRows = await deps.entities.ListingPrivate.filter({ listing_id: listingId });
    result.pre_write.lp = lpRows[0] ? { ...lpRows[0] } : null;
  } catch (err) {
    result.first_refetch_error = `pre-write LP fetch: ${err?.message || String(err)}`;
  }

  // ── Hook: afterAuthoritativePrefetch ────────────────────────────────────
  if (hooks.afterAuthoritativePrefetch) {
    result.hooks_invoked.push('afterAuthoritativePrefetch');
    try { await hooks.afterAuthoritativePrefetch(deps, listingId); } catch (e) {
      result.verification_error = `afterAuthoritativePrefetch hook: ${e?.message || String(e)}`;
    }
  }

  // ── Step 2: Write the intended complete tuple to the first record ───────
  // Write ListingPrivate first (authoritative), then Listing (mirror)
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
    try { await hooks.beforeFirstTupleWrite(deps, listingId, 'ListingPrivate'); } catch (e) {
      result.verification_error = `beforeFirstTupleWrite hook: ${e?.message || String(e)}`;
    }
  }

  result.first_write_attempted = true;
  try {
    // Upsert LP
    const existingLP = result.pre_write.lp;
    if (existingLP) {
      await deps.entities.ListingPrivate.update(existingLP.id, firstFields);
    } else {
      await deps.entities.ListingPrivate.create({ listing_id: listingId, ...firstFields });
    }
  } catch (err) {
    result.first_write_error = err?.message || String(err);
    return result; // first-record failure → non-success
  }

  // ── Hook: betweenTupleWrites ─────────────────────────────────────────────
  if (hooks.betweenTupleWrites) {
    result.hooks_invoked.push('betweenTupleWrites');
    try { await hooks.betweenTupleWrites(deps, listingId); } catch (e) {
      result.verification_error = `betweenTupleWrites hook: ${e?.message || String(e)}`;
    }
  }

  // ── Step 3: Write the identical intended complete tuple to the second record
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
    return result; // second-record failure → non-success
  }

  // ── Step 4: Re-fetch both records authoritatively ──────────────────────
  let postListing = null;
  let postLP = null;

  try {
    const [l] = await deps.entities.Listing.filter({ id: listingId });
    postListing = l;
  } catch (err) {
    result.second_refetch_error = `post-write listing fetch: ${err?.message || String(err)}`;
  }

  try {
    const lpRows = await deps.entities.ListingPrivate.filter({ listing_id: listingId });
    postLP = lpRows[0];
  } catch (err) {
    result.second_refetch_error = `post-write LP fetch: ${err?.message || String(err)}`;
  }

  // ── Step 5: Verify all four reservation fields ──────────────────────────
  if (postListing) {
    result.listing_tuple = {
      token: postListing.reservation_token ?? null,
      buyer: postListing.reserved_by_email ?? null,
      expiration: postListing.reservation_expires_at ?? null,
      revision: postListing.reservation_revision ?? null,
      status: postListing.status ?? null,
      hidden_reason: postListing.hidden_reason ?? null,
    };
    // Verify second write (Listing) persisted — Listing is the SECOND record written
    result.second_write_proven =
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
    // Verify first write (ListingPrivate) persisted — LP is the FIRST record written
    result.first_write_proven =
      result.lp_tuple.token === intended.token &&
      result.lp_tuple.buyer === intended.buyer &&
      result.lp_tuple.expiration === intended.expiration &&
      result.lp_tuple.revision === intended.revision;
  }

  // Complete tuple equality: ALL four fields must match on both records
  result.tuple_equality =
    result.listing_tuple.token === result.lp_tuple.token &&
    result.listing_tuple.buyer === result.lp_tuple.buyer &&
    result.listing_tuple.expiration === result.lp_tuple.expiration &&
    result.listing_tuple.revision === result.lp_tuple.revision;

  // Status proof: Listing status matches intended (if specified)
  if (intended.status !== undefined) {
    result.status_proof = result.listing_tuple.status === intended.status;
  } else {
    result.status_proof = true; // no status change requested
  }

  // Quarantine proof: quarantine fields match intended (if specified)
  if (intended.quarantine && intended.quarantine.checkout_quarantined !== undefined) {
    result.quarantine_proof = result.lp_tuple.checkout_quarantined === intended.quarantine.checkout_quarantined;
  } else {
    result.quarantine_proof = true; // no quarantine change requested
  }

  // ── Hook: afterTupleVerification ─────────────────────────────────────────
  if (hooks.afterTupleVerification) {
    result.hooks_invoked.push('afterTupleVerification');
    try { await hooks.afterTupleVerification(deps, listingId, result); } catch (e) {
      result.verification_error = `afterTupleVerification hook: ${e?.message || String(e)}`;
    }
  }

  // ── Step 6: Return structured proof ─────────────────────────────────────
  // Success requires: first write proven, second write proven, tuple equality,
  // status proof, quarantine proof, and no errors.
  result.ok = result.first_write_proven && result.second_write_proven &&
    result.tuple_equality && result.status_proof && result.quarantine_proof &&
    !result.first_write_error && !result.second_write_error &&
    !result.verification_error;

  return result;
}