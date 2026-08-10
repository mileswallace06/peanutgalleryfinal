/**
 * Reservation Authority Adversarial Tests (7C.9C.2E Correction Round 4)
 *
 * Round 4 corrections:
 *   - Normal projection writes reservation_mirror_state, NOT status/hidden_reason.
 *   - Business-held statuses (hidden, pending_verification, pending_payout_setup)
 *     are NEVER reopened by normal projection.
 *   - Convergence failure: scoped failure (versioned CAS fails, hide succeeds) → PROTECTED.
 *   - Separate test: all Listing writes fail → PROTECTION_INCOMPLETE.
 *   - projectMirror post-CAS race: re-fetch BOTH, detect authority advance.
 *   - Corrupt authority state triggers protection (hide + alert + verify).
 *
 * Round 3 (preserved):
 *   - Authority-driven: caller cannot supply status/hidden_reason.
 *   - Equal-version repair: re-fetch BOTH after update.
 *   - Mirror newer than authority: hide/quarantine + alert + verify.
 *   - All tests assert FINAL ENTITY STATE, not only returned error codes.
 */
import { createReservationAuthority } from '../base44/shared/reservationAuthority.js';
import { generateMigrationReport, planApply } from '../base44/shared/reservationAuthorityMigration.js';
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
  deps._seedLP('lp1', { listing_id: 'list1', reservation_version: 1, reservation_lifecycle_state: 'available' });
  deps._seedListing('list1', { reservation_version: 2, status: 'hidden', hidden_reason: 'checkout_quarantine' });
  const res = await authority.projectMirror('list1', 0, 1);
  assert(!res.ok, 'should be rejected');
  assert(res.code === 'STALE_MIRROR', `expected STALE_MIRROR, got ${res.code}`);
  assert(res.current_mirror_version === 2, 'current should be 2');
  const [listing] = await deps.entities.Listing.filter({ id: 'list1' });
  assert(listing.reservation_version === 2, 'mirror version should be unchanged at 2');
  assert(listing.status === 'hidden', 'mirror status should be unchanged');
});

// ── 2: Equal-version conflicting mirror payload → MIRROR_CONFLICT ────────────
test('equal version with different payload returns MIRROR_CONFLICT', async () => {
  const deps = createMockDeps();
  const authority = createReservationAuthority(deps);
  deps._seedLP('lp1', { listing_id: 'list1', reservation_version: 1, reservation_lifecycle_state: 'available' });
  deps._seedListing('list1', { reservation_version: 1, status: 'hidden', hidden_reason: 'checkout_quarantine', reservation_mirror_state: 'reserved' });
  const res = await authority.projectMirror('list1', 0, 1);
  assert(!res.ok, 'should be rejected');
  assert(res.code === 'MIRROR_CONFLICT', `expected MIRROR_CONFLICT, got ${res.code}`);
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
  if (!res.ok) {
    assert(res.code === 'STALE_PROJECTION' || res.code === 'SWEEP_CONVERGENCE_FAILED',
      `expected STALE_PROJECTION or SWEEP_CONVERGENCE_FAILED, got ${res.code}`);
  }
  const [listing] = await deps.entities.Listing.filter({ id: 'list1' });
  const [lp] = await deps.entities.ListingPrivate.filter({ listing_id: 'list1' });
  const authorityVersion = lp.reservation_version;
  const mirrorVersion = listing.reservation_version;
  const mirrorMatches = mirrorVersion === authorityVersion;
  const mirrorHidden = listing.status === 'hidden';
  assert(mirrorMatches || mirrorHidden,
    `mirror should match authority (${authorityVersion}) or be hidden, got version=${mirrorVersion} status=${listing.status}`);
});

// ── 5: projectMirror is authority-driven — no forbidden fields projected ─────
test('projectMirror is authority-driven and never projects forbidden fields', async () => {
  const deps = createMockDeps();
  const authority = createReservationAuthority(deps);
  deps._seedLP('lp1', {
    listing_id: 'list1', reservation_version: 1,
    reservation_lifecycle_state: 'reserved',
    reservation_token: 'private_token', reserved_by_email: 'private@test',
    reservation_expires_at: '2026-12-31T00:00:00Z',
    reservation_revision: 'rev_1',
  });
  deps._seedListing('list1', { reservation_version: 0, status: 'active' });
  const res = await authority.projectMirror('list1', 0, 1);
  assert(res.ok, 'should succeed');
  assert(res.verified === true, 'should be verified');
  const [listing] = await deps.entities.Listing.filter({ id: 'list1' });
  assert(listing.reservation_version === 1, 'mirror version should be 1');
  assert(listing.reservation_mirror_state === 'reserved', 'reservation_mirror_state should be reserved');
  assert(listing.status === 'active', 'status should be unchanged (normal projection does not touch status)');
  // Forbidden fields must NOT be projected
  assert(listing.reservation_token === null || listing.reservation_token === undefined,
    'reservation_token must not be projected from authority');
  assert(listing.reserved_by_email === null || listing.reserved_by_email === undefined,
    'reserved_by_email must not be projected from authority');
});

// ── 6: projectMirror derives from authority — frozen → hidden ───────────────
test('projectMirror derives hidden from frozen authority state', async () => {
  const deps = createMockDeps();
  const authority = createReservationAuthority(deps);
  deps._seedLP('lp1', {
    listing_id: 'list1', reservation_version: 1,
    reservation_lifecycle_state: 'frozen',
    reservation_token: 'tok1', reserved_by_email: 'b1@test',
    reservation_expires_at: '2026-12-31T00:00:00Z',
    reservation_revision: 'rev_1',
  });
  deps._seedListing('list1', { reservation_version: 0, status: 'active' });
  const res = await authority.projectMirror('list1', 0, 1);
  assert(res.ok, 'should succeed');
  assert(res.verified === true, 'should be verified');
  const [listing] = await deps.entities.Listing.filter({ id: 'list1' });
  assert(listing.reservation_version === 1, 'mirror version should be 1');
  assert(listing.reservation_mirror_state === 'frozen', 'reservation_mirror_state should be frozen');
  assert(listing.status === 'active', 'status should be unchanged (normal projection does not set hidden)');
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
  const [listing] = await deps.entities.Listing.filter({ id: 'list1' });
  assert(listing.reservation_version === 3, 'mirror version should be 3');
  assert(listing.reservation_mirror_state === 'reserved', 'reservation_mirror_state should be reserved');
  assert(listing.status === 'active', 'status should be unchanged');
  assert(listing.reservation_token === 'stale', 'sweeper should not overwrite reservation_token');
});

