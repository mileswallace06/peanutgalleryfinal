/**
 * Reservation Authority Constants (7C.9C.2E Correction Round 2)
 *
 * Shared constants, validation, canonical JSON, and SHA-256 hashing.
 *
 * Round 2 corrections:
 *   - SHA-256 is REQUIRED. No FNV fallback. Fail-closed if Web Crypto unavailable.
 *   - pending_effects array validation before datastore access.
 *   - Whitespace-only ID/token/buyer rejection.
 *   - Terminal-state tuple fields must be explicitly null (omitted ≠ null).
 *   - `initialize` operation type for migration apply.
 *   - hashEffects helper for pending_effects_hash field.
 *
 * No Deno/Node-specific imports — pure ESM JavaScript.
 */

// ── Operation types (explicit allowlist) ────────────────────────────────────
export const OPERATION_TYPES = ['reserve', 'release', 'freeze', 'finalize', 'cancel', 'expire', 'initialize'];

// ── Lifecycle states (schema enum) ──────────────────────────────────────────
export const LIFECYCLE_STATES = ['available', 'reserved', 'frozen', 'sold', 'cancelled', 'expired'];

// ── State-transition table ──────────────────────────────────────────────────
// `initialize` can transition from a virtual 'uninitialized' state to any valid lifecycle.
// `to: '*'` means any valid lifecycle state is accepted.
export const STATE_TRANSITIONS = {
  reserve:    { from: ['available'],            to: 'reserved' },
  release:    { from: ['reserved'],             to: 'available' },
  freeze:     { from: ['reserved'],             to: 'frozen' },
  finalize:   { from: ['frozen'],               to: 'sold' },
  cancel:     { from: ['reserved', 'frozen'],   to: 'cancelled' },
  expire:     { from: ['reserved', 'frozen'],   to: 'expired' },
  initialize: { from: ['uninitialized'],         to: '*' },
};

// ── Tuple requirements by state ─────────────────────────────────────────────
export const TUPLE_REQUIRED_STATES = new Set(['reserved', 'frozen']);
export const TUPLE_NULL_STATES = new Set(['available', 'sold', 'cancelled', 'expired']);

// ── Mirror field safety ─────────────────────────────────────────────────────
// Fields the authority must NEVER project to the public Listing mirror.
export const FORBIDDEN_MIRROR_FIELDS = new Set([
  'reservation_token', 'reserved_by_email', 'reservation_expires_at', 'reservation_revision',
  'last_operation_id', 'last_operation_type', 'last_operation_payload_hash',
  'last_operation_result_json', 'last_operation_at', 'pending_effects_json',
  'pending_effects_hash',
  'checkout_quarantined', 'checkout_quarantine_reason', 'checkout_quarantined_at',
  'checkout_quarantine_pi_id',
  'quarantined_reservation_token', 'quarantined_buyer', 'quarantined_expiration',
  'quarantined_purchase_id', 'quarantine_generation',
  'recovery_not_before', 'recovery_blocked', 'recovery_blocked_reason', 'recovery_blocked_at',
  'seller_cancel_requested_at', 'seller_pause_requested_at',
  'reservation_lifecycle_state',
  'ticket_file_url', 'proof_url', 'proof_status', 'proof_rejection_reason',
  'current_proof_asset_id', 'transfer_verification_proof_url', 'transfer_verified_by',
  'transfer_verified_notes', 'pg_transfer_proof_url', 'pg_transfer_notes',
  'pg_fulfilled_at', 'pg_fulfilled_by',
  'seller_ownership_confirmed', 'limited_transfer_authorization',
  'ticket_custody_status', 'custody_received_at', 'buyer_delivered_at',
  'returned_to_seller_at', 'transfer_failure_reason',
  'seller_release_deadline', 'custody_status', 'seat_inventory_id',
  'seller_email', 'event_id', 'section', 'row', 'seats', 'quantity', 'tier',
  'asking_price', 'original_price', 'transfer_method',
  'listing_mode', 'listing_transfer_mode', 'listing_type', 'inventory_source',
  'requires_existing_ticket', 'requires_location', 'location_requirement',
  'upgrade_window_opens_at', 'upgrade_window_closes_at', 'upgrade_instructions',
  'is_demo_listing',
]);

// Only these fields may be projected to the Listing mirror by NORMAL projection.
// Round 4: status and hidden_reason are NO LONGER projected by normal projection.
// They are owned by business logic. Emergency protection may set them.
export const APPROVED_MIRROR_FIELDS = new Set(['reservation_version', 'reservation_mirror_state']);

