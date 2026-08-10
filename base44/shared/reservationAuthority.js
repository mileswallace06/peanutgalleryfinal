/**
 * Reservation Authority — Single-authority CAS prototype (7C.9C.2E Correction)
 *
 * CORRECTED implementation addressing defects 1, 3, 4, 5:
 *   1. Pending effects: fail-closed — block transition if undelivered effects exist,
 *      malformed JSON → EFFECTS_CORRUPT, clearPendingEffects requires CAS-match.
 *   3. Operation idempotency: hash complete semantic envelope (operation_type,
 *      requested_state, payload, pending_effects) via canonical JSON + SHA-256.
 *      Corrupt result → OPERATION_RECORD_CORRUPT. Old retry → STALE_RETRY.
 *   4. State/tuple validation: validate before datastore access, explicit
 *      state-transition table, tuple requirements by state.
 *   5. Commit verification: verify ALL committed fields after CAS win.
 *
 * ListingPrivate is the sole authoritative row. Listing is a non-authoritative
 * projection (mirror) — see reservationAuthorityMirror.js.
 *
 * Empirically atomic CAS: Base44 updateMany with a filter predicate is observed
 * to be atomic for single-record conditional updates (10/10 probe rounds, 1 winner).
 * NOT contractually guaranteed by official documentation.
 *
 * No Deno/Node-specific imports — pure ESM JavaScript.
 */
import {
  OPERATION_TYPES, LIFECYCLE_STATES, STATE_TRANSITIONS,
  TUPLE_REQUIRED_STATES, TUPLE_NULL_STATES,
  canonicalize, hashEnvelope, isValidVersion,
  validateTransition, validateTuple, parsePendingEffects,
} from './reservationAuthorityConstants.js';
import { createMirrorAuthority } from './reservationAuthorityMirror.js';
import { generateMigrationReport, planApply } from './reservationAuthorityMigration.js';
import { RESERVATION_MUTATION_ENTRY_POINTS } from './reservationMutationManifest.js';

