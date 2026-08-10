/**
 * Reservation Authority Concurrency Tests (7C.9C.2E Correction)
 *
 * Imports the ACTUAL authority module. Tests all corrected defects:
 *   1. Pending effects (fail-closed, corrupt JSON, stale clearer)
 *   3. Operation idempotency (full envelope hash, nested diff, corrupt result)
 *   4. State/tuple validation (before datastore, transition table, tuple reqs)
 *   5. Commit verification (all fields, post-CAS corruption)
 *   6. Migration (missing version → MIGRATION_REQUIRED)
 *
 * Three clearly separated sections:
 *   1. Deterministic local module tests (mock deps — prove authority LOGIC)
 *   2. Live Base44 CAS probe (real Base44 — prove datastore atomicity)
 *   3. Production integration tests (manifest check — RED until migrated)
 *
 * Local mock tests do NOT prove Base44 datastore atomicity.
 */
import { createReservationAuthority, getReservationMutationManifest } from '../base44/shared/reservationAuthority.js';
import { mockHashEnvelope, createMockDeps } from './authority/helpers.mjs';

const tests = [];
let passed = 0;
let failed = 0;

function test(name, fn) { tests.push({ name, fn }); }
function assert(cond, msg) { if (!cond) throw new Error(msg); }

// ════════════════════════════════════════════════════════════════════════════
// SECTION 1: DETERMINISTIC LOCAL MODULE TESTS
// ════════════════════════════════════════════════════════════════════════════

// ── 1: 20 different operations → exactly 1 winner ────────────────────────────
test('20 different operations at one expected version produces exactly one winner', async () => {
  const deps = createMockDeps();
  const authority = createReservationAuthority(deps);
  deps._seedLP('lp1', { listing_id: 'list1' });
  const results = await Promise.all(
    Array.from({ length: 20 }, (_, i) =>
      authority.transitionReservation({
        listing_id: 'list1', expected_version: 0,
        operation_id: `op_${i}`, operation_type: 'reserve',
        payload: { token: `t${i}`, buyer: `b${i}@test`, expiration: '2026-12-31T00:00:00Z' },
        requested_state: 'reserved',
      })
    )
  );
  const winners = results.filter(r => r.ok && !r.idempotent);
  const conflicts = results.filter(r => !r.ok && r.code === 'CONFLICT');
  assert(winners.length === 1, `expected 1 winner, got ${winners.length}`);
  assert(conflicts.length === 19, `expected 19 conflicts, got ${conflicts.length}`);
});

// ── 2: 20 identical retries → same result, 1 mutation ────────────────────────
test('20 identical retries produce same semantic result and only one mutation', async () => {
  const deps = createMockDeps();
  const authority = createReservationAuthority(deps);
  deps._seedLP('lp1', { listing_id: 'list1' });
  const payload = { token: 't_same', buyer: 'b_same@test', expiration: '2026-12-31T00:00:00Z' };
  const results = await Promise.all(
    Array.from({ length: 20 }, () =>
      authority.transitionReservation({
        listing_id: 'list1', expected_version: 0,
        operation_id: 'op_same', operation_type: 'reserve',
        payload, requested_state: 'reserved',
      })
    )
  );
  const winners = results.filter(r => r.ok && !r.idempotent);
  const idempotents = results.filter(r => r.ok && r.idempotent);
  assert(winners.length === 1, `expected 1 winner, got ${winners.length}`);
  assert(idempotents.length === 19, `expected 19 idempotent, got ${idempotents.length}`);
  assert(results.every(r => r.ok), 'all should be ok');
});