// ── 8: Mirror newer than authority → hide/quarantine + alert ─────────────────
test('mirror newer than authority triggers protection (hide + alert)', async () => {
  const deps = createMockDeps();
  const authority = createReservationAuthority(deps);
  deps._seedLP('lp1', { listing_id: 'list1', reservation_version: 2, reservation_lifecycle_state: 'available' });
  deps._seedListing('list1', { reservation_version: 5, status: 'active' });
  const res = await authority.sweepMirror('list1');
  assert(!res.ok, 'should detect corruption');
  assert(res.code === 'MIRROR_NEWER_THAN_AUTHORITY', `expected MIRROR_NEWER_THAN_AUTHORITY, got ${res.code}`);
  assert(res.protection, 'should have protection result');
  assert(res.protection.protected === true, 'protection should be verified');
  // Assert final entity state — Listing must be hidden
  const [listing] = await deps.entities.Listing.filter({ id: 'list1' });
  assert(listing.status === 'hidden', `Listing should be hidden, got ${listing.status}`);
  assert(listing.hidden_reason === 'checkout_quarantine', 'hidden_reason should be checkout_quarantine');
  // Assert AdminAlert was created
  const alerts = Array.from(deps._adminAlertStore.values());
  const unresolved = alerts.filter(a => a.resolved === false);
  assert(unresolved.length === 1, `expected 1 unresolved alert, got ${unresolved.length}`);
  assert(unresolved[0].priority === 'critical', 'priority should be critical');
  assert(unresolved[0].incident_key === `mirror_corruption:list1`, 'incident key should match');
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
  const [listing] = await deps.entities.Listing.filter({ id: 'list1' });
  assert(listing.reservation_version === 3, 'version should be unchanged');
  assert(listing.status === 'active', 'status should be unchanged');
});

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
  if (res.ok) {
    assert(!res.already_synced, 'should NOT report already_synced when fields diverge');
    assert(res.repaired === true, 'should repair fields');
  }
  const [listing] = await deps.entities.Listing.filter({ id: 'list1' });
  assert(listing.reservation_mirror_state === 'sold', `reservation_mirror_state should be sold, got ${listing.reservation_mirror_state}`);
  assert(listing.status === 'active', 'status should be unchanged (terminal business status uses explicit finalization)');
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
  const [listing] = await deps.entities.Listing.filter({ id: 'list1' });
  assert(listing.reservation_version === undefined, 'mirror version should be unchanged (undefined)');
});

// ── 13: projectMirror with missing Listing version → MIRROR_MIGRATION_REQUIRED
test('projectMirror with missing Listing version returns MIRROR_MIGRATION_REQUIRED', async () => {
  const deps = createMockDeps();
  const authority = createReservationAuthority(deps);
  deps._seedLP('lp1', { listing_id: 'list1', reservation_version: 1, reservation_lifecycle_state: 'available' });
  deps._seedListing('list1', { status: 'active' });
  delete deps._listingStore.get('list1').reservation_version;
  const res = await authority.projectMirror('list1', 0, 1);
  assert(!res.ok, 'should fail');
  assert(res.code === 'MIRROR_MIGRATION_REQUIRED', `expected MIRROR_MIGRATION_REQUIRED, got ${res.code}`);
  const [listing] = await deps.entities.Listing.filter({ id: 'list1' });
  assert(listing.reservation_version === undefined, 'mirror version should be unchanged');
  assert(listing.status === 'active', 'status should be unchanged');
});

// ── 14: projectMirror authority-driven — caller cannot override status ──────
test('projectMirror caller cannot project active when authority says sold', async () => {
  const deps = createMockDeps();
  const authority = createReservationAuthority(deps);
  deps._seedLP('lp1', {
    listing_id: 'list1', reservation_version: 1,
    reservation_lifecycle_state: 'sold',
    reservation_token: null, reserved_by_email: null, reservation_expires_at: null,
    reservation_revision: 'rev_1',
  });
  deps._seedListing('list1', { reservation_version: 0, status: 'active' });
  // Caller passes NO payload — authority derives from LP state
  const res = await authority.projectMirror('list1', 0, 1);
  assert(res.ok, 'should succeed');
  const [listing] = await deps.entities.Listing.filter({ id: 'list1' });
  // Authority says sold → mirror must be sold, NOT active
  assert(listing.reservation_mirror_state === 'sold', `reservation_mirror_state should be sold (authority-driven), got ${listing.reservation_mirror_state}`);
  assert(listing.status === 'active', 'status should be unchanged (terminal business status uses explicit finalization)');
});

// ── 15: Post-sweep verifies version status and hidden_reason ──────────────────
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
  const [listing] = await deps.entities.Listing.filter({ id: 'list1' });
  assert(listing.reservation_version === 2, 'version should be 2');
  assert(listing.reservation_mirror_state === 'frozen', 'reservation_mirror_state should be frozen');
  assert(listing.status === 'active', 'status should be unchanged (normal projection does not set hidden)');
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
  deps._seedLP('lp1', { listing_id: 'list1', reservation_version: 1, reservation_lifecycle_state: 'available' });
  deps._seedListing('list1', { reservation_version: 0, status: 'active' });
  const r1 = await authority.projectMirror('list1', -1, 1);
  assert(!r1.ok, 'negative expected version should be rejected');
  assert(r1.code === 'VALIDATION_ERROR', `expected VALIDATION_ERROR, got ${r1.code}`);
  const r2 = await authority.projectMirror('list1', 0, 1.5);
  assert(!r2.ok, 'fractional new version should be rejected');
  assert(r2.code === 'VALIDATION_ERROR', `expected VALIDATION_ERROR, got ${r2.code}`);
  const r3 = await authority.projectMirror('list1', 0, 0);
  assert(!r3.ok, 'new_version <= expected should be rejected');
  assert(r3.code === 'VALIDATION_ERROR', `expected VALIDATION_ERROR, got ${r3.code}`);
});

