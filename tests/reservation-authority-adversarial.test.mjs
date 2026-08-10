/**
 * Reservation Authority Adversarial Tests (7C.9C.2E Correction Round 2)
 *
 * Round 2 corrections:
 *   - All tests assert FINAL ENTITY STATE, not only returned error codes.
 *   - Mirror: MIGRATION_REQUIRED for missing LP version.
 *   - Mirror: MIRROR_MIGRATION_REQUIRED for missing Listing version.
 *   - Equal version: authority sold, mirror active → must NOT report synced.
 *   - Authority advances during sweep → final mirror matches newest or hidden.
 *   - Post-write public field mismatch → detected and protected.
 *   - Unknown fields rejected (not silently dropped).
 */
import { createReservationAuthority } from '../base44/shared/reservationAuthority.js';
import { createMockDeps } from './authority/helpers.mjs';

const tests = [];
let passed = 0;
let failed = 0;

function test(name, fn) { tests.push({ name, fn }); }
function assert(cond, msg) { if (!cond) throw new Error(msg); }

// ── 1: Delayed v1 mirror after committed v2 ──────────────────────────────────
test('delayed v1 mirror after committed v2 is rejected', async () => {
  const deps = createMockDeps();
  const authority = createReservationAuthority(deps);
  deps._seedListing('list1', { reservation_version: 2, status: 'hidden', hidden_reason: 'checkout_quarantine' });
  const res = await authority.projectMirror('list1', 0, 1, { status: 'active' });
  assert(!res.ok, 'should be rejected');
  assert(res.code === 'STALE_MIRROR', `expected STALE_MIRROR, got ${res.code}`);
  assert(res.current_mirror_version === 2, 'current should be 2');
  // Assert final entity state
  const [listing] = await deps.entities.Listing.filter({ id: 'list1' });
  assert(listing.reservation_version === 2, 'mirror version should be unchanged at 2');
  assert(listing.status === 'hidden', 'mirror status should be unchanged');
});

// ── 2: Equal-version conflicting mirror payload → MIRROR_CONFLICT ────────────
test('equal version with different payload returns MIRROR_CONFLICT', async () => {
  const deps = createMockDeps();
  const authority = createReservationAuthority(deps);
  deps._seedListing('list1', { reservation_version: 1, status: 'hidden', hidden_reason: 'checkout_quarantine' });
  const res = await authority.projectMirror('list1', 0, 1, { status: 'active' });
  assert(!res.ok, 'should be rejected');
  assert(res.code === 'MIRROR_CONFLICT', `expected MIRROR_CONFLICT, got ${res.code}`);
  // Assert final entity state — unchanged
  const [listing] = await deps.entities.Listing.filter({ id: 'list1' });
  assert(listing.reservation_version === 1, 'version should be unchanged');
  assert(listing.status === 'hidden', 'status should be unchanged');
});

// ── 3: Two sweepers racing converge to newest authority version ──────────────
test('two sweepers racing converge to newest authority version', async () => {
  const deps = createMockDeps();
  const authority = createReservationAuthority(deps);
  deps._seedLP('lp1', {
    listing_id: 'list1', reservation_version: 2,
    reservation_lifecycle_state: 'reserved',
    reservation_token: 'auth_token', reserved_by_email: 'auth@test',
    reservation_expires_at: '2026-12-31T00:00:00Z',
    reservation_revision: 'rev_1',
  });
  deps._seedListing('list1', { reservation_version: 0, status: 'active' });
  const [res1, res2] = await Promise.all([
    authority.sweepMirror('list1'),
    authority.sweepMirror('list1'),
  ]);
  assert(res1.ok || res2.ok, 'at least one sweeper should succeed');
  if (res1.ok) assert(res1.mirror_version === 2, 'sweeper 1 should report v2');
  if (res2.ok) assert(res2.mirror_version === 2, 'sweeper 2 should report v2');
  // Assert final entity state
  const [listing] = await deps.entities.Listing.filter({ id: 'list1' });
  assert(listing.reservation_version === 2, 'mirror should be at v2');
  assert(listing.status === 'active', 'mirror status should be active');
});

