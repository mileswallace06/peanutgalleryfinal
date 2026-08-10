/**
 * Round 6B Correction Tests (7C.9C.2E)
 *
 * Tests for Round 6B corrections:
 *   Section 1: Post-CAS commit verification — validateIdempotentReplay against
 *              freshly re-fetched row; silent datastore drops/mutations detected.
 *   Section 2: Remove ID-only protection writes — never mutate Listing unless
 *              a row was successfully read; never fall back to {id} alone.
 *   Section 3: Migration revision validation — reservation_revision required
 *              explicit null for terminal and available states.
 *
 * No provider calls. No real-data migration. Synthetic mock deps only.
 */
import { createReservationAuthority } from '../base44/shared/reservationAuthority.js';
import { generateMigrationReport } from '../base44/shared/reservationAuthorityMigration.js';
import { createMockDeps, mockHashEnvelope } from './authority/helpers.mjs';

const tests = [];
let passed = 0;
let failed = 0;

function test(name, fn) { tests.push({ name, fn }); }
function assert(cond, msg) { if (!cond) throw new Error(msg); }

const R6B_PAYLOAD = { token: 't1', buyer: 'b1@test', expiration: '2026-12-31T00:00:00Z' };

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

// Helper: trigger a transition that succeeds CAS but fails post-CAS verification
// by dropping a field from the CAS $set. Returns the transition result.
async function triggerFailedCommit(deps, dropField, pendingEffects = []) {
  const authority = createReservationAuthority(deps);
  seedValidCommittedLP(deps, 'op_0', 'initialize', 'available', { token: null, buyer: null, expiration: null }, 0);
  deps._seedListing('list1', { reservation_version: 0, status: 'active' });

  // Drop the specified field from the CAS $set so post-CAS verification fails
  deps._lpFailConfig.dropFieldsOnUpdate = new Set([dropField]);

  return await authority.transitionReservation({
    listing_id: 'list1', expected_version: 0,
    operation_id: 'op_1', operation_type: 'reserve',
    payload: R6B_PAYLOAD, requested_state: 'reserved',
    pending_effects: pendingEffects,
  });
}

// ════════════════════════════════════════════════════════════════════════════
// SECTION 1: POST-CAS COMMIT VERIFICATION
// ════════════════════════════════════════════════════════════════════════════

test('R6B-COMMIT-1: silent drop of last_operation_result_json → VERIFICATION_MISMATCH', async () => {
  const deps = createMockDeps();
  const res = await triggerFailedCommit(deps, 'last_operation_result_json');
  assert(!res.ok, 'should fail when last_operation_result_json is silently dropped');
  assert(res.code === 'VERIFICATION_MISMATCH', `expected VERIFICATION_MISMATCH, got ${res.code}`);
  assert(res.protection, 'protection should be triggered');
  // No incomplete commit may return success
  assert(res.ok !== true, 'no incomplete commit may return success');
});

test('R6B-COMMIT-2: silent drop of last_operation_at → VERIFICATION_MISMATCH', async () => {
  const deps = createMockDeps();
  const res = await triggerFailedCommit(deps, 'last_operation_at');
  assert(!res.ok, 'should fail when last_operation_at is silently dropped');
  assert(res.code === 'VERIFICATION_MISMATCH', `expected VERIFICATION_MISMATCH, got ${res.code}`);
  assert(res.protection, 'protection should be triggered');
});

test('R6B-COMMIT-3: mutation of last_operation_result_json → VERIFICATION_MISMATCH', async () => {
  const deps = createMockDeps();
  const authority = createReservationAuthority(deps);
  seedValidCommittedLP(deps, 'op_0', 'initialize', 'available', { token: null, buyer: null, expiration: null }, 0);
  deps._seedListing('list1', { reservation_version: 0, status: 'active' });

  // Mutate last_operation_result_json after update
  deps._lpFailConfig.mutateAfterUpdate = {
    last_operation_result_json: '{"corrupted":true}',
  };

  const res = await authority.transitionReservation({
    listing_id: 'list1', expected_version: 0,
    operation_id: 'op_1', operation_type: 'reserve',
    payload: R6B_PAYLOAD, requested_state: 'reserved',
  });

  assert(!res.ok, 'should fail when last_operation_result_json is mutated');
  assert(res.code === 'VERIFICATION_MISMATCH', `expected VERIFICATION_MISMATCH, got ${res.code}`);
  assert(res.protection, 'protection should be triggered');
});