// ════════════════════════════════════════════════════════════════════════════
// ROUND 3 NEW ADVERSARIAL TESTS
// ════════════════════════════════════════════════════════════════════════════

// ── R3-A: Equal-version repair detects authority advance during repair ──────
test('equal-version repair detects authority advance during repair', async () => {
  const deps = createMockDeps();
  const authority = createReservationAuthority(deps);
  deps._seedLP('lp1', {
    listing_id: 'list1', reservation_version: 2,
    reservation_lifecycle_state: 'sold',
    reservation_token: null, reserved_by_email: null, reservation_expires_at: null,
    reservation_revision: 'rev_1',
  });
  deps._seedListing('list1', { reservation_version: 2, status: 'active', hidden_reason: null });
  // Hook: after equal-version CAS, advance the authority
  deps._setHook('afterSweepCAS', (d, listing_id) => {
    const lp = d._lpStore.get('lp1');
    if (lp) {
      lp.reservation_version = 3;
      lp.reservation_lifecycle_state = 'available';
      lp.reservation_token = null;
      lp.reserved_by_email = null;
      lp.reservation_expires_at = null;
    }
  });
  const res = await authority.sweepMirror('list1');
  // Should detect the advance and retry or fail — NOT report success with stale state
  if (res.ok) {
    // If it succeeded, it must have converged to the NEWEST authority state
    const [lp] = await deps.entities.ListingPrivate.filter({ listing_id: 'list1' });
    const [listing] = await deps.entities.Listing.filter({ id: 'list1' });
    assert(listing.reservation_version === lp.reservation_version,
      `mirror must match authority after repair: mirror=${listing.reservation_version} auth=${lp.reservation_version}`);
  } else {
    // If it failed, it must be STALE_PROJECTION or CONVERGENCE_FAILED
    assert(res.code === 'STALE_PROJECTION' || res.code === 'SWEEP_CONVERGENCE_FAILED',
      `expected STALE_PROJECTION or SWEEP_CONVERGENCE_FAILED, got ${res.code}`);
  }
});

// ── R3-B: Convergence failure with scoped failure → PROTECTED ──────────────
// Round 4 fix: Use scoped failure that blocks only versioned CAS calls,
// allowing the protection hide (unversioned) to succeed.
test('convergence failure with scoped failure triggers protection PROTECTED', async () => {
  const deps = createMockDeps();
  const authority = createReservationAuthority(deps);
  deps._seedLP('lp1', {
    listing_id: 'list1', reservation_version: 2,
    reservation_lifecycle_state: 'reserved',
    reservation_token: 'tok1', reserved_by_email: 'b1@test',
    reservation_expires_at: '2026-12-31T00:00:00Z',
    reservation_revision: 'rev_1',
  });
  deps._seedListing('list1', { reservation_version: 0, status: 'active' });
  // Scoped failure: blocks only versioned CAS (sweep projection), allows unversioned hide
  deps._listingFailConfig.updateManyReturnZeroForVersioned = true;
  const res = await authority.sweepMirror('list1');
  assert(!res.ok, 'should fail');
  assert(res.code === 'SWEEP_CONVERGENCE_FAILED', `expected SWEEP_CONVERGENCE_FAILED, got ${res.code}`);
  assert(res.protection, 'should have protection result');
  assert(res.protection.protected === true, 'protection should be PROTECTED (hide succeeded)');
  // Verify Listing is hidden (protection hide succeeded because it's unversioned)
  deps._listingFailConfig.updateManyReturnZeroForVersioned = false;
  const [listing] = await deps.entities.Listing.filter({ id: 'list1' });
  assert(listing.status === 'hidden', `Listing should be hidden, got ${listing.status}`);
  assert(listing.hidden_reason === 'checkout_quarantine', 'hidden_reason should be checkout_quarantine');
  // Verify exact alert exists
  const alerts = Array.from(deps._adminAlertStore.values());
  const unresolved = alerts.filter(a => a.resolved === false);
  assert(unresolved.length === 1, `expected 1 unresolved alert, got ${unresolved.length}`);
  assert(unresolved[0].priority === 'critical', 'priority should be critical');
  assert(unresolved[0].incident_key === 'mirror_corruption:list1', 'incident key should match');
});

// ── R3-C: Protection with AdminAlert creation failure → PROTECTION_INCOMPLETE
test('protection with AdminAlert creation failure returns PROTECTION_INCOMPLETE', async () => {
  const deps = createMockDeps();
  const authority = createReservationAuthority(deps);
  deps._seedLP('lp1', { listing_id: 'list1', reservation_version: 2, reservation_lifecycle_state: 'available' });
  deps._seedListing('list1', { reservation_version: 5, status: 'active' });
  // Make AdminAlert.create throw
  deps._adminAlertFailConfig.createThrow = true;
  const res = await authority.sweepMirror('list1');
  assert(!res.ok, 'should fail');
  assert(res.code === 'MIRROR_NEWER_THAN_AUTHORITY', `expected MIRROR_NEWER_THAN_AUTHORITY, got ${res.code}`);
  assert(res.protection, 'should have protection result');
  assert(res.protection.protected === false, 'protection should NOT be verified (alert failed)');
  assert(res.protection.code === 'PROTECTION_INCOMPLETE', `expected PROTECTION_INCOMPLETE, got ${res.protection.code}`);
  // Listing should still be hidden (hide step succeeded)
  deps._adminAlertFailConfig.createThrow = false;
  const [listing] = await deps.entities.Listing.filter({ id: 'list1' });
  assert(listing.status === 'hidden', 'Listing should still be hidden despite alert failure');
});

