/**
 * Launch Gate Assertion (7C.9C.2E Correction Round 4)
 *
 * The gate EXECUTES BEHAVIOR — no source substring searches, no manifest
 * booleans as proof, no package-script substring checks.
 *
 * Round 4 corrections:
 *   - Removed ALL package-script substring checks (TEST 4 from Round 3).
 *   - Removed weak "entry-wrapper test files exist" check (empty files could
 *     turn it green). Replaced with explicit PRODUCTION_INTEGRATION_NOT_IMPLEMENTED.
 *   - Added CONCURRENT_ALERT_DUPLICATION_BLOCKER as an explicit EXPECTED_FAILURE.
 *   - A skipped live Base44 probe is not a pass.
 *   - No claims of "no includes/string searches" while using includes().
 *
 * The launch gate is RED because:
 *   1. PRODUCTION_INTEGRATION_NOT_IMPLEMENTED — no entry-wrapper behavioral tests.
 *   2. CONCURRENT_ALERT_DUPLICATION_BLOCKER — datastore lacks unique constraints.
 *
 * ATOMICITY CLARIFICATION:
 *   Base44 `updateMany` with a conditional filter predicate is EMPIRICALLY ATOMIC
 *   for single-record CAS (10/10 rounds × 20 calls = exactly 1 winner per round).
 *   This is NOT a contractual platform guarantee.
 */
import { createReservationAuthority, getReservationMutationManifest } from '../base44/shared/reservationAuthority.js';
import { OPERATION_TYPES, validatePendingEffectsArray, validateTuple, hashEnvelope, hashEffects, validateLifecycleState } from '../base44/shared/reservationAuthorityConstants.js';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

let passed = 0;
let failed = 0;
const failures = [];

function check(name, fn) {
  try {
    fn();
    console.log(`[PASS] ${name}`);
    passed++;
  } catch (e) {
    console.log(`[FAIL] ${name}`);
    console.log(`  ${e.message}`);
    failures.push(name);
    failed++;
  }
}

async function checkAsync(name, fn) {
  try {
    await fn();
    console.log(`[PASS] ${name}`);
    passed++;
  } catch (e) {
    console.log(`[FAIL] ${name}`);
    console.log(`  ${e.message}`);
    failures.push(name);
    failed++;
  }
}

// ── TEST 1: Authority module exports a working interface ────────────────────
check('authority_module_exports_working_interface', () => {
  const mockLP = { filter: async () => [], updateMany: async () => ({ updated: 0 }) };
  const mockListing = { filter: async () => [], updateMany: async () => ({ updated: 0 }), update: async () => ({}) };
  const authority = createReservationAuthority({
    entities: { ListingPrivate: mockLP, Listing: mockListing },
  });
  if (typeof authority.transitionReservation !== 'function') throw new Error('transitionReservation is not a function');
  if (typeof authority.projectMirror !== 'function') throw new Error('projectMirror is not a function');
  if (typeof authority.sweepMirror !== 'function') throw new Error('sweepMirror is not a function');
  if (typeof authority.getPendingEffects !== 'function') throw new Error('getPendingEffects is not a function');
  if (typeof authority.clearPendingEffects !== 'function') throw new Error('clearPendingEffects is not a function');
});

// ── TEST 2: Authority validates inputs ──────────────────────────────────────
await checkAsync('authority_validates_inputs', async () => {
  const mockLP = { filter: async () => [], updateMany: async () => ({ updated: 0 }) };
  const mockListing = { filter: async () => [], updateMany: async () => ({ updated: 0 }), update: async () => ({}) };
  const authority = createReservationAuthority({
    entities: { ListingPrivate: mockLP, Listing: mockListing },
  });
  const r1 = await authority.transitionReservation({ expected_version: 0, operation_id: 'op', operation_type: 'reserve', requested_state: 'reserved' });
  if (r1.ok) throw new Error('should reject missing listing_id');
  const r2 = await authority.transitionReservation({ listing_id: 'l1', expected_version: 0, operation_type: 'reserve', requested_state: 'reserved' });
  if (r2.ok) throw new Error('should reject missing operation_id');
  const r3 = await authority.transitionReservation({ listing_id: 'l1', expected_version: 'abc', operation_id: 'op', operation_type: 'reserve', requested_state: 'reserved' });
  if (r3.ok) throw new Error('should reject non-number expected_version');
  const r4 = await authority.transitionReservation({ listing_id: 'l1', expected_version: -1, operation_id: 'op', operation_type: 'reserve', requested_state: 'reserved' });
  if (r4.ok) throw new Error('should reject negative expected_version');
});