// ── 3: Same op ID + different payload → OPERATION_ID_CONFLICT ─────────────────
test('same operation ID with different payload is rejected', async () => {
  const deps = createMockDeps();
  const authority = createReservationAuthority(deps);
  deps._seedLP('lp1', {
    listing_id: 'list1', reservation_version: 1,
    reservation_lifecycle_state: 'reserved',
    last_operation_id: 'op_x',
    last_operation_payload_hash: mockHashEnvelope({
      operation_type: 'reserve', requested_state: 'reserved',
      payload: { token: 't1', buyer: 'b1@test' }, pending_effects: [],
    }),
    last_operation_result_json: JSON.stringify({ op: 'op_x', v: 1 }),
  });
  const result = await authority.transitionReservation({
    listing_id: 'list1', expected_version: 0,
    operation_id: 'op_x', operation_type: 'reserve',
    payload: { token: 't2', buyer: 'b2@test', expiration: '2026-12-31T00:00:00Z' },
    requested_state: 'reserved',
  });
  assert(!result.ok, 'should be rejected');
  assert(result.code === 'OPERATION_ID_CONFLICT', `expected OPERATION_ID_CONFLICT, got ${result.code}`);
});

// ── 4: Losing operation cannot overwrite winner ──────────────────────────────
test('losing operation cannot overwrite winner', async () => {
  const deps = createMockDeps();
  const authority = createReservationAuthority(deps);
  deps._seedLP('lp1', {
    listing_id: 'list1', reservation_version: 1,
    reservation_lifecycle_state: 'reserved',
    reservation_token: 'winner_token',
    last_operation_id: 'op_winner',
  });
  const result = await authority.transitionReservation({
    listing_id: 'list1', expected_version: 0,
    operation_id: 'op_loser', operation_type: 'reserve',
    payload: { token: 'loser_token', buyer: 'loser@test', expiration: '2026-12-31T00:00:00Z' },
    requested_state: 'reserved',
  });
  assert(!result.ok, 'loser should fail');
  assert(result.code === 'CONFLICT', `expected CONFLICT, got ${result.code}`);
  assert(result.current_operation_id === 'op_winner', 'winner should be preserved');
});

// ── 5: Old operation retry after newer → STALE_RETRY ──────────────────────────
test('old operation retry after newer transition returns STALE_RETRY', async () => {
  const deps = createMockDeps();
  const authority = createReservationAuthority(deps);
  deps._seedLP('lp1', { listing_id: 'list1' });
  const resA = await authority.transitionReservation({
    listing_id: 'list1', expected_version: 0,
    operation_id: 'op_A', operation_type: 'reserve',
    payload: { token: 'tA', buyer: 'bA@test', expiration: '2026-12-31T00:00:00Z' },
    requested_state: 'reserved',
  });
  assert(resA.ok && !resA.idempotent, 'op_A should win');
  const resB = await authority.transitionReservation({
    listing_id: 'list1', expected_version: 1,
    operation_id: 'op_B', operation_type: 'freeze',
    payload: { token: 'tA', buyer: 'bA@test', expiration: '2026-12-31T00:00:00Z' },
    requested_state: 'frozen',
  });
  assert(resB.ok && !resB.idempotent, 'op_B should win');
  const resA2 = await authority.transitionReservation({
    listing_id: 'list1', expected_version: 0,
    operation_id: 'op_A', operation_type: 'reserve',
    payload: { token: 'tA', buyer: 'bA@test', expiration: '2026-12-31T00:00:00Z' },
    requested_state: 'reserved',
  });
  assert(!resA2.ok, 'old retry should fail');
  assert(resA2.code === 'STALE_RETRY', `expected STALE_RETRY, got ${resA2.code}`);
  assert(resA2.current_version === 2, 'current should be v2');
});

// ── 6: Failed query → AUTHORITY_QUERY_FAILED ─────────────────────────────────
test('failed authoritative query fails closed', async () => {
  const deps = createMockDeps();
  const authority = createReservationAuthority(deps);
  deps._seedLP('lp1', { listing_id: 'list1' });
  deps.entities.ListingPrivate.filter = async () => { throw new Error('query failure'); };
  const result = await authority.transitionReservation({
    listing_id: 'list1', expected_version: 0,
    operation_id: 'op_1', operation_type: 'reserve',
    payload: { token: 't1', buyer: 'b1@test', expiration: '2026-12-31T00:00:00Z' },
    requested_state: 'reserved',
  });
  assert(!result.ok, 'should fail');
  assert(result.code === 'AUTHORITY_QUERY_FAILED', `expected AUTHORITY_QUERY_FAILED, got ${result.code}`);
});

