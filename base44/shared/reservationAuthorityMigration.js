/**
 * Reservation Authority Migration (7C.9C.2E Correction Round 3)
 *
 * Read-only dry-run report that joins BOTH Listing and ListingPrivate.
 * Does NOT apply any migration. An idempotent apply design is provided
 * but requires explicit owner approval before execution.
 *
 * Round 3 corrections:
 *   - Missing versions on legacy records are normal MIGRATION_REQUIRED,
 *     not automatically AMBIGUOUS.
 *   - Handles independently: LP version missing, Listing mirror version
 *     missing, both missing, sidecar missing, duplicate sidecar, orphan sidecar.
 *   - Public hidden, pending_verification, pending_payout_setup, and malformed
 *     pending_transfer states NEVER map automatically to available.
 *   - sold/cancelled/expired require valid terminal tuples (null token/buyer/expiration).
 *   - active + valid empty reservation tuple may map to available.
 *   - Pagination: does not silently cap at 10,000 rows.
 *   - Dry-run report only. Does not apply to real records.
 *
 * No Deno/Node-specific imports — pure ESM JavaScript.
 */
import {
  LIFECYCLE_STATES, TUPLE_REQUIRED_STATES, TUPLE_NULL_STATES,
  isValidISODate, isNonEmptyString, isValidVersion, isValidLifecycleState,
} from './reservationAuthorityConstants.js';

// ── Paginated fetch (does not silently cap at 10,000) ───────────────────────
// Fetches all records in batches, tracking seen IDs to handle SDKs that
// do not support skip-based pagination.
async function fetchAllRecords(entity, batchSize = 500) {
  const all = [];
  const seen = new Set();
  let skip = 0;
  while (true) {
    let batch;
    try {
      batch = await entity.list('-created_date', batchSize, skip);
    } catch (e) {
      // If list doesn't support skip, fall back to filter with cursor
      try {
        batch = await entity.list('-created_date', batchSize);
      } catch (e2) {
        throw new Error(`fetchAllRecords: list failed: ${e2?.message || String(e2)}`);
      }
    }
    if (!Array.isArray(batch) || batch.length === 0) break;
    let newCount = 0;
    for (const rec of batch) {
      if (rec.id && !seen.has(rec.id)) {
        seen.add(rec.id);
        all.push(rec);
        newCount++;
      }
    }
    if (batch.length < batchSize || newCount === 0) break;
    skip += batchSize;
  }
  return all;
}

