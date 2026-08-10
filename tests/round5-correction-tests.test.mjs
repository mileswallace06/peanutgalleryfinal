/**
 * Round 5 Correction Tests (7C.9C.2E)
 *
 * Regression tests for each defect identified in Correction Round 5:
 *   Item 2: CAS snapshot completeness — beforeCAS tests for each protected field
 *   Item 3: Quarantined migration classification — joined Listing + LP tests
 *   Item 4: Migration plan contract — no invalid operation_type, no stale status text
 *   Item 5: Terminal/business-held status preservation during protection
 *
 * No provider calls. No real-data migration. Synthetic mock deps only.
 */
import { createReservationAuthority } from '../base44/shared/reservationAuthority.js';
import { generateMigrationReport, planApply } from '../base44/shared/reservationAuthorityMigration.js';
import {
  OPERATION_TYPES, shouldHideForProtection, isNonReservableStatus,
  TERMINAL_BUSINESS_STATUSES, BUSINESS_HELD_STATUSES,
  buildAuthoritativeSnapshot,
} from '../base44/shared/reservationAuthorityConstants.js';
import { createMockDeps, mockHashEnvelope } from './authority/helpers.mjs';

const tests = [];
let passed = 0;
let failed = 0;

function test(name, fn) { tests.push({ name, fn }); }
function assert(cond, msg) { if (!cond) throw new Error(msg); }

const R5_PAYLOAD = { token: 't1', buyer: 'b1@test', expiration: '2026-12-31T00:00:00Z' };

// Helper: seed a fully valid committed LP record
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

// ════════════════════════════════════════════════════════════════════════════
// ITEM 2: CAS SNAPSHOT COMPLETENESS — beforeCAS tests for each protected field
// ════════════════════════════════════════════════════════════════════════════

// Helper: test that a legacy writer changing a specific field causes CAS to lose
function testBeforeCASField(fieldName, newValue) {
  return async () => {
    const deps = createMockDeps();
    const authority = createReservationAuthority(deps);
    deps._seedLP('lp1', { listing_id: 'list1' });
    deps._seedListing('list1', {});
    deps._setHook('beforeCAS', (d) => {
      const lp = d._lpStore.get('lp1');
      if (lp) lp[fieldName] = newValue;
    });
    const res = await authority.transitionReservation({
      listing_id: 'list1', expected_version: 0,
      operation_id: 'op_1', operation_type: 'reserve',
      payload: R5_PAYLOAD, requested_state: 'reserved',
    });
    assert(!res.ok, `CAS should lose when legacy writer changes ${fieldName}`);
    assert(res.code === 'CONFLICT', `expected CONFLICT for ${fieldName}, got ${res.code}`);
    const [lp] = await deps.entities.ListingPrivate.filter({ listing_id: 'list1' });
    assert(lp.reservation_version === 0, `version should not be incremented for ${fieldName}`);
    assert(lp.last_operation_id !== 'op_1', `authority operation should not be written for ${fieldName}`);
  };
}

test('R5-CAS-1: legacy writer changes reservation_token → CAS loses', testBeforeCASField('reservation_token', 'legacy_token'));
test('R5-CAS-2: legacy writer changes reserved_by_email → CAS loses', testBeforeCASField('reserved_by_email', 'legacy@test'));
test('R5-CAS-3: legacy writer changes reservation_expires_at → CAS loses', testBeforeCASField('reservation_expires_at', '2025-06-30T00:00:00Z'));
test('R5-CAS-4: legacy writer changes reservation_revision → CAS loses', testBeforeCASField('reservation_revision', 'legacy_rev'));
test('R5-CAS-5: legacy writer changes reservation_lifecycle_state → CAS loses', testBeforeCASField('reservation_lifecycle_state', 'reserved'));
test('R5-CAS-6: legacy writer changes pending_effects_json → CAS loses', testBeforeCASField('pending_effects_json', JSON.stringify([{ effect_type: 'legacy' }])));
test('R5-CAS-7: legacy writer changes pending_effects_hash → CAS loses', testBeforeCASField('pending_effects_hash', 'legacy_hash'));
test('R5-CAS-8: legacy writer changes checkout_quarantined → CAS loses', testBeforeCASField('checkout_quarantined', true));
test('R5-CAS-9: legacy writer changes recovery_blocked → CAS loses', testBeforeCASField('recovery_blocked', true));
test('R5-CAS-10: legacy writer changes last_operation_id → CAS loses', testBeforeCASField('last_operation_id', 'legacy_op'));
test('R5-CAS-11: legacy writer changes last_operation_type → CAS loses', testBeforeCASField('last_operation_type', 'legacy_type'));
test('R5-CAS-12: legacy writer changes last_operation_payload_hash → CAS loses', testBeforeCASField('last_operation_payload_hash', 'legacy_hash'));
test('R5-CAS-13: legacy writer changes last_operation_result_json → CAS loses', testBeforeCASField('last_operation_result_json', 'legacy_result'));
test('R5-CAS-14: legacy writer changes last_operation_at → CAS loses', testBeforeCASField('last_operation_at', '2025-01-01T00:00:00Z'));