// ── R3-D: Protection with updateMany returning updated:0 → PROTECTION_INCOMPLETE
test('protection with updateMany returning updated:0 returns PROTECTION_INCOMPLETE', async () => {
  const deps = createMockDeps();
  const authority = createReservationAuthority(deps);
  deps._seedLP('lp1', { listing_id: 'list1', reservation_version: 2, reservation_lifecycle_state: 'available' });
  deps._seedListing('list1', { reservation_version: 5, status: 'active' });
  // Make Listing.updateMany return updated:0 (hide fails)
  deps._listingFailConfig.updateManyReturnZero = true;
  const res = await authority.sweepMirror('list1');
  assert(!res.ok, 'should fail');
  assert(res.code === 'MIRROR_NEWER_THAN_AUTHORITY', `expected MIRROR_NEWER_THAN_AUTHORITY, got ${res.code}`);
  assert(res.protection, 'should have protection result');
  assert(res.protection.protected === false, 'protection should NOT be verified (hide failed)');
  assert(res.protection.code === 'PROTECTION_INCOMPLETE', `expected PROTECTION_INCOMPLETE, got ${res.protection.code}`);
  deps._listingFailConfig.updateManyReturnZero = false;
});

// ── R3-E: Hidden Listing cannot be reopened by migration ────────────────────
test('hidden Listing is never proposed as available by migration', async () => {
  const deps = createMockDeps();
  deps._seedListing('list1', { status: 'hidden', hidden_reason: 'admin_disabled' });
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
  assert(rec.derived_lifecycle_state !== 'available',
    `hidden Listing should never derive available, got ${rec.derived_lifecycle_state}`);
  assert(rec.derived_lifecycle_state === 'AMBIGUOUS',
    `hidden Listing should be AMBIGUOUS (manual review), got ${rec.derived_lifecycle_state}`);
});

// ── R3-F: pending_verification Listing cannot be reopened by migration ───────
test('pending_verification Listing is never proposed as available by migration', async () => {
  const deps = createMockDeps();
  deps._seedListing('list1', { status: 'pending_verification' });
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
  assert(rec.derived_lifecycle_state !== 'available',
    `pending_verification should never derive available, got ${rec.derived_lifecycle_state}`);
});

// ── R3-G: pending_payout_setup Listing cannot be reopened by migration ───────
test('pending_payout_setup Listing is never proposed as available by migration', async () => {
  const deps = createMockDeps();
  deps._seedListing('list1', { status: 'pending_payout_setup' });
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
  assert(rec.derived_lifecycle_state !== 'available',
    `pending_payout_setup should never derive available, got ${rec.derived_lifecycle_state}`);
});

// ── R3-H: Missing version with derivable state is MIGRATION_REQUIRED ─────────
test('missing version with derivable state is MIGRATION_REQUIRED not AMBIGUOUS', async () => {
  const deps = createMockDeps();
  deps._seedListing('list1', { status: 'active' });
  delete deps._listingStore.get('list1').reservation_version;
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
  assert(rec.status === 'MIGRATION_REQUIRED', `expected MIGRATION_REQUIRED, got ${rec.status}`);
  assert(rec.derived_lifecycle_state === 'available', 'active + null tuple should derive available');
  assert(rec.proposed_reservation_version === 0, 'proposed version should be 0');
});

// ── R3-I: sold Listing requires valid terminal tuple ─────────────────────────
test('sold Listing with non-null token is AMBIGUOUS', async () => {
  const deps = createMockDeps();
  deps._seedListing('list1', { status: 'sold' });
  deps._seedLP('lp1', {
    listing_id: 'list1',
    reservation_token: 'should_be_null', reserved_by_email: 'should_be_null',
    reservation_expires_at: null, reservation_revision: null,
  });
  delete deps._lpStore.get('lp1').reservation_version;
  const report = await generateMigrationReport(deps);
  assert(report.ok, 'report should succeed');
  const rec = report.records.find(r => r.listing_id === 'list1');
  assert(rec, 'should have a record');
  // sold with non-null token → AMBIGUOUS (terminal state has non-null token)
  assert(rec.status === 'AMBIGUOUS', `expected AMBIGUOUS, got ${rec.status}`);
  assert(rec.issues.some(i => i.includes('non-null token')), 'should have non-null token issue');
});

// ── R3-J: projectMirror with corrupt LP state returns STATE_CORRUPT + protection
test('projectMirror with corrupt LP lifecycle state returns STATE_CORRUPT and triggers protection', async () => {
  const deps = createMockDeps();
  const authority = createReservationAuthority(deps);
  deps._seedLP('lp1', {
    listing_id: 'list1', reservation_version: 1,
    reservation_lifecycle_state: 'invalid_state',
  });
  deps._seedListing('list1', { reservation_version: 0, status: 'active' });
  const res = await authority.projectMirror('list1', 0, 1);
  assert(!res.ok, 'should fail');
  assert(res.code === 'STATE_CORRUPT', `expected STATE_CORRUPT, got ${res.code}`);
  assert(res.protection, 'should have protection result');
  // Round 4: corrupt authority must not leave an active Listing publicly available
  const [listing] = await deps.entities.Listing.filter({ id: 'list1' });
  assert(listing.status === 'hidden', `Listing should be hidden by protection, got ${listing.status}`);
  assert(listing.hidden_reason === 'checkout_quarantine', 'hidden_reason should be checkout_quarantine');
  // Verify alert exists
  const alerts = Array.from(deps._adminAlertStore.values());
  const unresolved = alerts.filter(a => a.resolved === false);
  assert(unresolved.length >= 1, 'should have at least 1 unresolved alert');
  assert(unresolved[0].priority === 'critical', 'priority should be critical');
});

// ── R3-K: sweep with corrupt LP state triggers protection ────────────────────
test('sweep with corrupt LP lifecycle state triggers protection', async () => {
  const deps = createMockDeps();
  const authority = createReservationAuthority(deps);
  deps._seedLP('lp1', {
    listing_id: 'list1', reservation_version: 2,
    reservation_lifecycle_state: null,
  });
  deps._seedListing('list1', { reservation_version: 2, status: 'active' });
  const res = await authority.sweepMirror('list1');
  assert(!res.ok, 'should fail');
  assert(res.code === 'STATE_CORRUPT', `expected STATE_CORRUPT, got ${res.code}`);
  assert(res.protection, 'should have protection result');
  // Listing should be hidden
  const [listing] = await deps.entities.Listing.filter({ id: 'list1' });
  assert(listing.status === 'hidden', 'Listing should be hidden');
});

