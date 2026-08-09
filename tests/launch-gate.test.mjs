/**
 * Launch Gate Assertion (7C.9C.2E Task 5)
 *
 * The gate EXECUTES BEHAVIOR — it does not search for strings.
 *
 * 1. Imports the actual authority module and asserts its exported interface.
 * 2. Verifies the concurrency test is wired into test:launch-gate (package.json).
 * 3. Verifies the reservation-mutation manifest is complete.
 * 4. Verifies production entry-point integration status (RED — not migrated).
 *
 * The gate remains RED until all entry points are migrated.
 * No empty-file or filename-existence check can turn this gate green.
 */
import { createReservationAuthority, getReservationMutationManifest, getUnintegratedEntryPoints } from '../base44/shared/reservationAuthority.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const tests = [];
let allPassed = true;

function test(name, fn) {
  tests.push({ name, fn });
}

// ── TEST 1: Authority module exports a working interface (behavior) ────────
test('authority_module_exports_working_interface', () => {
  const mockLP = { filter: async () => [], updateMany: async () => ({ updated: 0 }) };
  const mockListing = { filter: async () => [], update: async () => ({}) };

  const authority = createReservationAuthority({
    entities: { ListingPrivate: mockLP, Listing: mockListing },
  });

  if (typeof authority.transitionReservation !== 'function') throw new Error('transitionReservation is not a function');
  if (typeof authority.projectMirror !== 'function') throw new Error('projectMirror is not a function');
  if (typeof authority.sweepMirror !== 'function') throw new Error('sweepMirror is not a function');
  if (typeof authority.getPendingEffects !== 'function') throw new Error('getPendingEffects is not a function');
  if (typeof authority.clearPendingEffects !== 'function') throw new Error('clearPendingEffects is not a function');
});

// ── TEST 2: Authority validates inputs (behavior) ──────────────────────────
test('authority_validates_inputs', async () => {
  const mockLP = { filter: async () => [], updateMany: async () => ({ updated: 0 }) };
  const mockListing = { filter: async () => [], update: async () => ({}) };

  const authority = createReservationAuthority({
    entities: { ListingPrivate: mockLP, Listing: mockListing },
  });

  const r1 = await authority.transitionReservation({ expected_version: 0, operation_id: 'op', operation_type: 'reserve', requested_state: 'reserved' });
  if (r1.ok) throw new Error('should reject missing listing_id');

  const r2 = await authority.transitionReservation({ listing_id: 'l1', expected_version: 0, operation_type: 'reserve', requested_state: 'reserved' });
  if (r2.ok) throw new Error('should reject missing operation_id');

  const r3 = await authority.transitionReservation({ listing_id: 'l1', expected_version: 'abc', operation_id: 'op', operation_type: 'reserve', requested_state: 'reserved' });
  if (r3.ok) throw new Error('should reject non-number expected_version');
});

// ── TEST 3: Authority never treats unknown as available (behavior) ─────────
test('authority_never_treats_unknown_as_available', async () => {
  const mockLP = { filter: async () => [] };
  const mockListing = { filter: async () => [], update: async () => ({}) };

  const authority = createReservationAuthority({
    entities: { ListingPrivate: mockLP, Listing: mockListing },
  });

  const result = await authority.transitionReservation({
    listing_id: 'nonexistent', expected_version: 0,
    operation_id: 'op', operation_type: 'reserve',
    payload: { token: 't' }, requested_state: 'reserved',
  });

  if (result.ok) throw new Error('should not treat unknown as available');
  if (result.code !== 'NOT_FOUND') throw new Error(`expected NOT_FOUND, got ${result.code}`);
});

// ── TEST 4: Concurrency test is wired into test:launch-gate (package.json) ───
test('concurrency_test_wired_into_launch_gate', () => {
  const pkgPath = join(__dirname, '..', 'package.json');
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
  const launchGateScript = pkg.scripts['test:launch-gate'] || '';
  if (!launchGateScript.includes('reservation-authority-concurrency.test.mjs')) {
    throw new Error('test:launch-gate does not include reservation-authority-concurrency.test.mjs');
  }
  if (!pkg.scripts['test:authority']) {
    throw new Error('test:authority script missing from package.json');
  }
});

// ── TEST 5: Reservation-mutation manifest is complete ────────────────────────
test('reservation_mutation_manifest_complete', () => {
  const manifest = getReservationMutationManifest();
  const requiredNames = [
    'reserveListing', 'releaseReservation', 'createCheckout', 'abortCheckout',
    'cancelPurchase', 'processTransferReminders', 'capturePayment',
    'cleanupAbandonedCheckouts', 'stripeWebhook', 'submitListing/manage_existing', 'deleteAccount',
  ];
  if (manifest.length < requiredNames.length) {
    throw new Error(`manifest has ${manifest.length} entries, expected >= ${requiredNames.length}`);
  }
  for (const name of requiredNames) {
    if (!manifest.some(e => e.name === name)) {
      throw new Error(`missing entry point: ${name}`);
    }
  }
});

// ── TEST 6: Production entry-point integration (RED — not migrated) ────────
test('production_entry_points_integrated', () => {
  const unintegrated = getUnintegratedEntryPoints();
  if (unintegrated.length > 0) {
    throw new Error(`Production entry points NOT yet integrated: ${unintegrated.map(e => e.name).join(', ')}. ` +
      `This is expected for sub-batch 7C.9C.2E. Gate remains RED.`);
  }
});

// ── MAIN RUNNER ─────────────────────────────────────────────────────────────
async function main() {
  console.log('=== Launch Gate Assertion (7C.9C.2E) ===\n');

  for (const t of tests) {
    try {
      await t.fn();
      console.log(`[PASS] ${t.name}`);
    } catch (e) {
      console.log(`[FAIL] ${t.name}`);
      console.log(`  ${e.message}`);
      allPassed = false;
    }
  }

  console.log(`\n=== Overall: ${allPassed ? 'PASS' : 'FAIL'} ===`);
  console.log(`Tests run: ${tests.length}, Passed: ${tests.length - (allPassed ? 0 : 1)}, Failed: ${allPassed ? 0 : 1}`);

  if (!allPassed) {
    console.log('\n┌─────────────────────────────────────────────────────────┐');
    console.log('│  LAUNCH GATE IS RED.                                     │');
    console.log('│  Production entry points are not yet integrated with    │');
    console.log('│  the reservation authority. Do not deploy to production. │');
    console.log('└─────────────────────────────────────────────────────────┘');
    process.exit(1);
  }
}

main().catch(err => { console.error('Test runner error:', err); process.exit(1); });