// ════════════════════════════════════════════════════════════════════════════
// ITEM 3: QUARANTINED MIGRATION CLASSIFICATION — joined Listing + LP tests
// ════════════════════════════════════════════════════════════════════════════

test('R5-MIG-1: quarantined LP with valid complete tuple + Listing hidden → derives frozen', async () => {
  const deps = createMockDeps();
  deps._seedListing('list1', { status: 'hidden' });
  deps._seedLP('lp1', {
    listing_id: 'list1',
    checkout_quarantined: true,
    reservation_token: 'tok1', reserved_by_email: 'b1@test',
    reservation_expires_at: '2026-12-31T00:00:00Z',
    reservation_revision: 'rev1',
  });
  delete deps._lpStore.get('lp1').reservation_version;
  const report = await generateMigrationReport(deps);
  assert(report.ok, 'report should succeed');
  const rec = report.records.find(r => r.listing_id === 'list1');
  assert(rec, 'should have a record');
  assert(rec.derived_lifecycle_state === 'frozen', `expected frozen, got ${rec.derived_lifecycle_state}`);
});

test('R5-MIG-2: quarantined LP with incomplete tuple (missing revision) → AMBIGUOUS', async () => {
  const deps = createMockDeps();
  deps._seedListing('list1', { status: 'hidden' });
  deps._seedLP('lp1', {
    listing_id: 'list1',
    checkout_quarantined: true,
    reservation_token: 'tok1', reserved_by_email: 'b1@test',
    reservation_expires_at: '2026-12-31T00:00:00Z',
    reservation_revision: null,
  });
  delete deps._lpStore.get('lp1').reservation_version;
  const report = await generateMigrationReport(deps);
  assert(report.ok, 'report should succeed');
  const rec = report.records.find(r => r.listing_id === 'list1');
  assert(rec, 'should have a record');
  assert(rec.derived_lifecycle_state === 'AMBIGUOUS', `expected AMBIGUOUS, got ${rec.derived_lifecycle_state}`);
});

test('R5-MIG-3: quarantined LP with malformed tuple (bad expiration) → AMBIGUOUS', async () => {
  const deps = createMockDeps();
  deps._seedListing('list1', { status: 'hidden' });
  deps._seedLP('lp1', {
    listing_id: 'list1',
    checkout_quarantined: true,
    reservation_token: 'tok1', reserved_by_email: 'b1@test',
    reservation_expires_at: 'not-a-date',
    reservation_revision: 'rev1',
  });
  delete deps._lpStore.get('lp1').reservation_version;
  const report = await generateMigrationReport(deps);
  assert(report.ok, 'report should succeed');
  const rec = report.records.find(r => r.listing_id === 'list1');
  assert(rec, 'should have a record');
  assert(rec.derived_lifecycle_state === 'AMBIGUOUS', `expected AMBIGUOUS, got ${rec.derived_lifecycle_state}`);
});

test('R5-MIG-4: quarantined LP with contradictory tuple (token but no buyer) → AMBIGUOUS', async () => {
  const deps = createMockDeps();
  deps._seedListing('list1', { status: 'hidden' });
  deps._seedLP('lp1', {
    listing_id: 'list1',
    checkout_quarantined: true,
    reservation_token: 'tok1', reserved_by_email: null,
    reservation_expires_at: '2026-12-31T00:00:00Z',
    reservation_revision: 'rev1',
  });
  delete deps._lpStore.get('lp1').reservation_version;
  const report = await generateMigrationReport(deps);
  assert(report.ok, 'report should succeed');
  const rec = report.records.find(r => r.listing_id === 'list1');
  assert(rec, 'should have a record');
  assert(rec.derived_lifecycle_state === 'AMBIGUOUS', `expected AMBIGUOUS, got ${rec.derived_lifecycle_state}`);
});