// ── R3-L: projectMirror authority version mismatch ───────────────────────────
test('projectMirror rejects when authority version does not match new_version', async () => {
  const deps = createMockDeps();
  const authority = createReservationAuthority(deps);
  deps._seedLP('lp1', { listing_id: 'list1', reservation_version: 5, reservation_lifecycle_state: 'available' });
  deps._seedListing('list1', { reservation_version: 0, status: 'active' });
  // Caller says new_version=1, but authority is at 5
  const res = await authority.projectMirror('list1', 0, 1);
  assert(!res.ok, 'should fail');
  assert(res.code === 'AUTHORITY_VERSION_MISMATCH', `expected AUTHORITY_VERSION_MISMATCH, got ${res.code}`);
  assert(res.authority_version === 5, 'authority version should be 5');
  // Verify zero writes
  const [listing] = await deps.entities.Listing.filter({ id: 'list1' });
  assert(listing.reservation_version === 0, 'mirror version should be unchanged');
});

// ════════════════════════════════════════════════════════════════════════════
// ROUND 4 NEW ADVERSARIAL TESTS
// ════════════════════════════════════════════════════════════════════════════

// ── R4-A: Convergence failure with ALL writes failing → PROTECTION_INCOMPLETE
test('convergence failure with all Listing writes failing returns PROTECTION_INCOMPLETE', async () => {
  const deps = createMockDeps();
  const authority = createReservationAuthority(deps);
  deps._seedLP('lp1', {
    listing_id: 'list1', reservation_version: 2,
    reservation_lifecycle_state: 'reserved',
    reservation_token: 'tok1', reserved_by_email: 'b1@test',
    reservation_expires_at: '2026-12-31T00:00:00Z',
    reservation_revision: 'rev_1',
  });
  deps._seedListing('list1', { reservation_version: 0, status: 'active' });
  // ALL Listing writes fail — including protection hide
  deps._listingFailConfig.updateManyReturnZero = true;
  const res = await authority.sweepMirror('list1');
  assert(!res.ok, 'should fail');
  assert(res.code === 'SWEEP_CONVERGENCE_FAILED', `expected SWEEP_CONVERGENCE_FAILED, got ${res.code}`);
  assert(res.protection, 'should have protection result');
  assert(res.protection.protected === false, 'protection should NOT be verified (all writes failed)');
  assert(res.protection.code === 'PROTECTION_INCOMPLETE', `expected PROTECTION_INCOMPLETE, got ${res.protection.code}`);
  // Listing should NOT be hidden (hide failed)
  deps._listingFailConfig.updateManyReturnZero = false;
  const [listing] = await deps.entities.Listing.filter({ id: 'list1' });
  assert(listing.status === 'active', `Listing should NOT be hidden (hide failed), got ${listing.status}`);
});

// ── R4-B: sweepMirror cannot reopen hidden/admin_disabled Listing ───────────
test('sweepMirror cannot reopen hidden/admin_disabled Listing', async () => {
  const deps = createMockDeps();
  const authority = createReservationAuthority(deps);
  deps._seedLP('lp1', { listing_id: 'list1', reservation_version: 2, reservation_lifecycle_state: 'available' });
  deps._seedListing('list1', { reservation_version: 2, status: 'hidden', hidden_reason: 'admin_disabled', reservation_mirror_state: 'available' });
  const res = await authority.sweepMirror('list1');
  assert(res.ok, 'should succeed (already synced)');
  assert(res.already_synced === true, 'should be already_synced');
  const [listing] = await deps.entities.Listing.filter({ id: 'list1' });
  assert(listing.status === 'hidden', 'status must stay hidden — normal projection does not reopen business-held status');
  assert(listing.hidden_reason === 'admin_disabled', 'hidden_reason must stay admin_disabled');
  assert(listing.reservation_mirror_state === 'available', 'reservation_mirror_state should be available');
});

// ── R4-C: sweepMirror cannot reopen hidden/transfer_disabled Listing ───────
test('sweepMirror cannot reopen hidden/transfer_disabled Listing', async () => {
  const deps = createMockDeps();
  const authority = createReservationAuthority(deps);
  deps._seedLP('lp1', { listing_id: 'list1', reservation_version: 2, reservation_lifecycle_state: 'available' });
  deps._seedListing('list1', { reservation_version: 2, status: 'hidden', hidden_reason: 'transfer_disabled', reservation_mirror_state: 'available' });
  const res = await authority.sweepMirror('list1');
  assert(res.ok, 'should succeed (already synced)');
  const [listing] = await deps.entities.Listing.filter({ id: 'list1' });
  assert(listing.status === 'hidden', 'status must stay hidden');
  assert(listing.hidden_reason === 'transfer_disabled', 'hidden_reason must stay transfer_disabled');
});

// ── R4-D: sweepMirror cannot reopen pending_verification Listing ────────────
test('sweepMirror cannot reopen pending_verification Listing', async () => {
  const deps = createMockDeps();
  const authority = createReservationAuthority(deps);
  deps._seedLP('lp1', { listing_id: 'list1', reservation_version: 2, reservation_lifecycle_state: 'available' });
  deps._seedListing('list1', { reservation_version: 2, status: 'pending_verification', reservation_mirror_state: 'available' });
  const res = await authority.sweepMirror('list1');
  assert(res.ok, 'should succeed (already synced)');
  const [listing] = await deps.entities.Listing.filter({ id: 'list1' });
  assert(listing.status === 'pending_verification', 'status must stay pending_verification');
});