test('R6B-COMMIT-4: mutation of last_operation_at → VERIFICATION_MISMATCH', async () => {
  const deps = createMockDeps();
  const authority = createReservationAuthority(deps);
  seedValidCommittedLP(deps, 'op_0', 'initialize', 'available', { token: null, buyer: null, expiration: null }, 0);
  deps._seedListing('list1', { reservation_version: 0, status: 'active' });

  deps._lpFailConfig.mutateAfterUpdate = {
    last_operation_at: '2025-06-30T00:00:00Z',
  };

  const res = await authority.transitionReservation({
    listing_id: 'list1', expected_version: 0,
    operation_id: 'op_1', operation_type: 'reserve',
    payload: R6B_PAYLOAD, requested_state: 'reserved',
  });

  assert(!res.ok, 'should fail when last_operation_at is mutated');
  assert(res.code === 'VERIFICATION_MISMATCH', `expected VERIFICATION_MISMATCH, got ${res.code}`);
});

test('R6B-COMMIT-5: mismatched committed_at in result → VERIFICATION_MISMATCH', async () => {
  const deps = createMockDeps();
  const authority = createReservationAuthority(deps);
  seedValidCommittedLP(deps, 'op_0', 'initialize', 'available', { token: null, buyer: null, expiration: null }, 0);
  deps._seedListing('list1', { reservation_version: 0, status: 'active' });

  // Mutate committed_at inside the result JSON to differ from last_operation_at
  deps._lpFailConfig.mutateAfterUpdate = {
    last_operation_result_json: JSON.stringify({
      operation_id: 'op_1', operation_type: 'reserve', requested_state: 'reserved',
      previous_version: 0, new_version: 1,
      committed_at: '2025-06-30T00:00:00Z', // differs from last_operation_at
    }),
  };

  const res = await authority.transitionReservation({
    listing_id: 'list1', expected_version: 0,
    operation_id: 'op_1', operation_type: 'reserve',
    payload: R6B_PAYLOAD, requested_state: 'reserved',
  });

  assert(!res.ok, 'should fail when committed_at != last_operation_at');
  assert(res.code === 'VERIFICATION_MISMATCH', `expected VERIFICATION_MISMATCH, got ${res.code}`);
});

test('R6B-COMMIT-6: silent drop of pending_effects_json → VERIFICATION_MISMATCH', async () => {
  const deps = createMockDeps();
  // Nonempty effects so the intended JSON differs from the old stored '[]'
  const res = await triggerFailedCommit(deps, 'pending_effects_json', [{ type: 'notify_seller' }]);
  assert(!res.ok, 'should fail when pending_effects_json is silently dropped');
  assert(res.code === 'VERIFICATION_MISMATCH', `expected VERIFICATION_MISMATCH, got ${res.code}`);
  assert(res.protection, 'protection should be triggered');
});

test('R6B-COMMIT-7: silent drop of pending_effects_hash → VERIFICATION_MISMATCH', async () => {
  const deps = createMockDeps();
  // Nonempty effects so the intended hash differs from the old stored hash
  const res = await triggerFailedCommit(deps, 'pending_effects_hash', [{ type: 'notify_seller' }]);
  assert(!res.ok, 'should fail when pending_effects_hash is silently dropped');
  assert(res.code === 'VERIFICATION_MISMATCH', `expected VERIFICATION_MISMATCH, got ${res.code}`);
});