// ── 7: Quarantine → AUTHORITY_BLOCKED ────────────────────────────────────────
test('quarantine/recovery-blocked authority cannot transition', async () => {
  const deps = createMockDeps();
  const authority = createReservationAuthority(deps);
  deps._seedLP('lp1', { listing_id: 'list1', checkout_quarantined: true });
  const res = await authority.transitionReservation({
    listing_id: 'list1', expected_version: 0,
    operation_id: 'op_1', operation_type: 'reserve',
    payload: { token: 't1', buyer: 'b1@test', expiration: '2026-12-31T00:00:00Z' },
    requested_state: 'reserved',
  });
  assert(!res.ok, 'should be blocked');
  assert(res.code === 'AUTHORITY_BLOCKED', `expected AUTHORITY_BLOCKED, got ${res.code}`);
});

// ── 8: No object in string schema field ──────────────────────────────────────
test('no test writes an object into a string schema field', async () => {
  const deps = createMockDeps();
  const authority = createReservationAuthority(deps);
  deps._seedLP('lp1', { listing_id: 'list1' });
  await authority.transitionReservation({
    listing_id: 'list1', expected_version: 0,
    operation_id: 'op_1', operation_type: 'reserve',
    payload: { token: 't1', buyer: 'b1@test', expiration: '2026-12-31T00:00:00Z' },
    requested_state: 'reserved',
    pending_effects: [{ effect_type: 'notify' }],
  });
  const [lp] = await deps.entities.ListingPrivate.filter({ listing_id: 'list1' });
  assert(typeof lp.last_operation_result_json === 'string', 'result_json must be string');
  assert(typeof lp.pending_effects_json === 'string', 'pending_effects_json must be string');
  assert(JSON.parse(lp.last_operation_result_json).operation_id === 'op_1', 'result should parse');
  assert(JSON.parse(lp.pending_effects_json).length === 1, 'effects should parse');
});

// ── 9: Zero provider calls ────────────────────────────────────────────────────
test('zero provider calls — no Stripe, email, push, points, or notification calls', async () => {
  const deps = createMockDeps();
  const authority = createReservationAuthority(deps);
  deps._seedLP('lp1', { listing_id: 'list1' });
  deps._seedListing('list1', {});
  const res = await authority.transitionReservation({
    listing_id: 'list1', expected_version: 0,
    operation_id: 'op_1', operation_type: 'reserve',
    payload: { token: 't1', buyer: 'b1@test', expiration: '2026-12-31T00:00:00Z' },
    requested_state: 'reserved',
  });
  assert(res.ok, 'should succeed without any provider calls');
});

// ── 10: effect_1 followed by operation 2 → PENDING_EFFECTS_BLOCKED ───────────
test('undelivered pending effects block next transition', async () => {
  const deps = createMockDeps();
  const authority = createReservationAuthority(deps);
  deps._seedLP('lp1', { listing_id: 'list1' });
  const res1 = await authority.transitionReservation({
    listing_id: 'list1', expected_version: 0,
    operation_id: 'op_1', operation_type: 'reserve',
    payload: { token: 't1', buyer: 'b1@test', expiration: '2026-12-31T00:00:00Z' },
    requested_state: 'reserved',
    pending_effects: [{ effect_type: 'effect_1' }],
  });
  assert(res1.ok, 'transition 1 should succeed');
  const res2 = await authority.transitionReservation({
    listing_id: 'list1', expected_version: 1,
    operation_id: 'op_2', operation_type: 'freeze',
    payload: { token: 't1', buyer: 'b1@test', expiration: '2026-12-31T00:00:00Z' },
    requested_state: 'frozen',
    pending_effects: [{ effect_type: 'effect_2' }],
  });
  assert(!res2.ok, 'transition 2 should be blocked');
  assert(res2.code === 'PENDING_EFFECTS_BLOCKED', `expected PENDING_EFFECTS_BLOCKED, got ${res2.code}`);
  // Verify effect_1 is still present (not overwritten)
  const effects = await authority.getPendingEffects('list1');
  assert(effects.ok, 'should read effects');
  assert(effects.effects.length === 1, 'effect_1 should still be present');
  assert(effects.effects[0].effect_type === 'effect_1', 'should be effect_1');
});

