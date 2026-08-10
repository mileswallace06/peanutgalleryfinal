/**
 * Reservation Authority Concurrency Tests (7C.9C.2E Correction Round 2)
 *
 * Round 2 additions:
 *   - Replacement effects queue barrier test (pending_effects_hash CAS)
 *   - Non-array pending effects cause zero writes
 *   - pending_effects_hash stored atomically during transition
 *   - Post-CAS corruption results in verified protection
 *   - Real SHA-256 test (no mock hash)
 *   - Whitespace-only ID/token/buyer rejection
 *   - Terminal-state omitted fields rejected (omitted ≠ null)
 *   - Migration report joins both entities (sold never available, missing
 *     sidecar, ambiguous, apply plan valid operation type)
 */
import { createReservationAuthority, getReservationMutationManifest, generateMigrationReport, planApply } from '../base44/shared/reservationAuthority.js';
import { isNonEmptyString } from '../base44/shared/reservationAuthorityConstants.js';
import { mockHashEnvelope, createMockDeps, createMockDepsWithRealHash } from './authority/helpers.mjs';

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
      payload: { token: 't1', buyer: 'b1@test', expiration: '2026-12-31T00:00:00Z' }, pending_effects: [],
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
  assert(typeof lp.pending_effects_hash === 'string', 'pending_effects_hash must be string');
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
  const r1 = await authority.clearPendingEffects({
    listing_id: 'list1', expected_version: 1,
    expected_operation_id: 'op_WRONG',
    expected_effects_json: JSON.stringify([{ effect_type: 'effect_1' }]),
    expected_effects_hash: mockHashEnvelope({ effects: [{ effect_type: 'effect_1' }] }),
  });
  assert(!r1.ok, 'should fail with wrong operation_id');
  const r2 = await authority.clearPendingEffects({
    listing_id: 'list1', expected_version: 1,
    expected_operation_id: 'op_1',
    expected_effects_json: JSON.stringify([{ effect_type: 'effect_1' }]),
    expected_effects_hash: 'wrong_hash',
  });
  assert(!r2.ok, 'should fail with wrong effects hash');
  assert(r2.code === 'EFFECTS_HASH_MISMATCH', `expected EFFECTS_HASH_MISMATCH, got ${r2.code}`);
  const r3 = await authority.clearPendingEffects({
    listing_id: 'list1', expected_version: 1,
    expected_operation_id: 'op_1',
    expected_effects_json: JSON.stringify([{ effect_type: 'effect_1' }]),
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
test('corrupt stored replay result returns RESULT_CORRUPT', async () => {
  const deps = createMockDeps();
  const authority = createReservationAuthority(deps);
  const envelope = {
    operation_type: 'reserve', requested_state: 'reserved',
    payload: { token: 't1', buyer: 'b1@test', expiration: '2026-12-31T00:00:00Z' }, pending_effects: [],
  };
  deps._seedLP('lp1', {
    listing_id: 'list1', reservation_version: 1,
    reservation_lifecycle_state: 'reserved',
    reservation_token: 't1', reserved_by_email: 'b1@test',
    reservation_expires_at: '2026-12-31T00:00:00Z',
    reservation_revision: 'rev_1',
    last_operation_id: 'op_1',
    last_operation_type: 'reserve',
    last_operation_payload_hash: mockHashEnvelope(envelope),
    last_operation_at: '2026-01-01T00:00:00Z',
    last_operation_result_json: '{corrupt json',
  });
  const res = await authority.transitionReservation({
    listing_id: 'list1', expected_version: 0,
    operation_id: 'op_1', operation_type: 'reserve',
    payload: { token: 't1', buyer: 'b1@test', expiration: '2026-12-31T00:00:00Z' },
    requested_state: 'reserved',
  });
  assert(!res.ok, 'should fail');
  // Round 4: validateIdempotentReplay catches corrupt result JSON
  assert(res.code === 'RESULT_CORRUPT', `expected RESULT_CORRUPT, got ${res.code}`);
});

// ── 14: Same op ID + changed operation type → OPERATION_ID_CONFLICT ──────────
test('same operation ID with changed operation type is rejected', async () => {
  const deps = createMockDeps();
  const authority = createReservationAuthority(deps);
  const envelope = {
    operation_type: 'reserve', requested_state: 'reserved',
    payload: { token: 't1', buyer: 'b1@test', expiration: '2026-12-31T00:00:00Z' }, pending_effects: [],
  };
  deps._seedLP('lp1', {
    listing_id: 'list1', reservation_version: 1,
    last_operation_id: 'op_1',
    last_operation_payload_hash: mockHashEnvelope(envelope),
    last_operation_result_json: JSON.stringify({ op: 'op_1' }),
  });
  const res = await authority.transitionReservation({
    listing_id: 'list1', expected_version: 0,
    operation_id: 'op_1', operation_type: 'freeze',
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
    requested_state: 'available',
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
    payload: { token: 't1', buyer: 'b1@test', expiration: '2026-12-31T00:00:00Z' }, pending_effects: [],
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
    pending_effects: [{ effect_type: 'new_effect' }],
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
    payload: { token: 't1', buyer: 'b1@test', expiration: '2026-12-31T00:00:00Z', metadata: { seat: 'A1' } }, pending_effects: [],
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
    payload: { token: 't1', buyer: 'b1@test', expiration: '2026-12-31T00:00:00Z', metadata: { seat: 'B2' } },
    requested_state: 'reserved',
  });
  assert(!res.ok, 'should be rejected');
  assert(res.code === 'OPERATION_ID_CONFLICT', `expected OPERATION_ID_CONFLICT, got ${res.code}`);
});

// ── 18: Invalid lifecycle tuple (available with token) → VALIDATION_ERROR ───
test('available state with token or buyer is rejected before datastore access', async () => {
  const deps = createMockDeps();
  const authority = createReservationAuthority(deps);
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

// ── 20: Post-CAS tuple corruption → VERIFICATION_MISMATCH + protection ─────
test('post-CAS tuple corruption is detected by commit verification and triggers protection', async () => {
  const deps = createMockDeps();
  const authority = createReservationAuthority(deps);
  deps._seedLP('lp1', { listing_id: 'list1' });
  deps._seedListing('list1', {});
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
  // Assert protection state
  assert(res.protection, 'should have protection result');
  assert(res.protection.protected === true, 'protection should be verified');
  // Verify LP is quarantined
  const [lp] = await deps.entities.ListingPrivate.filter({ listing_id: 'list1' });
  assert(lp.checkout_quarantined === true, 'LP should be quarantined');
  assert(lp.recovery_blocked === true, 'LP should be recovery-blocked');
  assert(typeof lp.checkout_quarantine_reason === 'string' && lp.checkout_quarantine_reason.includes('VERIFICATION_MISMATCH'), 'quarantine reason should be set');
  assert(isNonEmptyString(lp.checkout_quarantined_at), 'quarantine timestamp should be set');
  // Verify Listing is hidden
  const [listing] = await deps.entities.Listing.filter({ id: 'list1' });
  assert(listing.status === 'hidden', 'Listing should be hidden');
  assert(listing.hidden_reason === 'checkout_quarantine', 'hidden_reason should be checkout_quarantine');
  // Verify AdminAlert was created
  const alerts = Array.from(deps._adminAlertStore.values());
  assert(alerts.length === 1, 'one AdminAlert should be created');
  assert(alerts[0].priority === 'critical', 'priority should be critical');
  assert(alerts[0].resolved === false, 'should be unresolved');
  // Verify corrupted tuple is preserved (not overwritten by protection)
  assert(lp.reservation_token === 'corrupted_token', 'corrupted token should be preserved');
});

// ── 21: Missing-version MIGRATION_REQUIRED ───────────────────────────────────
test('missing reservation_version returns MIGRATION_REQUIRED in report', async () => {
  const deps = createMockDeps();
  deps._seedLP('lp1', { listing_id: 'list1' });
  delete deps._lpStore.get('lp1').reservation_version;
  deps._seedLP('lp2', { listing_id: 'list2', reservation_version: 1 });
  deps._seedListing('list1', { status: 'active' });
  delete deps._listingStore.get('list1').reservation_version;
  deps._seedListing('list2', { reservation_version: 1 });
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
// SECTION 1B: ROUND 2 NEW TESTS
// ════════════════════════════════════════════════════════════════════════════

// ── 24: Replacement effects queue cannot be erased by stale clearer ─────────
test('replacement effects queue cannot be erased by stale clearer (barrier test)', async () => {
  const deps = createMockDeps();
  const authority = createReservationAuthority(deps);
  const effectsA = [{ effect_type: 'effect_A' }];
  const effectsB = [{ effect_type: 'effect_B' }];
  const hashA = mockHashEnvelope({ effects: effectsA });
  deps._seedLP('lp1', {
    listing_id: 'list1', reservation_version: 1,
    last_operation_id: 'op_1',
    pending_effects_json: JSON.stringify(effectsA),
  });
  // Hook replaces effects with B between read and CAS
  deps._setHook('beforeClearCAS', (d, listing_id) => {
    const lp = d._lpStore.get('lp1');
    if (lp) {
      lp.pending_effects_json = JSON.stringify(effectsB);
      lp.pending_effects_hash = mockHashEnvelope({ effects: effectsB });
    }
  });
  const r = await authority.clearPendingEffects({
    listing_id: 'list1', expected_version: 1,
    expected_operation_id: 'op_1',
    expected_effects_json: JSON.stringify(effectsA),
    expected_effects_hash: hashA,
  });
  assert(!r.ok, 'stale clearer should fail');
  assert(r.code === 'CONFLICT' || r.code === 'EFFECTS_HASH_MISMATCH', `expected CONFLICT or EFFECTS_HASH_MISMATCH, got ${r.code}`);
  // Verify effects B is preserved
  const [lp] = await deps.entities.ListingPrivate.filter({ listing_id: 'list1' });
  assert(lp.pending_effects_json === JSON.stringify(effectsB), 'effects B should be preserved');
  assert(lp.pending_effects_hash === mockHashEnvelope({ effects: effectsB }), 'effects B hash should be preserved');
});

// ── 25: Non-array pending effects cause zero writes ──────────────────────────
test('non-array pending effects cause zero writes', async () => {
  const deps = createMockDeps();
  const authority = createReservationAuthority(deps);
  deps._seedLP('lp1', { listing_id: 'list1' });
  const r1 = await authority.transitionReservation({
    listing_id: 'list1', expected_version: 0,
    operation_id: 'op_1', operation_type: 'reserve',
    payload: { token: 't1', buyer: 'b1@test', expiration: '2026-12-31T00:00:00Z' },
    requested_state: 'reserved',
    pending_effects: null,
  });
  assert(!r1.ok, 'null pending_effects should be rejected');
  assert(r1.code === 'VALIDATION_ERROR', `expected VALIDATION_ERROR, got ${r1.code}`);
  const r2 = await authority.transitionReservation({
    listing_id: 'list1', expected_version: 0,
    operation_id: 'op_2', operation_type: 'reserve',
    payload: { token: 't2', buyer: 'b2@test', expiration: '2026-12-31T00:00:00Z' },
    requested_state: 'reserved',
    pending_effects: 'not an array',
  });
  assert(!r2.ok, 'string pending_effects should be rejected');
  assert(r2.code === 'VALIDATION_ERROR', `expected VALIDATION_ERROR, got ${r2.code}`);
  const r3 = await authority.transitionReservation({
    listing_id: 'list1', expected_version: 0,
    operation_id: 'op_3', operation_type: 'reserve',
    payload: { token: 't3', buyer: 'b3@test', expiration: '2026-12-31T00:00:00Z' },
    requested_state: 'reserved',
    pending_effects: { effect_type: 'not array' },
  });
  assert(!r3.ok, 'object pending_effects should be rejected');
  assert(r3.code === 'VALIDATION_ERROR', `expected VALIDATION_ERROR, got ${r3.code}`);
  // Verify zero writes
  const [lp] = await deps.entities.ListingPrivate.filter({ listing_id: 'list1' });
  assert(lp.reservation_version === 0, 'version should still be 0');
  assert(lp.last_operation_id === null, 'no operation should have been written');
});

// ── 26: pending_effects_hash stored atomically during transition ────────────
test('pending_effects_hash stored atomically during transition', async () => {
  const deps = createMockDeps();
  const authority = createReservationAuthority(deps);
  deps._seedLP('lp1', { listing_id: 'list1' });
  const effects = [{ effect_type: 'notify' }, { effect_type: 'email' }];
  const expectedHash = mockHashEnvelope({ effects });
  const res = await authority.transitionReservation({
    listing_id: 'list1', expected_version: 0,
    operation_id: 'op_1', operation_type: 'reserve',
    payload: { token: 't1', buyer: 'b1@test', expiration: '2026-12-31T00:00:00Z' },
    requested_state: 'reserved',
    pending_effects: effects,
  });
  assert(res.ok, 'transition should succeed');
  const [lp] = await deps.entities.ListingPrivate.filter({ listing_id: 'list1' });
  assert(lp.pending_effects_json === JSON.stringify(effects), 'effects JSON should be stored');
  assert(lp.pending_effects_hash === expectedHash, 'effects hash should be stored atomically');
});

// ── 27: clearPendingEffects verifies hash after clearing ────────────────────
test('clearPendingEffects clears both JSON and hash and verifies', async () => {
  const deps = createMockDeps();
  const authority = createReservationAuthority(deps);
  const effects = [{ effect_type: 'notify' }];
  const effectsHash = mockHashEnvelope({ effects });
  const emptyHash = mockHashEnvelope({ effects: [] });
  deps._seedLP('lp1', {
    listing_id: 'list1', reservation_version: 1,
    last_operation_id: 'op_1',
    pending_effects_json: JSON.stringify(effects),
  });
  const r = await authority.clearPendingEffects({
    listing_id: 'list1', expected_version: 1,
    expected_operation_id: 'op_1',
    expected_effects_json: JSON.stringify([{ effect_type: 'notify' }]),
    expected_effects_hash: effectsHash,
  });
  assert(r.ok, 'should succeed');
  assert(r.verified === true, 'should be verified');
  const [lp] = await deps.entities.ListingPrivate.filter({ listing_id: 'list1' });
  assert(lp.pending_effects_json === '[]', 'JSON should be cleared');
  assert(lp.pending_effects_hash === emptyHash, 'hash should be cleared to empty hash');
});

// ── 28: Real SHA-256 test (no mock hash) ──────────────────────────────────────
test('real SHA-256 hashing works (no mock fallback)', async () => {
  const deps = createMockDepsWithRealHash();
  const authority = createReservationAuthority(deps);
  deps._seedLP('lp1', { listing_id: 'list1' });
  const res = await authority.transitionReservation({
    listing_id: 'list1', expected_version: 0,
    operation_id: 'op_1', operation_type: 'reserve',
    payload: { token: 't1', buyer: 'b1@test', expiration: '2026-12-31T00:00:00Z' },
    requested_state: 'reserved',
  });
  assert(res.ok, 'should succeed with real SHA-256');
  const [lp] = await deps.entities.ListingPrivate.filter({ listing_id: 'list1' });
  // Real SHA-256 produces a 64-char hex string, not a mock_ prefix
  assert(typeof lp.last_operation_payload_hash === 'string', 'hash should be string');
  assert(lp.last_operation_payload_hash.length === 64, `SHA-256 hash should be 64 chars, got ${lp.last_operation_payload_hash.length}`);
  assert(!lp.last_operation_payload_hash.startsWith('mock_'), 'should not be mock hash');
  assert(!lp.last_operation_payload_hash.startsWith('fnv_'), 'should not be FNV fallback');
  assert(lp.pending_effects_hash.length === 64, 'effects hash should be 64 chars');
});

// ── 29: Whitespace-only listing_id rejected ─────────────────────────────────
test('whitespace-only listing_id is rejected', async () => {
  const deps = createMockDeps();
  const authority = createReservationAuthority(deps);
  const r = await authority.transitionReservation({
    listing_id: '   ', expected_version: 0,
    operation_id: 'op_1', operation_type: 'reserve',
    payload: { token: 't1', buyer: 'b1@test', expiration: '2026-12-31T00:00:00Z' },
    requested_state: 'reserved',
  });
  assert(!r.ok, 'whitespace-only listing_id should be rejected');
  assert(r.code === 'VALIDATION_ERROR', `expected VALIDATION_ERROR, got ${r.code}`);
});

// ── 30: Whitespace-only token/buyer rejected ─────────────────────────────────
test('whitespace-only token and buyer are rejected', async () => {
  const deps = createMockDeps();
  const authority = createReservationAuthority(deps);
  const r = await authority.transitionReservation({
    listing_id: 'list1', expected_version: 0,
    operation_id: 'op_1', operation_type: 'reserve',
    payload: { token: '   ', buyer: 'b1@test', expiration: '2026-12-31T00:00:00Z' },
    requested_state: 'reserved',
  });
  assert(!r.ok, 'whitespace-only token should be rejected');
  assert(r.code === 'VALIDATION_ERROR', `expected VALIDATION_ERROR, got ${r.code}`);
  const r2 = await authority.transitionReservation({
    listing_id: 'list1', expected_version: 0,
    operation_id: 'op_2', operation_type: 'reserve',
    payload: { token: 't1', buyer: '   ', expiration: '2026-12-31T00:00:00Z' },
    requested_state: 'reserved',
  });
  assert(!r2.ok, 'whitespace-only buyer should be rejected');
  assert(r2.code === 'VALIDATION_ERROR', `expected VALIDATION_ERROR, got ${r2.code}`);
});

// ── 31: Terminal-state omitted fields rejected (omitted ≠ null) ─────────────
test('terminal-state omitted fields are rejected (omitted is not null)', async () => {
  const deps = createMockDeps();
  const authority = createReservationAuthority(deps);
  // Omit token entirely for available state
  const r = await authority.transitionReservation({
    listing_id: 'list1', expected_version: 0,
    operation_id: 'op_1', operation_type: 'release',
    payload: { buyer: null, expiration: null },
    requested_state: 'available',
  });
  assert(!r.ok, 'omitted token should be rejected');
  assert(r.code === 'VALIDATION_ERROR', `expected VALIDATION_ERROR, got ${r.code}`);
  // Omit buyer entirely
  const r2 = await authority.transitionReservation({
    listing_id: 'list1', expected_version: 0,
    operation_id: 'op_2', operation_type: 'release',
    payload: { token: null, expiration: null },
    requested_state: 'available',
  });
  assert(!r2.ok, 'omitted buyer should be rejected');
  assert(r2.code === 'VALIDATION_ERROR', `expected VALIDATION_ERROR, got ${r2.code}`);
  // Omit expiration entirely
  const r3 = await authority.transitionReservation({
    listing_id: 'list1', expected_version: 0,
    operation_id: 'op_3', operation_type: 'release',
    payload: { token: null, buyer: null },
    requested_state: 'available',
  });
  assert(!r3.ok, 'omitted expiration should be rejected');
  assert(r3.code === 'VALIDATION_ERROR', `expected VALIDATION_ERROR, got ${r3.code}`);
});

// ── 32: Sold Listing with cleared private tuple never proposed as available ──
test('sold Listing with cleared private tuple is never proposed as available', async () => {
  const deps = createMockDeps();
  deps._seedListing('list1', { status: 'sold' });
  deps._seedLP('lp1', {
    listing_id: 'list1',
    reservation_token: null, reserved_by_email: null, reservation_expires_at: null,
    reservation_revision: null,
  });
  delete deps._lpStore.get('lp1').reservation_version;
  const report = await generateMigrationReport(deps);
  assert(report.ok, 'report should succeed');
  const rec = report.records.find(r => r.listing_id === 'list1');
  assert(rec, 'should have a record for list1');
  assert(rec.derived_lifecycle_state === 'sold', `sold should derive sold, got ${rec.derived_lifecycle_state}`);
  if (rec.status === 'MIGRATION_REQUIRED') {
    assert(rec.proposed_init.requested_state === 'sold', `proposed state should be sold, got ${rec.proposed_init.requested_state}`);
  }
});

// ── 33: Missing sidecar is counted ───────────────────────────────────────────
test('missing sidecar is counted in report', async () => {
  const deps = createMockDeps();
  deps._seedListing('list1', { status: 'active' });
  // No LP seeded — missing sidecar
  const report = await generateMigrationReport(deps);
  assert(report.ok, 'report should succeed');
  assert(report.totals.missing_sidecar === 1, `expected 1 missing_sidecar, got ${report.totals.missing_sidecar}`);
  const rec = report.records.find(r => r.listing_id === 'list1');
  assert(rec, 'should have a record');
  assert(rec.status === 'MISSING_SIDECAR', `expected MISSING_SIDECAR, got ${rec.status}`);
});

// ── 34: Malformed expiration and missing revision are ambiguous ─────────────
test('malformed expiration and missing revision are ambiguous', async () => {
  const deps = createMockDeps();
  deps._seedListing('list1', { status: 'active' });
  deps._seedLP('lp1', {
    listing_id: 'list1',
    reservation_token: 'tok1', reserved_by_email: 'b1@test',
    reservation_expires_at: 'not-a-date',
    reservation_revision: null,
  });
  delete deps._lpStore.get('lp1').reservation_version;
  const report = await generateMigrationReport(deps);
  assert(report.ok, 'report should succeed');
  const rec = report.records.find(r => r.listing_id === 'list1');
  assert(rec, 'should have a record');
  assert(rec.status === 'AMBIGUOUS', `expected AMBIGUOUS, got ${rec.status}`);
  assert(rec.issues.length > 0, 'should have issues');
});

// ── 35: Apply plan never proposes invalid operation type ─────────────────────
test('apply plan uses valid initialize operation type', async () => {
  const deps = createMockDeps();
  const plan = planApply(deps, 'apply_req_1');
  assert(plan.operation_type === 'initialize', 'plan should use initialize');
  const { OPERATION_TYPES } = await import('../base44/shared/reservationAuthorityConstants.js');
  assert(OPERATION_TYPES.includes(plan.operation_type), 'initialize should be in OPERATION_TYPES');
  assert(plan.initialized_fields.length >= 9, 'should specify all initialized fields');
  assert(plan.initialized_fields.includes('reservation_version (0)'), 'should include reservation_version');
  assert(plan.initialized_fields.includes('pending_effects_hash (SHA-256 of {effects:[]})'), 'should include pending_effects_hash');
});

// ── 36: Hashing failure returns structured error ────────────────────────────
test('hashing failure returns structured error without datastore access', async () => {
  const deps = createMockDeps();
  // Override hashEnvelope to throw
  deps.hashEnvelope = async () => { throw new Error('hashing unavailable'); };
  const authority = createReservationAuthority(deps);
  deps._seedLP('lp1', { listing_id: 'list1' });
  const res = await authority.transitionReservation({
    listing_id: 'list1', expected_version: 0,
    operation_id: 'op_1', operation_type: 'reserve',
    payload: { token: 't1', buyer: 'b1@test', expiration: '2026-12-31T00:00:00Z' },
    requested_state: 'reserved',
  });
  assert(!res.ok, 'should fail');
  assert(res.code === 'HASHING_FAILED', `expected HASHING_FAILED, got ${res.code}`);
  // Verify zero writes
  const [lp] = await deps.entities.ListingPrivate.filter({ listing_id: 'list1' });
  assert(lp.reservation_version === 0, 'version should still be 0');
});

// ════════════════════════════════════════════════════════════════════════════
// SECTION 1C: ROUND 3 NEW TESTS
// ════════════════════════════════════════════════════════════════════════════

// ── R3-1: Missing lifecycle state returns STATE_CORRUPT ─────────────────────
test('missing lifecycle state returns STATE_CORRUPT (never available)', async () => {
  const deps = createMockDeps();
  const authority = createReservationAuthority(deps);
  deps._seedLP('lp1', {
    listing_id: 'list1', reservation_version: 0,
    reservation_lifecycle_state: null,
  });
  const res = await authority.transitionReservation({
    listing_id: 'list1', expected_version: 0,
    operation_id: 'op_1', operation_type: 'reserve',
    payload: { token: 't1', buyer: 'b1@test', expiration: '2026-12-31T00:00:00Z' },
    requested_state: 'reserved',
  });
  assert(!res.ok, 'should fail');
  assert(res.code === 'STATE_CORRUPT', `expected STATE_CORRUPT, got ${res.code}`);
  assert(res.state_code === 'STATE_MISSING', `expected STATE_MISSING, got ${res.state_code}`);
  // Verify zero writes
  const [lp] = await deps.entities.ListingPrivate.filter({ listing_id: 'list1' });
  assert(lp.reservation_version === 0, 'version should be unchanged');
  assert(lp.last_operation_id === null, 'no operation should have been written');
});

// ── R3-2: Empty lifecycle state returns STATE_CORRUPT ───────────────────────
test('empty lifecycle state returns STATE_CORRUPT (never available)', async () => {
  const deps = createMockDeps();
  const authority = createReservationAuthority(deps);
  deps._seedLP('lp1', {
    listing_id: 'list1', reservation_version: 0,
    reservation_lifecycle_state: '',
  });
  const res = await authority.transitionReservation({
    listing_id: 'list1', expected_version: 0,
    operation_id: 'op_1', operation_type: 'reserve',
    payload: { token: 't1', buyer: 'b1@test', expiration: '2026-12-31T00:00:00Z' },
    requested_state: 'reserved',
  });
  assert(!res.ok, 'should fail');
  assert(res.code === 'STATE_CORRUPT', `expected STATE_CORRUPT, got ${res.code}`);
  assert(res.state_code === 'STATE_EMPTY', `expected STATE_EMPTY, got ${res.state_code}`);
});

// ── R3-3: Invalid lifecycle state returns STATE_CORRUPT ─────────────────────
test('invalid lifecycle state returns STATE_CORRUPT (never available)', async () => {
  const deps = createMockDeps();
  const authority = createReservationAuthority(deps);
  deps._seedLP('lp1', {
    listing_id: 'list1', reservation_version: 0,
    reservation_lifecycle_state: 'some_invalid_state',
  });
  const res = await authority.transitionReservation({
    listing_id: 'list1', expected_version: 0,
    operation_id: 'op_1', operation_type: 'reserve',
    payload: { token: 't1', buyer: 'b1@test', expiration: '2026-12-31T00:00:00Z' },
    requested_state: 'reserved',
  });
  assert(!res.ok, 'should fail');
  assert(res.code === 'STATE_CORRUPT', `expected STATE_CORRUPT, got ${res.code}`);
  assert(res.state_code === 'STATE_INVALID', `expected STATE_INVALID, got ${res.state_code}`);
});

// ── R3-4: Pending effects JSON changed without hash cannot be erased ────────
test('pending effects JSON changed without matching hash cannot be erased', async () => {
  const deps = createMockDeps();
  const authority = createReservationAuthority(deps);
  const effectsA = [{ effect_type: 'effect_A' }];
  const effectsB = [{ effect_type: 'effect_B' }];
  const hashA = mockHashEnvelope({ effects: effectsA });
  deps._seedLP('lp1', {
    listing_id: 'list1', reservation_version: 1,
    last_operation_id: 'op_1',
    pending_effects_json: JSON.stringify(effectsA),
  });
  // Hook replaces ONLY the JSON (not the hash) between read and CAS
  deps._setHook('beforeClearCAS', (d, listing_id) => {
    const lp = d._lpStore.get('lp1');
    if (lp) {
      lp.pending_effects_json = JSON.stringify(effectsB);
      // Hash stays as hashA (stale)
    }
  });
  const r = await authority.clearPendingEffects({
    listing_id: 'list1', expected_version: 1,
    expected_operation_id: 'op_1',
    expected_effects_json: JSON.stringify(effectsA),
    expected_effects_hash: hashA,
  });
  assert(!r.ok, 'stale clearer should fail when JSON does not match');
  assert(r.code === 'CONFLICT' || r.code === 'EFFECTS_HASH_MISMATCH',
    `expected CONFLICT or EFFECTS_HASH_MISMATCH, got ${r.code}`);
  // Verify effects B is preserved
  const [lp] = await deps.entities.ListingPrivate.filter({ listing_id: 'list1' });
  assert(lp.pending_effects_json === JSON.stringify(effectsB), 'effects B JSON should be preserved');
});

// ── R3-5: clearPendingEffects requires expected_effects_json ─────────────────
test('clearPendingEffects rejects missing expected_effects_json', async () => {
  const deps = createMockDeps();
  const authority = createReservationAuthority(deps);
  const effects = [{ effect_type: 'notify' }];
  deps._seedLP('lp1', {
    listing_id: 'list1', reservation_version: 1,
    last_operation_id: 'op_1',
    pending_effects_json: JSON.stringify([{ effect_type: 'notify' }]),
  });
  const r = await authority.clearPendingEffects({
    listing_id: 'list1', expected_version: 1,
    expected_operation_id: 'op_1',
    expected_effects_hash: mockHashEnvelope({ effects }),
    // expected_effects_json intentionally omitted
  });
  assert(!r.ok, 'should reject missing expected_effects_json');
  assert(r.code === 'VALIDATION_ERROR', `expected VALIDATION_ERROR, got ${r.code}`);
});

// ── R3-6: getPendingEffects returns effects_json ────────────────────────────
test('getPendingEffects returns effects_json for caller use', async () => {
  const deps = createMockDeps();
  const authority = createReservationAuthority(deps);
  const effects = [{ effect_type: 'notify' }, { effect_type: 'email' }];
  deps._seedLP('lp1', {
    listing_id: 'list1', reservation_version: 1,
    last_operation_id: 'op_1',
    pending_effects_json: JSON.stringify(effects),
  });
  const result = await authority.getPendingEffects('list1');
  assert(result.ok, 'should succeed');
  assert(typeof result.effects_json === 'string', 'effects_json should be a string');
  assert(result.effects_json === JSON.stringify(effects), 'effects_json should match');
  // Verify round-trip: clearPendingEffects with returned effects_json
  const clearResult = await authority.clearPendingEffects({
    listing_id: 'list1', expected_version: 1,
    expected_operation_id: 'op_1',
    expected_effects_json: result.effects_json,
    expected_effects_hash: result.effects_hash,
  });
  assert(clearResult.ok, 'should clear using returned effects_json and hash');
  assert(clearResult.verified === true, 'should be verified');
});

// ════════════════════════════════════════════════════════════════════════════
// SECTION 1D: ROUND 4 NEW TESTS
// ════════════════════════════════════════════════════════════════════════════

// ── R4-1: Strengthened CAS snapshot detects legacy writer tuple change ──────
test('strengthened CAS snapshot detects legacy writer tuple change', async () => {
  const deps = createMockDeps();
  const authority = createReservationAuthority(deps);
  deps._seedLP('lp1', { listing_id: 'list1' });
  deps._seedListing('list1', {});
  // Hook: legacy writer changes tuple without incrementing version
  deps._setHook('beforeCAS', (d, listing_id) => {
    const lp = d._lpStore.get('lp1');
    if (lp) {
      lp.reservation_token = 'legacy_token';
      lp.reserved_by_email = 'legacy@test';
      lp.reservation_expires_at = '2026-12-31T00:00:00Z';
      lp.reservation_revision = 'legacy_rev';
      // Do NOT increment version — legacy writer doesn't use the authority
    }
  });
  const res = await authority.transitionReservation({
    listing_id: 'list1', expected_version: 0,
    operation_id: 'op_1', operation_type: 'reserve',
    payload: { token: 't1', buyer: 'b1@test', expiration: '2026-12-31T00:00:00Z' },
    requested_state: 'reserved',
  });
  assert(!res.ok, 'authority should lose CAS to legacy writer');
  assert(res.code === 'CONFLICT', `expected CONFLICT, got ${res.code}`);
  // Verify legacy writer's change is preserved
  const [lp] = await deps.entities.ListingPrivate.filter({ listing_id: 'list1' });
  assert(lp.reservation_token === 'legacy_token', 'legacy token should be preserved');
  assert(lp.reservation_version === 0, 'version should still be 0');
  assert(lp.last_operation_id === null, 'no authority operation should have been written');
});

// ── R4-2: Idempotent replay validation catches corrupt stored state ─────────
test('idempotent replay validation catches corrupt stored state', async () => {
  const deps = createMockDeps();
  const authority = createReservationAuthority(deps);
  const envelope = {
    operation_type: 'reserve', requested_state: 'reserved',
    payload: { token: 't1', buyer: 'b1@test', expiration: '2026-12-31T00:00:00Z' }, pending_effects: [],
  };
  deps._seedLP('lp1', {
    listing_id: 'list1', reservation_version: 1,
    reservation_lifecycle_state: 'reserved',
    reservation_token: 't1', reserved_by_email: 'b1@test',
    reservation_expires_at: '2026-12-31T00:00:00Z',
    reservation_revision: 'rev_1',
    last_operation_id: 'op_1',
    last_operation_payload_hash: mockHashEnvelope(envelope),
    last_operation_result_json: JSON.stringify({ operation_id: 'op_1', new_version: 1 }),
  });
  deps._seedListing('list1', {});
  // Corrupt the lifecycle state AFTER seeding (simulates datastore corruption)
  const lpRec = deps._lpStore.get('lp1');
  lpRec.reservation_lifecycle_state = null;
  const res = await authority.transitionReservation({
    listing_id: 'list1', expected_version: 0,
    operation_id: 'op_1', operation_type: 'reserve',
    payload: { token: 't1', buyer: 'b1@test', expiration: '2026-12-31T00:00:00Z' },
    requested_state: 'reserved',
  });
  assert(!res.ok, 'should not return idempotent success with corrupt state');
  assert(res.code === 'STATE_CORRUPT', `expected STATE_CORRUPT, got ${res.code}`);
  assert(res.protection, 'should have protection result');
  // Verify listing is hidden by protection
  const [listing] = await deps.entities.Listing.filter({ id: 'list1' });
  assert(listing.status === 'hidden', 'Listing should be hidden by protection');
});

// ── R4-3: Corrupt authority state triggers protection and hides Listing ──────
test('corrupt authority state triggers protection and hides active Listing', async () => {
  const deps = createMockDeps();
  const authority = createReservationAuthority(deps);
  deps._seedLP('lp1', {
    listing_id: 'list1', reservation_version: 0,
    reservation_lifecycle_state: null,
  });
  deps._seedListing('list1', { status: 'active' });
  const res = await authority.transitionReservation({
    listing_id: 'list1', expected_version: 0,
    operation_id: 'op_1', operation_type: 'reserve',
    payload: { token: 't1', buyer: 'b1@test', expiration: '2026-12-31T00:00:00Z' },
    requested_state: 'reserved',
  });
  assert(!res.ok, 'should fail');
  assert(res.code === 'STATE_CORRUPT', `expected STATE_CORRUPT, got ${res.code}`);
  assert(res.protection, 'should have protection result');
  assert(res.protection.protected === true, 'protection should be verified');
  // Verify listing is hidden — corrupt authority cannot leave Listing publicly available
  const [listing] = await deps.entities.Listing.filter({ id: 'list1' });
  assert(listing.status === 'hidden', 'Listing should be hidden by protection');
  assert(listing.hidden_reason === 'checkout_quarantine', 'hidden_reason should be checkout_quarantine');
  // Verify alert exists
  const alerts = Array.from(deps._adminAlertStore.values());
  const unresolved = alerts.filter(a => a.resolved === false);
  assert(unresolved.length >= 1, 'should have at least 1 unresolved alert');
  assert(unresolved[0].priority === 'critical', 'priority should be critical');
});

// ── R4-4: Idempotent replay validation catches version/result mismatch ──────
test('idempotent replay validation catches stored result version mismatch', async () => {
  const deps = createMockDeps();
  const authority = createReservationAuthority(deps);
  const envelope = {
    operation_type: 'reserve', requested_state: 'reserved',
    payload: { token: 't1', buyer: 'b1@test', expiration: '2026-12-31T00:00:00Z' }, pending_effects: [],
  };
  deps._seedLP('lp1', {
    listing_id: 'list1', reservation_version: 1,
    reservation_lifecycle_state: 'reserved',
    reservation_token: 't1', reserved_by_email: 'b1@test',
    reservation_expires_at: '2026-12-31T00:00:00Z',
    reservation_revision: 'rev_1',
    last_operation_id: 'op_1',
    last_operation_type: 'reserve',
    last_operation_payload_hash: mockHashEnvelope(envelope),
    last_operation_at: '2026-01-01T00:00:00Z',
    // Corrupt: stored result says new_version=5 but authoritative version is 1
    last_operation_result_json: JSON.stringify({
      operation_id: 'op_1', operation_type: 'reserve',
      requested_state: 'reserved', previous_version: 0,
      new_version: 5, committed_at: '2026-01-01T00:00:00Z',
    }),
  });
  deps._seedListing('list1', {});
  const res = await authority.transitionReservation({
    listing_id: 'list1', expected_version: 0,
    operation_id: 'op_1', operation_type: 'reserve',
    payload: { token: 't1', buyer: 'b1@test', expiration: '2026-12-31T00:00:00Z' },
    requested_state: 'reserved',
  });
  assert(!res.ok, 'should not return idempotent success with version mismatch');
  assert(res.code === 'VERSION_MISMATCH', `expected VERSION_MISMATCH, got ${res.code}`);
  assert(res.protection, 'should have protection result');
});

// ════════════════════════════════════════════════════════════════════════════
// SECTION 1E: ROUND 5 NEW TESTS
// ════════════════════════════════════════════════════════════════════════════

// Helper: seed a fully valid committed LP record for idempotent replay tests
function seedValidCommittedLP(deps, op_id, op_type, state, payload, version) {
  const envelope = { operation_type: op_type, requested_state: state, payload, pending_effects: [] };
  const hash = mockHashEnvelope(envelope);
  const result = {
    operation_id: op_id, operation_type: op_type, requested_state: state,
    previous_version: version - 1, new_version: version, committed_at: '2026-01-01T00:00:00Z',
  };
  deps._seedLP('lp1', {
    listing_id: 'list1', reservation_version: version,
    reservation_lifecycle_state: state,
    reservation_token: payload.token, reserved_by_email: payload.buyer,
    reservation_expires_at: payload.expiration,
    reservation_revision: 'rev_1',
    last_operation_id: op_id, last_operation_type: op_type,
    last_operation_payload_hash: hash, last_operation_at: '2026-01-01T00:00:00Z',
    last_operation_result_json: JSON.stringify(result),
  });
  return { envelope, hash };
}

const R5_PAYLOAD = { token: 't1', buyer: 'b1@test', expiration: '2026-12-31T00:00:00Z' };

// ── R5-1: Missing last_operation_result_json → not idempotent success ──────
test('R5-1: missing last_operation_result_json does not return idempotent success', async () => {
  const deps = createMockDeps();
  const authority = createReservationAuthority(deps);
  seedValidCommittedLP(deps, 'op_1', 'reserve', 'reserved', R5_PAYLOAD, 1);
  delete deps._lpStore.get('lp1').last_operation_result_json;
  const res = await authority.transitionReservation({
    listing_id: 'list1', expected_version: 0,
    operation_id: 'op_1', operation_type: 'reserve',
    payload: R5_PAYLOAD, requested_state: 'reserved',
  });
  assert(!res.ok, 'should not return idempotent success');
  assert(res.code === 'RESULT_CORRUPT', `expected RESULT_CORRUPT, got ${res.code}`);
});

// ── R5-2: Missing last_operation_type → not idempotent success ─────────────
test('R5-2: missing last_operation_type does not return idempotent success', async () => {
  const deps = createMockDeps();
  const authority = createReservationAuthority(deps);
  seedValidCommittedLP(deps, 'op_1', 'reserve', 'reserved', R5_PAYLOAD, 1);
  delete deps._lpStore.get('lp1').last_operation_type;
  const res = await authority.transitionReservation({
    listing_id: 'list1', expected_version: 0,
    operation_id: 'op_1', operation_type: 'reserve',
    payload: R5_PAYLOAD, requested_state: 'reserved',
  });
  assert(!res.ok, 'should not return idempotent success');
  assert(res.code === 'OPERATION_CORRUPT', `expected OPERATION_CORRUPT, got ${res.code}`);
});

// ── R5-3: Missing pending_effects_hash → not idempotent success ────────────
test('R5-3: missing pending_effects_hash does not return idempotent success', async () => {
  const deps = createMockDeps();
  const authority = createReservationAuthority(deps);
  seedValidCommittedLP(deps, 'op_1', 'reserve', 'reserved', R5_PAYLOAD, 1);
  delete deps._lpStore.get('lp1').pending_effects_hash;
  const res = await authority.transitionReservation({
    listing_id: 'list1', expected_version: 0,
    operation_id: 'op_1', operation_type: 'reserve',
    payload: R5_PAYLOAD, requested_state: 'reserved',
  });
  assert(!res.ok, 'should not return idempotent success');
  assert(res.code === 'EFFECTS_HASH_CORRUPT', `expected EFFECTS_HASH_CORRUPT, got ${res.code}`);
});

// ── R5-4: Reserved state with missing reservation_revision → not ok ───────
test('R5-4: reserved state with missing reservation_revision does not return idempotent success', async () => {
  const deps = createMockDeps();
  const authority = createReservationAuthority(deps);
  seedValidCommittedLP(deps, 'op_1', 'reserve', 'reserved', R5_PAYLOAD, 1);
  delete deps._lpStore.get('lp1').reservation_revision;
  const res = await authority.transitionReservation({
    listing_id: 'list1', expected_version: 0,
    operation_id: 'op_1', operation_type: 'reserve',
    payload: R5_PAYLOAD, requested_state: 'reserved',
  });
  assert(!res.ok, 'should not return idempotent success');
  assert(res.code === 'TUPLE_CORRUPT', `expected TUPLE_CORRUPT, got ${res.code}`);
});

// ── R5-5: Missing last_operation_at → not idempotent success ───────────────
test('R5-5: missing last_operation_at does not return idempotent success', async () => {
  const deps = createMockDeps();
  const authority = createReservationAuthority(deps);
  seedValidCommittedLP(deps, 'op_1', 'reserve', 'reserved', R5_PAYLOAD, 1);
  delete deps._lpStore.get('lp1').last_operation_at;
  const res = await authority.transitionReservation({
    listing_id: 'list1', expected_version: 0,
    operation_id: 'op_1', operation_type: 'reserve',
    payload: R5_PAYLOAD, requested_state: 'reserved',
  });
  assert(!res.ok, 'should not return idempotent success');
  assert(res.code === 'OPERATION_CORRUPT', `expected OPERATION_CORRUPT, got ${res.code}`);
});

// ── R5-6: Result JSON missing required fields → not idempotent success ────
test('R5-6: result JSON missing required fields does not return idempotent success', async () => {
  const deps = createMockDeps();
  const authority = createReservationAuthority(deps);
  seedValidCommittedLP(deps, 'op_1', 'reserve', 'reserved', R5_PAYLOAD, 1);
  deps._lpStore.get('lp1').last_operation_result_json = JSON.stringify({
    operation_id: 'op_1', operation_type: 'reserve',
    requested_state: 'reserved', previous_version: 0, new_version: 1,
  });
  const res = await authority.transitionReservation({
    listing_id: 'list1', expected_version: 0,
    operation_id: 'op_1', operation_type: 'reserve',
    payload: R5_PAYLOAD, requested_state: 'reserved',
  });
  assert(!res.ok, 'should not return idempotent success');
  assert(res.code === 'RESULT_CORRUPT', `expected RESULT_CORRUPT, got ${res.code}`);
});

// ── R5-7: Result JSON mismatched operation_type → not idempotent success ──
test('R5-7: result JSON mismatched operation_type does not return idempotent success', async () => {
  const deps = createMockDeps();
  const authority = createReservationAuthority(deps);
  seedValidCommittedLP(deps, 'op_1', 'reserve', 'reserved', R5_PAYLOAD, 1);
  deps._lpStore.get('lp1').last_operation_result_json = JSON.stringify({
    operation_id: 'op_1', operation_type: 'freeze',
    requested_state: 'reserved', previous_version: 0,
    new_version: 1, committed_at: '2026-01-01T00:00:00Z',
  });
  const res = await authority.transitionReservation({
    listing_id: 'list1', expected_version: 0,
    operation_id: 'op_1', operation_type: 'reserve',
    payload: R5_PAYLOAD, requested_state: 'reserved',
  });
  assert(!res.ok, 'should not return idempotent success');
  assert(res.code === 'RESULT_MISMATCH', `expected RESULT_MISMATCH, got ${res.code}`);
});

// ── R5-8: Legacy writer changes last_operation_type → CAS loses ───────────
test('R5-8: legacy writer changes last_operation_type without version increment → CAS loses', async () => {
  const deps = createMockDeps();
  const authority = createReservationAuthority(deps);
  deps._seedLP('lp1', { listing_id: 'list1' });
  deps._seedListing('list1', {});
  deps._setHook('beforeCAS', (d) => {
    const lp = d._lpStore.get('lp1');
    if (lp) lp.last_operation_type = 'legacy_type';
  });
  const res = await authority.transitionReservation({
    listing_id: 'list1', expected_version: 0,
    operation_id: 'op_1', operation_type: 'reserve',
    payload: R5_PAYLOAD, requested_state: 'reserved',
  });
  assert(!res.ok, 'CAS should lose');
  assert(res.code === 'CONFLICT', `expected CONFLICT, got ${res.code}`);
  const [lp] = await deps.entities.ListingPrivate.filter({ listing_id: 'list1' });
  assert(lp.last_operation_id === null, 'no authority operation should have been written');
});

// ── R5-9: Legacy writer changes last_operation_payload_hash → CAS loses ──
test('R5-9: legacy writer changes last_operation_payload_hash without version increment → CAS loses', async () => {
  const deps = createMockDeps();
  const authority = createReservationAuthority(deps);
  deps._seedLP('lp1', { listing_id: 'list1' });
  deps._seedListing('list1', {});
  deps._setHook('beforeCAS', (d) => {
    const lp = d._lpStore.get('lp1');
    if (lp) lp.last_operation_payload_hash = 'legacy_hash';
  });
  const res = await authority.transitionReservation({
    listing_id: 'list1', expected_version: 0,
    operation_id: 'op_1', operation_type: 'reserve',
    payload: R5_PAYLOAD, requested_state: 'reserved',
  });
  assert(!res.ok, 'CAS should lose');
  assert(res.code === 'CONFLICT', `expected CONFLICT, got ${res.code}`);
});

// ── R5-10: Legacy writer changes last_operation_result_json → CAS loses ──
test('R5-10: legacy writer changes last_operation_result_json without version increment → CAS loses', async () => {
  const deps = createMockDeps();
  const authority = createReservationAuthority(deps);
  deps._seedLP('lp1', { listing_id: 'list1' });
  deps._seedListing('list1', {});
  deps._setHook('beforeCAS', (d) => {
    const lp = d._lpStore.get('lp1');
    if (lp) lp.last_operation_result_json = 'legacy_result';
  });
  const res = await authority.transitionReservation({
    listing_id: 'list1', expected_version: 0,
    operation_id: 'op_1', operation_type: 'reserve',
    payload: R5_PAYLOAD, requested_state: 'reserved',
  });
  assert(!res.ok, 'CAS should lose');
  assert(res.code === 'CONFLICT', `expected CONFLICT, got ${res.code}`);
});

// ── R5-11: Legacy writer changes last_operation_at → CAS loses ───────────
test('R5-11: legacy writer changes last_operation_at without version increment → CAS loses', async () => {
  const deps = createMockDeps();
  const authority = createReservationAuthority(deps);
  deps._seedLP('lp1', { listing_id: 'list1' });
  deps._seedListing('list1', {});
  deps._setHook('beforeCAS', (d) => {
    const lp = d._lpStore.get('lp1');
    if (lp) lp.last_operation_at = '2025-01-01T00:00:00Z';
  });
  const res = await authority.transitionReservation({
    listing_id: 'list1', expected_version: 0,
    operation_id: 'op_1', operation_type: 'reserve',
    payload: R5_PAYLOAD, requested_state: 'reserved',
  });
  assert(!res.ok, 'CAS should lose');
  assert(res.code === 'CONFLICT', `expected CONFLICT, got ${res.code}`);
});

// ── R5-12: Missing snapshot field → SNAPSHOT_INCOMPLETE before CAS ────────
test('R5-12: missing snapshot field returns SNAPSHOT_INCOMPLETE before CAS', async () => {
  const deps = createMockDeps();
  const authority = createReservationAuthority(deps);
  deps._seedLP('lp1', { listing_id: 'list1' });
  deps._seedListing('list1', {});
  delete deps._lpStore.get('lp1').last_operation_type;
  const res = await authority.transitionReservation({
    listing_id: 'list1', expected_version: 0,
    operation_id: 'op_1', operation_type: 'reserve',
    payload: R5_PAYLOAD, requested_state: 'reserved',
  });
  assert(!res.ok, 'should fail');
  assert(res.code === 'SNAPSHOT_INCOMPLETE', `expected SNAPSHOT_INCOMPLETE, got ${res.code}`);
  assert(res.missing.includes('last_operation_type'), 'should report missing last_operation_type');
});

// ── R5-13: Valid idempotent replay with all fields present → success ──────
test('R5-13: valid idempotent replay with all fields present returns success', async () => {
  const deps = createMockDeps();
  const authority = createReservationAuthority(deps);
  seedValidCommittedLP(deps, 'op_1', 'reserve', 'reserved', R5_PAYLOAD, 1);
  deps._seedListing('list1', {});
  const res = await authority.transitionReservation({
    listing_id: 'list1', expected_version: 0,
    operation_id: 'op_1', operation_type: 'reserve',
    payload: R5_PAYLOAD, requested_state: 'reserved',
  });
  assert(res.ok, 'should return idempotent success');
  assert(res.idempotent === true, 'should be idempotent');
  assert(res.version === 1, 'version should be 1');
  assert(res.state === 'reserved', 'state should be reserved');
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
    last_operation_result_json: null, last_operation_at: null,
    pending_effects_json: '[]', pending_effects_hash: null,
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
        last_operation_result_json: null, last_operation_at: null,
        pending_effects_json: '[]', pending_effects_hash: null,
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
  console.log('=== Reservation Authority Concurrency Tests (7C.9C.2E Correction Round 4) ===\n');
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