// Business-held public statuses that normal projection must NEVER change.
// These represent independent business restrictions, not reservation workflow states.
export const BUSINESS_HELD_STATUSES = new Set(['hidden', 'pending_verification', 'pending_payout_setup']);

// Business-held hidden reasons that normal projection must NEVER clear.
export const BUSINESS_HELD_HIDDEN_REASONS = new Set(['admin_disabled', 'transfer_disabled', 'expired_verification']);

// Reservation mirror states (same enum as lifecycle states).
export const RESERVATION_MIRROR_STATES = LIFECYCLE_STATES;

// ── Recursively stable canonical JSON ───────────────────────────────────────
export function canonicalize(value) {
  if (value === null) return 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return 'null';
    return String(value);
  }
  if (typeof value === 'string') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return '[' + value.map(canonicalize).join(',') + ']';
  }
  if (typeof value === 'object') {
    const keys = Object.keys(value).sort();
    return '{' + keys.map(k => JSON.stringify(k) + ':' + canonicalize(value[k])).join(',') + '}';
  }
  return 'null';
}

// ── SHA-256 via Web Crypto (REQUIRED — no fallback) ──────────────────────────
export async function sha256Hex(text) {
  const crypto = globalThis.crypto;
  if (!crypto || !crypto.subtle) {
    throw new Error('SHA-256 unavailable: Web Crypto API (crypto.subtle) not present — fail-closed');
  }
  const data = new TextEncoder().encode(text);
  const buf = await crypto.subtle.digest('SHA-256', data);
  const arr = new Uint8Array(buf);
  const hex = [];
  for (const b of arr) hex.push(b.toString(16).padStart(2, '0'));
  return hex.join('');
}

// ── Hash the complete semantic operation envelope ───────────────────────────
// Envelope = { operation_type, requested_state, payload, pending_effects }
// Uses recursively stable canonical JSON + SHA-256.
// An injected hash may be provided for testing (sync or async).
// Throws on hashing failure — caller must catch and return structured error.
export async function hashEnvelope(envelope, injectedHash) {
  if (injectedHash) return await injectedHash(envelope);
  const canonical = canonicalize(envelope);
  return await sha256Hex(canonical);
}

// ── Hash a pending-effects array ─────────────────────────────────────────────
// Hashes { effects: [...] } via canonical JSON + SHA-256.
// Used for the pending_effects_hash field stored atomically with pending_effects_json.
export async function hashEffects(effects, injectedHash) {
  if (injectedHash) return await injectedHash({ effects });
  const canonical = canonicalize({ effects });
  return await sha256Hex(canonical);
}

// ── Input validators ────────────────────────────────────────────────────────
export function isValidVersion(v) {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0;
}

export function isNonEmptyString(v) {
  return typeof v === 'string' && v.trim().length > 0;
}

// ── Lifecycle state validation (fail-closed on unknown state) ──────────────
// Missing, empty, or invalid lifecycle state must NEVER be treated as available.
export function isValidLifecycleState(state) {
  return typeof state === 'string' && LIFECYCLE_STATES.includes(state);
}

export function validateLifecycleState(state) {
  if (state === null || state === undefined) {
    return { valid: false, code: 'STATE_MISSING', error: 'reservation_lifecycle_state is missing' };
  }
  if (typeof state !== 'string' || state.trim() === '') {
    return { valid: false, code: 'STATE_EMPTY', error: 'reservation_lifecycle_state is empty or whitespace' };
  }
  if (!LIFECYCLE_STATES.includes(state)) {
    return { valid: false, code: 'STATE_INVALID', error: `reservation_lifecycle_state is not a valid enum: ${JSON.stringify(state)}` };
  }
  return { valid: true };
}

export function isValidISODate(str) {
  if (typeof str !== 'string' || str.trim().length === 0) return false;
  const d = new Date(str);
  return !isNaN(d.getTime());
}

