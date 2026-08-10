/**
 * Reservation Authority — Single-authority CAS prototype (7C.9C.2E Correction Round 2)
 *
 * Round 2 corrections:
 *   1. Pending-effect clearing: pending_effects_hash field stored atomically with
 *      pending_effects_json. CAS predicate includes hash. Non-array effects
 *      rejected before datastore. Stale clearer cannot erase a different queue.
 *   2. Post-CAS verification failure triggers protection: quarantine LP, hide
 *      Listing, create AdminAlert, verify each step. PROTECTION_INCOMPLETE
 *      if any step fails. Corrupted tuple preserved.
 *   5. SHA-256 required (no FNV fallback). Whitespace-only rejection. Terminal-
 *      state explicit null requirement. Hashing/serialization failures caught.
 *
 * ListingPrivate is the sole authoritative row. Listing is a non-authoritative
 * projection (mirror) — see reservationAuthorityMirror.js.
 *
 * No Deno/Node-specific imports — pure ESM JavaScript.
 */
import {
  OPERATION_TYPES, LIFECYCLE_STATES, STATE_TRANSITIONS,
  TUPLE_REQUIRED_STATES, TUPLE_NULL_STATES,
  canonicalize, hashEnvelope, hashEffects, isValidVersion, isNonEmptyString,
  validateTransition, validateTuple, validatePendingEffectsArray,
  parsePendingEffects, validateLifecycleState,
  buildAuthoritativeSnapshot, validateIdempotentReplay,
  validateSnapshotCompleteness, TERMINAL_BUSINESS_STATUSES, shouldHideForProtection,
  isNonReservableStatus,
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

// ── Protection routine for corrupted authority ──────────────────────────────
// Called on verification query failure, record disappearance, or committed-
// field mismatch. Attempts to quarantine LP, hide Listing, create AdminAlert.
// Returns PROTECTION_INCOMPLETE with per-step evidence if any step fails.
// Preserves the corrupted tuple — does NOT overwrite it.
async function protectCorruptedAuthority(deps, listing_id, lp_id, reason, evidence) {
  const now_iso = new Date(deps.now()).toISOString();
  const steps = {};
  const incident_key = `verification_mismatch:${lp_id}`;

  // 1. Set LP quarantine + recovery_blocked (CAS: checkout_quarantined=false)
  try {
    await deps.entities.ListingPrivate.updateMany(
      { id: lp_id, checkout_quarantined: false },
      { $set: {
        checkout_quarantined: true,
        checkout_quarantine_reason: `VERIFICATION_MISMATCH: ${reason}`,
        checkout_quarantined_at: now_iso,
        recovery_blocked: true,
        recovery_blocked_reason: `VERIFICATION_MISMATCH: ${reason}`,
        recovery_blocked_at: now_iso,
      }}
    );
    steps.lp_quarantine_attempted = true;
  } catch (e) {
    steps.lp_quarantine_error = e?.message || String(e);
    steps.lp_quarantine_attempted = false;
  }

  // 2. Re-fetch LP and verify protection fields
  try {
    const rows = await deps.entities.ListingPrivate.filter({ id: lp_id });
    const lp = rows[0];
    if (lp) {
      steps.lp_quarantine_verified = lp.checkout_quarantined === true;
      steps.lp_recovery_blocked_verified = lp.recovery_blocked === true;
      steps.lp_reason_verified = typeof lp.checkout_quarantine_reason === 'string' &&
        lp.checkout_quarantine_reason.includes('VERIFICATION_MISMATCH');
      steps.lp_timestamp_verified = isNonEmptyString(lp.checkout_quarantined_at);
    } else {
      steps.lp_quarantine_verified = false;
      steps.lp_recovery_blocked_verified = false;
      steps.lp_reason_verified = false;
      steps.lp_disappeared = true;
    }
  } catch (e) {
    steps.lp_verify_error = e?.message || String(e);
    steps.lp_quarantine_verified = false;
    steps.lp_recovery_blocked_verified = false;
    steps.lp_reason_verified = false;
  }

  // 3. Round 5: Read current Listing status BEFORE hiding.
  //    Terminal statuses (sold/cancelled/expired) are already non-reservable and must be preserved.
  let currentStatus = null;
  try {
    const rows = await deps.entities.Listing.filter({ id: listing_id });
    const listing = rows[0];
    if (listing) currentStatus = listing.status;
  } catch (e) { /* non-fatal */ }
  const needsHide = shouldHideForProtection(currentStatus);
  steps.listing_status_before_protection = currentStatus;
  steps.needs_hide = needsHide;

  // 3a. Hide public Listing (only if NOT already terminal/business-held)
  //     Round 6: Use a STATUS-PRESERVING predicate to eliminate the terminal-status race.
  //     The predicate includes the exact observed status and hidden_reason so a
  //     concurrent terminal transition (e.g. sold) causes updated=0, not an overwrite.
  if (needsHide) {
    // Read the full Listing to capture exact hidden_reason (including null/omission semantics)
    let observedListing = null;
    try {
      const rows = await deps.entities.Listing.filter({ id: listing_id });
      observedListing = rows[0] || null;
    } catch (e) { /* non-fatal — will attempt with id-only fallback */ }

    const hidePredicate = { id: listing_id };
    if (observedListing) {
      hidePredicate.status = observedListing.status;
      // Include hidden_reason only if it has a value; omitting it from the predicate
      // would match any value. If the Listing has hidden_reason=null, we include it
      // to ensure we only hide if it's still null.
      if (observedListing.hidden_reason !== undefined) {
        hidePredicate.hidden_reason = observedListing.hidden_reason;
      }
    }

    let hideUpdated = 0;
    try {
      const hideResult = await deps.entities.Listing.updateMany(
        hidePredicate,
        { $set: { status: 'hidden', hidden_reason: 'checkout_quarantine' } }
      );
      hideUpdated = hideResult.updated || 0;
      steps.listing_hide_attempted = true;
      steps.hide_updated = hideUpdated;
    } catch (e) {
      steps.listing_hide_error = e?.message || String(e);
      steps.listing_hide_attempted = false;
      steps.hide_updated = 0;
    }

    // If hide returned 0, a concurrent transition may have changed the status.
    // Re-read and check if it's now terminal/business-held (preserve) or still reservable (retry).
    if (hideUpdated === 0) {
      let rereadListing = null;
      try {
        const rows = await deps.entities.Listing.filter({ id: listing_id });
        rereadListing = rows[0] || null;
      } catch (e) { /* non-fatal */ }

      if (rereadListing && isNonReservableStatus(rereadListing.status)) {
        // Concurrent transition made it non-reservable — preserve it
        steps.concurrent_terminal_preserved = true;
        steps.preserved_status = rereadListing.status;
        currentStatus = rereadListing.status;
      } else if (rereadListing && rereadListing.status === 'active') {
        // Still reservable — retry once with the new observed status
        const retryPredicate = { id: listing_id, status: 'active' };
        if (rereadListing.hidden_reason !== undefined) {
          retryPredicate.hidden_reason = rereadListing.hidden_reason;
        }
        try {
          const retryResult = await deps.entities.Listing.updateMany(
            retryPredicate,
            { $set: { status: 'hidden', hidden_reason: 'checkout_quarantine' } }
          );
          steps.hide_retry_updated = retryResult.updated || 0;
        } catch (e) {
          steps.hide_retry_error = e?.message || String(e);
        }
      }
    }
  } else {
    steps.listing_hide_attempted = false;
    steps.non_reservable_status_preserved = true;
  }

  // 4. Re-fetch Listing and verify it ended non-reservable
  try {
    const rows = await deps.entities.Listing.filter({ id: listing_id });
    const listing = rows[0];
    if (listing) {
      const isNonReservable = isNonReservableStatus(listing.status);
      steps.listing_non_reservable_verified = isNonReservable;
      if (needsHide && !steps.concurrent_terminal_preserved) {
        steps.listing_hidden_verified = listing.status === 'hidden';
        steps.listing_hidden_reason_verified = listing.hidden_reason === 'checkout_quarantine';
      } else if (steps.concurrent_terminal_preserved) {
        steps.listing_hidden_verified = isNonReservable;
        steps.listing_hidden_reason_verified = true;
      } else {
        steps.listing_hidden_verified = listing.status === currentStatus;
        steps.listing_hidden_reason_verified = true;
      }
    } else {
      steps.listing_hidden_verified = false;
      steps.listing_hidden_reason_verified = false;
      steps.listing_non_reservable_verified = false;
      steps.listing_disappeared = true;
    }
  } catch (e) {
    steps.listing_verify_error = e?.message || String(e);
    steps.listing_hidden_verified = false;
    steps.listing_hidden_reason_verified = false;
    steps.listing_non_reservable_verified = false;
  }

  // 5. Create/update incident AdminAlert
  if (deps.entities.AdminAlert) {
    try {
      const existing = await deps.entities.AdminAlert.filter({ incident_key });
      if (existing.length > 0) {
        await deps.entities.AdminAlert.update(existing[0].id, {
          occurrence_count: (existing[0].occurrence_count || 1) + 1,
          last_occurred_at: now_iso,
          description: `VERIFICATION_MISMATCH: ${reason}. Evidence: ${JSON.stringify(evidence).slice(0, 500)}`,
        });
        steps.admin_alert_created = false;
        steps.admin_alert_updated = true;
      } else {
        await deps.entities.AdminAlert.create({
          alert_type: 'admin_action_required',
          priority: 'critical',
          title: 'Reservation Authority Verification Mismatch',
          description: `VERIFICATION_MISMATCH: ${reason}. Evidence: ${JSON.stringify(evidence).slice(0, 500)}`,
          reference_id: listing_id,
          reference_type: 'listing',
          incident_key,
          occurrence_count: 1,
          last_occurred_at: now_iso,
          resolved: false,
        });
        steps.admin_alert_created = true;
        steps.admin_alert_updated = false;
      }
      steps.admin_alert_attempted = true;
    } catch (e) {
      steps.admin_alert_error = e?.message || String(e);
      steps.admin_alert_attempted = false;
    }
  } else {
    steps.admin_alert_skipped = true;
  }

  // 6. Verify exactly one unresolved alert with the incident key
  //    Honest limitation: alert deduplication is sequentially idempotent but
  //    not concurrently atomic — concurrent creates can produce duplicates.
  //    Report the count honestly; do not claim PROTECTED if verification fails.
  if (deps.entities.AdminAlert) {
    try {
      const alerts = await deps.entities.AdminAlert.filter({ incident_key, resolved: false });
      steps.admin_alert_count = alerts.length;
      steps.admin_alert_verified = alerts.length === 1 && alerts[0].priority === 'critical';
      if (alerts.length > 1) {
        steps.admin_alert_duplicate_detected = true;
      }
    } catch (e) {
      steps.admin_alert_verify_error = e?.message || String(e);
      steps.admin_alert_verified = false;
    }
  } else {
    steps.admin_alert_verified = false;
  }

  // Check if ALL critical protection steps verified (including alert)
  const hideVerified = needsHide
    ? (steps.listing_hidden_verified === true && steps.listing_hidden_reason_verified === true)
    : (steps.listing_hidden_verified === true && steps.listing_non_reservable_verified === true);
  const allVerified =
    steps.lp_quarantine_verified === true &&
    steps.lp_recovery_blocked_verified === true &&
    steps.lp_reason_verified === true &&
    steps.lp_timestamp_verified === true &&
    hideVerified &&
    steps.admin_alert_verified === true;

  return {
    protected: allVerified,
    steps,
    code: allVerified ? 'PROTECTED' : 'PROTECTION_INCOMPLETE',
    incident_key,
  };
}

// ── Factory ──────────────────────────────────────────────────────────────────
export function createReservationAuthority(deps) {
  if (!deps?.entities?.ListingPrivate) throw new Error('createReservationAuthority: ListingPrivate entity required');
  if (!deps?.entities?.Listing) throw new Error('createReservationAuthority: Listing entity required');

  // Normalize deps — ensure `now` and `generateId` are always available
  // for all downstream functions (protection, transitions, etc.)
  const now = deps.now || (() => Date.now());
  const generateId = deps.generateId || defaultGenerateId;
  const normalizedDeps = { ...deps, now, generateId };

  const { entities: { ListingPrivate, Listing } } = normalizedDeps;

  // ── transitionReservation ──────────────────────────────────────────────────
  async function transitionReservation(params) {
    const {
      listing_id, expected_version, operation_id, operation_type,
      payload, requested_state, pending_effects = [],
    } = params;

    // ── Step 1: Validate inputs BEFORE any datastore access ────────────────
    if (!isNonEmptyString(listing_id)) {
      return { ok: false, code: 'VALIDATION_ERROR', error: 'listing_id must be a nonempty string' };
    }
    if (!isValidVersion(expected_version)) {
      return { ok: false, code: 'VALIDATION_ERROR', error: 'expected_version must be a nonnegative integer' };
    }
    if (!isNonEmptyString(operation_id)) {
      return { ok: false, code: 'VALIDATION_ERROR', error: 'operation_id must be a nonempty string' };
    }
    if (!operation_type) {
      return { ok: false, code: 'VALIDATION_ERROR', error: 'missing operation_type' };
    }
    if (!OPERATION_TYPES.includes(operation_type)) {
      return { ok: false, code: 'VALIDATION_ERROR', error: `unknown operation_type: ${operation_type}` };
    }
    if (!requested_state) {
      return { ok: false, code: 'VALIDATION_ERROR', error: 'missing requested_state' };
    }
    if (!LIFECYCLE_STATES.includes(requested_state)) {
      return { ok: false, code: 'VALIDATION_ERROR', error: `unknown requested_state: ${requested_state}` };
    }

    // Validate pending_effects array before datastore access
    const effectsCheck = validatePendingEffectsArray(pending_effects);
    if (!effectsCheck.ok) {
      return { ok: false, code: 'VALIDATION_ERROR', error: effectsCheck.error };
    }

    // Validate tuple (before datastore access — zero reads on invalid input)
    const tupleCheck = validateTuple(requested_state, payload);
    if (!tupleCheck.valid) {
      return { ok: false, code: 'VALIDATION_ERROR', error: tupleCheck.error };
    }

    // ── Step 2: Compute envelope hash and effects hash ─────────────────────
    const envelope = {
      operation_type,
      requested_state,
      payload: payload || null,
      pending_effects: pending_effects || [],
    };
    let envelope_hash, effects_hash;
    try {
      envelope_hash = await hashEnvelope(envelope, deps.hashEnvelope);
      effects_hash = await hashEffects(pending_effects || [], deps.hashEnvelope);
    } catch (e) {
      return { ok: false, code: 'HASHING_FAILED', error: e?.message || String(e) };
    }

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
    const existingEffectsCheck = parsePendingEffects(lp.pending_effects_json);
    if (!existingEffectsCheck.ok) {
      return { ok: false, code: existingEffectsCheck.code, error: existingEffectsCheck.error };
    }

    // ── Step 6: Idempotent replay check (Round 4: validate before success) ─
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
      // Round 4: Validate stored state before returning idempotent success.
      // Corruption triggers fail-closed protection, never idempotent success.
      const replayValidation = await validateIdempotentReplay(
        lp, operation_id, envelope_hash,
        async (effects) => hashEffects(effects, deps.hashEnvelope)
      );
      if (!replayValidation.ok) {
        const protection = await protectCorruptedAuthority(normalizedDeps, listing_id, lp.id,
          `IDEMPOTENT_REPLAY_CORRUPT: ${replayValidation.code}: ${replayValidation.error}`,
          { operation_id, replay_validation: replayValidation });
        return {
          ok: false, code: replayValidation.code || 'REPLAY_CORRUPT',
          error: replayValidation.error,
          protection,
        };
      }
      return {
        ok: true, idempotent: true,
        operation_id, result: replayValidation.stored_result,
        version: lp.reservation_version,
        state: lp.reservation_lifecycle_state,
      };
    }

    // ── Step 7: Block if undelivered pending effects exist ──────────────────
    if (existingEffectsCheck.effects.length > 0) {
      return {
        ok: false, code: 'PENDING_EFFECTS_BLOCKED',
        error: `${existingEffectsCheck.effects.length} undelivered pending effect(s) — clear before transitioning`,
        pending_effects: existingEffectsCheck.effects,
        version: lp.reservation_version,
        last_operation_id: lp.last_operation_id,
      };
    }

    // ── Step 8: Version check ───────────────────────────────────────────────
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

    // ── Step 9: Validate current lifecycle state (fail-closed → protect) ────
    // Missing, empty, or invalid state must NEVER be treated as available.
    // Round 4: STATE_CORRUPT triggers protection (hide Listing + alert + verify).
    const stateCheck = validateLifecycleState(lp.reservation_lifecycle_state);
    if (!stateCheck.valid) {
      const protection = await protectCorruptedAuthority(normalizedDeps, listing_id, lp.id,
        `STATE_CORRUPT in transitionReservation: ${stateCheck.error}`,
        { state: lp.reservation_lifecycle_state, state_code: stateCheck.code });
      return {
        ok: false, code: 'STATE_CORRUPT',
        error: stateCheck.error, state_code: stateCheck.code,
        protection,
      };
    }
    const current_state = lp.reservation_lifecycle_state;
    const transitionCheck = validateTransition(operation_type, requested_state, current_state);
    if (!transitionCheck.valid) {
      return { ok: false, code: 'VALIDATION_ERROR', error: transitionCheck.error };
    }

    // ── Step 10: Perform conditional updateMany (CAS) ────────────────────────
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
      reservation_token: payload.token,
      reserved_by_email: payload.buyer,
      reservation_expires_at: payload.expiration,
    };

    if (deps.hooks?.beforeCAS) {
      try { await deps.hooks.beforeCAS(deps, listing_id); } catch (e) { /* non-fatal */ }
    }

    // ── Step 10: Perform conditional updateMany (CAS) ────────────────────────
    // Round 5: Validate snapshot completeness before CAS.
    // If the SDK omits undefined query keys, the CAS predicate would be weaker
    // than intended. Records with missing snapshot fields must be rejected.
    const snapshotCheck = validateSnapshotCompleteness(lp);
    if (!snapshotCheck.ok) {
      const protection = await protectCorruptedAuthority(normalizedDeps, listing_id, lp.id,
        `SNAPSHOT_INCOMPLETE: missing fields: ${snapshotCheck.missing.join(', ')}`,
        { missing_fields: snapshotCheck.missing });
      return {
        ok: false, code: 'SNAPSHOT_INCOMPLETE',
        error: `snapshot has missing fields: ${snapshotCheck.missing.join(', ')}`,
        missing: snapshotCheck.missing,
        protection,
      };
    }
    // Round 4: CAS predicate includes the COMPLETE authoritative snapshot
    // that informed the decision. This detects legacy writers who change
    // the tuple without incrementing version.
    const snapshot = buildAuthoritativeSnapshot(lp);
    let casResult;
    try {
      casResult = await ListingPrivate.updateMany(
        snapshot,
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
            pending_effects_hash: effects_hash,
          },
        }
      );
    } catch (e) {
      return { ok: false, code: 'CAS_ERROR', error: e?.message || String(e) };
    }

    const updated = casResult.updated || 0;

    if (updated > 0) {
      // ── Step 11: Verify ALL committed fields ──────────────────────────────
      if (deps.hooks?.afterCASWin) {
        try { await deps.hooks.afterCASWin(deps, listing_id); } catch (e) { /* non-fatal */ }
      }

      let verified;
      try {
        const rows = await ListingPrivate.filter({ listing_id });
        verified = rows[0] || null;
      } catch (e) {
        // Verification query failure — trigger protection
        const protection = await protectCorruptedAuthority(normalizedDeps, listing_id, lp.id, 'verification query failed', { error: e?.message });
        return {
          ok: false, code: 'VERIFICATION_FAILED',
          error: e?.message || String(e),
          protection,
        };
      }
      if (!verified) {
        // Record disappeared — trigger protection
        const protection = await protectCorruptedAuthority(normalizedDeps, listing_id, lp.id, 'record disappeared after CAS', {});
        return {
          ok: false, code: 'VERIFICATION_MISMATCH',
          error: 'record not found after CAS',
          protection,
        };
      }

      const expected = {
        reservation_version: new_version,
        reservation_lifecycle_state: requested_state,
        reservation_token: payload.token,
        reserved_by_email: payload.buyer,
        reservation_expires_at: payload.expiration,
        reservation_revision: revision,
        last_operation_id: operation_id,
        last_operation_type: operation_type,
        last_operation_payload_hash: envelope_hash,
        pending_effects_json: effects_json,
        pending_effects_hash: effects_hash,
      };

      const mismatches = [];
      for (const [field, exp] of Object.entries(expected)) {
        if (verified[field] !== exp) {
          mismatches.push(`${field}: expected ${JSON.stringify(exp)}, got ${JSON.stringify(verified[field])}`);
        }
      }

      if (mismatches.length > 0) {
        // Committed-field mismatch — trigger protection
        const protection = await protectCorruptedAuthority(
          normalizedDeps, listing_id, lp.id,
          `commit verification failed: ${mismatches.join('; ')}`,
          { mismatches, expected, actual: verified }
        );
        return {
          ok: false, code: 'VERIFICATION_MISMATCH',
          error: `commit verification failed: ${mismatches.join('; ')}`,
          mismatches,
          protection,
        };
      }

      return {
        ok: true, idempotent: false,
        operation_id, result, version: new_version,
        state: requested_state, verified: true,
      };
    }

    // ── Step 12: CAS lost — reread authoritatively ─────────────────────────
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

    if (reread.last_operation_id === operation_id) {
      if (reread.last_operation_payload_hash === envelope_hash) {
        // Round 4: Validate stored state before returning idempotent success.
        const replayValidation = await validateIdempotentReplay(
          reread, operation_id, envelope_hash,
          async (effects) => hashEffects(effects, deps.hashEnvelope)
        );
        if (!replayValidation.ok) {
          const protection = await protectCorruptedAuthority(normalizedDeps, listing_id, lp.id,
            `IDEMPOTENT_REPLAY_CORRUPT (reread): ${replayValidation.code}: ${replayValidation.error}`,
            { operation_id, replay_validation: replayValidation });
          return {
            ok: false, code: replayValidation.code || 'REPLAY_CORRUPT',
            error: replayValidation.error,
            protection,
          };
        }
        return {
          ok: true, idempotent: true,
          operation_id, result: replayValidation.stored_result,
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

  // ── clearPendingEffects — fail-closed CAS with pending_effects_hash ────────
  async function clearPendingEffects(params) {
    const { listing_id, expected_version, expected_operation_id, expected_effects_hash, expected_effects_json } = params;

    if (!isNonEmptyString(listing_id)) {
      return { ok: false, code: 'VALIDATION_ERROR', error: 'listing_id must be a nonempty string' };
    }
    if (!isValidVersion(expected_version)) {
      return { ok: false, code: 'VALIDATION_ERROR', error: 'expected_version must be a nonnegative integer' };
    }
    if (!isNonEmptyString(expected_operation_id)) {
      return { ok: false, code: 'VALIDATION_ERROR', error: 'expected_operation_id must be a nonempty string' };
    }
    if (!expected_effects_hash) {
      return { ok: false, code: 'VALIDATION_ERROR', error: 'missing expected_effects_hash' };
    }
    if (typeof expected_effects_json !== 'string') {
      return { ok: false, code: 'VALIDATION_ERROR', error: 'expected_effects_json must be a string (canonical JSON)' };
    }

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

    const current_effects_hash = await hashEffects(effectsCheck.effects, deps.hashEnvelope);
    if (current_effects_hash !== expected_effects_hash) {
      return {
        ok: false, code: 'EFFECTS_HASH_MISMATCH',
        error: 'current effects do not match expected hash — stale clearer',
        expected: expected_effects_hash,
        actual: current_effects_hash,
      };
    }

    // Also verify the stored pending_effects_hash field matches
    if (lp.pending_effects_hash && lp.pending_effects_hash !== expected_effects_hash) {
      return {
        ok: false, code: 'EFFECTS_HASH_MISMATCH',
        error: 'stored pending_effects_hash does not match expected — effects replaced',
        expected: expected_effects_hash,
        actual: lp.pending_effects_hash,
      };
    }

    // Compute empty effects hash for clearing
    let empty_effects_hash;
    try {
      empty_effects_hash = await hashEffects([], deps.hashEnvelope);
    } catch (e) {
      return { ok: false, code: 'HASHING_FAILED', error: e?.message || String(e) };
    }

    // Hook: beforeClearCAS (for barrier tests — fires between read and CAS)
    if (deps.hooks?.beforeClearCAS) {
      try { await deps.hooks.beforeClearCAS(deps, listing_id); } catch (e) { /* non-fatal */ }
    }

    // CAS: match id, reservation_version, last_operation_id, pending_effects_json AND hash
    // Both the exact canonical JSON and its hash are in the predicate so a
    // stale clearer cannot erase a replacement effects queue.
    let casResult;
    try {
      casResult = await ListingPrivate.updateMany(
        {
          id: lp.id,
          reservation_version: expected_version,
          last_operation_id: expected_operation_id,
          pending_effects_json: expected_effects_json,
          pending_effects_hash: expected_effects_hash,
        },
        { $set: {
          pending_effects_json: '[]',
          pending_effects_hash: empty_effects_hash,
        }}
      );
    } catch (e) {
      return { ok: false, code: 'CAS_ERROR', error: e?.message || String(e) };
    }

    const updated = casResult.updated || 0;
    if (updated === 0) {
      return { ok: false, code: 'CONFLICT', error: 'CAS lost — version, operation_id, or effects hash changed' };
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

    // Verify version, operation ID, JSON, and hash
    if (verified.reservation_version !== expected_version) {
      return { ok: false, code: 'VERIFY_MISMATCH', error: `version: expected ${expected_version}, got ${verified.reservation_version}` };
    }
    if (verified.last_operation_id !== expected_operation_id) {
      return { ok: false, code: 'VERIFY_MISMATCH', error: `operation_id: expected ${expected_operation_id}, got ${verified.last_operation_id}` };
    }
    if (verified.pending_effects_json !== '[]') {
      return { ok: false, code: 'VERIFY_MISMATCH', error: `pending_effects_json not cleared: ${verified.pending_effects_json}` };
    }
    if (verified.pending_effects_hash !== empty_effects_hash) {
      return { ok: false, code: 'VERIFY_MISMATCH', error: `pending_effects_hash not cleared: ${verified.pending_effects_hash}` };
    }

    return { ok: true, cleared: true, verified: true };
  }

  // ── getPendingEffects ───────────────────────────────────────────────────────
  async function getPendingEffects(listing_id) {
    if (!isNonEmptyString(listing_id)) {
      return { ok: false, code: 'VALIDATION_ERROR', error: 'listing_id must be a nonempty string' };
    }

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

    const effects_hash = await hashEffects(effectsCheck.effects, deps.hashEnvelope);

    return {
      ok: true,
      effects: effectsCheck.effects,
      effects_json: lp.pending_effects_json ?? '[]',
      version: lp.reservation_version,
      operation_id: lp.last_operation_id,
      effects_hash,
      stored_effects_hash: lp.pending_effects_hash ?? null,
    };
  }

  // ── Mirror functions ────────────────────────────────────────────────────────
  const mirror = createMirrorAuthority(normalizedDeps);

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