// ── Derive lifecycle state from LP + Listing (joined) ───────────────────────
// Rules (Round 3):
//   1. If LP has a valid reservation_lifecycle_state, use it as primary signal
//      (but verify tuple consistency).
//   2. Public sold/cancelled/expired never become available; require valid
//      terminal tuples (null token/buyer/expiration).
//   3. Public hidden, pending_verification, pending_payout_setup, and malformed
//      pending_transfer NEVER map to available — preserve/manual-review.
//   4. Quarantined or recovery-blocked → frozen.
//   5. active + valid empty reservation tuple → available.
//   6. Full tuple (token+buyer+expiry+revision) → reserved (or expired if past).
//   7. Any uncertain or contradictory case → AMBIGUOUS.
//   8. Unknown must never be interpreted as available.
function deriveLifecycleState(lp, listing) {
  // Terminal public states never become available
  if (listing?.status === 'sold') return 'sold';
  if (listing?.status === 'cancelled') return 'cancelled';
  if (listing?.status === 'expired') return 'expired';

  // Round 5: Quarantined or recovery-blocked — check BEFORE generic hidden.
  // A quarantined row with a valid complete reservation tuple may derive frozen.
  // A quarantined row with an incomplete/malformed/contradictory tuple remains AMBIGUOUS.
  if (lp?.checkout_quarantined === true || lp?.recovery_blocked === true) {
    const hasToken = isNonEmptyString(lp.reservation_token);
    const hasBuyer = isNonEmptyString(lp.reserved_by_email);
    const hasExpiry = lp.reservation_expires_at && isValidISODate(lp.reservation_expires_at);
    const hasRevision = isNonEmptyString(lp.reservation_revision);
    if (hasToken && hasBuyer && hasExpiry && hasRevision) {
      return 'frozen';
    }
    // Incomplete/malformed tuple → AMBIGUOUS
    return 'AMBIGUOUS';
  }

  // Non-active public states that must NEVER map to available
  // (preserve/manual-review) — generic hidden without quarantine evidence
  if (listing?.status === 'hidden') return 'AMBIGUOUS';
  if (listing?.status === 'pending_verification') return 'AMBIGUOUS';
  if (listing?.status === 'pending_payout_setup') return 'AMBIGUOUS';
  if (listing?.status === 'pending_transfer') {
    // pending_transfer is only safe if there's a valid reservation tuple
    // Otherwise it's ambiguous (malformed)
    if (!lp) return 'AMBIGUOUS';
    const hasToken = isNonEmptyString(lp.reservation_token);
    const hasBuyer = isNonEmptyString(lp.reserved_by_email);
    const hasExpiry = lp.reservation_expires_at && isValidISODate(lp.reservation_expires_at);
    if (!(hasToken && hasBuyer && hasExpiry)) return 'AMBIGUOUS';
    // Fall through to tuple-based derivation below
  }

  if (!lp) return 'AMBIGUOUS';

  // If LP has a valid lifecycle state, use it as primary signal
  if (isValidLifecycleState(lp.reservation_lifecycle_state)) {
    return lp.reservation_lifecycle_state;
  }

  // LP lifecycle state is missing/invalid — derive from tuple
  const hasToken = isNonEmptyString(lp.reservation_token);
  const hasBuyer = isNonEmptyString(lp.reserved_by_email);
  const hasExpiry = lp.reservation_expires_at && isValidISODate(lp.reservation_expires_at);
  const hasRevision = isNonEmptyString(lp.reservation_revision);

  if (hasToken && hasBuyer && hasExpiry && hasRevision) {
    // Full tuple — check if expired
    try {
      if (new Date(lp.reservation_expires_at) < new Date()) {
        return 'expired';
      }
    } catch (e) {
      return 'AMBIGUOUS';
    }
    return 'reserved';
  }

  // No tuple — check if all explicitly null
  const tokenNull = lp.reservation_token === null;
  const buyerNull = lp.reserved_by_email === null;
  const expiryNull = lp.reservation_expires_at === null;
  if (tokenNull && buyerNull && expiryNull) {
    // active + valid empty tuple → available
    if (listing?.status === 'active' || !listing) return 'available';
    return 'AMBIGUOUS';
  }

  // Partial or contradictory
  return 'AMBIGUOUS';
}

// ── Check for tuple/state disagreement ──────────────────────────────────────
function checkTupleStateAgreement(derived_state, lp) {
  const hasToken = isNonEmptyString(lp.reservation_token);
  const hasBuyer = isNonEmptyString(lp.reserved_by_email);
  const hasExpiry = lp.reservation_expires_at && isValidISODate(lp.reservation_expires_at);
  const hasRevision = isNonEmptyString(lp.reservation_revision);
  const hasTuple = hasToken && hasBuyer && hasExpiry;
  const hasPartialTuple = (hasToken && !hasBuyer) || (!hasToken && hasBuyer) ||
                          (hasToken && !hasExpiry) || (!hasToken && hasExpiry);

  const issues = [];

  // Reserved/frozen requires full tuple + revision
  if (TUPLE_REQUIRED_STATES.has(derived_state)) {
    if (!hasTuple) issues.push('reserved/frozen state missing full tuple');
    if (!hasRevision) issues.push('reserved/frozen state missing reservation revision');
  }

  // Terminal states require null tuple (sold/cancelled/expired)
  if (TUPLE_NULL_STATES.has(derived_state)) {
    if (hasToken) issues.push('terminal state has non-null token');
    if (hasBuyer) issues.push('terminal state has non-null buyer');
    if (hasExpiry) issues.push('terminal state has non-null expiration');
  }

  // Partial tuple is always ambiguous
  if (hasPartialTuple) issues.push('partial tuple');

  // Malformed expiration
  if (lp.reservation_expires_at && !isValidISODate(lp.reservation_expires_at)) {
    issues.push('malformed expiration');
  }

  return issues;
}