// ── TEST 3: Authority never treats unknown as available ─────────────────────
await checkAsync('authority_never_treats_unknown_as_available', async () => {
  const mockLP = { filter: async () => [] };
  const mockListing = { filter: async () => [], updateMany: async () => ({ updated: 0 }), update: async () => ({}) };
  const authority = createReservationAuthority({
    entities: { ListingPrivate: mockLP, Listing: mockListing },
  });
  const result = await authority.transitionReservation({
    listing_id: 'nonexistent', expected_version: 0,
    operation_id: 'op', operation_type: 'reserve',
    payload: { token: 't', buyer: 'b@test', expiration: '2026-12-31T00:00:00Z' },
    requested_state: 'reserved',
  });
  if (result.ok) throw new Error('should not treat unknown as available');
  if (result.code !== 'NOT_FOUND') throw new Error(`expected NOT_FOUND, got ${result.code}`);
});

// ── TEST 4: Manifest complete ────────────────────────────────────────────────
check('reservation_mutation_manifest_complete', () => {
  const manifest = getReservationMutationManifest();
  const required = [
    'reserveListing', 'releaseReservation', 'createCheckout', 'abortCheckout',
    'cancelPurchase', 'processTransferReminders', 'capturePayment',
    'cleanupAbandonedCheckouts', 'stripeWebhook', 'submitListing/manage_existing', 'deleteAccount',
  ];
  if (manifest.length < required.length) {
    throw new Error(`manifest has ${manifest.length}, expected >= ${required.length}`);
  }
  for (const name of required) {
    if (!manifest.some(e => e.name === name)) {
      throw new Error(`missing entry point: ${name}`);
    }
  }
});

// ── TEST 5: Production entry-point integration (RED — not implemented) ─────
check('production_entry_points_integrated', () => {
  // Round 4: No weak "test files exist" check. Empty files could turn it green.
  // Production integration must be proven by importing and executing actual
  // entry wrappers with injected authority dependencies. Until those executable
  // tests exist, this gate returns PRODUCTION_INTEGRATION_NOT_IMPLEMENTED.
  const entryWrapperTestDir = join(__dirname, 'entry-wrappers');
  if (!existsSync(entryWrapperTestDir)) {
    throw new Error('PRODUCTION_INTEGRATION_NOT_IMPLEMENTED: No entry-wrapper behavioral tests exist. ' +
      'Production integration can only pass after executable entry-wrapper tests that import and ' +
      'exercise actual entry wrappers with injected authority dependencies. Gate remains RED.');
  }
  // Even if the directory exists, we need to verify the tests actually import
  // and execute entry wrappers. For now, the gate remains RED.
  throw new Error('PRODUCTION_INTEGRATION_NOT_IMPLEMENTED: Entry-wrapper test directory exists but ' +
    'no executable tests have been verified to import and exercise actual entry wrappers. ' +
    'Gate remains RED.');
});

// ── TEST 6: Probe artifact exports runProbe function (behavioral import) ───
await checkAsync('probe_artifact_exports_runProbe_function', async () => {
  const probeModule = await import('../tests/probe-artifacts/single-authority-cas-probe.mjs');
  if (typeof probeModule.runProbe !== 'function') {
    throw new Error('probe artifact must export a function named runProbe');
  }
});

// ── TEST 7: initialize is a valid operation type ─────────────────────────────
check('initialize_is_valid_operation_type', () => {
  if (!OPERATION_TYPES.includes('initialize')) {
    throw new Error('initialize must be in OPERATION_TYPES for migration apply');
  }
});

// ── TEST 8: validatePendingEffectsArray rejects non-arrays ──────────────────
check('validate_pending_effects_array_rejects_non_arrays', () => {
  const r1 = validatePendingEffectsArray(null);
  if (r1.ok) throw new Error('should reject null');
  const r2 = validatePendingEffectsArray('string');
  if (r2.ok) throw new Error('should reject string');
  const r3 = validatePendingEffectsArray({ not: 'array' });
  if (r3.ok) throw new Error('should reject object');
  const r4 = validatePendingEffectsArray(undefined);
  if (r4.ok) throw new Error('should reject undefined');
  const r5 = validatePendingEffectsArray([]);
  if (!r5.ok) throw new Error('should accept empty array');
  const r6 = validatePendingEffectsArray([{ effect_type: 'notify' }]);
  if (!r6.ok) throw new Error('should accept valid array');
});