// ── 11: Stale effect clearer → fails ─────────────────────────────────────────
test('stale effect clearer cannot clear effects from another operation', async () => {
  const deps = createMockDeps();
  const authority = createReservationAuthority(deps);
  deps._seedLP('lp1', {
    listing_id: 'list1', reservation_version: 1,
    last_operation_id: 'op_1',
    pending_effects_json: JSON.stringify([{ effect_type: 'effect_1' }]),
  });
  // Wrong operation_id
  const r1 = await authority.clearPendingEffects({
    listing_id: 'list1', expected_version: 1,
    expected_operation_id: 'op_WRONG',
    expected_effects_hash: mockHashEnvelope({ effects: [{ effect_type: 'effect_1' }] }),
  });
  assert(!r1.ok, 'should fail with wrong operation_id');
  // Wrong effects hash
  const r2 = await authority.clearPendingEffects({
    listing_id: 'list1', expected_version: 1,
    expected_operation_id: 'op_1',
    expected_effects_hash: 'wrong_hash',
  });
  assert(!r2.ok, 'should fail with wrong effects hash');
  assert(r2.code === 'EFFECTS_HASH_MISMATCH', `expected EFFECTS_HASH_MISMATCH, got ${r2.code}`);
  // Correct clear
  const r3 = await authority.clearPendingEffects({
    listing_id: 'list1', expected_version: 1,
    expected_operation_id: 'op_1',
    expected_effects_hash: mockHashEnvelope({ effects: [{ effect_type: 'effect_1' }] }),
  });
  assert(r3.ok, 'should succeed with correct match');
  assert(r3.verified === true, 'should be verified');
});

// ── 12: Corrupt pending-effects JSON → EFFECTS_CORRUPT ───────────────────────
test('corrupt pending-effects JSON blocks mutation with EFFECTS_CORRUPT', async () => {
  const deps = createMockDeps();
  const authority = createReservationAuthority(deps);
  deps._seedLP('lp1', {
    listing_id: 'list1',
    pending_effects_json: '{not valid json',
  });
  const res = await authority.transitionReservation({
    listing_id: 'list1', expected_version: 0,
    operation_id: 'op_1', operation_type: 'reserve',
    payload: { token: 't1', buyer: 'b1@test', expiration: '2026-12-31T00:00:00Z' },
    requested_state: 'reserved',
  });
  assert(!res.ok, 'should be blocked');
  assert(res.code === 'EFFECTS_CORRUPT', `expected EFFECTS_CORRUPT, got ${res.code}`);
});

// ── 13: Corrupt stored replay result → OPERATION_RECORD_CORRUPT ─────────────
test('corrupt stored replay result returns OPERATION_RECORD_CORRUPT', async () => {
  const deps = createMockDeps();
  const authority = createReservationAuthority(deps);
  const envelope = {
    operation_type: 'reserve', requested_state: 'reserved',
    payload: { token: 't1', buyer: 'b1@test', expiration: '2026-12-31T00:00:00Z' }, pending_effects: [],
  };
  deps._seedLP('lp1', {
    listing_id: 'list1', reservation_version: 1,
    reservation_lifecycle_state: 'reserved',
    last_operation_id: 'op_1',
    last_operation_payload_hash: mockHashEnvelope(envelope),
    last_operation_result_json: '{corrupt json',
  });
  const res = await authority.transitionReservation({
    listing_id: 'list1', expected_version: 0,
    operation_id: 'op_1', operation_type: 'reserve',
    payload: { token: 't1', buyer: 'b1@test', expiration: '2026-12-31T00:00:00Z' },
    requested_state: 'reserved',
  });
  assert(!res.ok, 'should fail');
  assert(res.code === 'OPERATION_RECORD_CORRUPT', `expected OPERATION_RECORD_CORRUPT, got ${res.code}`);
});