// ── Pending-effects array validation (before datastore access) ───────────────
// Rejects non-arrays, null, strings, objects, and non-serializable values.
export function validatePendingEffectsArray(effects) {
  if (effects === null || effects === undefined) {
    return { ok: false, error: 'pending_effects must be an array (got null/undefined)' };
  }
  if (!Array.isArray(effects)) {
    return { ok: false, error: `pending_effects must be an array (got ${typeof effects})` };
  }
  // Recursively check for non-serializable values
  function checkSerializable(val, path) {
    if (val === null) return null;
    if (typeof val === 'boolean') return null;
    if (typeof val === 'number') return Number.isFinite(val) ? null : `non-finite number at ${path}`;
    if (typeof val === 'string') return null;
    if (typeof val === 'undefined') return `undefined at ${path}`;
    if (typeof val === 'function') return `function at ${path}`;
    if (typeof val === 'symbol') return `symbol at ${path}`;
    if (typeof val === 'bigint') return `bigint at ${path}`;
    if (Array.isArray(val)) {
      for (let i = 0; i < val.length; i++) {
        const err = checkSerializable(val[i], `${path}[${i}]`);
        if (err) return err;
      }
      return null;
    }
    if (typeof val === 'object') {
      for (const k of Object.keys(val)) {
        const err = checkSerializable(val[k], `${path}.${k}`);
        if (err) return err;
      }
      return null;
    }
    return `unknown type at ${path}`;
  }
  const serErr = checkSerializable(effects, 'effects');
  if (serErr) return { ok: false, error: `pending_effects not serializable: ${serErr}` };
  // Also verify JSON round-trip
  try {
    const s = JSON.stringify(effects);
    JSON.parse(s);
  } catch (e) {
    return { ok: false, error: `pending_effects JSON serialization failed: ${e.message}` };
  }
  return { ok: true };
}

// ── State-transition validation ─────────────────────────────────────────────
export function validateTransition(operation_type, requested_state, current_state) {
  const t = STATE_TRANSITIONS[operation_type];
  if (!t) return { valid: false, error: `unknown operation_type: ${operation_type}` };
  // `from: ['*']` means any source state is allowed
  if (!t.from.includes(current_state) && !t.from.includes('*'))
    return { valid: false, error: `${operation_type} not allowed from ${current_state}` };
  // `to: '*'` means any valid target state is allowed
  if (t.to !== '*' && t.to !== requested_state)
    return { valid: false, error: `${operation_type} must transition to ${t.to}, got ${requested_state}` };
  return { valid: true };
}

// ── Tuple validation ────────────────────────────────────────────────────────
// Terminal-state fields must be EXPLICITLY present and null.
// Omitted values (undefined) are NOT equivalent to deliberate nulls.
export function validateTuple(requested_state, payload) {
  const p = payload || {};
  const token = p.token;
  const buyer = p.buyer;
  const expiration = p.expiration;
  const tokenPresent = 'token' in p;
  const buyerPresent = 'buyer' in p;
  const expirationPresent = 'expiration' in p;

  if (TUPLE_REQUIRED_STATES.has(requested_state)) {
    if (!tokenPresent || !isNonEmptyString(token))
      return { valid: false, error: `${requested_state} requires nonempty string token` };
    if (!buyerPresent || !isNonEmptyString(buyer))
      return { valid: false, error: `${requested_state} requires nonempty string buyer` };
    if (!expirationPresent || !expiration)
      return { valid: false, error: `${requested_state} requires nonempty expiration` };
    if (!isValidISODate(expiration)) return { valid: false, error: 'invalid ISO expiration' };
  }
  if (TUPLE_NULL_STATES.has(requested_state)) {
    // Terminal states require explicit null — omitted is not equivalent
    if (!tokenPresent) return { valid: false, error: `${requested_state} requires explicit null token (omitted is not null)` };
    if (!buyerPresent) return { valid: false, error: `${requested_state} requires explicit null buyer (omitted is not null)` };
    if (!expirationPresent) return { valid: false, error: `${requested_state} requires explicit null expiration (omitted is not null)` };
    if (token !== null) return { valid: false, error: `${requested_state} requires null token` };
    if (buyer !== null) return { valid: false, error: `${requested_state} requires null buyer` };
    if (expiration !== null) return { valid: false, error: `${requested_state} requires null expiration` };
  }
  return { valid: true };
}

// ── Build authoritative snapshot for CAS predicate ──────────────────────────
// Returns the complete authoritative snapshot that informed the decision.
// This snapshot is included in the CAS predicate so that ANY change to the
// tuple by a legacy writer (who doesn't increment version) is detected.
export function buildAuthoritativeSnapshot(lp) {
  return {
    id: lp.id,
    reservation_version: lp.reservation_version,
    reservation_lifecycle_state: lp.reservation_lifecycle_state,
    reservation_token: lp.reservation_token,
    reserved_by_email: lp.reserved_by_email,
    reservation_expires_at: lp.reservation_expires_at,
    reservation_revision: lp.reservation_revision,
    last_operation_id: lp.last_operation_id,
    pending_effects_json: lp.pending_effects_json,
    pending_effects_hash: lp.pending_effects_hash,
    checkout_quarantined: lp.checkout_quarantined,
    recovery_blocked: lp.recovery_blocked,
  };
}

