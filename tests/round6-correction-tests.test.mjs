/**
 * Round 6 Correction Tests (7C.9C.2E)
 *
 * Regression tests for Round 6 corrections:
 *   Item 1: Fail-closed replay validation — completeness checks on replay path
 *   Item 2: Protection-write terminal-status race — status-preserving predicate
 *   Item 3: Migration classification strictly fail-closed — status enum + tuple validation
 *   Item 5: Conditional assertion fixes — require record/plan_action before asserting
 *
 * No provider calls. No real-data migration. Synthetic mock deps only.
 */
import { createReservationAuthority } from '../base44/shared/reservationAuthority.js';
import { generateMigrationReport, planApply, validateListingStatus, LISTING_STATUS_ENUM } from '../base44/shared/reservationAuthorityMigration.js';
import {
  OPERATION_TYPES, shouldHideForProtection, isNonReservableStatus,
  TERMINAL_BUSINESS_STATUSES, BUSINESS_HELD_STATUSES,
  validateIdempotentReplay, validateTuple, validateLifecycleState,
} from '../base44/shared/reservationAuthorityConstants.js';
import { createMockDeps, mockHashEnvelope } from './authority/helpers.mjs';

const tests = [];
let passed = 0;
let failed = 0;

function test(name, fn) { tests.push({ name, fn }); }
function assert(cond, msg) { if (!cond) throw new Error(msg); }

const R6_PAYLOAD = { token: 't1', buyer: 'b1@test', expiration: '2026-12-31T00:00:00Z' };

// Helper: seed a fully valid committed LP record
function seedValidCommittedLP(deps, op_id, op_type, state, payload, version) {
  const envelope = { operation_type: op_type, requested_state: state, payload, pending_effects: [] };
  const hash = mockHashEnvelope(envelope);
  const committed_at = '2026-01-01T00:00:00Z';
  const result = {
    operation_id: op_id, operation_type: op_type, requested_state: state,
    previous_version: version - 1, new_version: version, committed_at,
  };
  deps._seedLP('lp1', {
    listing_id: 'list1', reservation_version: version,
    reservation_lifecycle_state: state,
    reservation_token: payload.token, reserved_by_email: payload.buyer,
    reservation_expires_at: payload.expiration,
    reservation_revision: 'rev_1',
    last_operation_id: op_id, last_operation_type: op_type,
    last_operation_payload_hash: hash, last_operation_at: committed_at,
    last_operation_result_json: JSON.stringify(result),
  });
  return { envelope, hash, committed_at };
}

// ════════════════════════════════════════════════════════════════════════════
// ITEM 1: FAIL-CLOSED REPLAY VALIDATION
// ════════════════════════════════════════════════════════════════════════════

// Helper: test that corrupting a specific field causes replay validation to fail
function testReplayCorruption(fieldName, newValue, expectedCode) {
  return async () => {
    const deps = createMockDeps();
    const authority = createReservationAuthority(deps);
    const { envelope, hash } = seedValidCommittedLP(deps, 'op_1', 'reserve', 'reserved', R6_PAYLOAD, 1);
    deps._seedListing('list1', { reservation_version: 0, status: 'active' });

    // Corrupt the field
    const lp = deps._lpStore.get('lp1');
    lp[fieldName] = newValue;

    // Attempt to replay the same operation — should fail validation
    const res = await authority.transitionReservation({
      listing_id: 'list1', expected_version: 1,
      operation_id: 'op_1', operation_type: 'reserve',
      payload: R6_PAYLOAD, requested_state: 'reserved',
    });

    assert(!res.ok, `replay should fail when ${fieldName} is corrupted`);
    // It should NOT return idempotent success
    assert(res.idempotent !== true, `should not return idempotent success when ${fieldName} is corrupted`);
    // It should return a structured non-success code
    assert(res.code !== undefined, `should return structured error code`);
    // Zero authority writes — version should not change
    const [lpAfter] = await deps.entities.ListingPrivate.filter({ listing_id: 'list1' });
    assert(lpAfter.reservation_version === 1, `version should not change (zero writes)`);
    // Zero mirror writes — Listing status should not change
    const [listingAfter] = await deps.entities.Listing.filter({ id: 'list1' });
    assert(listingAfter.status === 'active', `Listing status should not change (zero mirror writes)`);
  };
}