test('R6B-COMMIT-8: valid transition succeeds with full commit verification', async () => {
  const deps = createMockDeps();
  const authority = createReservationAuthority(deps);
  seedValidCommittedLP(deps, 'op_0', 'initialize', 'available', { token: null, buyer: null, expiration: null }, 0);
  deps._seedListing('list1', { reservation_version: 0, status: 'active' });

  const res = await authority.transitionReservation({
    listing_id: 'list1', expected_version: 0,
    operation_id: 'op_1', operation_type: 'reserve',
    payload: R6B_PAYLOAD, requested_state: 'reserved',
  });

  assert(res.ok, 'valid transition should succeed');
  assert(res.verified === true, 'should be verified');
  assert(res.version === 1, 'version should be 1');
  // Verify ALL committed fields are present
  const [lpAfter] = await deps.entities.ListingPrivate.filter({ listing_id: 'list1' });
  assert(lpAfter.last_operation_result_json !== null, 'last_operation_result_json must be present');
  assert(lpAfter.last_operation_at !== null, 'last_operation_at must be present');
  assert(lpAfter.pending_effects_json === '[]', 'pending_effects_json must be []');
  assert(lpAfter.pending_effects_hash !== null, 'pending_effects_hash must be present');
});

test('R6B-COMMIT-9: partial-commit containment — quarantine blocks further transitions, no rollback', async () => {
  const deps = createMockDeps();
  const authority = createReservationAuthority(deps);
  seedValidCommittedLP(deps, 'op_0', 'initialize', 'available', { token: null, buyer: null, expiration: null }, 0);
  deps._seedListing('list1', { reservation_version: 0, status: 'active' });
  deps._lpFailConfig.dropFieldsOnUpdate = new Set(['last_operation_result_json']);

  const res = await authority.transitionReservation({
    listing_id: 'list1', expected_version: 0,
    operation_id: 'op_1', operation_type: 'reserve',
    payload: R6B_PAYLOAD, requested_state: 'reserved',
  });

  assert(!res.ok, 'transition should fail');
  assert(res.protection, 'protection should be triggered');

  // Protection should have quarantined LP (protection-only write)
  const [lpAfter] = await deps.entities.ListingPrivate.filter({ listing_id: 'list1' });
  assert(lpAfter.checkout_quarantined === true, 'LP should be quarantined by protection');
  assert(lpAfter.recovery_blocked === true, 'LP should be recovery_blocked by protection');

  // CAS already committed before verification detected the datastore problem.
  // Blind rollback would be unsafe — a concurrent winner may have advanced.
  // Containment: the quarantined LP must reject all further transitions.
  const res2 = await authority.transitionReservation({
    listing_id: 'list1', expected_version: lpAfter.reservation_version,
    operation_id: 'op_2', operation_type: 'release',
    payload: { token: null, buyer: null, expiration: null },
    requested_state: 'available',
  });
  assert(!res2.ok, 'quarantined LP must reject further transitions');
  assert(res2.code === 'AUTHORITY_BLOCKED', `expected AUTHORITY_BLOCKED, got ${res2.code}`);
});

// ════════════════════════════════════════════════════════════════════════════
// SECTION 2: REMOVE ID-ONLY PROTECTION WRITES
// ════════════════════════════════════════════════════════════════════════════

// Helper: trigger protection via failed commit, with Listing filter throwing once
async function triggerProtectionWithReadThrow(deps, listingStatus) {
  const authority = createReservationAuthority(deps);
  seedValidCommittedLP(deps, 'op_0', 'initialize', 'available', { token: null, buyer: null, expiration: null }, 0);
  deps._seedListing('list1', { reservation_version: 0, status: listingStatus });

  // Drop a field so post-CAS verification fails → triggers protection
  deps._lpFailConfig.dropFieldsOnUpdate = new Set(['last_operation_result_json']);

  // Make the first Listing filter call throw (protection's initial read)
  deps._listingFailConfig.filterThrowOnce = true;

  return await authority.transitionReservation({
    listing_id: 'list1', expected_version: 0,
    operation_id: 'op_1', operation_type: 'reserve',
    payload: R6B_PAYLOAD, requested_state: 'reserved',
  });
}

test('R6B-PROT-1: initial read throws while Listing is sold → PROTECTION_INCOMPLETE, Listing unchanged', async () => {
  const deps = createMockDeps();
  const res = await triggerProtectionWithReadThrow(deps, 'sold');

  assert(!res.ok, 'should fail');
  assert(res.protection, 'protection should be triggered');
  assert(res.protection.code === 'PROTECTION_INCOMPLETE',
    `expected PROTECTION_INCOMPLETE, got ${res.protection.code}`);
  assert(res.protection.steps.listing_read_failed === true, 'should record listing_read_failed');
  assert(res.protection.steps.listing_protection_unproven === true, 'should record listing_protection_unproven');
  assert(res.protection.steps.listing_hide_skipped === true, 'should skip Listing hide');

  // Listing must NOT be mutated — status must still be 'sold'
  const [listing] = await deps.entities.Listing.filter({ id: 'list1' });
  assert(listing.status === 'sold', `Listing status must be unchanged (sold), got ${listing.status}`);
  assert(listing.hidden_reason === null, 'hidden_reason must be unchanged (null)');
});