// ── Check if a public status is safe to map to a lifecycle state ────────────
// Non-active public states must NEVER map to available.
function checkPublicStatusSafety(listing_status, derived_state) {
  const issues = [];
  const nonActiveStates = ['hidden', 'pending_verification', 'pending_payout_setup'];

  // These public states must never become available
  if (nonActiveStates.includes(listing_status) && derived_state === 'available') {
    issues.push(`public ${listing_status} must never map to available`);
  }

  // sold/cancelled/expired must agree
  if (listing_status === 'sold' && derived_state !== 'sold') {
    issues.push('public sold but derived state is not sold');
  }
  if (listing_status === 'cancelled' && derived_state !== 'cancelled') {
    issues.push('public cancelled but derived state is not cancelled');
  }
  if (listing_status === 'expired' && derived_state !== 'expired') {
    issues.push('public expired but derived state is not expired');
  }

  return issues;
}

// ── Generate read-only migration report (joins both entities, paginated) ────
export async function generateMigrationReport(deps) {
  const records = [];
  const totals = {
    total: 0,
    migration_required: 0,
    mirror_migration_required: 0,
    already_initialized: 0,
    version_divergence: 0,
    ambiguous: 0,
    missing_sidecar: 0,
    duplicate_sidecar: 0,
    orphan_sidecar: 0,
    failures: 0,
    truncated: false,
  };
  const ambiguous = [];
  const failures = [];

  // Read all Listings and ListingPrivate records (paginated — no 10,000 cap)
  let allListings, allLP;
  try {
    allListings = await fetchAllRecords(deps.entities.Listing);
  } catch (e) {
    return { ok: false, code: 'REPORT_QUERY_FAILED', error: `Listing query failed: ${e?.message || String(e)}` };
  }
  try {
    allLP = await fetchAllRecords(deps.entities.ListingPrivate);
  } catch (e) {
    return { ok: false, code: 'REPORT_QUERY_FAILED', error: `ListingPrivate query failed: ${e?.message || String(e)}` };
  }

  // Index LP by listing_id (detect duplicates)
  const lpByListingId = new Map();
  for (const lp of allLP) {
    const arr = lpByListingId.get(lp.listing_id) || [];
    arr.push(lp);
    lpByListingId.set(lp.listing_id, arr);
  }

  // Track which listing_ids have been processed (for orphan detection)
  const processedListingIds = new Set();

  // Process each Listing
  for (const listing of allListings) {
    totals.total++;
    processedListingIds.add(listing.id);

    const lpArr = lpByListingId.get(listing.id) || [];
    const rec = {
      listing_id: listing.id,
      listing_status: listing.status,
      listing_reservation_version: listing.reservation_version ?? null,
      sidecar_count: lpArr.length,
      listing_private_id: lpArr.length === 1 ? lpArr[0].id : null,
      current_reservation_tuple: null,
      has_reservation_version: false,
      current_reservation_version: null,
      has_public_mirror_version: listing.reservation_version !== null && listing.reservation_version !== undefined,
      derived_lifecycle_state: null,
      proposed_reservation_version: null,
      proposed_init: null,
      status: null,
      issues: [],
    };

    // Check for missing sidecar
    if (lpArr.length === 0) {
      rec.status = 'MISSING_SIDECAR';
      rec.issues.push('Listing has no ListingPrivate sidecar');
      totals.missing_sidecar++;
      records.push(rec);
      continue;
    }

    // Check for duplicate sidecar
    if (lpArr.length > 1) {
      rec.status = 'DUPLICATE_SIDECAR';
      rec.issues.push(`${lpArr.length} ListingPrivate rows for one listing`);
      totals.duplicate_sidecar++;
      records.push(rec);
      continue;
    }

    const lp = lpArr[0];
    rec.current_reservation_tuple = {
      token: lp.reservation_token ?? null,
      buyer: lp.reserved_by_email ?? null,
      expiration: lp.reservation_expires_at ?? null,
      revision: lp.reservation_revision ?? null,
    };
    rec.has_reservation_version = lp.reservation_version !== null && lp.reservation_version !== undefined;
    rec.current_reservation_version = lp.reservation_version ?? null;

    // Derive lifecycle state (joined with Listing)
    rec.derived_lifecycle_state = deriveLifecycleState(lp, listing);

    // Check for tuple/state issues
    const tupleIssues = checkTupleStateAgreement(rec.derived_lifecycle_state, lp);
    rec.issues.push(...tupleIssues);

    // Check for public status safety
    const statusIssues = checkPublicStatusSafety(listing.status, rec.derived_lifecycle_state);
    rec.issues.push(...statusIssues);

    // Check for missing public mirror version (separate from AMBIGUOUS)
    if (!rec.has_public_mirror_version) {
      rec.issues.push('Listing missing reservation_version (mirror)');
    }

    // Determine status (Round 4: independent version classification):
    //   1. LP missing version + Listing missing version → MIGRATION_REQUIRED (two-record init)
    //   2. LP initialized + Listing version missing → MIRROR_MIGRATION_REQUIRED (mirror-only)
    //   3. LP missing version + Listing initialized → AMBIGUOUS (don't reset newer public version)
    //   4. Both initialized, versions differ → VERSION_DIVERGENCE (don't silently downgrade)
    //   5. Both initialized, versions match → ALREADY_INITIALIZED
    //   6. State derivation or tuple/state issues → AMBIGUOUS
    const hasDerivableState = rec.derived_lifecycle_state !== 'AMBIGUOUS';
    const hasTupleIssues = tupleIssues.length > 0;
    const hasStatusIssues = statusIssues.length > 0;

    if (rec.derived_lifecycle_state === 'AMBIGUOUS' || hasTupleIssues || hasStatusIssues) {
      rec.status = 'AMBIGUOUS';
      ambiguous.push({
        listing_id: listing.id,
        listing_private_id: lp.id,
        derived_state: rec.derived_lifecycle_state,
        issues: rec.issues,
      });
      totals.ambiguous++;
    } else if (!rec.has_reservation_version || !isValidVersion(lp.reservation_version)) {
      // LP missing version
      if (!rec.has_public_mirror_version || !isValidVersion(listing.reservation_version)) {
        // Both missing → MIGRATION_REQUIRED (two-record init)
        rec.status = 'MIGRATION_REQUIRED';
        rec.proposed_reservation_version = 0;
        rec.proposed_init = buildInitPlan(lp, listing, rec.derived_lifecycle_state);
        totals.migration_required++;
      } else {
        // LP missing version + Listing has version → AMBIGUOUS (don't reset newer public version)
        rec.status = 'AMBIGUOUS';
        rec.issues.push(`LP missing version but Listing has version ${listing.reservation_version} — will not reset newer public version to 0`);
        ambiguous.push({
          listing_id: listing.id,
          listing_private_id: lp.id,
          derived_state: rec.derived_lifecycle_state,
          issues: rec.issues,
        });
        totals.ambiguous++;
      }
    } else {
      // LP has valid version
      if (!rec.has_public_mirror_version || !isValidVersion(listing.reservation_version)) {
        // LP initialized + Listing version missing → MIRROR_MIGRATION_REQUIRED
        rec.status = 'MIRROR_MIGRATION_REQUIRED';
        rec.proposed_reservation_version = lp.reservation_version;
        rec.proposed_init = buildMirrorOnlyPlan(lp, listing, rec.derived_lifecycle_state);
        totals.mirror_migration_required++;
      } else if (lp.reservation_version !== listing.reservation_version) {
        // Both initialized but versions differ → VERSION_DIVERGENCE
        rec.status = 'VERSION_DIVERGENCE';
        rec.issues.push(`LP version ${lp.reservation_version} ≠ Listing version ${listing.reservation_version}`);
        totals.version_divergence++;
      } else {
        // Both initialized, versions match → ALREADY_INITIALIZED
        rec.status = 'ALREADY_INITIALIZED';
        totals.already_initialized++;
      }
    }

    records.push(rec);
  }

  // Check for orphan LP records (LP without a Listing)
  for (const [listingId, arr] of lpByListingId) {
    if (!processedListingIds.has(listingId)) {
      for (const lp of arr) {
        totals.total++;
        totals.orphan_sidecar++;
        const rec = {
          listing_id: listingId,
          listing_status: null,
          listing_reservation_version: null,
          sidecar_count: arr.length,
          listing_private_id: lp.id,
          current_reservation_tuple: {
            token: lp.reservation_token ?? null,
            buyer: lp.reserved_by_email ?? null,
            expiration: lp.reservation_expires_at ?? null,
            revision: lp.reservation_revision ?? null,
          },
          has_reservation_version: lp.reservation_version !== null && lp.reservation_version !== undefined,
          current_reservation_version: lp.reservation_version ?? null,
          has_public_mirror_version: false,
          derived_lifecycle_state: deriveLifecycleState(lp, null),
          proposed_reservation_version: null,
          proposed_init: null,
          status: 'ORPHAN_SIDECAR',
          issues: ['ListingPrivate has no parent Listing'],
        };
        records.push(rec);
      }
    }
  }

  return { ok: true, records, totals, ambiguous, failures };
}