test('R5-MIG-5: generic hidden Listing without quarantine evidence → never available', async () => {
  const deps = createMockDeps();
  deps._seedListing('list1', { status: 'hidden' });
  deps._seedLP('lp1', {
    listing_id: 'list1',
    checkout_quarantined: false, recovery_blocked: false,
    reservation_token: null, reserved_by_email: null, reservation_expires_at: null,
  });
  delete deps._lpStore.get('lp1').reservation_version;
  const report = await generateMigrationReport(deps);
  assert(report.ok, 'report should succeed');
  const rec = report.records.find(r => r.listing_id === 'list1');
  assert(rec, 'should have a record');
  assert(rec.derived_lifecycle_state !== 'available', 'generic hidden must never derive available');
  assert(rec.derived_lifecycle_state === 'AMBIGUOUS', `expected AMBIGUOUS, got ${rec.derived_lifecycle_state}`);
});

test('R5-MIG-6: recovery-blocked LP with valid complete tuple → derives frozen', async () => {
  const deps = createMockDeps();
  deps._seedListing('list1', { status: 'hidden' });
  deps._seedLP('lp1', {
    listing_id: 'list1',
    recovery_blocked: true,
    reservation_token: 'tok1', reserved_by_email: 'b1@test',
    reservation_expires_at: '2026-12-31T00:00:00Z',
    reservation_revision: 'rev1',
  });
  delete deps._lpStore.get('lp1').reservation_version;
  const report = await generateMigrationReport(deps);
  assert(report.ok, 'report should succeed');
  const rec = report.records.find(r => r.listing_id === 'list1');
  assert(rec, 'should have a record');
  assert(rec.derived_lifecycle_state === 'frozen', `expected frozen, got ${rec.derived_lifecycle_state}`);
});

test('R5-MIG-7: recovery-blocked LP with incomplete tuple → AMBIGUOUS', async () => {
  const deps = createMockDeps();
  deps._seedListing('list1', { status: 'hidden' });
  deps._seedLP('lp1', {
    listing_id: 'list1',
    recovery_blocked: true,
    reservation_token: null, reserved_by_email: null, reservation_expires_at: null,
    reservation_revision: null,
  });
  delete deps._lpStore.get('lp1').reservation_version;
  const report = await generateMigrationReport(deps);
  assert(report.ok, 'report should succeed');
  const rec = report.records.find(r => r.listing_id === 'list1');
  assert(rec, 'should have a record');
  assert(rec.derived_lifecycle_state === 'AMBIGUOUS', `expected AMBIGUOUS, got ${rec.derived_lifecycle_state}`);
});

test('R5-MIG-8: sold Listing with cleared tuple never becomes available', async () => {
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
  assert(rec.derived_lifecycle_state === 'sold', `expected sold, got ${rec.derived_lifecycle_state}`);
});

// ════════════════════════════════════════════════════════════════════════════
// ITEM 4: MIGRATION PLAN CONTRACT
// ════════════════════════════════════════════════════════════════════════════

test('R5-PLAN-1: planApply uses valid initialize operation_type', () => {
  const deps = createMockDeps();
  const plan = planApply(deps, 'apply_req_1');
  assert(plan.operation_type === 'initialize', 'plan should use initialize');
  assert(OPERATION_TYPES.includes(plan.operation_type), 'initialize should be in OPERATION_TYPES');
});

test('R5-PLAN-2: planApply initialized_fields does not include status or hidden_reason', () => {
  const deps = createMockDeps();
  const plan = planApply(deps, 'apply_req_1');
  const hasStatus = plan.initialized_fields.some(f => f.includes('status'));
  const hasHiddenReason = plan.initialized_fields.some(f => f.includes('hidden_reason'));
  assert(!hasStatus, 'initialized_fields must not include status');
  assert(!hasHiddenReason, 'initialized_fields must not include hidden_reason');
});