test('R6B-PROT-2: initial read throws while Listing is cancelled → PROTECTION_INCOMPLETE, Listing unchanged', async () => {
  const deps = createMockDeps();
  const res = await triggerProtectionWithReadThrow(deps, 'cancelled');

  assert(!res.ok, 'should fail');
  assert(res.protection.code === 'PROTECTION_INCOMPLETE',
    `expected PROTECTION_INCOMPLETE, got ${res.protection.code}`);

  const [listing] = await deps.entities.Listing.filter({ id: 'list1' });
  assert(listing.status === 'cancelled', `Listing status must be unchanged (cancelled), got ${listing.status}`);
});

test('R6B-PROT-3: initial read throws while Listing is active → PROTECTION_INCOMPLETE, Listing unchanged', async () => {
  const deps = createMockDeps();
  const res = await triggerProtectionWithReadThrow(deps, 'active');

  assert(!res.ok, 'should fail');
  assert(res.protection.code === 'PROTECTION_INCOMPLETE',
    `expected PROTECTION_INCOMPLETE, got ${res.protection.code}`);

  // Listing must NOT be mutated — status must still be 'active' (not hidden)
  const [listing] = await deps.entities.Listing.filter({ id: 'list1' });
  assert(listing.status === 'active', `Listing status must be unchanged (active), got ${listing.status}`);
  assert(listing.hidden_reason === null, 'hidden_reason must be unchanged (null)');
});

test('R6B-PROT-4: active read followed by concurrent sold → preserves sold (authority)', async () => {
  const deps = createMockDeps();
  const authority = createReservationAuthority(deps);
  seedValidCommittedLP(deps, 'op_0', 'initialize', 'available', { token: null, buyer: null, expiration: null }, 0);
  deps._seedListing('list1', { reservation_version: 0, status: 'active' });

  deps._lpFailConfig.dropFieldsOnUpdate = new Set(['last_operation_result_json']);

  // Hook: after protection reads Listing (active), change to sold before hide
  deps._setHook('beforeProtectionHide', (d, listing_id) => {
    const listing = d._listingStore.get('list1');
    if (listing) {
      listing.status = 'sold';
      listing.hidden_reason = null;
    }
  });

  const res = await authority.transitionReservation({
    listing_id: 'list1', expected_version: 0,
    operation_id: 'op_1', operation_type: 'reserve',
    payload: R6B_PAYLOAD, requested_state: 'reserved',
  });

  assert(!res.ok, 'should fail');
  assert(res.protection, 'protection should be triggered');

  // Final status must be 'sold' (concurrent terminal), NOT 'hidden'
  const [listing] = await deps.entities.Listing.filter({ id: 'list1' });
  assert(listing.status === 'sold', `final status must be sold (concurrent terminal), got ${listing.status}`);
  assert(listing.status !== 'hidden', 'must not overwrite concurrent terminal with hidden');
});

test('R6B-PROT-5: active read followed by concurrent pending_verification → preserves (authority)', async () => {
  const deps = createMockDeps();
  const authority = createReservationAuthority(deps);
  seedValidCommittedLP(deps, 'op_0', 'initialize', 'available', { token: null, buyer: null, expiration: null }, 0);
  deps._seedListing('list1', { reservation_version: 0, status: 'active' });

  deps._lpFailConfig.dropFieldsOnUpdate = new Set(['last_operation_result_json']);

  deps._setHook('beforeProtectionHide', (d, listing_id) => {
    const listing = d._listingStore.get('list1');
    if (listing) {
      listing.status = 'pending_verification';
      listing.hidden_reason = null;
    }
  });

  const res = await authority.transitionReservation({
    listing_id: 'list1', expected_version: 0,
    operation_id: 'op_1', operation_type: 'reserve',
    payload: R6B_PAYLOAD, requested_state: 'reserved',
  });

  assert(!res.ok, 'should fail');
  assert(res.protection, 'protection should be triggered');

  const [listing] = await deps.entities.Listing.filter({ id: 'list1' });
  assert(listing.status === 'pending_verification',
    `final status must be pending_verification (business-held), got ${listing.status}`);
  assert(listing.status !== 'hidden', 'must not overwrite business-held with hidden');
});