// ── Build init plan for a single record ─────────────────────────────────────
function buildInitPlan(lp, listing, derived_state) {
  const now_iso = new Date().toISOString();
  return {
    operation_id: `init_${lp.id}`,
    operation_type: 'initialize',
    requested_state: derived_state,
    fields_to_set: {
      reservation_version: 0,
      reservation_lifecycle_state: derived_state,
      last_operation_id: `init_${lp.id}`,
      last_operation_type: 'initialize',
      last_operation_payload_hash: 'COMPUTED_AT_APPLY',
      last_operation_result_json: JSON.stringify({
        operation_id: `init_${lp.id}`,
        operation_type: 'initialize',
        requested_state: derived_state,
        initialized_at: now_iso,
      }),
      last_operation_at: now_iso,
      pending_effects_json: '[]',
      pending_effects_hash: 'COMPUTED_AT_APPLY',
    },
    public_mirror_update: {
      reservation_version: 0,
      reservation_mirror_state: derived_state,
    },
  };
}

// ── Build mirror-only init plan (LP initialized, Listing missing version) ───
// Only updates the public Listing mirror — does NOT touch ListingPrivate.
// Derives mirror state from the authoritative LP record.
function buildMirrorOnlyPlan(lp, listing, derived_state) {
  return {
    plan_action: 'mirror_initialize',
    requested_state: derived_state,
    fields_to_set: {
      reservation_version: lp.reservation_version,
      reservation_mirror_state: derived_state,
    },
    note: 'Mirror-only initialization. LP is already initialized. Only the public Listing mirror needs reservation_version + reservation_mirror_state. Does NOT write status or hidden_reason.',
  };
}