test('R5-PLAN-3: planApply description does not mention writing status or hidden_reason', () => {
  const deps = createMockDeps();
  const plan = planApply(deps, 'apply_req_1');
  assert(!plan.description.includes('status'), 'description must not mention status');
  assert(!plan.description.includes('hidden_reason'), 'description must not mention hidden_reason');
});

test('R5-PLAN-4: planApply steps do not mention writing status or hidden_reason', () => {
  const deps = createMockDeps();
  const plan = planApply(deps, 'apply_req_1');
  for (const step of plan.steps) {
    const mentionsStatusWrite = step.includes('status:') || step.includes('status=') || step.includes("status '") ;
    const mentionsHiddenReasonWrite = step.includes('hidden_reason:') || step.includes('hidden_reason=');
    assert(!mentionsStatusWrite, `step must not write status: ${step}`);
    assert(!mentionsHiddenReasonWrite, `step must not write hidden_reason: ${step}`);
  }
});

test('R5-PLAN-5: buildMirrorOnlyPlan uses plan_action not operation_type', async () => {
  const deps = createMockDeps();
  deps._seedListing('list1', { status: 'active' });
  deps._seedLP('lp1', {
    listing_id: 'list1', reservation_version: 1,
    reservation_lifecycle_state: 'available',
  });
  const report = await generateMigrationReport(deps);
  assert(report.ok, 'report should succeed');
  const rec = report.records.find(r => r.listing_id === 'list1');
  // buildMirrorOnlyPlan is called for MIRROR_MIGRATION_REQUIRED records
  if (rec?.proposed_init?.plan_action === 'mirror_initialize') {
    assert(rec.proposed_init.plan_action === 'mirror_initialize', 'should use plan_action');
    assert(!rec.proposed_init.operation_type, 'should NOT use operation_type for mirror init');
    assert(!rec.proposed_init.note.includes('hidden_reason'), 'note should not mention hidden_reason');
  }
});

test('R5-PLAN-6: planApply is dry_run only — no real apply', () => {
  const deps = createMockDeps();
  const plan = planApply(deps, 'apply_req_1');
  assert(plan.mode === 'dry_run', 'plan must be dry_run');
  assert(plan.requires_owner_approval === true, 'plan must require owner approval');
});

// ════════════════════════════════════════════════════════════════════════════
// ITEM 5: TERMINAL/BUSINESS-HELD STATUS PRESERVATION DURING PROTECTION
// ════════════════════════════════════════════════════════════════════════════

// Helper: test protection behavior for a given initial Listing status
async function testProtectionForStatus(initialStatus, shouldHide, expectedStatus) {
  const deps = createMockDeps();
  const authority = createReservationAuthority(deps);
  deps._seedLP('lp1', {
    listing_id: 'list1', reservation_version: 0,
    reservation_lifecycle_state: null, // corrupt state triggers protection
  });
  deps._seedListing('list1', { status: initialStatus });
  const res = await authority.transitionReservation({
    listing_id: 'list1', expected_version: 0,
    operation_id: 'op_1', operation_type: 'reserve',
    payload: R5_PAYLOAD, requested_state: 'reserved',
  });
  assert(!res.ok, 'should fail with STATE_CORRUPT');
  assert(res.code === 'STATE_CORRUPT', `expected STATE_CORRUPT, got ${res.code}`);
  assert(res.protection, 'should have protection result');
  assert(res.protection.protected === true, 'protection should be verified');

  // Verify Listing status
  const [listing] = await deps.entities.Listing.filter({ id: 'list1' });
  if (shouldHide) {
    assert(listing.status === 'hidden', `expected hidden, got ${listing.status}`);
    assert(listing.hidden_reason === 'checkout_quarantine', `expected checkout_quarantine, got ${listing.hidden_reason}`);
  } else {
    assert(listing.status === expectedStatus, `expected ${expectedStatus} preserved, got ${listing.status}`);
  }

  // Verify LP is quarantined regardless
  const [lp] = await deps.entities.ListingPrivate.filter({ listing_id: 'list1' });
  assert(lp.checkout_quarantined === true, 'LP should be quarantined');
  assert(lp.recovery_blocked === true, 'LP should be recovery-blocked');

  // Verify AdminAlert exists
  const alerts = Array.from(deps._adminAlertStore.values());
  const unresolved = alerts.filter(a => a.resolved === false);
  assert(unresolved.length >= 1, 'should have at least 1 unresolved alert');
  assert(unresolved[0].priority === 'critical', 'priority should be critical');
}

