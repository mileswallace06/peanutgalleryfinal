/**
 * Reservation Authority — Single-authority CAS prototype (7C.9C.2E Task 3)
 *
 * Injected-dependency API suitable for testing. Generic transitionReservation
 * function — not reserve-only. ListingPrivate is the sole authoritative row.
 * Listing is a non-authoritative projection (mirror).
 *
 * Empirically atomic CAS: Base44 updateMany with a filter predicate is observed
 * to be atomic for single-record conditional updates (10/10 probe rounds, 1 winner).
 * NOT contractually guaranteed by official documentation.
 */
import { RESERVATION_MUTATION_ENTRY_POINTS } from './reservationMutationManifest.js';

// ── Default deterministic payload hash (djb2) ────────────────────────────────
function defaultHashPayload(payload) {
  if (!payload) return 'h_null';
  const sorted = JSON.stringify(payload, Object.keys(payload).sort());
  let hash = 5381;
  for (let i = 0; i < sorted.length; i++) {
    hash = ((hash << 5) + hash) + sorted.charCodeAt(i);
    hash = hash & 0xFFFFFFFF;
  }
  return `h_${(hash >>> 0).toString(36)}`;
}

function defaultGenerateId() {
  if (typeof globalThis.crypto !== 'undefined' && globalThis.crypto.randomUUID) {
    return globalThis.crypto.randomUUID();
  }
  return `id_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

// ── Factory ──────────────────────────────────────────────────────────────────
export function createReservationAuthority(deps) {
  const {
    entities: { ListingPrivate, Listing },
    now = () => Date.now(),
    generateId = defaultGenerateId,
    hashPayload = defaultHashPayload,
  } = deps;

  if (!ListingPrivate) throw new Error('createReservationAuthority: ListingPrivate entity required');
  if (!Listing) throw new Error('createReservationAuthority: Listing entity required');

  // ── transitionReservation ──────────────────────────────────────────────────
  async function transitionReservation(params) {
    const {
      listing_id,
      expected_version,
      operation_id,
      operation_type,
      payload,
      requested_state,
      pending_effects = [],
    } = params;

    // 1. Validate inputs
    if (!listing_id) return { ok: false, error: 'missing listing_id', code: 'VALIDATION_ERROR' };
    if (typeof expected_version !== 'number' || !Number.isFinite(expected_version)) {
      return { ok: false, error: 'expected_version must be a finite number', code: 'VALIDATION_ERROR' };
    }
    if (!operation_id) return { ok: false, error: 'missing operation_id', code: 'VALIDATION_ERROR' };
    if (!operation_type) return { ok: false, error: 'missing operation_type', code: 'VALIDATION_ERROR' };
    if (!requested_state) return { ok: false, error: 'missing requested_state', code: 'VALIDATION_ERROR' };

    const payload_hash = hashPayload(payload);

    // 2. Read the authoritative ListingPrivate row
    let lp;
    try {
      const rows = await ListingPrivate.filter({ listing_id });
      lp = rows[0] || null;
    } catch (e) {
      return { ok: false, error: `authoritative query failed: ${e?.message || e}`, code: 'AUTHORITY_QUERY_FAILED' };
    }

    // Never classify unknown state as available
    if (!lp) {
      return { ok: false, error: 'authoritative record not found', code: 'NOT_FOUND' };
    }

    // 3. Idempotent replay check — if last_operation_id matches
    if (lp.last_operation_id === operation_id) {
      if (lp.last_operation_payload_hash !== payload_hash) {
        return {
          ok: false,
          error: 'same operation_id with different payload — rejected',
          code: 'OPERATION_ID_CONFLICT',
          operation_id,
          stored_payload_hash: lp.last_operation_payload_hash,
          received_payload_hash: payload_hash,
        };
      }
      let stored_result = null;
      try { stored_result = lp.last_operation_result_json ? JSON.parse(lp.last_operation_result_json) : null; } catch (_) {}
      return {
        ok: true,
        idempotent: true,
        operation_id,
        result: stored_result,
        version: lp.reservation_version,
        state: lp.reservation_lifecycle_state,
      };
    }

    // Check quarantine/recovery-blocked state
    if (lp.checkout_quarantined === true || lp.recovery_blocked === true) {
      return {
        ok: false,
        error: 'authority is quarantined or recovery-blocked',
        code: 'AUTHORITY_BLOCKED',
        checkout_quarantined: lp.checkout_quarantined,
        recovery_blocked: lp.recovery_blocked,
      };
    }

    // 4. Perform one conditional updateMany (CAS)
    const new_version = expected_version + 1;
    const now_iso = new Date(now()).toISOString();
    const result = {
      operation_id,
      operation_type,
      requested_state,
      previous_version: expected_version,
      new_version,
      committed_at: now_iso,
    };
    const result_json = JSON.stringify(result);
    const pending_effects_json = JSON.stringify(pending_effects);

    const new_tuple = {
      reservation_token: payload?.token ?? null,
      reserved_by_email: payload?.buyer ?? null,
      reservation_expires_at: payload?.expiration ?? null,
    };

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
            reservation_revision: generateId(),
            reservation_lifecycle_state: requested_state,
            last_operation_id: operation_id,
            last_operation_type: operation_type,
            last_operation_payload_hash: payload_hash,
            last_operation_result_json: result_json,
            last_operation_at: now_iso,
            pending_effects_json,
          },
        }
      );
    } catch (e) {
      return { ok: false, error: `CAS failed: ${e?.message || e}`, code: 'CAS_ERROR' };
    }

    const updated = casResult.updated || 0;

    if (updated > 0) {
      // 7. Verify the committed authoritative state after a winner
      let verified;
      try {
        const verifyRows = await ListingPrivate.filter({ listing_id });
        verified = verifyRows[0] || null;
      } catch (e) {
        return { ok: false, error: `verification query failed: ${e?.message || e}`, code: 'VERIFICATION_FAILED' };
      }

      if (!verified || verified.reservation_version !== new_version ||
          verified.last_operation_id !== operation_id) {
        return { ok: false, error: 'verification mismatch after CAS win', code: 'VERIFICATION_MISMATCH' };
      }

      return {
        ok: true,
        idempotent: false,
        operation_id,
        result,
        version: new_version,
        state: requested_state,
        verified: true,
      };
    }

    // 6. CAS lost (updated=0) — reread authoritatively
    let reread;
    try {
      const rereadRows = await ListingPrivate.filter({ listing_id });
      reread = rereadRows[0] || null;
    } catch (e) {
      return { ok: false, error: `reread query failed: ${e?.message || e}`, code: 'REREAD_FAILED' };
    }

    if (!reread) {
      return { ok: false, error: 'authoritative record disappeared after CAS loss', code: 'NOT_FOUND' };
    }

    if (reread.last_operation_id === operation_id && reread.last_operation_payload_hash === payload_hash) {
      let stored_result = null;
      try { stored_result = reread.last_operation_result_json ? JSON.parse(reread.last_operation_result_json) : null; } catch (_) {}
      return {
        ok: true,
        idempotent: true,
        operation_id,
        result: stored_result,
        version: reread.reservation_version,
        state: reread.reservation_lifecycle_state,
      };
    }

    return {
      ok: false,
      error: 'CAS lost — another operation won',
      code: 'CONFLICT',
      operation_id,
      expected_version,
      current_version: reread.reservation_version,
      current_state: reread.reservation_lifecycle_state,
      current_operation_id: reread.last_operation_id,
    };
  }

  // ── projectMirror ──────────────────────────────────────────────────────────
  async function projectMirror(listing_id, mirror_version, mirror_payload) {
    let listing;
    try {
      const rows = await Listing.filter({ id: listing_id });
      listing = rows[0] || null;
    } catch (e) {
      return { ok: false, error: `mirror query failed: ${e?.message || e}`, code: 'MIRROR_QUERY_FAILED' };
    }

    if (!listing) {
      return { ok: false, error: 'mirror record not found', code: 'MIRROR_NOT_FOUND' };
    }

    const current_mirror_version = listing.reservation_version || 0;
    if (current_mirror_version > mirror_version) {
      return {
        ok: false,
        error: 'stale mirror version — current mirror is newer',
        code: 'STALE_MIRROR',
        current_mirror_version,
        attempted_mirror_version: mirror_version,
      };
    }

    try {
      await Listing.update(listing.id, {
        ...mirror_payload,
        reservation_version: mirror_version,
      });
    } catch (e) {
      return { ok: false, error: `mirror update failed: ${e?.message || e}`, code: 'MIRROR_UPDATE_FAILED' };
    }

    return { ok: true, mirror_version };
  }

  // ── sweepMirror ────────────────────────────────────────────────────────────
  async function sweepMirror(listing_id) {
    let lp, listing;
    try {
      const lpRows = await ListingPrivate.filter({ listing_id });
      lp = lpRows[0] || null;
      const lRows = await Listing.filter({ id: listing_id });
      listing = lRows[0] || null;
    } catch (e) {
      return { ok: false, error: `sweeper query failed: ${e?.message || e}`, code: 'SWEEPER_QUERY_FAILED' };
    }

    if (!lp) return { ok: false, error: 'authority not found', code: 'NOT_FOUND' };
    if (!listing) return { ok: false, error: 'mirror not found', code: 'MIRROR_NOT_FOUND' };

    const current_mirror_version = listing.reservation_version || 0;
    if (current_mirror_version === lp.reservation_version) {
      return { ok: true, already_synced: true, mirror_version: lp.reservation_version };
    }

    if (current_mirror_version > lp.reservation_version) {
      return { ok: false, error: 'mirror is newer than authority — corruption', code: 'MIRROR_NEWER_THAN_AUTHORITY' };
    }

    const mirror_payload = {
      reservation_token: lp.reservation_token,
      reserved_by_email: lp.reserved_by_email,
      reservation_expires_at: lp.reservation_expires_at,
      reservation_revision: lp.reservation_revision,
    };

    try {
      await Listing.update(listing.id, {
        ...mirror_payload,
        reservation_version: lp.reservation_version,
      });
    } catch (e) {
      return { ok: false, error: `sweeper update failed: ${e?.message || e}`, code: 'SWEEPER_UPDATE_FAILED' };
    }

    return { ok: true, repaired: true, mirror_version: lp.reservation_version };
  }

  // ── getPendingEffects ───────────────────────────────────────────────────────
  async function getPendingEffects(listing_id) {
    let lp;
    try {
      const rows = await ListingPrivate.filter({ listing_id });
      lp = rows[0] || null;
    } catch (e) {
      return { ok: false, error: `query failed: ${e?.message || e}`, code: 'QUERY_FAILED' };
    }
    if (!lp) return { ok: false, error: 'not found', code: 'NOT_FOUND' };
    let effects = [];
    try { effects = lp.pending_effects_json ? JSON.parse(lp.pending_effects_json) : []; } catch (_) { effects = []; }
    return { ok: true, effects, version: lp.reservation_version, operation_id: lp.last_operation_id };
  }

  // ── clearPendingEffects ─────────────────────────────────────────────────────
  async function clearPendingEffects(listing_id, expected_version) {
    let lp;
    try {
      const rows = await ListingPrivate.filter({ listing_id });
      lp = rows[0] || null;
    } catch (e) {
      return { ok: false, error: `query failed: ${e?.message || e}`, code: 'QUERY_FAILED' };
    }
    if (!lp) return { ok: false, error: 'not found', code: 'NOT_FOUND' };

    let casResult;
    try {
      casResult = await ListingPrivate.updateMany(
        { id: lp.id, reservation_version: expected_version },
        { $set: { pending_effects_json: '[]' } }
      );
    } catch (e) {
      return { ok: false, error: `CAS failed: ${e?.message || e}`, code: 'CAS_ERROR' };
    }

    const updated = casResult.updated || 0;
    if (updated > 0) return { ok: true, cleared: true };
    return { ok: false, error: 'CAS lost — version changed', code: 'CONFLICT' };
  }

  return {
    transitionReservation,
    projectMirror,
    sweepMirror,
    getPendingEffects,
    clearPendingEffects,
  };
}

// ── Manifest access for launch gate ───────────────────────────────────────────
export function getReservationMutationManifest() {
  return RESERVATION_MUTATION_ENTRY_POINTS;
}

export function getUnintegratedEntryPoints() {
  return RESERVATION_MUTATION_ENTRY_POINTS.filter(e => !e.integrated);
}