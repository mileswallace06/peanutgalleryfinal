/**
 * Reservation Authority Constants (7C.9C.2E Correction)
 *
 * Shared constants, validation, canonical JSON, and SHA-256 hashing.
 * No Deno/Node-specific imports — pure ESM JavaScript.
 */

// ── Operation types (explicit allowlist) ────────────────────────────────────
export const OPERATION_TYPES = ['reserve', 'release', 'freeze', 'finalize', 'cancel', 'expire'];

// ── Lifecycle states (schema enum) ──────────────────────────────────────────
export const LIFECYCLE_STATES = ['available', 'reserved', 'frozen', 'sold', 'cancelled', 'expired'];

// ── State-transition table ──────────────────────────────────────────────────
export const STATE_TRANSITIONS = {
  reserve:  { from: ['available'],            to: 'reserved' },
  release:  { from: ['reserved'],             to: 'available' },
  freeze:   { from: ['reserved'],             to: 'frozen' },
  finalize: { from: ['frozen'],               to: 'sold' },
  cancel:   { from: ['reserved', 'frozen'],   to: 'cancelled' },
  expire:   { from: ['reserved', 'frozen'],   to: 'expired' },
};

// ── Tuple requirements by state ─────────────────────────────────────────────
export const TUPLE_REQUIRED_STATES = new Set(['reserved', 'frozen']);
export const TUPLE_NULL_STATES = new Set(['available', 'sold', 'cancelled', 'expired']);

// ── Mirror field safety ─────────────────────────────────────────────────────
// Fields the authority must NEVER project to the public Listing mirror.
// These are private ListingPrivate fields that must not leak.
export const FORBIDDEN_MIRROR_FIELDS = new Set([
  'reservation_token', 'reserved_by_email', 'reservation_expires_at', 'reservation_revision',
  'last_operation_id', 'last_operation_type', 'last_operation_payload_hash',
  'last_operation_result_json', 'last_operation_at', 'pending_effects_json',
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

// Only these fields may be projected to the Listing mirror.
export const APPROVED_MIRROR_FIELDS = new Set(['reservation_version', 'status', 'hidden_reason']);

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

// ── SHA-256 via Web Crypto ───────────────────────────────────────────────────
export async function sha256Hex(text) {
  const crypto = globalThis.crypto;
  if (crypto && crypto.subtle) {
    const data = new TextEncoder().encode(text);
    const buf = await crypto.subtle.digest('SHA-256', data);
    const arr = new Uint8Array(buf);
    const hex = [];
    for (const b of arr) hex.push(b.toString(16).padStart(2, '0'));
    return hex.join('');
  }
  // Fallback for environments without Web Crypto (NOT for production use)
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return `fnv_${(h >>> 0).toString(16)}`;
}

// ── Hash the complete semantic operation envelope ───────────────────────────
// Envelope = { operation_type, requested_state, payload, pending_effects }
// Uses recursively stable canonical JSON + SHA-256.
// An injected hash may be provided for testing (sync or async).
export async function hashEnvelope(envelope, injectedHash) {
  if (injectedHash) return await injectedHash(envelope);
  return sha256Hex(canonicalize(envelope));
}

// ── Input validators ────────────────────────────────────────────────────────
export function isValidVersion(v) {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0;
}

export function isValidISODate(str) {
  if (typeof str !== 'string' || str.length === 0) return false;
  const d = new Date(str);
  return !isNaN(d.getTime());
}

// ── State-transition validation ─────────────────────────────────────────────
export function validateTransition(operation_type, requested_state, current_state) {
  const t = STATE_TRANSITIONS[operation_type];
  if (!t) return { valid: false, error: `unknown operation_type: ${operation_type}` };
  if (!t.from.includes(current_state))
    return { valid: false, error: `${operation_type} not allowed from ${current_state}` };
  if (t.to !== requested_state)
    return { valid: false, error: `${operation_type} must transition to ${t.to}, got ${requested_state}` };
  return { valid: true };
}

// ── Tuple validation ────────────────────────────────────────────────────────
export function validateTuple(requested_state, payload) {
  const token = payload?.token ?? null;
  const buyer = payload?.buyer ?? null;
  const expiration = payload?.expiration ?? null;

  if (TUPLE_REQUIRED_STATES.has(requested_state)) {
    if (!token) return { valid: false, error: `${requested_state} requires nonempty token` };
    if (!buyer) return { valid: false, error: `${requested_state} requires nonempty buyer` };
    if (!expiration) return { valid: false, error: `${requested_state} requires nonempty expiration` };
    if (!isValidISODate(expiration)) return { valid: false, error: 'invalid ISO expiration' };
  }
  if (TUPLE_NULL_STATES.has(requested_state)) {
    if (token !== null) return { valid: false, error: `${requested_state} requires null token` };
    if (buyer !== null) return { valid: false, error: `${requested_state} requires null buyer` };
    if (expiration !== null) return { valid: false, error: `${requested_state} requires null expiration` };
  }
  return { valid: true };
}

// ── Pending-effects parsing ────────────────────────────────────────────────
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