test('R6-REPLAY-1: corrupt last_operation_at → replay fails', testReplayCorruption('last_operation_at', '2025-06-30T00:00:00Z'));
test('R6-REPLAY-2: corrupt last_operation_at (null) → replay fails', testReplayCorruption('last_operation_at', null));
test('R6-REPLAY-3: corrupt last_operation_at (undefined) → replay fails', testReplayCorruption('last_operation_at', undefined));
test('R6-REPLAY-4: corrupt last_operation_at (empty string) → replay fails', testReplayCorruption('last_operation_at', ''));

test('R6-REPLAY-5: corrupt result committed_at → replay fails', async () => {
  const deps = createMockDeps();
  const authority = createReservationAuthority(deps);
  seedValidCommittedLP(deps, 'op_1', 'reserve', 'reserved', R6_PAYLOAD, 1);
  deps._seedListing('list1', { reservation_version: 0, status: 'active' });

  // Corrupt committed_at in the stored result JSON
  const lp = deps._lpStore.get('lp1');
  const result = JSON.parse(lp.last_operation_result_json);
  result.committed_at = '2025-06-30T00:00:00Z'; // different from last_operation_at
  lp.last_operation_result_json = JSON.stringify(result);

  const res = await authority.transitionReservation({
    listing_id: 'list1', expected_version: 1,
    operation_id: 'op_1', operation_type: 'reserve',
    payload: R6_PAYLOAD, requested_state: 'reserved',
  });

  assert(!res.ok, 'replay should fail when committed_at != last_operation_at');
  assert(res.idempotent !== true, 'should not return idempotent success');
  const [lpAfter] = await deps.entities.ListingPrivate.filter({ listing_id: 'list1' });
  assert(lpAfter.reservation_version === 1, 'version should not change');
});

test('R6-REPLAY-6: corrupt pending_effects_json (undefined) → replay fails', async () => {
  const deps = createMockDeps();
  const authority = createReservationAuthority(deps);
  seedValidCommittedLP(deps, 'op_1', 'reserve', 'reserved', R6_PAYLOAD, 1);
  deps._seedListing('list1', { reservation_version: 0, status: 'active' });

  const lp = deps._lpStore.get('lp1');
  lp.pending_effects_json = undefined;

  const res = await authority.transitionReservation({
    listing_id: 'list1', expected_version: 1,
    operation_id: 'op_1', operation_type: 'reserve',
    payload: R6_PAYLOAD, requested_state: 'reserved',
  });

  assert(!res.ok, 'replay should fail when pending_effects_json is undefined');
  assert(res.idempotent !== true, 'should not return idempotent success');
});

test('R6-REPLAY-7: corrupt pending_effects_json (null) → replay fails', async () => {
  const deps = createMockDeps();
  const authority = createReservationAuthority(deps);
  seedValidCommittedLP(deps, 'op_1', 'reserve', 'reserved', R6_PAYLOAD, 1);
  deps._seedListing('list1', { reservation_version: 0, status: 'active' });

  const lp = deps._lpStore.get('lp1');
  lp.pending_effects_json = null;

  const res = await authority.transitionReservation({
    listing_id: 'list1', expected_version: 1,
    operation_id: 'op_1', operation_type: 'reserve',
    payload: R6_PAYLOAD, requested_state: 'reserved',
  });

  assert(!res.ok, 'replay should fail when pending_effects_json is null');
});

test('R6-REPLAY-8: corrupt pending_effects_json (non-string) → replay fails', async () => {
  const deps = createMockDeps();
  const authority = createReservationAuthority(deps);
  seedValidCommittedLP(deps, 'op_1', 'reserve', 'reserved', R6_PAYLOAD, 1);
  deps._seedListing('list1', { reservation_version: 0, status: 'active' });

  const lp = deps._lpStore.get('lp1');
  lp.pending_effects_json = []; // array instead of string

  const res = await authority.transitionReservation({
    listing_id: 'list1', expected_version: 1,
    operation_id: 'op_1', operation_type: 'reserve',
    payload: R6_PAYLOAD, requested_state: 'reserved',
  });

  assert(!res.ok, 'replay should fail when pending_effects_json is not a string');
});