// ── Validate idempotent replay before returning success ─────────────────────
// Checks that the stored state is internally consistent before returning
// idempotent success. Corruption triggers fail-closed protection.
export async function validateIdempotentReplay(lp, operation_id, envelope_hash, hashEffectsFn) {
  // 1. Lifecycle state is valid
  const stateCheck = validateLifecycleState(lp.reservation_lifecycle_state);
  if (!stateCheck.valid) {
    return { ok: false, code: 'STATE_CORRUPT', state_code: stateCheck.code, error: stateCheck.error };
  }

  // 2. Reservation version is valid
  if (!isValidVersion(lp.reservation_version)) {
    return { ok: false, code: 'VERSION_CORRUPT', error: `reservation_version is invalid: ${JSON.stringify(lp.reservation_version)}` };
  }

  // 3. Tuple matches stored lifecycle state
  const tupleCheck = validateTuple(lp.reservation_lifecycle_state, {
    token: lp.reservation_token,
    buyer: lp.reserved_by_email,
    expiration: lp.reservation_expires_at,
  });
  if (!tupleCheck.valid) {
    return { ok: false, code: 'TUPLE_CORRUPT', error: tupleCheck.error };
  }

  // 4. Last operation ID matches
  if (lp.last_operation_id !== operation_id) {
    return { ok: false, code: 'OPERATION_MISMATCH', error: `last_operation_id mismatch: expected ${operation_id}, got ${lp.last_operation_id}` };
  }

  // 5. Last operation payload hash matches
  if (lp.last_operation_payload_hash !== envelope_hash) {
    return { ok: false, code: 'HASH_MISMATCH', error: 'last_operation_payload_hash does not match envelope hash' };
  }

  // 6. Stored result new_version matches authoritative version
  let stored_result = null;
  if (lp.last_operation_result_json) {
    try {
      stored_result = JSON.parse(lp.last_operation_result_json);
    } catch (e) {
      return { ok: false, code: 'RESULT_CORRUPT', error: `stored result JSON is malformed: ${e.message}` };
    }
  }
  if (stored_result && stored_result.new_version !== lp.reservation_version) {
    return { ok: false, code: 'VERSION_MISMATCH', error: `stored result new_version ${stored_result.new_version} does not match authoritative version ${lp.reservation_version}` };
  }

  // 7. Pending-effects JSON is valid
  const effectsCheck = parsePendingEffects(lp.pending_effects_json);
  if (!effectsCheck.ok) {
    return { ok: false, code: 'EFFECTS_CORRUPT', error: effectsCheck.error };
  }

  // 8. Pending-effects hash matches (async — uses SHA-256)
  if (hashEffectsFn) {
    let computed_hash;
    try {
      computed_hash = await hashEffectsFn(effectsCheck.effects);
    } catch (e) {
      return { ok: false, code: 'HASHING_FAILED', error: e?.message || String(e) };
    }
    if (lp.pending_effects_hash && computed_hash !== lp.pending_effects_hash) {
      return { ok: false, code: 'EFFECTS_HASH_MISMATCH', error: 'pending_effects_hash does not match computed hash of pending_effects_json' };
    }
  }

  return { ok: true, stored_result };
}

// ── Check if a Listing has a business-held status ──────────────────────────
// Business-held statuses are independent business restrictions that normal
// projection must NOT change. Emergency protection may override them.
export function isBusinessHeldStatus(status) {
  return BUSINESS_HELD_STATUSES.has(status);
}

export function isBusinessHeldHiddenReason(reason) {
  return BUSINESS_HELD_HIDDEN_REASONS.has(reason);
}

// ── Pending-effects parsing (from stored JSON) ──────────────────────────────
export function parsePendingEffects(effects_json) {
  if (effects_json === null || effects_json === undefined || effects_json === '') {
    return { ok: true, effects: [] };
  }
  if (effects_json === '[]') return { ok: true, effects: [] };
  try {
    const parsed = JSON.parse(effects_json);
    if (!Array.isArray(parsed)) {
      return { ok: false, code: 'EFFECTS_CORRUPT', error: 'pending_effects_json is not an array' };
    }
    return { ok: true, effects: parsed };
  } catch (e) {
    return { ok: false, code: 'EFFECTS_CORRUPT', error: `malformed JSON: ${e.message}` };
  }
}