// ── 4: Authority advancing during sweep → STALE_PROJECTION or convergence ───
test('authority advancing during sweep returns STALE_PROJECTION or converges', async () => {
  const deps = createMockDeps();
  const authority = createReservationAuthority(deps);
  deps._seedLP('lp1', {
    listing_id: 'list1', reservation_version: 2,
    reservation_lifecycle_state: 'reserved',
    reservation_token: 'auth_token', reserved_by_email: 'auth@test',
    reservation_expires_at: '2026-12-31T00:00:00Z',
    reservation_revision: 'rev_1',
  });
  deps._seedListing('list1', { reservation_version: 0, status: 'active' });
  deps._setHook('afterSweepCAS', (d, listing_id) => {
    const lp = d._lpStore.get('lp1');
    if (lp) {
      lp.reservation_version = 3;
      lp.last_operation_id = 'op_advanced';
    }
  });
  const res = await authority.sweepMirror('list1');
  // Should either detect stale projection or converge to v3
  if (!res.ok) {
    assert(res.code === 'STALE_PROJECTION' || res.code === 'SWEEP_CONVERGENCE_FAILED',
      `expected STALE_PROJECTION or SWEEP_CONVERGENCE_FAILED, got ${res.code}`);
  }
  // Assert final entity state — mirror should match newest authority or be hidden
  const [listing] = await deps.entities.Listing.filter({ id: 'list1' });
  const [lp] = await deps.entities.ListingPrivate.filter({ listing_id: 'list1' });
  const authorityVersion = lp.reservation_version;
  const mirrorVersion = listing.reservation_version;
  const mirrorMatches = mirrorVersion === authorityVersion;
  const mirrorHidden = listing.status === 'hidden';
  assert(mirrorMatches || mirrorHidden,
    `mirror should match authority (${authorityVersion}) or be hidden, got version=${mirrorVersion} status=${listing.status}`);
});

// ── 5: Public Listing forbidden-field scan (recursive) ───────────────────────
test('mirror never projects forbidden fields to Listing', async () => {
  const deps = createMockDeps();
  const authority = createReservationAuthority(deps);
  deps._seedListing('list1', { reservation_version: 0, status: 'active' });
  const res = await authority.projectMirror('list1', 0, 1, {
    status: 'hidden',
    hidden_reason: 'checkout_quarantine',
    reservation_token: 'should_not_be_projected',
    reserved_by_email: 'should_not_be_projected',
    pending_effects_json: '[]',
    last_operation_id: 'should_not_be_projected',
  });
  assert(!res.ok, 'should reject forbidden fields');
  assert(res.code === 'MIRROR_FORBIDDEN_FIELD', `expected MIRROR_FORBIDDEN_FIELD, got ${res.code}`);
  assert(res.fields.length >= 4, `should find >= 4 forbidden fields, got ${res.fields.length}`);
  // Assert final entity state — unchanged
  const [listing] = await deps.entities.Listing.filter({ id: 'list1' });
  assert(listing.reservation_version === 0, 'mirror version should be unchanged');
  assert(listing.reservation_token === null, 'reservation_token should not be set');
});

// ── 6: Mirror projects only approved fields ──────────────────────────────────
test('mirror projects only approved public fields and reservation_version', async () => {
  const deps = createMockDeps();
  const authority = createReservationAuthority(deps);
  deps._seedListing('list1', { reservation_version: 0, status: 'active' });
  const res = await authority.projectMirror('list1', 0, 1, {
    status: 'hidden',
    hidden_reason: 'checkout_quarantine',
  });
  assert(res.ok, 'should succeed with approved fields');
  assert(res.verified === true, 'should be verified');
  // Assert final entity state
  const [listing] = await deps.entities.Listing.filter({ id: 'list1' });
  assert(listing.reservation_version === 1, 'mirror version should be 1');
  assert(listing.status === 'hidden', 'status should be hidden');
  assert(listing.hidden_reason === 'checkout_quarantine', 'hidden_reason should be set');
  assert(listing.reservation_token === null, 'reservation_token should not be set');
});

// ── 7: Sweeper repairs stale mirror ──────────────────────────────────────────
test('sweeper safely repairs stale mirror', async () => {
  const deps = createMockDeps();
  const authority = createReservationAuthority(deps);
  deps._seedLP('lp1', {
    listing_id: 'list1', reservation_version: 3,
    reservation_lifecycle_state: 'reserved',
    reservation_token: 'auth_token', reserved_by_email: 'auth@test',
    reservation_expires_at: '2026-12-31T00:00:00Z',
    reservation_revision: 'rev_1',
  });
  deps._seedListing('list1', { reservation_version: 1, status: 'active', reservation_token: 'stale' });
  const res = await authority.sweepMirror('list1');
  assert(res.ok, 'sweeper should succeed');
  assert(res.repaired === true, 'should repair');
  assert(res.mirror_version === 3, 'mirror version should be 3');
  // Assert final entity state
  const [listing] = await deps.entities.Listing.filter({ id: 'list1' });
  assert(listing.reservation_version === 3, 'mirror version should be 3');
  assert(listing.status === 'active', 'status should be active');
  assert(listing.reservation_token === 'stale', 'sweeper should not overwrite reservation_token');
});