test('R6-REPLAY-9: corrupt checkout_quarantined (non-boolean) → replay fails', async () => {
  const deps = createMockDeps();
  const authority = createReservationAuthority(deps);
  seedValidCommittedLP(deps, 'op_1', 'reserve', 'reserved', R6_PAYLOAD, 1);
  deps._seedListing('list1', { reservation_version: 0, status: 'active' });

  const lp = deps._lpStore.get('lp1');
  lp.checkout_quarantined = 'true'; // string, not boolean

  const res = await authority.transitionReservation({
    listing_id: 'list1', expected_version: 1,
    operation_id: 'op_1', operation_type: 'reserve',
    payload: R6_PAYLOAD, requested_state: 'reserved',
  });

  assert(!res.ok, 'replay should fail when checkout_quarantined is not boolean');
  assert(res.idempotent !== true, 'should not return idempotent success');
});

test('R6-REPLAY-10: corrupt checkout_quarantined (undefined) → replay fails', async () => {
  const deps = createMockDeps();
  const authority = createReservationAuthority(deps);
  seedValidCommittedLP(deps, 'op_1', 'reserve', 'reserved', R6_PAYLOAD, 1);
  deps._seedListing('list1', { reservation_version: 0, status: 'active' });

  const lp = deps._lpStore.get('lp1');
  lp.checkout_quarantined = undefined;

  const res = await authority.transitionReservation({
    listing_id: 'list1', expected_version: 1,
    operation_id: 'op_1', operation_type: 'reserve',
    payload: R6_PAYLOAD, requested_state: 'reserved',
  });

  assert(!res.ok, 'replay should fail when checkout_quarantined is undefined');
});

test('R6-REPLAY-11: corrupt recovery_blocked (non-boolean) → replay fails', async () => {
  const deps = createMockDeps();
  const authority = createReservationAuthority(deps);
  seedValidCommittedLP(deps, 'op_1', 'reserve', 'reserved', R6_PAYLOAD, 1);
  deps._seedListing('list1', { reservation_version: 0, status: 'active' });

  const lp = deps._lpStore.get('lp1');
  lp.recovery_blocked = 1; // number, not boolean

  const res = await authority.transitionReservation({
    listing_id: 'list1', expected_version: 1,
    operation_id: 'op_1', operation_type: 'reserve',
    payload: R6_PAYLOAD, requested_state: 'reserved',
  });

  assert(!res.ok, 'replay should fail when recovery_blocked is not boolean');
});

test('R6-REPLAY-12: corrupt recovery_blocked (undefined) → replay fails', async () => {
  const deps = createMockDeps();
  const authority = createReservationAuthority(deps);
  seedValidCommittedLP(deps, 'op_1', 'reserve', 'reserved', R6_PAYLOAD, 1);
  deps._seedListing('list1', { reservation_version: 0, status: 'active' });

  const lp = deps._lpStore.get('lp1');
  lp.recovery_blocked = undefined;

  const res = await authority.transitionReservation({
    listing_id: 'list1', expected_version: 1,
    operation_id: 'op_1', operation_type: 'reserve',
    payload: R6_PAYLOAD, requested_state: 'reserved',
  });

  assert(!res.ok, 'replay should fail when recovery_blocked is undefined');
});

test('R6-REPLAY-13: valid complete replay succeeds', async () => {
  const deps = createMockDeps();
  const authority = createReservationAuthority(deps);
  seedValidCommittedLP(deps, 'op_1', 'reserve', 'reserved', R6_PAYLOAD, 1);
  deps._seedListing('list1', { reservation_version: 0, status: 'active' });

  const res = await authority.transitionReservation({
    listing_id: 'list1', expected_version: 1,
    operation_id: 'op_1', operation_type: 'reserve',
    payload: R6_PAYLOAD, requested_state: 'reserved',
  });

  assert(res.ok, 'valid replay should succeed');
  assert(res.idempotent === true, 'should return idempotent success');
});