// ── TEST 9: validateTuple requires explicit null for terminal states ───────
check('validate_tuple_requires_explicit_null_for_terminal_states', () => {
  const r1 = validateTuple('available', { buyer: null, expiration: null });
  if (r1.valid) throw new Error('omitted token should fail for available');
  const r2 = validateTuple('available', { token: null, buyer: null, expiration: null });
  if (!r2.valid) throw new Error('explicit null should pass for available');
  const r3 = validateTuple('reserved', { token: '   ', buyer: 'b@test', expiration: '2026-12-31T00:00:00Z' });
  if (r3.valid) throw new Error('whitespace-only token should fail for reserved');
});

// ── TEST 10: SHA-256 hashing works (behavioral — no mock) ────────────────────
await checkAsync('sha256_hashing_works_without_mock', async () => {
  const hash = await hashEnvelope({ operation_type: 'reserve', requested_state: 'reserved', payload: { token: 't1' }, pending_effects: [] });
  if (typeof hash !== 'string') throw new Error('hash should be string');
  if (hash.length !== 64) throw new Error(`SHA-256 hash should be 64 chars, got ${hash.length}`);
  if (hash.startsWith('mock_')) throw new Error('should not be mock hash');
  if (hash.startsWith('fnv_')) throw new Error('should not be FNV fallback');
  const effectsHash = await hashEffects([{ effect_type: 'notify' }]);
  if (typeof effectsHash !== 'string') throw new Error('effects hash should be string');
  if (effectsHash.length !== 64) throw new Error(`effects SHA-256 hash should be 64 chars, got ${effectsHash.length}`);
});

// ── TEST 11: Authority returns structured error codes (not a stub) ──────────
await checkAsync('authority_returns_structured_error_codes_not_stub', async () => {
  const mockLP = { filter: async () => [], updateMany: async () => ({ updated: 0 }) };
  const mockListing = { filter: async () => [], updateMany: async () => ({ updated: 0 }), update: async () => ({}) };
  const authority = createReservationAuthority({
    entities: { ListingPrivate: mockLP, Listing: mockListing },
  });
  const r = await authority.transitionReservation({
    listing_id: 'l1', expected_version: 0,
    operation_id: 'op', operation_type: 'reserve', requested_state: 'reserved',
    payload: { token: 't', buyer: 'b@test', expiration: '2026-12-31T00:00:00Z' },
  });
  if (r.ok) throw new Error('should fail on missing LP record');
  if (!r.code) throw new Error('must return structured error code, not just ok:false (stub)');
  if (r.code !== 'NOT_FOUND') throw new Error(`expected NOT_FOUND, got ${r.code}`);
  if (!r.error || typeof r.error !== 'string') throw new Error('must return error message string');
});

// ── TEST 12: Authority fails closed on corrupt lifecycle state (behavioral) ──
await checkAsync('authority_fails_closed_on_corrupt_lifecycle_state', async () => {
  const mockLP = {
    filter: async (q) => {
      if (q.listing_id === 'corrupt1') {
        return [{ id: 'lp1', listing_id: 'corrupt1', reservation_version: 0,
          reservation_lifecycle_state: null, checkout_quarantined: false, recovery_blocked: false,
          pending_effects_json: '[]', last_operation_id: null }];
      }
      if (q.listing_id === 'corrupt2') {
        return [{ id: 'lp2', listing_id: 'corrupt2', reservation_version: 0,
          reservation_lifecycle_state: 'invalid_enum', checkout_quarantined: false, recovery_blocked: false,
          pending_effects_json: '[]', last_operation_id: null }];
      }
      return [];
    },
    updateMany: async () => ({ updated: 0 }),
  };
  const mockListing = { filter: async () => [], updateMany: async () => ({ updated: 0 }), update: async () => ({}) };
  const authority = createReservationAuthority({
    entities: { ListingPrivate: mockLP, Listing: mockListing },
  });
  const r1 = await authority.transitionReservation({
    listing_id: 'corrupt1', expected_version: 0,
    operation_id: 'op', operation_type: 'reserve', requested_state: 'reserved',
    payload: { token: 't', buyer: 'b@test', expiration: '2026-12-31T00:00:00Z' },
  });
  if (r1.ok) throw new Error('should fail on missing lifecycle state');
  if (r1.code !== 'STATE_CORRUPT') throw new Error(`expected STATE_CORRUPT, got ${r1.code}`);
  if (r1.state_code !== 'STATE_MISSING') throw new Error(`expected STATE_MISSING, got ${r1.state_code}`);
  const r2 = await authority.transitionReservation({
    listing_id: 'corrupt2', expected_version: 0,
    operation_id: 'op', operation_type: 'reserve', requested_state: 'reserved',
    payload: { token: 't', buyer: 'b@test', expiration: '2026-12-31T00:00:00Z' },
  });
  if (r2.ok) throw new Error('should fail on invalid lifecycle state');
  if (r2.code !== 'STATE_CORRUPT') throw new Error(`expected STATE_CORRUPT, got ${r2.code}`);
  if (r2.state_code !== 'STATE_INVALID') throw new Error(`expected STATE_INVALID, got ${r2.state_code}`);
});