// ── R4-E: sweepMirror cannot reopen pending_payout_setup Listing ───────────
test('sweepMirror cannot reopen pending_payout_setup Listing', async () => {
  const deps = createMockDeps();
  const authority = createReservationAuthority(deps);
  deps._seedLP('lp1', { listing_id: 'list1', reservation_version: 2, reservation_lifecycle_state: 'available' });
  deps._seedListing('list1', { reservation_version: 2, status: 'pending_payout_setup', reservation_mirror_state: 'available' });
  const res = await authority.sweepMirror('list1');
  assert(res.ok, 'should succeed (already synced)');
  const [listing] = await deps.entities.Listing.filter({ id: 'list1' });
  assert(listing.status === 'pending_payout_setup', 'status must stay pending_payout_setup');
});

// ── R4-F: projectMirror post-CAS race — authority advances during projection ─
test('projectMirror post-CAS race detects authority advance (v1/sold → v2/cancelled)', async () => {
  const deps = createMockDeps();
  const authority = createReservationAuthority(deps);
  deps._seedLP('lp1', {
    listing_id: 'list1', reservation_version: 1,
    reservation_lifecycle_state: 'sold',
    reservation_token: null, reserved_by_email: null, reservation_expires_at: null,
    reservation_revision: 'rev_1',
  });
  deps._seedListing('list1', { reservation_version: 0, status: 'active' });
  // Hook: advance authority from v1/sold to v2/cancelled during projection
  deps._setHook('beforeMirrorCAS', (d, listing_id) => {
    const lp = d._lpStore.get('lp1');
    if (lp) {
      lp.reservation_version = 2;
      lp.reservation_lifecycle_state = 'cancelled';
      lp.reservation_revision = 'rev_2';
    }
  });
  const res = await authority.projectMirror('list1', 0, 1);
  assert(!res.ok, 'must NOT return success with stale projection');
  assert(res.code === 'STALE_PROJECTION', `expected STALE_PROJECTION, got ${res.code}`);
  assert(res.current_authority_version === 2, 'current authority version should be 2');
  // Mirror was updated to v1 but authority is at v2 — projection is stale
  const [listing] = await deps.entities.Listing.filter({ id: 'list1' });
  assert(listing.reservation_version === 1, 'mirror was updated to v1 (but projection is stale)');
  const [lp] = await deps.entities.ListingPrivate.filter({ listing_id: 'list1' });
  assert(lp.reservation_version === 2, 'authority should be at v2');
});

// ── R4-G: projectMirror cannot reopen hidden/admin_disabled Listing ────────
test('projectMirror cannot reopen hidden/admin_disabled Listing', async () => {
  const deps = createMockDeps();
  const authority = createReservationAuthority(deps);
  deps._seedLP('lp1', { listing_id: 'list1', reservation_version: 1, reservation_lifecycle_state: 'available' });
  deps._seedListing('list1', { reservation_version: 0, status: 'hidden', hidden_reason: 'admin_disabled' });
  const res = await authority.projectMirror('list1', 0, 1);
  assert(res.ok, 'should succeed');
  const [listing] = await deps.entities.Listing.filter({ id: 'list1' });
  assert(listing.reservation_mirror_state === 'available', 'reservation_mirror_state should be available');
  assert(listing.status === 'hidden', 'status must stay hidden — normal projection does not reopen business-held status');
  assert(listing.hidden_reason === 'admin_disabled', 'hidden_reason must stay admin_disabled');
});

// ════════════════════════════════════════════════════════════════════════════
// ROUND 4 MIGRATION VERSION CLASSIFICATION TESTS (Defect 7)
// ════════════════════════════════════════════════════════════════════════════

// ── R4-MIG-1: LP missing version + Listing missing version → MIGRATION_REQUIRED
test('R4-MIG-1: LP missing version + Listing missing version → MIGRATION_REQUIRED', async () => {
  const deps = createMockDeps();
  deps._seedListing('list1', { status: 'active' });
  delete deps._listingStore.get('list1').reservation_version;
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
  assert(rec.status === 'MIGRATION_REQUIRED', `expected MIGRATION_REQUIRED, got ${rec.status}`);
  assert(rec.proposed_reservation_version === 0, 'proposed version should be 0');
});

// ── R4-MIG-2: LP initialized + Listing version missing → MIRROR_MIGRATION_REQUIRED
test('R4-MIG-2: LP initialized + Listing version missing → MIRROR_MIGRATION_REQUIRED', async () => {
  const deps = createMockDeps();
  deps._seedListing('list1', { status: 'active' });
  delete deps._listingStore.get('list1').reservation_version;
  deps._seedLP('lp1', {
    listing_id: 'list1', reservation_version: 3,
    reservation_lifecycle_state: 'available',
    reservation_token: null, reserved_by_email: null, reservation_expires_at: null,
    reservation_revision: null,
  });
  const report = await generateMigrationReport(deps);
  assert(report.ok, 'report should succeed');
  const rec = report.records.find(r => r.listing_id === 'list1');
  assert(rec, 'should have a record');
  assert(rec.status === 'MIRROR_MIGRATION_REQUIRED', `expected MIRROR_MIGRATION_REQUIRED, got ${rec.status}`);
  assert(rec.proposed_reservation_version === 3, 'proposed version should be 3 (from LP)');
});

// ── R4-MIG-3: LP missing version + Listing version 5 → AMBIGUOUS (do not reset)
test('R4-MIG-3: LP missing version + Listing version 5 → AMBIGUOUS (do not reset)', async () => {
  const deps = createMockDeps();
  deps._seedListing('list1', { status: 'active', reservation_version: 5 });
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
  assert(rec.status === 'AMBIGUOUS', `expected AMBIGUOUS, got ${rec.status}`);
  assert(rec.issues.some(i => i.includes('will not reset newer public version')), 'should have reset warning issue');
});

// ── R4-MIG-4: Both initialized but versions differ → VERSION_DIVERGENCE
test('R4-MIG-4: Both initialized but versions differ → VERSION_DIVERGENCE', async () => {
  const deps = createMockDeps();
  deps._seedListing('list1', { status: 'active', reservation_version: 3 });
  deps._seedLP('lp1', {
    listing_id: 'list1', reservation_version: 5,
    reservation_lifecycle_state: 'available',
    reservation_token: null, reserved_by_email: null, reservation_expires_at: null,
    reservation_revision: null,
  });
  const report = await generateMigrationReport(deps);
  assert(report.ok, 'report should succeed');
  const rec = report.records.find(r => r.listing_id === 'list1');
  assert(rec, 'should have a record');
  assert(rec.status === 'VERSION_DIVERGENCE', `expected VERSION_DIVERGENCE, got ${rec.status}`);
  assert(rec.issues.some(i => i.includes('LP version 5 ≠ Listing version 3')), 'should have divergence issue');
});