test('R6-REPLAY-14: timestamp mismatch (last_operation_at != committed_at) → fails', async () => {
  const deps = createMockDeps();
  const authority = createReservationAuthority(deps);
  seedValidCommittedLP(deps, 'op_1', 'reserve', 'reserved', R6_PAYLOAD, 1);
  deps._seedListing('list1', { reservation_version: 0, status: 'active' });

  // Set last_operation_at to a different value than committed_at
  const lp = deps._lpStore.get('lp1');
  lp.last_operation_at = '2026-06-30T00:00:00Z'; // different from committed_at '2026-01-01T00:00:00Z'

  const res = await authority.transitionReservation({
    listing_id: 'list1', expected_version: 1,
    operation_id: 'op_1', operation_type: 'reserve',
    payload: R6_PAYLOAD, requested_state: 'reserved',
  });

  assert(!res.ok, 'replay should fail when last_operation_at != committed_at');
  assert(res.idempotent !== true, 'should not return idempotent success');
});

// ════════════════════════════════════════════════════════════════════════════
// ITEM 2: PROTECTION-WRITE TERMINAL-STATUS RACE
// ════════════════════════════════════════════════════════════════════════════

// Helper: test that protection preserves a concurrent terminal transition
async function testConcurrentTerminalRace(initialStatus, competitorStatus) {
  const deps = createMockDeps();
  const authority = createReservationAuthority(deps);
  deps._seedLP('lp1', {
    listing_id: 'list1', reservation_version: 0,
    reservation_lifecycle_state: null, // corrupt → triggers protection
  });
  deps._seedListing('list1', { status: initialStatus });

  // Hook: after protection reads the Listing status, a competitor changes it
  deps._setHook('afterSweepCAS', (d, listing_id) => {
    const listing = d._listingStore.get('list1');
    if (listing) {
      listing.status = competitorStatus;
      if (competitorStatus === 'sold' || competitorStatus === 'cancelled' || competitorStatus === 'expired') {
        listing.hidden_reason = null;
      }
    }
  });

  // For protection triggered via transitionReservation, we need a different hook
  // The protection reads the Listing, then does the hide. We'll use beforeCAS
  // to change the status between the read and the hide.
  // Actually, let's use a more direct approach: trigger protection via sweepMirror
  // with a mirror-newer-than-authority scenario
  deps._clearHooks();

  // Set up mirror newer than authority to trigger protection
  deps._seedLP('lp1', {
    listing_id: 'list1', reservation_version: 2,
    reservation_lifecycle_state: 'available',
  });
  deps._seedListing('list1', { reservation_version: 5, status: initialStatus });

  // Hook: after protection reads the Listing (in protectMirror), change status
  // We'll use a custom approach — the mock store's updateMany will change the status
  // if the predicate doesn't match
  let protectionReadDone = false;
  const originalFilter = deps.entities.Listing.filter;
  deps.entities.Listing.filter = async (query) => {
    const results = await originalFilter.call(deps.entities.Listing, query);
    // After the first read (protection reads status), simulate competitor changing it
    if (!protectionReadDone && query.id === 'list1' && results.length > 0) {
      protectionReadDone = true;
      // Change the status in the store AFTER the read returns
      const listing = deps._listingStore.get('list1');
      if (listing) {
        listing.status = competitorStatus;
        if (competitorStatus === 'sold' || competitorStatus === 'cancelled' || competitorStatus === 'expired') {
          listing.hidden_reason = null;
        }
      }
    }
    return results;
  };

  const res = await authority.sweepMirror('list1');

  assert(!res.ok, 'should detect corruption (MIRROR_NEWER_THAN_AUTHORITY)');
  assert(res.protection, 'should have protection result');

  // Final status must be the competitor's terminal status, NOT hidden
  const [listing] = await deps.entities.Listing.filter({ id: 'list1' });
  assert(listing.status === competitorStatus,
    `final status must be ${competitorStatus} (competitor's terminal state), got ${listing.status}`);
  assert(listing.status !== 'hidden' || competitorStatus === 'hidden',
    `must not claim successful quarantine over terminal state`);
}