test('R6B-PROT-6: mirror protection initial read throws while Listing is sold → PROTECTION_INCOMPLETE', async () => {
  const deps = createMockDeps();
  const authority = createReservationAuthority(deps);

  // Set up mirror newer than authority to trigger protectMirror
  deps._seedLP('lp1', {
    listing_id: 'list1', reservation_version: 2,
    reservation_lifecycle_state: 'available',
  });
  deps._seedListing('list1', { reservation_version: 5, status: 'sold' });

  // Make the SECOND Listing filter call throw (protectMirror's initial read).
  // Call 0 = sweepMirror's Listing read; call 1 = protectMirror's Listing read.
  deps._listingFailConfig.filterThrowOnCall = 1;

  const res = await authority.sweepMirror('list1');

  assert(!res.ok, 'should fail');
  assert(res.protection, 'protection should be triggered');
  assert(res.protection.code === 'PROTECTION_INCOMPLETE',
    `expected PROTECTION_INCOMPLETE, got ${res.protection.code}`);
  assert(res.protection.steps.listing_read_failed === true, 'should record listing_read_failed');
  assert(res.protection.steps.listing_hide_skipped === true, 'should skip Listing hide');

  // Listing must NOT be mutated — status must still be 'sold'
  const [listing] = await deps.entities.Listing.filter({ id: 'list1' });
  assert(listing.status === 'sold', `Listing status must be unchanged (sold), got ${listing.status}`);
});

test('R6B-PROT-7: mirror protection active read followed by concurrent sold → preserves sold', async () => {
  const deps = createMockDeps();
  const authority = createReservationAuthority(deps);

  deps._seedLP('lp1', {
    listing_id: 'list1', reservation_version: 2,
    reservation_lifecycle_state: 'available',
  });
  deps._seedListing('list1', { reservation_version: 5, status: 'active' });

  // Hook: after protection reads Listing (active), change to sold before hide
  deps._setHook('beforeProtectionHide', (d, listing_id) => {
    const listing = d._listingStore.get('list1');
    if (listing) {
      listing.status = 'sold';
      listing.hidden_reason = null;
    }
  });

  const res = await authority.sweepMirror('list1');

  assert(!res.ok, 'should fail');
  assert(res.protection, 'protection should be triggered');

  // Final status must be 'sold' (concurrent terminal), NOT 'hidden'
  const [listing] = await deps.entities.Listing.filter({ id: 'list1' });
  assert(listing.status === 'sold', `final status must be sold, got ${listing.status}`);
  assert(listing.status !== 'hidden', 'must not overwrite concurrent terminal with hidden');
});

// ════════════════════════════════════════════════════════════════════════════
// SECTION 3: MIGRATION REVISION VALIDATION
// ════════════════════════════════════════════════════════════════════════════

// Helper: seed a listing + LP with specified revision, no reservation_version
function seedForMigration(deps, listingStatus, lpData) {
  deps._seedListing('list1', { status: listingStatus });
  deps._seedLP('lp1', {
    listing_id: 'list1',
    reservation_token: null, reserved_by_email: null, reservation_expires_at: null,
    reservation_revision: null,
    ...lpData,
  });
  delete deps._lpStore.get('lp1').reservation_version;
  // Remove default lifecycle state so migration falls through to tuple-based derivation
  delete deps._lpStore.get('lp1').reservation_lifecycle_state;
}

test('R6B-MIG-1: sold + stale revision → AMBIGUOUS', async () => {
  const deps = createMockDeps();
  seedForMigration(deps, 'sold', { reservation_revision: 'stale_rev' });
  const report = await generateMigrationReport(deps);
  const rec = report.records.find(r => r.listing_id === 'list1');
  assert(rec.derived_lifecycle_state === 'AMBIGUOUS',
    `sold + stale revision should be AMBIGUOUS, got ${rec.derived_lifecycle_state}`);
  assert(rec.status === 'AMBIGUOUS', `status should be AMBIGUOUS, got ${rec.status}`);
  assert(rec.proposed_init === null, 'ambiguous record must not receive plan');
});

