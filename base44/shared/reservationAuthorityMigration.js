/**
 * Reservation Authority Migration (7C.9C.2E Correction Round 2 — Defect 4)
 *
 * Read-only dry-run report that joins BOTH Listing and ListingPrivate.
 * Does NOT apply any migration. An idempotent apply design is provided
 * but requires explicit owner approval before execution.
 *
 * Round 2 corrections:
 *   - Examines bounded batches of both Listing and ListingPrivate.
 *   - Detects: missing sidecar, duplicate sidecar, orphan sidecar,
 *     missing/invalid private version, missing public mirror version,
 *     malformed expiration, partial tuple, reserved/frozen missing revision,
 *     tuple/state disagreement, public status vs proposed authority-state
 *     disagreement.
 *   - Lifecycle derivation: sold/cancelled/expired never become available;
 *     quarantined/recovery-blocked → frozen; reserved/frozen requires token,
 *     buyer, valid expiration, and revision; uncertain → AMBIGUOUS; unknown
 *     never available.
 *   - Apply plan uses `initialize` operation type (validated).
 *   - Dry-run plan specifies every initialized field.
 *
 * No Deno/Node-specific imports — pure ESM JavaScript.
 */
import {
  LIFECYCLE_STATES, TUPLE_REQUIRED_STATES, TUPLE_NULL_STATES,
  isValidISODate, isNonEmptyString, isValidVersion,
} from './reservationAuthorityConstants.js';

// ── Derive lifecycle state from LP + Listing (joined) ───────────────────────
// Rules:
//   - Public sold/cancelled/expired never become available.
//   - Quarantined or recovery-blocked → frozen.
//   - Reserved/frozen requires token, buyer, valid expiration, and revision.
//   - Any uncertain or contradictory case → AMBIGUOUS.
//   - Unknown must never be interpreted as available.
function deriveLifecycleState(lp, listing) {
  // Terminal public states never become available
  if (listing?.status === 'sold') return 'sold';
  if (listing?.status === 'cancelled') return 'cancelled';
  if (listing?.status === 'expired') return 'expired';

  // Quarantined or recovery-blocked → frozen
  if (lp?.checkout_quarantined === true || lp?.recovery_blocked === true) return 'frozen';

  if (!lp) return 'AMBIGUOUS';

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
    return 'available';
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

  // Terminal states require null tuple
  if (TUPLE_NULL_STATES.has(derived_state) && hasToken) {
    issues.push('terminal state has non-null token');
  }

  // Partial tuple is always ambiguous
  if (hasPartialTuple) issues.push('partial tuple');

  // Malformed expiration
  if (lp.reservation_expires_at && !isValidISODate(lp.reservation_expires_at)) {
    issues.push('malformed expiration');
  }

  return issues;
}

// ── Generate read-only migration report (joins both entities) ────────────────
export async function generateMigrationReport(deps) {
  const records = [];
  const totals = {
    total: 0,
    migration_required: 0,
    already_initialized: 0,
    ambiguous: 0,
    missing_sidecar: 0,
    duplicate_sidecar: 0,
    orphan_sidecar: 0,
    failures: 0,
  };
  const ambiguous = [];
  const failures = [];

  // Read all Listings and ListingPrivate records (bounded batches)
  let allListings, allLP;
  try {
    allListings = await deps.entities.Listing.list('-created_date', 10000);
  } catch (e) {
    return { ok: false, code: 'REPORT_QUERY_FAILED', error: `Listing query failed: ${e?.message || String(e)}` };
  }
  try {
    allLP = await deps.entities.ListingPrivate.list('-created_date', 10000);
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

    // Check for public status vs proposed authority-state disagreement
    if (listing.status === 'sold' && rec.derived_lifecycle_state !== 'sold') {
      rec.issues.push('public sold but derived state is not sold');
    }
    if (listing.status === 'cancelled' && rec.derived_lifecycle_state !== 'cancelled') {
      rec.issues.push('public cancelled but derived state is not cancelled');
    }
    if (listing.status === 'expired' && rec.derived_lifecycle_state !== 'expired') {
      rec.issues.push('public expired but derived state is not expired');
    }

    // Check for missing public mirror version
    if (!rec.has_public_mirror_version) {
      rec.issues.push('Listing missing reservation_version (mirror)');
    }

    // Determine status
    if (rec.issues.length > 0) {
      rec.status = 'AMBIGUOUS';
      ambiguous.push({
        listing_id: listing.id,
        listing_private_id: lp.id,
        derived_state: rec.derived_lifecycle_state,
        issues: rec.issues,
      });
      totals.ambiguous++;
    } else if (!rec.has_reservation_version || !isValidVersion(lp.reservation_version)) {
      rec.status = 'MIGRATION_REQUIRED';
      rec.proposed_reservation_version = 0;
      rec.proposed_init = buildInitPlan(lp, listing, rec.derived_lifecycle_state);
      totals.migration_required++;
    } else {
      rec.status = 'ALREADY_INITIALIZED';
      totals.already_initialized++;
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
      status: derived_state === 'frozen' ? 'hidden' : (derived_state === 'sold' ? 'sold' : (derived_state === 'cancelled' ? 'cancelled' : (derived_state === 'expired' ? 'expired' : 'active'))),
      hidden_reason: derived_state === 'frozen' ? 'checkout_quarantine' : null,
    },
  };
}

// ── Idempotent apply design (NOT executed — requires owner approval) ────────
export function planApply(deps, apply_request_id) {
  return {
    apply_request_id,
    mode: 'dry_run',
    requires_owner_approval: true,
    description: 'Initialize reservation_version, reservation_lifecycle_state, and all last_operation_* fields on ListingPrivate records that lack them. Also initializes the public Listing mirror version. Each record is CAS-written with reservation_version=0 as the initial state. Ambiguous records are skipped and require manual resolution.',
    operation_type: 'initialize',
    steps: [
      '1. Run generateMigrationReport to identify records needing initialization.',
      '2. For each MIGRATION_REQUIRED record, CAS-write: reservation_version=0, reservation_lifecycle_state=derived, last_operation_id=`init_<id>`, last_operation_type=initialize, last_operation_payload_hash=SHA-256(envelope), last_operation_result_json=JSON(result), last_operation_at=ISO timestamp, pending_effects_json="[]", pending_effects_hash=SHA-256({effects:[]}).',
      '3. For each MIGRATION_REQUIRED record, also update the public Listing mirror: reservation_version=0, status=derived public status, hidden_reason=derived hidden reason.',
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
      'public Listing status (derived)',
      'public Listing hidden_reason (derived)',
    ],
    idempotency: 'apply_request_id is unique per apply run. Replays with the same id are rejected.',
    safety: 'No real-production Stripe, email, push, points, or notification calls. Synthetic records only for testing.',
  };
}