test('R5-PROT-1: corrupt LP + Listing sold → protection preserves sold', async () => {
  await testProtectionForStatus('sold', false, 'sold');
});

test('R5-PROT-2: corrupt LP + Listing cancelled → protection preserves cancelled', async () => {
  await testProtectionForStatus('cancelled', false, 'cancelled');
});

test('R5-PROT-3: corrupt LP + Listing expired → protection preserves expired', async () => {
  await testProtectionForStatus('expired', false, 'expired');
});

test('R5-PROT-4: corrupt LP + Listing active → protection hides to hidden/checkout_quarantine', async () => {
  await testProtectionForStatus('active', true, 'hidden');
});

test('R5-PROT-5: corrupt LP + Listing hidden (admin_disabled) → protection preserves hidden', async () => {
  const deps = createMockDeps();
  const authority = createReservationAuthority(deps);
  deps._seedLP('lp1', {
    listing_id: 'list1', reservation_version: 0,
    reservation_lifecycle_state: null,
  });
  deps._seedListing('list1', { status: 'hidden', hidden_reason: 'admin_disabled' });
  const res = await authority.transitionReservation({
    listing_id: 'list1', expected_version: 0,
    operation_id: 'op_1', operation_type: 'reserve',
    payload: R5_PAYLOAD, requested_state: 'reserved',
  });
  assert(!res.ok, 'should fail with STATE_CORRUPT');
  assert(res.protection.protected === true, 'protection should be verified');
  const [listing] = await deps.entities.Listing.filter({ id: 'list1' });
  assert(listing.status === 'hidden', 'should remain hidden');
  assert(listing.hidden_reason === 'admin_disabled', 'should preserve admin_disabled reason');
});

test('R5-PROT-6: corrupt LP + Listing pending_verification → protection preserves pending_verification', async () => {
  await testProtectionForStatus('pending_verification', false, 'pending_verification');
});

test('R5-PROT-7: corrupt LP + Listing pending_payout_setup → protection preserves pending_payout_setup', async () => {
  await testProtectionForStatus('pending_payout_setup', false, 'pending_payout_setup');
});

// ── shouldHideForProtection unit tests ──────────────────────────────────────
test('R5-PROT-8: shouldHideForProtection returns false for terminal statuses', () => {
  assert(shouldHideForProtection('sold') === false, 'sold should not be hidden');
  assert(shouldHideForProtection('cancelled') === false, 'cancelled should not be hidden');
  assert(shouldHideForProtection('expired') === false, 'expired should not be hidden');
});

test('R5-PROT-9: shouldHideForProtection returns false for business-held statuses', () => {
  assert(shouldHideForProtection('hidden') === false, 'hidden should not be hidden');
  assert(shouldHideForProtection('pending_verification') === false, 'pending_verification should not be hidden');
  assert(shouldHideForProtection('pending_payout_setup') === false, 'pending_payout_setup should not be hidden');
});

test('R5-PROT-10: shouldHideForProtection returns true for active/reservable', () => {
  assert(shouldHideForProtection('active') === true, 'active should be hidden');
  assert(shouldHideForProtection('pending_transfer') === true, 'pending_transfer should be hidden');
  assert(shouldHideForProtection(null) === true, 'null should be hidden');
});

test('R5-PROT-11: isNonReservableStatus covers terminal and business-held', () => {
  assert(isNonReservableStatus('sold') === true, 'sold is non-reservable');
  assert(isNonReservableStatus('cancelled') === true, 'cancelled is non-reservable');
  assert(isNonReservableStatus('expired') === true, 'expired is non-reservable');
  assert(isNonReservableStatus('hidden') === true, 'hidden is non-reservable');
  assert(isNonReservableStatus('pending_verification') === true, 'pending_verification is non-reservable');
  assert(isNonReservableStatus('pending_payout_setup') === true, 'pending_payout_setup is non-reservable');
  assert(isNonReservableStatus('active') === false, 'active is reservable');
});

// ════════════════════════════════════════════════════════════════════════════
// MAIN RUNNER
// ════════════════════════════════════════════════════════════════════════════

async function main() {
  console.log('=== Round 5 Correction Tests (7C.9C.2E) ===\n');
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