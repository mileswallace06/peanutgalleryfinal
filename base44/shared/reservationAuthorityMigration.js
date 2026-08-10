/**
 * Reservation Authority Migration (7C.9C.2E Correction — Defect 6)
 *
 * Read-only dry-run report for existing ListingPrivate records.
 * Does NOT apply any migration. An idempotent apply design is provided
 * but requires explicit owner approval before execution.
 *
 * Missing reservation_version → MIGRATION_REQUIRED (not generic CONFLICT).
 *
 * No Deno/Node-specific imports — pure ESM JavaScript.
 */
import {
  LIFECYCLE_STATES, TUPLE_REQUIRED_STATES, TUPLE_NULL_STATES, isValidISODate,
} from './reservationAuthorityConstants.js';

// ── Derive lifecycle state from current reservation tuple ───────────────────
function deriveLifecycleState(lp) {
  const hasToken = !!lp.reservation_token;
  const hasBuyer = !!lp.reserved_by_email;
  const hasExpiry = !!lp.reservation_expires_at;
  const hasTuple = hasToken && hasBuyer && hasExpiry;

  // Check existing fields that indicate state
  if (lp.checkout_quarantined === true) return 'frozen';
  if (lp.recovery_blocked === true) return 'frozen';

  if (hasTuple) {
    // Has a reservation tuple — check if expired
    if (lp.reservation_expires_at && new Date(lp.reservation_expires_at) < new Date()) {
      return 'expired';
    }
    return 'reserved';
  }
  // No tuple
  return 'available';
}

// ── Generate read-only migration report ─────────────────────────────────────
// Reads ALL ListingPrivate records and produces a dry-run report.
// Does NOT modify any records.
export async function generateMigrationReport(deps) {
  const records = [];
  const totals = {
    total: 0, migration_required: 0, already_initialized: 0,
    ambiguous: 0, missing_sidecar: 0, failures: 0,
  };
  const ambiguous = [];
  const failures = [];

  let allLP;
  try {
    allLP = await deps.entities.ListingPrivate.list('-created_date', 10000);
  } catch (e) {
    return { ok: false, code: 'REPORT_QUERY_FAILED', error: e?.message || String(e) };
  }

  for (const lp of allLP) {
    totals.total++;
    const rec = {
      listing_private_id: lp.id,
      listing_id: lp.listing_id,
      current_reservation_tuple: {
        token: lp.reservation_token ?? null,
        buyer: lp.reserved_by_email ?? null,
        expiration: lp.reservation_expires_at ?? null,
        revision: lp.reservation_revision ?? null,
      },
      has_reservation_version: lp.reservation_version !== null && lp.reservation_version !== undefined,
      current_reservation_version: lp.reservation_version ?? null,
      derived_lifecycle_state: null,
      proposed_reservation_version: null,
      proposed_last_operation_init: null,
      status: null,
    };

    // Derive lifecycle state
    rec.derived_lifecycle_state = deriveLifecycleState(lp);

    // Check for missing reservation_version
    if (!rec.has_reservation_version) {
      rec.status = 'MIGRATION_REQUIRED';
      rec.proposed_reservation_version = 0;
      rec.proposed_last_operation_init = {
        operation_id: `init_${lp.id}`,
        operation_type: 'initialize',
        requested_state: rec.derived_lifecycle_state,
      };
      totals.migration_required++;
    } else if (typeof lp.reservation_version !== 'number' || !Number.isInteger(lp.reservation_version) || lp.reservation_version < 0) {
      rec.status = 'MIGRATION_REQUIRED';
      rec.proposed_reservation_version = 0;
      rec.proposed_last_operation_init = {
        operation_id: `init_${lp.id}`,
        operation_type: 'initialize',
        requested_state: rec.derived_lifecycle_state,
      };
      totals.migration_required++;
    } else {
      // Already has a valid reservation_version
      rec.status = 'ALREADY_INITIALIZED';
      totals.already_initialized++;
    }

    // Check for ambiguous records (require quarantine/manual review)
    const tuple = rec.current_reservation_tuple;
    const hasPartialTuple = (tuple.token && !tuple.buyer) || (!tuple.token && tuple.buyer) ||
                            (tuple.token && !tuple.expiration) || (!tuple.token && tuple.expiration);
    const hasConflictingState = (TUPLE_REQUIRED_STATES.has(rec.derived_lifecycle_state) && !tuple.token) ||
                                  (TUPLE_NULL_STATES.has(rec.derived_lifecycle_state) && tuple.token);

    if (hasPartialTuple || hasConflictingState) {
      rec.status = 'AMBIGUOUS';
      rec.reason = hasPartialTuple ? 'partial tuple' : 'tuple/state conflict';
      ambiguous.push({
        listing_private_id: lp.id,
        listing_id: lp.listing_id,
        derived_state: rec.derived_lifecycle_state,
        tuple,
        reason: rec.reason,
      });
      totals.ambiguous++;
    }

    records.push(rec);
  }

  return { ok: true, records, totals, ambiguous, failures };
}

// ── Idempotent apply design (NOT executed — requires owner approval) ────────
// This function returns the apply PLAN. It does NOT execute any writes.
// Execution requires explicit owner approval and a separate gated function.
export function planApply(deps, apply_request_id) {
  return {
    apply_request_id,
    mode: 'dry_run',
    requires_owner_approval: true,
    description: 'Initialize reservation_version and last_operation_* on ListingPrivate records that lack them. Each record is CAS-written with reservation_version=0 as the initial state. Ambiguous records are skipped and require manual resolution.',
    steps: [
      '1. Run generateMigrationReport to identify records needing initialization.',
      '2. For each MIGRATION_REQUIRED record, CAS-write reservation_version=0, reservation_lifecycle_state=derived, last_operation_id=`init_<id>`, last_operation_type=initialize.',
      '3. Skip AMBIGUOUS records — flag for manual resolution.',
      '4. Record the apply_request_id in a MigrationRun entity for idempotency.',
      '5. Re-run generateMigrationReport to verify all records are initialized.',
    ],
    idempotency: 'apply_request_id is unique per apply run. Replays with the same id are rejected.',
    safety: 'No real-production Stripe, email, push, points, or notification calls. Synthetic records only for testing.',
  };
}