// ── 8: Mirror newer than authority → corruption ──────────────────────────────
test('mirror newer than authority is detected as corruption', async () => {
  const deps = createMockDeps();
  const authority = createReservationAuthority(deps);
  deps._seedLP('lp1', { listing_id: 'list1', reservation_version: 2 });
  deps._seedListing('list1', { reservation_version: 5, status: 'active' });
  const res = await authority.sweepMirror('list1');
  assert(!res.ok, 'should detect corruption');
  assert(res.code === 'MIRROR_NEWER_THAN_AUTHORITY', `expected MIRROR_NEWER_THAN_AUTHORITY, got ${res.code}`);
  // Assert final entity state — unchanged
  const [listing] = await deps.entities.Listing.filter({ id: 'list1' });
  assert(listing.reservation_version === 5, 'mirror version should be unchanged');
});

// ── 9: Idempotent sweep (already synced) ─────────────────────────────────────
test('sweeper reports already_synced when mirror matches authority', async () => {
  const deps = createMockDeps();
  const authority = createReservationAuthority(deps);
  deps._seedLP('lp1', { listing_id: 'list1', reservation_version: 3, reservation_lifecycle_state: 'available' });
  deps._seedListing('list1', { reservation_version: 3, status: 'active', hidden_reason: null });
  const res = await authority.sweepMirror('list1');
  assert(res.ok, 'should succeed');
  assert(res.already_synced === true, 'should be already_synced');
  assert(res.mirror_version === 3, 'version should be 3');
  // Assert final entity state — unchanged
  const [listing] = await deps.entities.Listing.filter({ id: 'list1' });
  assert(listing.reservation_version === 3, 'version should be unchanged');
  assert(listing.status === 'active', 'status should be unchanged');
});

// ════════════════════════════════════════════════════════════════════════════
// ROUND 2 NEW MIRROR TESTS
// ════════════════════════════════════════════════════════════════════════════

// ── 10: Equal version, authority sold, mirror active → must NOT report synced
test('equal version with authority sold and mirror active must not report synced', async () => {
  const deps = createMockDeps();
  const authority = createReservationAuthority(deps);
  deps._seedLP('lp1', {
    listing_id: 'list1', reservation_version: 2,
    reservation_lifecycle_state: 'sold',
    reservation_token: null, reserved_by_email: null, reservation_expires_at: null,
    reservation_revision: 'rev_1',
  });
  deps._seedListing('list1', { reservation_version: 2, status: 'active', hidden_reason: null });
  const res = await authority.sweepMirror('list1');
  // Should detect divergence and repair, not report already_synced
  if (res.ok) {
    assert(!res.already_synced, 'should NOT report already_synced when fields diverge');
    assert(res.repaired === true, 'should repair fields');
  }
  // Assert final entity state — mirror should be updated to sold
  const [listing] = await deps.entities.Listing.filter({ id: 'list1' });
  assert(listing.status === 'sold', `status should be sold, got ${listing.status}`);
  assert(listing.hidden_reason === null, 'hidden_reason should be null');
});

// ── 11: Missing LP version → MIGRATION_REQUIRED ──────────────────────────────
test('sweep with missing LP version returns MIGRATION_REQUIRED', async () => {
  const deps = createMockDeps();
  const authority = createReservationAuthority(deps);
  deps._seedLP('lp1', { listing_id: 'list1' });
  delete deps._lpStore.get('lp1').reservation_version;
  deps._seedListing('list1', { reservation_version: 0, status: 'active' });
  const res = await authority.sweepMirror('list1');
  assert(!res.ok, 'should fail');
  assert(res.code === 'MIGRATION_REQUIRED', `expected MIGRATION_REQUIRED, got ${res.code}`);
  // Assert final entity state — unchanged
  const [listing] = await deps.entities.Listing.filter({ id: 'list1' });
  assert(listing.reservation_version === 0, 'mirror version should be unchanged');
});

// ── 12: Missing Listing version → MIRROR_MIGRATION_REQUIRED ───────────────────
test('sweep with missing Listing version returns MIRROR_MIGRATION_REQUIRED', async () => {
  const deps = createMockDeps();
  const authority = createReservationAuthority(deps);
  deps._seedLP('lp1', { listing_id: 'list1', reservation_version: 2, reservation_lifecycle_state: 'available' });
  deps._seedListing('list1', { status: 'active' });
  delete deps._listingStore.get('list1').reservation_version;
  const res = await authority.sweepMirror('list1');
  assert(!res.ok, 'should fail');
  assert(res.code === 'MIRROR_MIGRATION_REQUIRED', `expected MIRROR_MIGRATION_REQUIRED, got ${res.code}`);
  // Assert final entity state — unchanged
  const [listing] = await deps.entities.Listing.filter({ id: 'list1' });
  assert(listing.reservation_version === undefined, 'mirror version should be unchanged (undefined)');
});