// ── TEST 13: validateLifecycleState rejects all invalid inputs (behavioral) ──
check('validate_lifecycle_state_rejects_invalid_inputs', () => {
  const r1 = validateLifecycleState(null);
  if (r1.valid) throw new Error('null should be invalid');
  if (r1.code !== 'STATE_MISSING') throw new Error(`expected STATE_MISSING, got ${r1.code}`);
  const r2 = validateLifecycleState(undefined);
  if (r2.valid) throw new Error('undefined should be invalid');
  if (r2.code !== 'STATE_MISSING') throw new Error(`expected STATE_MISSING, got ${r2.code}`);
  const r3 = validateLifecycleState('');
  if (r3.valid) throw new Error('empty string should be invalid');
  if (r3.code !== 'STATE_EMPTY') throw new Error(`expected STATE_EMPTY, got ${r3.code}`);
  const r4 = validateLifecycleState('   ');
  if (r4.valid) throw new Error('whitespace should be invalid');
  if (r4.code !== 'STATE_EMPTY') throw new Error(`expected STATE_EMPTY, got ${r4.code}`);
  const r5 = validateLifecycleState('not_a_real_state');
  if (r5.valid) throw new Error('invalid enum should be invalid');
  if (r5.code !== 'STATE_INVALID') throw new Error(`expected STATE_INVALID, got ${r5.code}`);
  const r6 = validateLifecycleState('available');
  if (!r6.valid) throw new Error('available should be valid');
  const r7 = validateLifecycleState('reserved');
  if (!r7.valid) throw new Error('reserved should be valid');
  const r8 = validateLifecycleState('sold');
  if (!r8.valid) throw new Error('sold should be valid');
});

// ── TEST 14: Concurrent alert duplication is a known BLOCKER ────────────────
check('concurrent_alert_duplication_is_known_blocker', () => {
  // This is an EXPECTED_FAILURE / BLOCKER — not a pass.
  // Base44 datastore lacks unique constraints on incident_key.
  // Two concurrent alert creates can produce duplicate unresolved alerts
  // for the same incident. The launch gate is RED while this remains
  // unfixed or explicitly accepted by the owner.
  throw new Error('CONCURRENT_ALERT_DUPLICATION_BLOCKER: Base44 datastore lacks unique constraints ' +
    'on incident_key. Two concurrent alert creates can produce duplicate unresolved alerts. ' +
    'This is an EXPECTED_FAILURE / BLOCKER — launch gate is RED until fixed or explicitly accepted.');
});

// ── MAIN RUNNER ─────────────────────────────────────────────────────────────
async function main() {
  console.log('=== Launch Gate Assertion (7C.9C.2E Correction Round 4) ===\n');

  console.log(`\n=== Overall: ${failed === 0 ? 'PASS' : 'FAIL'} ===`);
  console.log(`Tests run: ${passed + failed}, Passed: ${passed}, Failed: ${failed}`);

  if (failed > 0) {
    console.log('\n┌─────────────────────────────────────────────────────────┐');
    console.log('│  LAUNCH GATE IS RED.                                     │');
    console.log('│  Production integration not implemented.                 │');
    console.log('│  Concurrent alert duplication is a known blocker.        │');
    console.log('│  Do not deploy to production.                             │');
    console.log('└─────────────────────────────────────────────────────────┘');
    console.log(`\nFailed tests: ${failures.join(', ')}`);
    process.exit(1);
  }
}

main().catch(err => { console.error('Test runner error:', err); process.exit(1); });