test('R6B-MIG-2: sold + empty revision → AMBIGUOUS', async () => {
  const deps = createMockDeps();
  seedForMigration(deps, 'sold', { reservation_revision: '' });
  const report = await generateMigrationReport(deps);
  const rec = report.records.find(r => r.listing_id === 'list1');
  assert(rec.derived_lifecycle_state === 'AMBIGUOUS',
    `sold + empty revision should be AMBIGUOUS, got ${rec.derived_lifecycle_state}`);
});

test('R6B-MIG-3: sold + undefined revision → AMBIGUOUS', async () => {
  const deps = createMockDeps();
  deps._seedListing('list1', { status: 'sold' });
  deps._seedLP('lp1', {
    listing_id: 'list1',
    reservation_token: null, reserved_by_email: null, reservation_expires_at: null,
  });
  delete deps._lpStore.get('lp1').reservation_version;
  delete deps._lpStore.get('lp1').reservation_revision;
  delete deps._lpStore.get('lp1').reservation_lifecycle_state;
  const report = await generateMigrationReport(deps);
  const rec = report.records.find(r => r.listing_id === 'list1');
  assert(rec.derived_lifecycle_state === 'AMBIGUOUS',
    `sold + undefined revision should be AMBIGUOUS, got ${rec.derived_lifecycle_state}`);
});

test('R6B-MIG-4: cancelled + stale revision → AMBIGUOUS', async () => {
  const deps = createMockDeps();
  seedForMigration(deps, 'cancelled', { reservation_revision: 'stale_rev' });
  const report = await generateMigrationReport(deps);
  const rec = report.records.find(r => r.listing_id === 'list1');
  assert(rec.derived_lifecycle_state === 'AMBIGUOUS',
    `cancelled + stale revision should be AMBIGUOUS, got ${rec.derived_lifecycle_state}`);
});

test('R6B-MIG-5: expired + stale revision → AMBIGUOUS', async () => {
  const deps = createMockDeps();
  seedForMigration(deps, 'expired', { reservation_revision: 'stale_rev' });
  const report = await generateMigrationReport(deps);
  const rec = report.records.find(r => r.listing_id === 'list1');
  assert(rec.derived_lifecycle_state === 'AMBIGUOUS',
    `expired + stale revision should be AMBIGUOUS, got ${rec.derived_lifecycle_state}`);
});

test('R6B-MIG-6: active/available + stale revision → AMBIGUOUS', async () => {
  const deps = createMockDeps();
  seedForMigration(deps, 'active', { reservation_revision: 'stale_rev' });
  const report = await generateMigrationReport(deps);
  const rec = report.records.find(r => r.listing_id === 'list1');
  assert(rec.derived_lifecycle_state === 'AMBIGUOUS',
    `active + stale revision should be AMBIGUOUS, got ${rec.derived_lifecycle_state}`);
});

test('R6B-MIG-7: active/available + empty revision → AMBIGUOUS', async () => {
  const deps = createMockDeps();
  seedForMigration(deps, 'active', { reservation_revision: '' });
  const report = await generateMigrationReport(deps);
  const rec = report.records.find(r => r.listing_id === 'list1');
  assert(rec.derived_lifecycle_state === 'AMBIGUOUS',
    `active + empty revision should be AMBIGUOUS, got ${rec.derived_lifecycle_state}`);
});

test('R6B-MIG-8: active/available + omitted revision → AMBIGUOUS', async () => {
  const deps = createMockDeps();
  deps._seedListing('list1', { status: 'active' });
  deps._seedLP('lp1', {
    listing_id: 'list1',
    reservation_token: null, reserved_by_email: null, reservation_expires_at: null,
  });
  delete deps._lpStore.get('lp1').reservation_version;
  delete deps._lpStore.get('lp1').reservation_revision;
  delete deps._lpStore.get('lp1').reservation_lifecycle_state;
  const report = await generateMigrationReport(deps);
  const rec = report.records.find(r => r.listing_id === 'list1');
  assert(rec.derived_lifecycle_state === 'AMBIGUOUS',
    `active + omitted revision should be AMBIGUOUS, got ${rec.derived_lifecycle_state}`);
});