test('R6-RACE-1: protection reads active, competitor changes to sold → preserves sold', async () => {
  await testConcurrentTerminalRace('active', 'sold');
});

test('R6-RACE-2: protection reads active, competitor changes to cancelled → preserves cancelled', async () => {
  await testConcurrentTerminalRace('active', 'cancelled');
});

test('R6-RACE-3: protection reads active, competitor changes to expired → preserves expired', async () => {
  await testConcurrentTerminalRace('active', 'expired');
});

test('R6-RACE-4: protection reads active, competitor changes to pending_verification → preserves', async () => {
  await testConcurrentTerminalRace('active', 'pending_verification');
});

test('R6-RACE-5: protection reads active, competitor changes to pending_payout_setup → preserves', async () => {
  await testConcurrentTerminalRace('active', 'pending_payout_setup');
});

// Authority path: protectCorruptedAuthority with concurrent terminal transition
test('R6-RACE-6: authority protection reads active, competitor changes to sold → preserves sold', async () => {
  const deps = createMockDeps();
  const authority = createReservationAuthority(deps);
  deps._seedLP('lp1', {
    listing_id: 'list1', reservation_version: 0,
    reservation_lifecycle_state: null, // corrupt → triggers protection
  });
  deps._seedListing('list1', { status: 'active' });

  // Simulate competitor changing status after protection reads it
  let protectionReadDone = false;
  const originalFilter = deps.entities.Listing.filter;
  deps.entities.Listing.filter = async (query) => {
    const results = await originalFilter.call(deps.entities.Listing, query);
    if (!protectionReadDone && query.id === 'list1' && results.length > 0) {
      protectionReadDone = true;
      const listing = deps._listingStore.get('list1');
      if (listing) {
        listing.status = 'sold';
        listing.hidden_reason = null;
      }
    }
    return results;
  };

  const res = await authority.transitionReservation({
    listing_id: 'list1', expected_version: 0,
    operation_id: 'op_1', operation_type: 'reserve',
    payload: R6_PAYLOAD, requested_state: 'reserved',
  });

  assert(!res.ok, 'should fail with STATE_CORRUPT');
  assert(res.protection, 'should have protection result');

  const [listing] = await deps.entities.Listing.filter({ id: 'list1' });
  assert(listing.status === 'sold', `final status must be sold, got ${listing.status}`);
  assert(listing.status !== 'hidden', 'must not overwrite terminal state with hidden');
});

test('R6-RACE-7: authority protection reads active, competitor changes to cancelled → preserves', async () => {
  const deps = createMockDeps();
  const authority = createReservationAuthority(deps);
  deps._seedLP('lp1', {
    listing_id: 'list1', reservation_version: 0,
    reservation_lifecycle_state: null,
  });
  deps._seedListing('list1', { status: 'active' });

  let protectionReadDone = false;
  const originalFilter = deps.entities.Listing.filter;
  deps.entities.Listing.filter = async (query) => {
    const results = await originalFilter.call(deps.entities.Listing, query);
    if (!protectionReadDone && query.id === 'list1' && results.length > 0) {
      protectionReadDone = true;
      const listing = deps._listingStore.get('list1');
      if (listing) { listing.status = 'cancelled'; listing.hidden_reason = null; }
    }
    return results;
  };

  const res = await authority.transitionReservation({
    listing_id: 'list1', expected_version: 0,
    operation_id: 'op_1', operation_type: 'reserve',
    payload: R6_PAYLOAD, requested_state: 'reserved',
  });

  const [listing] = await deps.entities.Listing.filter({ id: 'list1' });
  assert(listing.status === 'cancelled', `final status must be cancelled, got ${listing.status}`);
});

// ════════════════════════════════════════════════════════════════════════════
// ITEM 3: MIGRATION CLASSIFICATION STRICTLY FAIL-CLOSED
// ════════════════════════════════════════════════════════════════════════════