// ── 13: projectMirror with missing Listing version → MIRROR_MIGRATION_REQUIRED
test('projectMirror with missing Listing version returns MIRROR_MIGRATION_REQUIRED', async () => {
  const deps = createMockDeps();
  const authority = createReservationAuthority(deps);
  deps._seedListing('list1', { status: 'active' });
  delete deps._listingStore.get('list1').reservation_version;
  const res = await authority.projectMirror('list1', 0, 1, { status: 'hidden' });
  assert(!res.ok, 'should fail');
  assert(res.code === 'MIRROR_MIGRATION_REQUIRED', `expected MIRROR_MIGRATION_REQUIRED, got ${res.code}`);
  // Assert final entity state — unchanged
  const [listing] = await deps.entities.Listing.filter({ id: 'list1' });
  assert(listing.reservation_version === undefined, 'mirror version should be unchanged');
  assert(listing.status === 'active', 'status should be unchanged');
});

// ── 14: Unknown fields rejected (not silently dropped) ───────────────────────
test('projectMirror rejects unknown fields instead of silently dropping them', async () => {
  const deps = createMockDeps();
  const authority = createReservationAuthority(deps);
  deps._seedListing('list1', { reservation_version: 0, status: 'active' });
  const res = await authority.projectMirror('list1', 0, 1, {
    status: 'hidden',
    unknown_field: 'should_be_rejected',
  });
  assert(!res.ok, 'should reject unknown fields');
  assert(res.code === 'MIRROR_UNKNOWN_FIELD', `expected MIRROR_UNKNOWN_FIELD, got ${res.code}`);
  assert(res.fields.includes('unknown_field'), 'should report unknown_field');
  // Assert final entity state — unchanged
  const [listing] = await deps.entities.Listing.filter({ id: 'list1' });
  assert(listing.reservation_version === 0, 'version should be unchanged');
});

// ── 15: Post-write public field mismatch detected ────────────────────────────
test('post-sweep verifies version status and hidden_reason', async () => {
  const deps = createMockDeps();
  const authority = createReservationAuthority(deps);
  deps._seedLP('lp1', {
    listing_id: 'list1', reservation_version: 2,
    reservation_lifecycle_state: 'frozen',
    reservation_token: 'tok1', reserved_by_email: 'b1@test',
    reservation_expires_at: '2026-12-31T00:00:00Z',
    reservation_revision: 'rev_1',
  });
  deps._seedListing('list1', { reservation_version: 0, status: 'active' });
  const res = await authority.sweepMirror('list1');
  assert(res.ok, 'sweep should succeed');
  assert(res.verified === true, 'should be verified');
  // Assert final entity state — all three fields verified
  const [listing] = await deps.entities.Listing.filter({ id: 'list1' });
  assert(listing.reservation_version === 2, 'version should be 2');
  assert(listing.status === 'hidden', 'status should be hidden (frozen)');
  assert(listing.hidden_reason === 'checkout_quarantine', 'hidden_reason should be checkout_quarantine');
});

// ── 16: Invalid listing_id rejected ──────────────────────────────────────────
test('sweep with invalid listing_id is rejected', async () => {
  const deps = createMockDeps();
  const authority = createReservationAuthority(deps);
  const res = await authority.sweepMirror('   ');
  assert(!res.ok, 'should fail');
  assert(res.code === 'VALIDATION_ERROR', `expected VALIDATION_ERROR, got ${res.code}`);
});

// ── 17: Invalid version types rejected in projectMirror ──────────────────────
test('projectMirror rejects invalid version types', async () => {
  const deps = createMockDeps();
  const authority = createReservationAuthority(deps);
  deps._seedListing('list1', { reservation_version: 0, status: 'active' });
  const r1 = await authority.projectMirror('list1', -1, 1, { status: 'hidden' });
  assert(!r1.ok, 'negative expected version should be rejected');
  assert(r1.code === 'VALIDATION_ERROR', `expected VALIDATION_ERROR, got ${r1.code}`);
  const r2 = await authority.projectMirror('list1', 0, 1.5, { status: 'hidden' });
  assert(!r2.ok, 'fractional new version should be rejected');
  assert(r2.code === 'VALIDATION_ERROR', `expected VALIDATION_ERROR, got ${r2.code}`);
  const r3 = await authority.projectMirror('list1', 0, 0, { status: 'hidden' });
  assert(!r3.ok, 'new_version <= expected should be rejected');
  assert(r3.code === 'VALIDATION_ERROR', `expected VALIDATION_ERROR, got ${r3.code}`);
});

// ════════════════════════════════════════════════════════════════════════════
// MAIN RUNNER
// ════════════════════════════════════════════════════════════════════════════

async function main() {
  console.log('=== Reservation Authority Adversarial Tests (7C.9C.2E Correction Round 2) ===\n');
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