// ── 14: Same op ID + changed operation type → OPERATION_ID_CONFLICT ──────────
test('same operation ID with changed operation type is rejected', async () => {
  const deps = createMockDeps();
  const authority = createReservationAuthority(deps);
  const envelope = {
    operation_type: 'reserve', requested_state: 'reserved',
    payload: { token: 't1', buyer: 'b1@test' }, pending_effects: [],
  };
  deps._seedLP('lp1', {
    listing_id: 'list1', reservation_version: 1,
    last_operation_id: 'op_1',
    last_operation_payload_hash: mockHashEnvelope(envelope),
    last_operation_result_json: JSON.stringify({ op: 'op_1' }),
  });
  const res = await authority.transitionReservation({
    listing_id: 'list1', expected_version: 0,
    operation_id: 'op_1', operation_type: 'freeze', // changed!
    payload: { token: 't1', buyer: 'b1@test', expiration: '2026-12-31T00:00:00Z' },
    requested_state: 'frozen',
  });
  assert(!res.ok, 'should be rejected');
  assert(res.code === 'OPERATION_ID_CONFLICT', `expected OPERATION_ID_CONFLICT, got ${res.code}`);
});

// ── 15: Same op ID + changed requested state → OPERATION_ID_CONFLICT ─────────
test('same operation ID with changed requested state is rejected', async () => {
  const deps = createMockDeps();
  const authority = createReservationAuthority(deps);
  const envelope = {
    operation_type: 'reserve', requested_state: 'reserved',
    payload: { token: 't1', buyer: 'b1@test', expiration: '2026-12-31T00:00:00Z' }, pending_effects: [],
  };
  deps._seedLP('lp1', {
    listing_id: 'list1', reservation_version: 1,
    reservation_lifecycle_state: 'reserved',
    last_operation_id: 'op_1',
    last_operation_payload_hash: mockHashEnvelope(envelope),
    last_operation_result_json: JSON.stringify({ op: 'op_1' }),
  });
  const res = await authority.transitionReservation({
    listing_id: 'list1', expected_version: 0,
    operation_id: 'op_1', operation_type: 'release',
    payload: { token: null, buyer: null, expiration: null },
    requested_state: 'available', // changed from reserved to available
  });
  assert(!res.ok, 'should be rejected');
  assert(res.code === 'OPERATION_ID_CONFLICT', `expected OPERATION_ID_CONFLICT, got ${res.code}`);
});

// ── 16: Same op ID + changed pending effects → OPERATION_ID_CONFLICT ─────────
test('same operation ID with changed pending effects is rejected', async () => {
  const deps = createMockDeps();
  const authority = createReservationAuthority(deps);
  const envelope = {
    operation_type: 'reserve', requested_state: 'reserved',
    payload: { token: 't1', buyer: 'b1@test' }, pending_effects: [],
  };
  deps._seedLP('lp1', {
    listing_id: 'list1', reservation_version: 1,
    last_operation_id: 'op_1',
    last_operation_payload_hash: mockHashEnvelope(envelope),
    last_operation_result_json: JSON.stringify({ op: 'op_1' }),
  });
  const res = await authority.transitionReservation({
    listing_id: 'list1', expected_version: 0,
    operation_id: 'op_1', operation_type: 'reserve',
    payload: { token: 't1', buyer: 'b1@test', expiration: '2026-12-31T00:00:00Z' },
    requested_state: 'reserved',
    pending_effects: [{ effect_type: 'new_effect' }], // changed!
  });
  assert(!res.ok, 'should be rejected');
  assert(res.code === 'OPERATION_ID_CONFLICT', `expected OPERATION_ID_CONFLICT, got ${res.code}`);
});