// ── R4-MIG-5: Both initialized, versions match → ALREADY_INITIALIZED
test('R4-MIG-5: Both initialized, versions match → ALREADY_INITIALIZED', async () => {
  const deps = createMockDeps();
  deps._seedListing('list1', { status: 'active', reservation_version: 3 });
  deps._seedLP('lp1', {
    listing_id: 'list1', reservation_version: 3,
    reservation_lifecycle_state: 'available',
    reservation_token: null, reserved_by_email: null, reservation_expires_at: null,
    reservation_revision: null,
  });
  const report = await generateMigrationReport(deps);
  assert(report.ok, 'report should succeed');
  const rec = report.records.find(r => r.listing_id === 'list1');
  assert(rec, 'should have a record');
  assert(rec.status === 'ALREADY_INITIALIZED', `expected ALREADY_INITIALIZED, got ${rec.status}`);
});

// ════════════════════════════════════════════════════════════════════════════
// ROUND 5 NEW ADVERSARIAL TESTS
// ════════════════════════════════════════════════════════════════════════════

// ── R5-ADV-1: Quarantined + valid tuple → frozen (not AMBIGUOUS) ───────────
test('R5-ADV-1: quarantined with valid complete tuple derives frozen', async () => {
  const deps = createMockDeps();
  deps._seedListing('list1', { status: 'hidden', hidden_reason: 'checkout_quarantine' });
  deps._seedLP('lp1', {
    listing_id: 'list1',
    checkout_quarantined: true,
    reservation_token: 'tok1', reserved_by_email: 'b1@test',
    reservation_expires_at: '2026-12-31T00:00:00Z',
    reservation_revision: 'rev_1',
  });
  delete deps._lpStore.get('lp1').reservation_version;
  const report = await generateMigrationReport(deps);
  assert(report.ok, 'report should succeed');
  const rec = report.records.find(r => r.listing_id === 'list1');
  assert(rec, 'should have a record');
  assert(rec.derived_lifecycle_state === 'frozen', `quarantined + valid tuple should derive frozen, got ${rec.derived_lifecycle_state}`);
});

// ── R5-ADV-2: Quarantined + incomplete tuple → AMBIGUOUS ───────────────────
test('R5-ADV-2: quarantined with incomplete tuple remains AMBIGUOUS', async () => {
  const deps = createMockDeps();
  deps._seedListing('list1', { status: 'hidden', hidden_reason: 'checkout_quarantine' });
  deps._seedLP('lp1', {
    listing_id: 'list1',
    checkout_quarantined: true,
    reservation_token: 'tok1', reserved_by_email: null,
    reservation_expires_at: null, reservation_revision: null,
  });
  delete deps._lpStore.get('lp1').reservation_version;
  const report = await generateMigrationReport(deps);
  assert(report.ok, 'report should succeed');
  const rec = report.records.find(r => r.listing_id === 'list1');
  assert(rec, 'should have a record');
  assert(rec.derived_lifecycle_state === 'AMBIGUOUS', `quarantined + incomplete tuple should be AMBIGUOUS, got ${rec.derived_lifecycle_state}`);
});

// ── R5-ADV-3: planApply does not write status or hidden_reason ──────────────
test('R5-ADV-3: planApply does not write status or hidden_reason to mirror', () => {
  const deps = createMockDeps();
  const plan = planApply(deps, 'apply_req_1');
  const stepsText = plan.steps.join(' ');
  assert(!stepsText.includes('status=derived'), 'steps should not mention status=derived');
  assert(!stepsText.includes('hidden_reason=derived'), 'steps should not mention hidden_reason=derived');
  const fieldsText = plan.initialized_fields.join(' ');
  assert(!fieldsText.includes('public Listing status'), 'initialized_fields should not include public Listing status');
  assert(!fieldsText.includes('public Listing hidden_reason'), 'initialized_fields should not include public Listing hidden_reason');
  assert(fieldsText.includes('reservation_mirror_state'), 'initialized_fields should include reservation_mirror_state');
});

// ── R5-ADV-4: mirror-only plan uses plan_action not invalid operation_type ─
test('R5-ADV-4: mirror-only plan uses plan_action not invalid operation_type', async () => {
  const deps = createMockDeps();
  deps._seedListing('list1', { status: 'active' });
  delete deps._listingStore.get('list1').reservation_version;
  deps._seedLP('lp1', {
    listing_id: 'list1', reservation_version: 3,
    reservation_lifecycle_state: 'available',
    reservation_token: null, reserved_by_email: null, reservation_expires_at: null,
    reservation_revision: null,
  });
  const report = await generateMigrationReport(deps);
  assert(report.ok, 'report should succeed');
  const rec = report.records.find(r => r.listing_id === 'list1');
  assert(rec, 'should have a record');
  assert(rec.status === 'MIRROR_MIGRATION_REQUIRED', `expected MIRROR_MIGRATION_REQUIRED, got ${rec.status}`);
  assert(rec.proposed_init, 'should have proposed_init');
  assert(rec.proposed_init.plan_action === 'mirror_initialize', 'should use plan_action=mirror_initialize');
  assert(!rec.proposed_init.operation_type, 'should NOT have operation_type');
  assert(rec.proposed_init.fields_to_set.reservation_version === 3, 'should set reservation_version');
  assert(rec.proposed_init.fields_to_set.reservation_mirror_state === 'available', 'should set reservation_mirror_state');
  assert(!rec.proposed_init.fields_to_set.status, 'should NOT set status');
  assert(!rec.proposed_init.fields_to_set.hidden_reason, 'should NOT set hidden_reason');
});

