/**
 * Reservation Authority Adversarial Tests (7C.9C.2E Correction — Defect 7)
 *
 * Mirror safety, forbidden-field scan, and sweep race tests.
 * Uses deferred-barrier hooks against the ACTUAL authority module.
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
  // Seed Listing already at v2
  deps._seedListing('list1', { reservation_version: 2, status: 'hidden', hidden_reason: 'checkout_quarantine' });
  // Try to project v1 with expected_current=0
  const res = await authority.projectMirror('list1', 0, 1, { status: 'active' });
  assert(!res.ok, 'should be rejected');
  assert(res.code === 'STALE_MIRROR', `expected STALE_MIRROR, got ${res.code}`);
  assert(res.current_mirror_version === 2, 'current should be 2');
});

// ── 2: Equal-version conflicting mirror payload → MIRROR_CONFLICT ────────────
test('equal version with different payload returns MIRROR_CONFLICT', async () => {
  const deps = createMockDeps();
  const authority = createReservationAuthority(deps);
  // Seed Listing at v1 with status='hidden'
  deps._seedListing('list1', { reservation_version: 1, status: 'hidden', hidden_reason: 'checkout_quarantine' });
  // Try to project v1 with expected_current=0, but Listing is already at v1 with different payload
  const res = await authority.projectMirror('list1', 0, 1, { status: 'active' });
  assert(!res.ok, 'should be rejected');
  assert(res.code === 'MIRROR_CONFLICT', `expected MIRROR_CONFLICT, got ${res.code}`);
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
  });
  deps._seedListing('list1', { reservation_version: 0, status: 'active' });
  const [res1, res2] = await Promise.all([
    authority.sweepMirror('list1'),
    authority.sweepMirror('list1'),
  ]);
  // At least one should succeed
  assert(res1.ok || res2.ok, 'at least one sweeper should succeed');
  // Both should report version 2
  if (res1.ok) assert(res1.mirror_version === 2, 'sweeper 1 should report v2');
  if (res2.ok) assert(res2.mirror_version === 2, 'sweeper 2 should report v2');
  // Verify Listing is at v2
  const [listing] = await deps.entities.Listing.filter({ id: 'list1' });
  assert(listing.reservation_version === 2, 'mirror should be at v2');
  assert(listing.status === 'active', 'mirror status should be active');
});

// ── 4: Authority advancing during sweep → STALE_PROJECTION ───────────────────
test('authority advancing during sweep returns STALE_PROJECTION', async () => {
  const deps = createMockDeps();
  const authority = createReservationAuthority(deps);
  deps._seedLP('lp1', {
    listing_id: 'list1', reservation_version: 2,
    reservation_lifecycle_state: 'reserved',
    reservation_token: 'auth_token', reserved_by_email: 'auth@test',
    reservation_expires_at: '2026-12-31T00:00:00Z',
  });
  deps._seedListing('list1', { reservation_version: 0, status: 'active' });
  // Hook: after sweep CAS wins, advance the authority to v3
  deps._setHook('afterSweepCAS', (d, listing_id) => {
    const lp = d._lpStore.get('lp1');
    if (lp) {
      lp.reservation_version = 3;
      lp.last_operation_id = 'op_advanced';
    }
  });
  const res = await authority.sweepMirror('list1');
  assert(!res.ok, 'should detect stale projection');
  assert(res.code === 'STALE_PROJECTION', `expected STALE_PROJECTION, got ${res.code}`);
  assert(res.projected_version === 2, 'projected should be v2');
  assert(res.current_authority_version === 3, 'current should be v3');
});

// ── 5: Public Listing forbidden-field scan (recursive) ───────────────────────
test('mirror never projects forbidden fields to Listing', async () => {
  const deps = createMockDeps();
  const authority = createReservationAuthority(deps);
  deps._seedListing('list1', { reservation_version: 0, status: 'active' });
  // Try to project forbidden fields
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
  // Verify Listing was NOT modified
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
  });
  deps._seedListing('list1', { reservation_version: 1, status: 'active', reservation_token: 'stale' });
  const res = await authority.sweepMirror('list1');
  assert(res.ok, 'sweeper should succeed');
  assert(res.repaired === true, 'should repair');
  assert(res.mirror_version === 3, 'mirror version should be 3');
  const [listing] = await deps.entities.Listing.filter({ id: 'list1' });
  assert(listing.reservation_version === 3, 'mirror version should be 3');
  assert(listing.status === 'active', 'status should be active');
  // Sweeper should NOT project reservation_token (forbidden field)
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
});

// ── 9: Idempotent sweep (already synced) ─────────────────────────────────────
test('sweeper reports already_synced when mirror matches authority', async () => {
  const deps = createMockDeps();
  const authority = createReservationAuthority(deps);
  deps._seedLP('lp1', { listing_id: 'list1', reservation_version: 3 });
  deps._seedListing('list1', { reservation_version: 3, status: 'active' });
  const res = await authority.sweepMirror('list1');
  assert(res.ok, 'should succeed');
  assert(res.already_synced === true, 'should be already_synced');
  assert(res.mirror_version === 3, 'version should be 3');
});

// ════════════════════════════════════════════════════════════════════════════
// MAIN RUNNER
// ════════════════════════════════════════════════════════════════════════════

async function main() {
  console.log('=== Reservation Authority Adversarial Tests (7C.9C.2E Correction) ===\n');
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