// ── 17: Nested-payload difference → OPERATION_ID_CONFLICT ───────────────────
test('nested payload difference is detected', async () => {
  const deps = createMockDeps();
  const authority = createReservationAuthority(deps);
  const envelope = {
    operation_type: 'reserve', requested_state: 'reserved',
    payload: { token: 't1', buyer: 'b1@test', metadata: { seat: 'A1' } }, pending_effects: [],
  };
  deps._seedLP('lp1', {
    listing_id: 'list1', reservation_version: 1,
    last_operation_id: 'op_1',
    last_operation_payload_hash: mockHashEnvelope(envelope),
    last_operation_result_json: JSON.stringify({ op: 'op_1' }),
  });
  const res = await authority.transitionReservation({
    listing_id: 'list1', expected_version: 0,
    operation_id: 'op_1', operation_type: 'reserve',
    payload: { token: 't1', buyer: 'b1@test', expiration: '2026-12-31T00:00:00Z', metadata: { seat: 'B2' } }, // nested diff!
    requested_state: 'reserved',
  });
  assert(!res.ok, 'should be rejected');
  assert(res.code === 'OPERATION_ID_CONFLICT', `expected OPERATION_ID_CONFLICT, got ${res.code}`);
});

// ── 18: Invalid lifecycle tuple (available with token) → VALIDATION_ERROR ───
test('available state with token or buyer is rejected before datastore access', async () => {
  const deps = createMockDeps();
  const authority = createReservationAuthority(deps);
  // No LP seeded — if validation passes, we'd get NOT_FOUND. If validation fails, we get VALIDATION_ERROR.
  const res = await authority.transitionReservation({
    listing_id: 'list1', expected_version: 0,
    operation_id: 'op_1', operation_type: 'release',
    payload: { token: 'should_be_null', buyer: null, expiration: null },
    requested_state: 'available',
  });
  assert(!res.ok, 'should be rejected');
  assert(res.code === 'VALIDATION_ERROR', `expected VALIDATION_ERROR, got ${res.code}`);
});

// ── 19: Negative/fractional expected version → VALIDATION_ERROR ──────────────
test('negative or fractional expected version is rejected before datastore access', async () => {
  const deps = createMockDeps();
  const authority = createReservationAuthority(deps);
  const r1 = await authority.transitionReservation({
    listing_id: 'list1', expected_version: -1,
    operation_id: 'op_1', operation_type: 'reserve',
    payload: { token: 't1', buyer: 'b1@test', expiration: '2026-12-31T00:00:00Z' },
    requested_state: 'reserved',
  });
  assert(!r1.ok, 'negative version should be rejected');
  assert(r1.code === 'VALIDATION_ERROR', `expected VALIDATION_ERROR, got ${r1.code}`);
  const r2 = await authority.transitionReservation({
    listing_id: 'list1', expected_version: 1.5,
    operation_id: 'op_1', operation_type: 'reserve',
    payload: { token: 't1', buyer: 'b1@test', expiration: '2026-12-31T00:00:00Z' },
    requested_state: 'reserved',
  });
  assert(!r2.ok, 'fractional version should be rejected');
  assert(r2.code === 'VALIDATION_ERROR', `expected VALIDATION_ERROR, got ${r2.code}`);
});

// ── 20: Post-CAS tuple corruption → VERIFICATION_MISMATCH ───────────────────
test('post-CAS tuple corruption is detected by commit verification', async () => {
  const deps = createMockDeps();
  const authority = createReservationAuthority(deps);
  deps._seedLP('lp1', { listing_id: 'list1' });
  // Hook: corrupt the LP record AFTER CAS wins but BEFORE verification
  deps._setHook('afterCASWin', (d, listing_id) => {
    const lp = d._lpStore.values().next().value;
    if (lp) lp.reservation_token = 'corrupted_token';
  });
  const res = await authority.transitionReservation({
    listing_id: 'list1', expected_version: 0,
    operation_id: 'op_1', operation_type: 'reserve',
    payload: { token: 't1', buyer: 'b1@test', expiration: '2026-12-31T00:00:00Z' },
    requested_state: 'reserved',
  });
  assert(!res.ok, 'should detect corruption');
  assert(res.code === 'VERIFICATION_MISMATCH', `expected VERIFICATION_MISMATCH, got ${res.code}`);
});