// ── R5-ADV-5: Protection preserves sold status ────────────────────────────
test('R5-ADV-5: protection preserves sold status (does not overwrite with hidden)', async () => {
  const deps = createMockDeps();
  const authority = createReservationAuthority(deps);
  deps._seedLP('lp1', { listing_id: 'list1', reservation_version: 2, reservation_lifecycle_state: 'available' });
  deps._seedListing('list1', { reservation_version: 5, status: 'sold' });
  const res = await authority.sweepMirror('list1');
  assert(!res.ok, 'should detect corruption');
  assert(res.code === 'MIRROR_NEWER_THAN_AUTHORITY', `expected MIRROR_NEWER_THAN_AUTHORITY, got ${res.code}`);
  assert(res.protection, 'should have protection result');
  assert(res.protection.protected === true, 'protection should be verified');
  const [listing] = await deps.entities.Listing.filter({ id: 'list1' });
  assert(listing.status === 'sold', `Listing status should be preserved as sold, got ${listing.status}`);
  const alerts = Array.from(deps._adminAlertStore.values());
  const unresolved = alerts.filter(a => a.resolved === false);
  assert(unresolved.length === 1, `expected 1 unresolved alert, got ${unresolved.length}`);
});

// ── R5-ADV-6: Protection preserves cancelled status ───────────────────────
test('R5-ADV-6: protection preserves cancelled status', async () => {
  const deps = createMockDeps();
  const authority = createReservationAuthority(deps);
  deps._seedLP('lp1', { listing_id: 'list1', reservation_version: 2, reservation_lifecycle_state: 'available' });
  deps._seedListing('list1', { reservation_version: 5, status: 'cancelled' });
  const res = await authority.sweepMirror('list1');
  assert(res.protection.protected === true, 'protection should be verified');
  const [listing] = await deps.entities.Listing.filter({ id: 'list1' });
  assert(listing.status === 'cancelled', `Listing status should be preserved as cancelled, got ${listing.status}`);
});

// ── R5-ADV-7: Protection preserves expired status ──────────────────────────
test('R5-ADV-7: protection preserves expired status', async () => {
  const deps = createMockDeps();
  const authority = createReservationAuthority(deps);
  deps._seedLP('lp1', { listing_id: 'list1', reservation_version: 2, reservation_lifecycle_state: 'available' });
  deps._seedListing('list1', { reservation_version: 5, status: 'expired' });
  const res = await authority.sweepMirror('list1');
  assert(res.protection.protected === true, 'protection should be verified');
  const [listing] = await deps.entities.Listing.filter({ id: 'list1' });
  assert(listing.status === 'expired', `Listing status should be preserved as expired, got ${listing.status}`);
});

// ── R5-ADV-8: Protection hides active status ───────────────────────────────
test('R5-ADV-8: protection hides active status (not terminal)', async () => {
  const deps = createMockDeps();
  const authority = createReservationAuthority(deps);
  deps._seedLP('lp1', { listing_id: 'list1', reservation_version: 2, reservation_lifecycle_state: 'available' });
  deps._seedListing('list1', { reservation_version: 5, status: 'active' });
  const res = await authority.sweepMirror('list1');
  assert(res.protection.protected === true, 'protection should be verified');
  const [listing] = await deps.entities.Listing.filter({ id: 'list1' });
  assert(listing.status === 'hidden', `Listing should be hidden, got ${listing.status}`);
  assert(listing.hidden_reason === 'checkout_quarantine', 'hidden_reason should be checkout_quarantine');
});

// ── R5-ADV-9: Protection hides pending_verification status ─────────────────
test('R5-ADV-9: protection hides pending_verification status', async () => {
  const deps = createMockDeps();
  const authority = createReservationAuthority(deps);
  deps._seedLP('lp1', { listing_id: 'list1', reservation_version: 2, reservation_lifecycle_state: 'available' });
  deps._seedListing('list1', { reservation_version: 5, status: 'pending_verification' });
  const res = await authority.sweepMirror('list1');
  assert(res.protection.protected === true, 'protection should be verified');
  const [listing] = await deps.entities.Listing.filter({ id: 'list1' });
  assert(listing.status === 'hidden', `Listing should be hidden, got ${listing.status}`);
});

// ── R5-ADV-10: Protection hides pending_payout_setup status ────────────────
test('R5-ADV-10: protection hides pending_payout_setup status', async () => {
  const deps = createMockDeps();
  const authority = createReservationAuthority(deps);
  deps._seedLP('lp1', { listing_id: 'list1', reservation_version: 2, reservation_lifecycle_state: 'available' });
  deps._seedListing('list1', { reservation_version: 5, status: 'pending_payout_setup' });
  const res = await authority.sweepMirror('list1');
  assert(res.protection.protected === true, 'protection should be verified');
  const [listing] = await deps.entities.Listing.filter({ id: 'list1' });
  assert(listing.status === 'hidden', `Listing should be hidden, got ${listing.status}`);
});

// ── R5-ADV-11: Protection hides hidden/admin_disabled (non-terminal hidden)
test('R5-ADV-11: protection hides hidden/admin_disabled status (non-terminal)', async () => {
  const deps = createMockDeps();
  const authority = createReservationAuthority(deps);
  deps._seedLP('lp1', { listing_id: 'list1', reservation_version: 2, reservation_lifecycle_state: 'available' });
  deps._seedListing('list1', { reservation_version: 5, status: 'hidden', hidden_reason: 'admin_disabled' });
  const res = await authority.sweepMirror('list1');
  assert(res.protection.protected === true, 'protection should be verified');
  const [listing] = await deps.entities.Listing.filter({ id: 'list1' });
  assert(listing.status === 'hidden', `Listing should be hidden, got ${listing.status}`);
  assert(listing.hidden_reason === 'checkout_quarantine', 'hidden_reason should be overwritten to checkout_quarantine');
});

// ════════════════════════════════════════════════════════════════════════════
// MAIN RUNNER
// ════════════════════════════════════════════════════════════════════════════

async function main() {
  console.log('=== Reservation Authority Adversarial Tests (7C.9C.2E Correction Round 4) ===\n');
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