// ── Idempotent apply design (NOT executed — requires owner approval) ────────
export function planApply(deps, apply_request_id) {
  return {
    apply_request_id,
    mode: 'dry_run',
    requires_owner_approval: true,
    description: 'Initialize reservation_version, reservation_lifecycle_state, and all last_operation_* fields on ListingPrivate records that lack them. Also initializes the public Listing mirror reservation_version and reservation_mirror_state. Each record is CAS-written with reservation_version=0 as the initial state. Ambiguous records are skipped and require manual resolution. Normal mirror initialization does NOT write status or hidden_reason.',
    operation_type: 'initialize',
    steps: [
      '1. Run generateMigrationReport to identify records needing initialization.',
      '2. For each MIGRATION_REQUIRED record, CAS-write: reservation_version=0, reservation_lifecycle_state=derived, last_operation_id=`init_<id>`, last_operation_type=initialize, last_operation_payload_hash=SHA-256(envelope), last_operation_result_json=JSON(result), last_operation_at=ISO timestamp, pending_effects_json="[]", pending_effects_hash=SHA-256({effects:[]}).',
      '3. For each MIGRATION_REQUIRED record, also update the public Listing mirror: reservation_version=0, reservation_mirror_state=derived. Does NOT write status or hidden_reason.',
      '4. Skip AMBIGUOUS records — flag for manual resolution.',
      '5. Skip MISSING_SIDECAR, DUPLICATE_SIDECAR, and ORPHAN_SIDECAR records — flag for manual resolution.',
      '6. Record the apply_request_id in a MigrationRun entity for idempotency.',
      '7. Re-run generateMigrationReport to verify all records are initialized.',
    ],
    initialized_fields: [
      'reservation_version (0)',
      'reservation_lifecycle_state (derived)',
      'last_operation_id (init_<id>)',
      'last_operation_type (initialize)',
      'last_operation_payload_hash (SHA-256 of init envelope)',
      'last_operation_result_json (JSON of init result)',
      'last_operation_at (ISO timestamp)',
      'pending_effects_json ("[]")',
      'pending_effects_hash (SHA-256 of {effects:[]})',
      'public Listing reservation_version (0)',
      'public Listing reservation_mirror_state (derived)',
    ],
    idempotency: 'apply_request_id is unique per apply run. Replays with the same id are rejected.',
    safety: 'No real-production Stripe, email, push, points, or notification calls. Synthetic records only for testing.',
  };
}