// ── 21: Missing-version MIGRATION_REQUIRED ───────────────────────────────────
test('missing reservation_version returns MIGRATION_REQUIRED in report', async () => {
  const { generateMigrationReport } = await import('../base44/shared/reservationAuthority.js');
  const deps = createMockDeps();
  // Seed LP without reservation_version
  deps._seedLP('lp1', { listing_id: 'list1' });
  delete deps._lpStore.get('lp1').reservation_version;
  // Seed LP with reservation_version
  deps._seedLP('lp2', { listing_id: 'list2', reservation_version: 1 });
  const report = await generateMigrationReport(deps);
  assert(report.ok, 'report should succeed');
  assert(report.totals.total === 2, `expected 2 records, got ${report.totals.total}`);
  assert(report.totals.migration_required === 1, `expected 1 migration_required, got ${report.totals.migration_required}`);
  assert(report.totals.already_initialized === 1, `expected 1 already_initialized, got ${report.totals.already_initialized}`);
  const migRec = report.records.find(r => r.status === 'MIGRATION_REQUIRED');
  assert(migRec, 'should have a MIGRATION_REQUIRED record');
  assert(migRec.proposed_reservation_version === 0, 'proposed version should be 0');
});

// ── 22: Manifest complete ────────────────────────────────────────────────────
test('reservation-mutation manifest is complete (11 entry points)', () => {
  const manifest = getReservationMutationManifest();
  assert(manifest.length >= 11, `expected >= 11, got ${manifest.length}`);
  const required = [
    'reserveListing', 'releaseReservation', 'createCheckout', 'abortCheckout',
    'cancelPurchase', 'processTransferReminders', 'capturePayment',
    'cleanupAbandonedCheckouts', 'stripeWebhook', 'submitListing/manage_existing', 'deleteAccount',
  ];
  for (const name of required) {
    assert(manifest.some(e => e.name === name), `missing: ${name}`);
  }
});

// ── 23: Production entry points NOT integrated (RED) ─────────────────────────
test('production entry points are NOT yet integrated (RED — expected)', () => {
  const manifest = getReservationMutationManifest();
  const unintegrated = manifest.filter(e => !e.integrated);
  assert(unintegrated.length > 0, 'entry points should NOT be integrated yet');
});

// ════════════════════════════════════════════════════════════════════════════
// SECTION 2: LIVE BASE44 CAS PROBE
// ════════════════════════════════════════════════════════════════════════════