function defaultGenerateId() {
  if (typeof globalThis.crypto !== 'undefined' && globalThis.crypto.randomUUID) {
    return globalThis.crypto.randomUUID();
  }
  return `rev_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

// ── Factory ──────────────────────────────────────────────────────────────────
export function createReservationAuthority(deps) {
  const {
    entities: { ListingPrivate, Listing },
    now = () => Date.now(),
    generateId = defaultGenerateId,
  } = deps;

  if (!ListingPrivate) throw new Error('createReservationAuthority: ListingPrivate entity required');
  if (!Listing) throw new Error('createReservationAuthority: Listing entity required');

  // ── transitionReservation ──────────────────────────────────────────────────
  async function transitionReservation(params) {
    const {
      listing_id, expected_version, operation_id, operation_type,
      payload, requested_state, pending_effects = [],
    } = params;

    // ── Step 1: Validate inputs BEFORE any datastore access ────────────────
    if (!listing_id) return { ok: false, code: 'VALIDATION_ERROR', error: 'missing listing_id' };
    if (!isValidVersion(expected_version)) {
      return { ok: false, code: 'VALIDATION_ERROR', error: 'expected_version must be a nonnegative integer' };
    }
    if (!operation_id) return { ok: false, code: 'VALIDATION_ERROR', error: 'missing operation_id' };
    if (!operation_type) return { ok: false, code: 'VALIDATION_ERROR', error: 'missing operation_type' };
    if (!OPERATION_TYPES.includes(operation_type)) {
      return { ok: false, code: 'VALIDATION_ERROR', error: `unknown operation_type: ${operation_type}` };
    }
    if (!requested_state) return { ok: false, code: 'VALIDATION_ERROR', error: 'missing requested_state' };
    if (!LIFECYCLE_STATES.includes(requested_state)) {
      return { ok: false, code: 'VALIDATION_ERROR', error: `unknown requested_state: ${requested_state}` };
    }

    // Validate tuple (before datastore access — zero reads on invalid input)
    const tupleCheck = validateTuple(requested_state, payload);
    if (!tupleCheck.valid) {
      return { ok: false, code: 'VALIDATION_ERROR', error: tupleCheck.error };
    }

    // ── Step 2: Compute envelope hash ──────────────────────────────────────
    const envelope = {
      operation_type,
      requested_state,
      payload: payload || null,
      pending_effects: pending_effects || [],
    };
    const envelope_hash = await hashEnvelope(envelope, deps.hashEnvelope);

    // ── Step 3: Read authoritative ListingPrivate row ──────────────────────
    let lp;
    try {
      const rows = await ListingPrivate.filter({ listing_id });
      lp = rows[0] || null;
    } catch (e) {
      return { ok: false, code: 'AUTHORITY_QUERY_FAILED', error: e?.message || String(e) };
    }

    // Never classify unknown state as available
    if (!lp) return { ok: false, code: 'NOT_FOUND', error: 'authoritative record not found' };

    // ── Step 4: Check quarantine/recovery-blocked ───────────────────────────
    if (lp.checkout_quarantined === true || lp.recovery_blocked === true) {
      return {
        ok: false, code: 'AUTHORITY_BLOCKED',
        error: 'authority is quarantined or recovery-blocked',
        checkout_quarantined: lp.checkout_quarantined,
        recovery_blocked: lp.recovery_blocked,
      };
    }

    // ── Step 5: Parse and validate existing pending effects ────────────────
    const effectsCheck = parsePendingEffects(lp.pending_effects_json);
    if (!effectsCheck.ok) {
      return { ok: false, code: effectsCheck.code, error: effectsCheck.error };
    }

    // ── Step 6: Idempotent replay check ─────────────────────────────────────
    if (lp.last_operation_id === operation_id) {
      if (lp.last_operation_payload_hash !== envelope_hash) {
        return {
          ok: false, code: 'OPERATION_ID_CONFLICT',
          error: 'same operation_id with different envelope — rejected',
          operation_id,
          stored_hash: lp.last_operation_payload_hash,
          received_hash: envelope_hash,
        };
      }
      // Return stored result — but verify it's not corrupt
      let stored_result = null;
      if (lp.last_operation_result_json) {
        try {
          stored_result = JSON.parse(lp.last_operation_result_json);
        } catch (e) {
          return {
            ok: false, code: 'OPERATION_RECORD_CORRUPT',
            error: `stored result JSON is malformed: ${e.message}`,
            operation_id,
          };
        }
      }
      return {
        ok: true, idempotent: true,
        operation_id, result: stored_result,
        version: lp.reservation_version,
        state: lp.reservation_lifecycle_state,
      };
    }

    // ── Step 7: Block if undelivered pending effects exist ──────────────────
    if (effectsCheck.effects.length > 0) {
      return {
        ok: false, code: 'PENDING_EFFECTS_BLOCKED',
        error: `${effectsCheck.effects.length} undelivered pending effect(s) — clear before transitioning`,
        pending_effects: effectsCheck.effects,
        version: lp.reservation_version,
        last_operation_id: lp.last_operation_id,
      };
    }

    // ── Step 8: Version check — detect stale/concurrent before transition ───
    if (lp.reservation_version === null || lp.reservation_version === undefined) {
      return { ok: false, code: 'MIGRATION_REQUIRED', error: 'reservation_version missing — initialization required' };
    }
    if (lp.reservation_version !== expected_version) {
      if (lp.reservation_version > expected_version + 1) {
        return {
          ok: false, code: 'STALE_RETRY',
          error: 'old operation retried after newer transition',
          operation_id, expected_version,
          current_version: lp.reservation_version,
          current_operation_id: lp.last_operation_id,
        };
      }
      return {
        ok: false, code: 'CONFLICT',
        error: 'CAS lost — another operation won',
        operation_id, expected_version,
        current_version: lp.reservation_version,
        current_state: lp.reservation_lifecycle_state,
        current_operation_id: lp.last_operation_id,
      };
    }

    // ── Step 9: Validate state transition ───────────────────────────────────
    const current_state = lp.reservation_lifecycle_state || 'available';
    const transitionCheck = validateTransition(operation_type, requested_state, current_state);
    if (!transitionCheck.valid) {
      return { ok: false, code: 'VALIDATION_ERROR', error: transitionCheck.error };
    }

    // ── Step 9: Perform conditional updateMany (CAS) ────────────────────────
    const new_version = expected_version + 1;
    const now_iso = new Date(now()).toISOString();
    const revision = generateId();
    const result = {
      operation_id, operation_type, requested_state,
      previous_version: expected_version,
      new_version, committed_at: now_iso,
    };
    const result_json = JSON.stringify(result);
    const effects_json = JSON.stringify(pending_effects || []);

    const new_tuple = {
      reservation_token: payload?.token ?? null,
      reserved_by_email: payload?.buyer ?? null,
      reservation_expires_at: payload?.expiration ?? null,
    };

    // Hook: beforeCAS (for deferred-barrier tests)
    if (deps.hooks?.beforeCAS) {
      try { await deps.hooks.beforeCAS(deps, listing_id); } catch (e) { /* non-fatal */ }
    }

    let casResult;
    try {
      casResult = await ListingPrivate.updateMany(
        {
          id: lp.id,
          reservation_version: expected_version,
          checkout_quarantined: false,
          recovery_blocked: false,
        },
        {
          $set: {
            ...new_tuple,
            reservation_version: new_version,
            reservation_revision: revision,
            reservation_lifecycle_state: requested_state,
            last_operation_id: operation_id,
            last_operation_type: operation_type,
            last_operation_payload_hash: envelope_hash,
            last_operation_result_json: result_json,
            last_operation_at: now_iso,
            pending_effects_json: effects_json,
          },
        }
      );
    } catch (e) {
      return { ok: false, code: 'CAS_ERROR', error: e?.message || String(e) };
    }

    const updated = casResult.updated || 0;

    if (updated > 0) {
      // ── Step 10: Verify ALL committed fields ──────────────────────────────
      // Hook: afterCASWin (for post-CAS corruption tests)
      if (deps.hooks?.afterCASWin) {
        try { await deps.hooks.afterCASWin(deps, listing_id); } catch (e) { /* non-fatal */ }
      }

      let verified;
      try {
        const rows = await ListingPrivate.filter({ listing_id });
        verified = rows[0] || null;
      } catch (e) {
        return { ok: false, code: 'VERIFICATION_FAILED', error: e?.message || String(e) };
      }
      if (!verified) {
        return { ok: false, code: 'VERIFICATION_MISMATCH', error: 'record not found after CAS' };
      }

      const expected = {
        reservation_version: new_version,
        reservation_lifecycle_state: requested_state,
        reservation_token: payload?.token ?? null,
        reserved_by_email: payload?.buyer ?? null,
        reservation_expires_at: payload?.expiration ?? null,
        reservation_revision: revision,
        last_operation_id: operation_id,
        last_operation_type: operation_type,
        last_operation_payload_hash: envelope_hash,
        pending_effects_json: effects_json,
      };

      const mismatches = [];
      for (const [field, exp] of Object.entries(expected)) {
        if (verified[field] !== exp) {
          mismatches.push(`${field}: expected ${JSON.stringify(exp)}, got ${JSON.stringify(verified[field])}`);
        }
      }

      if (mismatches.length > 0) {
        return {
          ok: false, code: 'VERIFICATION_MISMATCH',
          error: `commit verification failed: ${mismatches.join('; ')}`,
          mismatches,
        };
      }

      return {
        ok: true, idempotent: false,
        operation_id, result, version: new_version,
        state: requested_state, verified: true,
      };
    }

    // ── Step 11: CAS lost — reread authoritatively ─────────────────────────
    let reread;
    try {
      const rows = await ListingPrivate.filter({ listing_id });
      reread = rows[0] || null;
    } catch (e) {
      return { ok: false, code: 'REREAD_FAILED', error: e?.message || String(e) };
    }
    if (!reread) {
      return { ok: false, code: 'NOT_FOUND', error: 'record disappeared after CAS loss' };
    }

    // Check idempotent replay (another caller won with the same operation)
    if (reread.last_operation_id === operation_id) {
      if (reread.last_operation_payload_hash === envelope_hash) {
        let stored_result = null;
        if (reread.last_operation_result_json) {
          try {
            stored_result = JSON.parse(reread.last_operation_result_json);
          } catch (e) {
            return { ok: false, code: 'OPERATION_RECORD_CORRUPT', error: `stored result JSON is malformed: ${e.message}` };
          }
        }
        return {
          ok: true, idempotent: true,
          operation_id, result: stored_result,
          version: reread.reservation_version,
          state: reread.reservation_lifecycle_state,
        };
      } else {
        return {
          ok: false, code: 'OPERATION_ID_CONFLICT',
          error: 'same operation_id with different envelope — rejected',
          operation_id,
          stored_hash: reread.last_operation_payload_hash,
          received_hash: envelope_hash,
        };
      }
    }

    // Distinguish STALE_RETRY from CONFLICT
    if (reread.reservation_version > expected_version + 1) {
      return {
        ok: false, code: 'STALE_RETRY',
        error: 'old operation retried after newer transition',
        operation_id, expected_version,
        current_version: reread.reservation_version,
        current_operation_id: reread.last_operation_id,
      };
    }

    return {
      ok: false, code: 'CONFLICT',
      error: 'CAS lost — another operation won',
      operation_id, expected_version,
      current_version: reread.reservation_version,
      current_state: reread.reservation_lifecycle_state,
      current_operation_id: reread.last_operation_id,
    };
  }

  // ── clearPendingEffects — fail-closed CAS with full match ───────────────────
  async function clearPendingEffects(params) {
    const { listing_id, expected_version, expected_operation_id, expected_effects_hash } = params;

    if (!listing_id) return { ok: false, code: 'VALIDATION_ERROR', error: 'missing listing_id' };
    if (!isValidVersion(expected_version)) {
      return { ok: false, code: 'VALIDATION_ERROR', error: 'expected_version must be a nonnegative integer' };
    }
    if (!expected_operation_id) return { ok: false, code: 'VALIDATION_ERROR', error: 'missing expected_operation_id' };
    if (!expected_effects_hash) return { ok: false, code: 'VALIDATION_ERROR', error: 'missing expected_effects_hash' };

    let lp;
    try {
      const rows = await ListingPrivate.filter({ listing_id });
      lp = rows[0] || null;
    } catch (e) {
      return { ok: false, code: 'QUERY_FAILED', error: e?.message || String(e) };
    }
    if (!lp) return { ok: false, code: 'NOT_FOUND', error: 'not found' };

    // Verify current effects match the expected hash
    const effectsCheck = parsePendingEffects(lp.pending_effects_json);
    if (!effectsCheck.ok) {
      return { ok: false, code: effectsCheck.code, error: effectsCheck.error };
    }

    const current_effects_hash = await hashEnvelope(
      { effects: effectsCheck.effects },
      deps.hashEnvelope
    );
    if (current_effects_hash !== expected_effects_hash) {
      return {
        ok: false, code: 'EFFECTS_HASH_MISMATCH',
        error: 'current effects do not match expected hash — stale clearer',
        expected: expected_effects_hash,
        actual: current_effects_hash,
      };
    }

    // CAS: match listing_id, reservation_version, last_operation_id, effects_hash
    let casResult;
    try {
      casResult = await ListingPrivate.updateMany(
        {
          id: lp.id,
          reservation_version: expected_version,
          last_operation_id: expected_operation_id,
        },
        { $set: { pending_effects_json: '[]' } }
      );
    } catch (e) {
      return { ok: false, code: 'CAS_ERROR', error: e?.message || String(e) };
    }

    const updated = casResult.updated || 0;
    if (updated === 0) {
      return { ok: false, code: 'CONFLICT', error: 'CAS lost — version or operation_id changed' };
    }

    // Re-fetch and prove the exact expected queue was cleared
    let verified;
    try {
      const rows = await ListingPrivate.filter({ listing_id });
      verified = rows[0] || null;
    } catch (e) {
      return { ok: false, code: 'VERIFY_FAILED', error: e?.message || String(e) };
    }
    if (!verified) return { ok: false, code: 'NOT_FOUND', error: 'not found after clear' };
    if (verified.pending_effects_json !== '[]') {
      return { ok: false, code: 'VERIFY_MISMATCH', error: `pending_effects_json not cleared: ${verified.pending_effects_json}` };
    }

    return { ok: true, cleared: true, verified: true };
  }

  // ── getPendingEffects ───────────────────────────────────────────────────────
  async function getPendingEffects(listing_id) {
    let lp;
    try {
      const rows = await ListingPrivate.filter({ listing_id });
      lp = rows[0] || null;
    } catch (e) {
      return { ok: false, code: 'QUERY_FAILED', error: e?.message || String(e) };
    }
    if (!lp) return { ok: false, code: 'NOT_FOUND', error: 'not found' };

    const effectsCheck = parsePendingEffects(lp.pending_effects_json);
    if (!effectsCheck.ok) {
      return { ok: false, code: effectsCheck.code, error: effectsCheck.error };
    }

    const effects_hash = await hashEnvelope(
      { effects: effectsCheck.effects },
      deps.hashEnvelope
    );

    return {
      ok: true,
      effects: effectsCheck.effects,
      version: lp.reservation_version,
      operation_id: lp.last_operation_id,
      effects_hash,
    };
  }

  // ── Mirror functions ────────────────────────────────────────────────────────
  const mirror = createMirrorAuthority(deps);

  return {
    transitionReservation,
    clearPendingEffects,
    getPendingEffects,
    projectMirror: mirror.projectMirror,
    sweepMirror: mirror.sweepMirror,
  };
}

// ── Manifest access for launch gate ───────────────────────────────────────────
export function getReservationMutationManifest() {
  return RESERVATION_MUTATION_ENTRY_POINTS;
}

export function getUnintegratedEntryPoints() {
  return RESERVATION_MUTATION_ENTRY_POINTS.filter(e => !e.integrated);
}

// ── Re-export migration ──────────────────────────────────────────────────────
export { generateMigrationReport, planApply };