test('R6B-MIG-9: valid explicit-null terminal with null revision → sold (migratable)', async () => {
  const deps = createMockDeps();
  deps._seedListing('list1', { status: 'sold' });
  deps._seedLP('lp1', {
    listing_id: 'list1',
    reservation_token: null, reserved_by_email: null, reservation_expires_at: null,
    reservation_revision: null,
  });
  delete deps._lpStore.get('lp1').reservation_version;
  delete deps._listingStore.get('list1').reservation_version;
  const report = await generateMigrationReport(deps);
  const rec = report.records.find(r => r.listing_id === 'list1');
  assert(rec.derived_lifecycle_state === 'sold',
    `valid explicit-null terminal should derive sold, got ${rec.derived_lifecycle_state}`);
  assert(rec.status === 'MIGRATION_REQUIRED', `should be migratable, got ${rec.status}`);
});

test('R6B-MIG-10: valid active with null revision → available (migratable)', async () => {
  const deps = createMockDeps();
  deps._seedListing('list1', { status: 'active' });
  deps._seedLP('lp1', {
    listing_id: 'list1',
    reservation_token: null, reserved_by_email: null, reservation_expires_at: null,
    reservation_revision: null,
  });
  delete deps._lpStore.get('lp1').reservation_version;
  delete deps._lpStore.get('lp1').reservation_lifecycle_state;
  delete deps._listingStore.get('list1').reservation_version;
  const report = await generateMigrationReport(deps);
  const rec = report.records.find(r => r.listing_id === 'list1');
  assert(rec.derived_lifecycle_state === 'available',
    `valid active with null revision should derive available, got ${rec.derived_lifecycle_state}`);
  assert(rec.status === 'MIGRATION_REQUIRED', `should be migratable, got ${rec.status}`);
});

test('R6B-MIG-11: sold + non-null token has exact issue "terminal state has non-null token"', async () => {
  const deps = createMockDeps();
  deps._seedListing('list1', { status: 'sold' });
  deps._seedLP('lp1', {
    listing_id: 'list1',
    reservation_token: 'should_be_null', reserved_by_email: 'should_be_null',
    reservation_expires_at: null, reservation_revision: null,
  });
  delete deps._lpStore.get('lp1').reservation_version;
  const report = await generateMigrationReport(deps);
  const rec = report.records.find(r => r.listing_id === 'list1');
  assert(rec.status === 'AMBIGUOUS', `expected AMBIGUOUS, got ${rec.status}`);
  assert(rec.issues.some(i => i.includes('terminal state has non-null token')),
    `should have "terminal state has non-null token" issue, got: ${rec.issues.join('; ')}`);
  assert(rec.issues.some(i => i.includes('terminal state has non-null buyer')),
    `should have "terminal state has non-null buyer" issue, got: ${rec.issues.join('; ')}`);
});

test('R6B-MIG-12: sold + non-null revision has exact issue "terminal state has non-null revision"', async () => {
  const deps = createMockDeps();
  deps._seedListing('list1', { status: 'sold' });
  deps._seedLP('lp1', {
    listing_id: 'list1',
    reservation_token: null, reserved_by_email: null, reservation_expires_at: null,
    reservation_revision: 'stale_rev',
  });
  delete deps._lpStore.get('lp1').reservation_version;
  const report = await generateMigrationReport(deps);
  const rec = report.records.find(r => r.listing_id === 'list1');
  assert(rec.status === 'AMBIGUOUS', `expected AMBIGUOUS, got ${rec.status}`);
  assert(rec.issues.some(i => i.includes('terminal state has non-null revision')),
    `should have "terminal state has non-null revision" issue, got: ${rec.issues.join('; ')}`);
});

// ════════════════════════════════════════════════════════════════════════════
// MAIN RUNNER
// ════════════════════════════════════════════════════════════════════════════

async function main() {
  console.log('=== Round 6B Correction Tests (7C.9C.2E) ===\n');
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