test('R6-MIG-1: sold + empty-string tuple → AMBIGUOUS', async () => {
  const deps = createMockDeps();
  deps._seedListing('list1', { status: 'sold' });
  deps._seedLP('lp1', {
    listing_id: 'list1',
    reservation_token: '', reserved_by_email: null,
    reservation_expires_at: null, reservation_revision: null,
  });
  delete deps._lpStore.get('lp1').reservation_version;
  const report = await generateMigrationReport(deps);
  assert(report.ok, 'report should succeed');
  const rec = report.records.find(r => r.listing_id === 'list1');
  assert(rec, 'should have a record');
  assert(rec.derived_lifecycle_state === 'AMBIGUOUS', `sold + empty-string token should be AMBIGUOUS, got ${rec.derived_lifecycle_state}`);
  assert(rec.status === 'AMBIGUOUS', `status should be AMBIGUOUS, got ${rec.status}`);
});

test('R6-MIG-2: cancelled + undefined tuple field → AMBIGUOUS', async () => {
  const deps = createMockDeps();
  deps._seedListing('list1', { status: 'cancelled' });
  deps._seedLP('lp1', {
    listing_id: 'list1',
    // reservation_token is undefined (not set)
    reserved_by_email: null,
    reservation_expires_at: null, reservation_revision: null,
  });
  delete deps._lpStore.get('lp1').reservation_token; // ensure undefined
  delete deps._lpStore.get('lp1').reservation_version;
  const report = await generateMigrationReport(deps);
  assert(report.ok, 'report should succeed');
  const rec = report.records.find(r => r.listing_id === 'list1');
  assert(rec, 'should have a record');
  assert(rec.derived_lifecycle_state === 'AMBIGUOUS', `cancelled + undefined token should be AMBIGUOUS, got ${rec.derived_lifecycle_state}`);
});

test('R6-MIG-3: expired + omitted tuple field → AMBIGUOUS', async () => {
  const deps = createMockDeps();
  deps._seedListing('list1', { status: 'expired' });
  deps._seedLP('lp1', {
    listing_id: 'list1',
    reservation_token: null, reserved_by_email: null,
    // reservation_expires_at is omitted (not set)
    reservation_revision: null,
  });
  delete deps._lpStore.get('lp1').reservation_expires_at;
  delete deps._lpStore.get('lp1').reservation_version;
  const report = await generateMigrationReport(deps);
  assert(report.ok, 'report should succeed');
  const rec = report.records.find(r => r.listing_id === 'list1');
  assert(rec, 'should have a record');
  assert(rec.derived_lifecycle_state === 'AMBIGUOUS', `expired + omitted expiration should be AMBIGUOUS, got ${rec.derived_lifecycle_state}`);
});

test('R6-MIG-4: active/available + empty token/buyer/expiration/revision → AMBIGUOUS', async () => {
  const deps = createMockDeps();
  deps._seedListing('list1', { status: 'active' });
  deps._seedLP('lp1', {
    listing_id: 'list1',
    reservation_token: '', reserved_by_email: '',
    reservation_expires_at: '', reservation_revision: '',
  });
  delete deps._lpStore.get('lp1').reservation_version;
  const report = await generateMigrationReport(deps);
  assert(report.ok, 'report should succeed');
  const rec = report.records.find(r => r.listing_id === 'list1');
  assert(rec, 'should have a record');
  assert(rec.derived_lifecycle_state === 'AMBIGUOUS', `empty strings should be AMBIGUOUS, got ${rec.derived_lifecycle_state}`);
});

test('R6-MIG-5: unknown Listing status → AMBIGUOUS', async () => {
  const deps = createMockDeps();
  deps._seedListing('list1', { status: 'unknown_status' });
  deps._seedLP('lp1', {
    listing_id: 'list1',
    reservation_token: null, reserved_by_email: null, reservation_expires_at: null,
    reservation_revision: null,
  });
  delete deps._lpStore.get('lp1').reservation_version;
  const report = await generateMigrationReport(deps);
  assert(report.ok, 'report should succeed');
  const rec = report.records.find(r => r.listing_id === 'list1');
  assert(rec, 'should have a record');
  assert(rec.derived_lifecycle_state === 'AMBIGUOUS', `unknown status should be AMBIGUOUS, got ${rec.derived_lifecycle_state}`);
});