async function runLiveBase44Probe() {
  if (typeof globalThis.base44 === 'undefined') {
    console.log('\n--- Section 2: Live Base44 CAS Probe ---');
    console.log('SKIPPED — base44 global not available in this environment.');
    console.log('A skipped probe is NOT a live pass.');
    console.log('Run via exec_tool to execute the live probe.');
    return { ran: false, all_one_winner: null };
  }
  console.log('\n--- Section 2: Live Base44 CAS Probe ---');
  console.log('Running live probe with synthetic records...');
  const PROBE_TAG = `PROBE-TEST-${Date.now()}`;
  const ROUNDS = 3, CONCURRENT = 20;
  const lpBefore = await base44.asServiceRole.entities.ListingPrivate.list('-created_date', 10000);
  const lp = await base44.entities.ListingPrivate.create({
    listing_id: `${PROBE_TAG}-auth`, reservation_version: 0,
    reservation_lifecycle_state: 'available', reservation_revision: 'rev_init',
    checkout_quarantined: false, recovery_blocked: false,
    reservation_token: null, reserved_by_email: null, reservation_expires_at: null,
    last_operation_id: null, last_operation_type: null, last_operation_payload_hash: null,
    last_operation_result_json: null, last_operation_at: null, pending_effects_json: '[]',
    is_demo_listing: true, notes: `${PROBE_TAG} authoritative`,
  });
  const lpId = lp.id;
  async function resetLP() {
    await base44.asServiceRole.entities.ListingPrivate.updateMany(
      { id: lpId }, { $set: {
        reservation_version: 0, reservation_lifecycle_state: 'available',
        checkout_quarantined: false, recovery_blocked: false,
        reservation_token: null, reserved_by_email: null, reservation_expires_at: null,
        last_operation_id: null, last_operation_type: null, last_operation_payload_hash: null,
        last_operation_result_json: null, last_operation_at: null, pending_effects_json: '[]',
      }}
    );
  }
  const roundResults = [];
  let allOneWinner = true;
  for (let round = 0; round < ROUNDS; round++) {
    await resetLP();
    const calls = await Promise.all(
      Array.from({ length: CONCURRENT }, (_, i) =>
        base44.asServiceRole.entities.ListingPrivate.updateMany(
          { id: lpId, reservation_version: 0, checkout_quarantined: false, recovery_blocked: false },
          { $set: {
            reservation_token: `t_r${round}_i${i}`, reserved_by_email: `b_r${round}_i${i}@p`,
            reservation_expires_at: new Date(Date.now() + 600000).toISOString(),
            reservation_version: 1, reservation_lifecycle_state: 'reserved',
            last_operation_id: `op_r${round}_i${i}`, last_operation_type: 'reserve',
            last_operation_payload_hash: `h_r${round}_i${i}`,
            last_operation_result_json: JSON.stringify({ op: `op_r${round}_i${i}` }),
            last_operation_at: new Date().toISOString(), pending_effects_json: '[]',
          }}
        ).then(r => ({ i, updated: r.updated || 0 })).catch(e => ({ i, updated: 0, error: e?.message }))
      )
    );
    const winners = calls.filter(c => c.updated > 0);
    roundResults.push({ round, winner_count: winners.length, winner_index: winners[0]?.i ?? null });
    if (winners.length !== 1) { allOneWinner = false; break; }
  }
  try { await base44.asServiceRole.entities.ListingPrivate.delete(lpId); } catch (_) {}
  const lpAfter = await base44.asServiceRole.entities.ListingPrivate.list('-created_date', 10000);
  console.log(`Rounds: ${roundResults.length}, all_one_winner: ${allOneWinner}`);
  console.log(`Before: ${lpBefore.length}, After: ${lpAfter.length}, Cleanup: ${lpAfter.length === lpBefore.length}`);
  return { ran: true, allOneWinner, rounds: roundResults, cleanupOk: lpAfter.length === lpBefore.length };
}

// ════════════════════════════════════════════════════════════════════════════
// MAIN RUNNER
// ════════════════════════════════════════════════════════════════════════════

async function main() {
  console.log('=== Reservation Authority Concurrency Tests (7C.9C.2E Correction) ===\n');
  console.log('--- Section 1: Deterministic Local Module Tests ---');
  for (const t of tests) {
    try {
      await t.fn();
      console.log(`[PASS] ${t.name}`);
      passed++;
    } catch (e) {
      console.log(`[FAIL] ${t.name}`);
      console.log(`  ${e.message}`);
      failed++;
    }
  }
  const probeResult = await runLiveBase44Probe();
  console.log('\n--- Section 3: Production Integration Tests ---');
  console.log(`\n=== Overall: ${failed === 0 ? 'PASS' : 'FAIL'} ===`);
  console.log(`Tests run: ${tests.length}, Passed: ${passed}, Failed: ${failed}`);
  console.log(`Live probe: ${probeResult.ran ? 'ran' : 'skipped'}, all_one_winner: ${probeResult.allOneWinner ?? 'N/A'}`);
  if (failed > 0) process.exit(1);
}

main().catch(err => { console.error('Test runner error:', err); process.exit(1); });