test('R6-MIG-6: missing Listing status → AMBIGUOUS', async () => {
  const deps = createMockDeps();
  deps._seedListing('list1', {});
  delete deps._listingStore.get('list1').status;
  deps._seedLP('lp1', {
    listing_id: 'list1',
    reservation_token: null, reserved_by_email: null, reservation_expires_at: null,
    reservation_revision: null,
  });
  delete deps._lpStore.get('lp1').reservation_version;
  const report = await generateMigrationReport(deps);
  assert(report.ok, 'report should succeed');
  const rec = report.records.find(r => r.listing_id === 'list1');
  assert(rec, 'should have a record');
  assert(rec.derived_lifecycle_state === 'AMBIGUOUS', `missing status should be AMBIGUOUS, got ${rec.derived_lifecycle_state}`);
});

test('R6-MIG-7: valid explicit-null terminal state → sold', async () => {
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
  assert(rec, 'should have a record');
  assert(rec.derived_lifecycle_state === 'sold', `valid explicit-null terminal should derive sold, got ${rec.derived_lifecycle_state}`);
});

test('R6-MIG-8: valid complete active reservation state → reserved', async () => {
  const deps = createMockDeps();
  deps._seedListing('list1', { status: 'active' });
  deps._seedLP('lp1', {
    listing_id: 'list1',
    reservation_token: 'tok1', reserved_by_email: 'b1@test',
    reservation_expires_at: '2026-12-31T00:00:00Z',
    reservation_revision: 'rev1',
  });
  delete deps._lpStore.get('lp1').reservation_version;
  const report = await generateMigrationReport(deps);
  assert(report.ok, 'report should succeed');
  const rec = report.records.find(r => r.listing_id === 'list1');
  assert(rec, 'should have a record');
  assert(rec.derived_lifecycle_state === 'reserved', `valid complete tuple should derive reserved, got ${rec.derived_lifecycle_state}`);
});

test('R6-MIG-9: no ambiguous record receives automatic initialization plan', async () => {
  const deps = createMockDeps();
  // Create several ambiguous records
  deps._seedListing('list1', { status: 'sold' });
  deps._seedLP('lp1', {
    listing_id: 'list1',
    reservation_token: '', reserved_by_email: null, reservation_expires_at: null,
  });
  delete deps._lpStore.get('lp1').reservation_version;

  deps._seedListing('list2', { status: 'unknown_status' });
  deps._seedLP('lp2', {
    listing_id: 'list2',
    reservation_token: null, reserved_by_email: null, reservation_expires_at: null,
  });
  delete deps._lpStore.get('lp2').reservation_version;

  const report = await generateMigrationReport(deps);
  assert(report.ok, 'report should succeed');
  for (const rec of report.records) {
    if (rec.status === 'AMBIGUOUS') {
      assert(rec.proposed_init === null, `ambiguous record ${rec.listing_id} must not receive initialization plan`);
      assert(rec.proposed_reservation_version === null, `ambiguous record ${rec.listing_id} must not receive proposed version`);
    }
  }
});

test('R6-MIG-10: validateListingStatus rejects missing status', () => {
  const r = validateListingStatus(null);
  assert(!r.valid, 'null status should be invalid');
  assert(r.code === 'STATUS_MISSING', `expected STATUS_MISSING, got ${r.code}`);
  const r2 = validateListingStatus(undefined);
  assert(!r2.valid, 'undefined status should be invalid');
});

test('R6-MIG-11: validateListingStatus rejects unknown status', () => {
  const r = validateListingStatus('fake_status');
  assert(!r.valid, 'unknown status should be invalid');
  assert(r.code === 'STATUS_UNKNOWN', `expected STATUS_UNKNOWN, got ${r.code}`);
});

test('R6-MIG-12: validateListingStatus rejects empty string', () => {
  const r = validateListingStatus('');
  assert(!r.valid, 'empty string status should be invalid');
  assert(r.code === 'STATUS_EMPTY', `expected STATUS_EMPTY, got ${r.code}`);
});

test('R6-MIG-13: validateListingStatus accepts all known enum values', () => {
  for (const status of LISTING_STATUS_ENUM) {
    const r = validateListingStatus(status);
    assert(r.valid, `${status} should be valid`);
  }
});

// ════════════════════════════════════════════════════════════════════════════
// ITEM 5: CONDITIONAL ASSERTION FIXES
// ════════════════════════════════════════════════════════════════════════════

test('R6-COND-1: planApply has required fields before assertions', () => {
  const deps = createMockDeps();
  const plan = planApply(deps, 'apply_req_1');
  // Require the plan exists and has expected structure before asserting
  assert(plan, 'plan must exist');
  assert(typeof plan === 'object', 'plan must be an object');
  assert(plan.operation_type !== undefined, 'plan must have operation_type');
  assert(plan.initialized_fields !== undefined, 'plan must have initialized_fields');
  assert(Array.isArray(plan.initialized_fields), 'initialized_fields must be an array');
  assert(plan.steps !== undefined, 'plan must have steps');
  assert(Array.isArray(plan.steps), 'steps must be an array');
});

test('R6-COND-2: buildMirrorOnlyPlan requires plan_action before asserting', async () => {
  const deps = createMockDeps();
  deps._seedListing('list1', { status: 'active' });
  deps._seedLP('lp1', {
    listing_id: 'list1', reservation_version: 1,
    reservation_lifecycle_state: 'available',
  });
  const report = await generateMigrationReport(deps);
  assert(report.ok, 'report should succeed');
  const rec = report.records.find(r => r.listing_id === 'list1');
  // Require the record exists and has proposed_init before branching
  assert(rec, 'record must exist');
  assert(rec.proposed_init, 'record must have proposed_init');
  assert(rec.proposed_init.plan_action === 'mirror_initialize', `plan_action must be mirror_initialize, got ${rec.proposed_init.plan_action}`);
  // Only assert about operation_type after confirming plan_action
  if (rec.proposed_init.plan_action === 'mirror_initialize') {
    assert(!rec.proposed_init.operation_type, 'mirror_initialize should NOT have operation_type');
  }
});

test('R6-COND-3: R5-PLAN-5 conditional assertion is fixed', async () => {
  // This test verifies the fix for the R5-PLAN-5 conditional assertion that
  // silently passed when proposed_init was absent
  const deps = createMockDeps();
  deps._seedListing('list1', { status: 'active' });
  deps._seedLP('lp1', {
    listing_id: 'list1', reservation_version: 1,
    reservation_lifecycle_state: 'available',
  });
  const report = await generateMigrationReport(deps);
  assert(report.ok, 'report should succeed');
  const rec = report.records.find(r => r.listing_id === 'list1');
  // The old test would silently pass if rec?.proposed_init?.plan_action was absent.
  // The fixed test requires rec and rec.proposed_init to exist before asserting.
  assert(rec, 'record must exist — old test would silently pass without this');
  assert(rec.proposed_init, 'proposed_init must exist — old test would silently pass without this');
  assert(rec.proposed_init.plan_action === 'mirror_initialize',
    `plan_action must be mirror_initialize — old test would silently pass without this`);
});

// ════════════════════════════════════════════════════════════════════════════
// MAIN RUNNER
// ════════════════════════════════════════════════════════════════════════════

async function main() {
  console.log('=== Round 6 Correction Tests (7C.9C.2E) ===\n');
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
  console.log(`\n=== Overall: ${failed === 0 ? 'PASS' : 'FAIL'} ===`);
  console.log(`Tests run: ${tests.length}, Passed: ${passed}, Failed: ${failed}`);
  if (failed > 0) process.exit(1);
}

main().catch(err => { console.error('Test runner error:', err); process.exit(1); });