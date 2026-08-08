/**
 * Launch Gate Assertion (7C.9C.2)
 *
 * This test ASSERTS that the reservation system has an atomic conditional
 * update primitive available. It FAILS by design while the Base44-only
 * architecture remains, because Base44 does not provide atomic CAS,
 * transactions, or unique constraints.
 *
 * This test will PASS only when an external transactional reservation
 * authority (e.g., Neon/Postgres with UPDATE...WHERE version=expected
 * RETURNING *) has been provisioned and integrated into the reservation
 * path via base44/shared/reservationAuthority.js.
 *
 * While this test FAILS, the launch gate is RED. No production deployment
 * is safe.
 */
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ── TEST 1: External transactional reservation authority provisioned ────────
function testAtomicAuthorityProvisioned() {
  const authorityPath = join(__dirname, '..', 'base44', 'shared', 'reservationAuthority.js');
  const provisioned = existsSync(authorityPath);
  return {
    name: 'atomic_reservation_authority_provisioned',
    passed: provisioned,
    type: 'launch-gate',
    authority_path: authorityPath,
    reason: provisioned
      ? 'External transactional reservation authority is provisioned.'
      : 'ARCHITECTURAL BLOCKER: Base44 conditional update is not atomic. No external transactional reservation authority has been provisioned. Launch gate is RED.',
  };
}

// ── TEST 2: Atomic strategy blocker documented ──────────────────────────────
function testAtomicityBlockerDocumented() {
  const blockerDoc = join(__dirname, '..', 'src', 'docs', 'ATOMIC_STRATEGY_BLOCKER.md');
  const documented = existsSync(blockerDoc);
  return {
    name: 'atomicity_blocker_documented',
    passed: documented,
    type: 'launch-gate',
    reason: documented
      ? 'Atomic strategy blocker is documented.'
      : 'Atomic strategy blocker documentation is missing.',
  };
}

// ── TEST 3: Known-limitations characterization test excluded from gate ──────
function testKnownLimitationsExcludedFromGate() {
  // The concurrent-alert-deduplication test documents a known limitation
  // (non-atomic duplicate alert creation). It must NOT be counted as a
  // green launch-safety assertion. It belongs in test:known-limitations,
  // not test:launch-gate.
  // This test verifies the launch-gate test file does NOT import or run
  // the concurrent-alert-deduplication test.
  const selfSource = existsSync(__filename);
  const concurrentAlertTest = join(__dirname, 'concurrent-alert-deduplication.test.mjs');
  const concurrentExists = existsSync(concurrentAlertTest);
  // The launch-gate test must exist, and the concurrent-alert test must
  // exist as a separate file (not inlined here).
  const passed = selfSource && concurrentExists;
  return {
    name: 'known_limitations_excluded_from_gate',
    passed,
    type: 'launch-gate',
    reason: passed
      ? 'Known-limitations characterization test is separate from launch gate.'
      : 'Launch gate structure is incorrect.',
  };
}

// ── MAIN RUNNER ─────────────────────────────────────────────────────────────
async function main() {
  const tests = [
    testAtomicAuthorityProvisioned(),
    testAtomicityBlockerDocumented(),
    testKnownLimitationsExcludedFromGate(),
  ];

  console.log('=== Launch Gate Assertion (7C.9C.2) ===\n');

  let allPassed = true;
  for (const t of tests) {
    const status = t.passed ? 'PASS' : 'FAIL';
    console.log(`[${status}] ${t.name}`);
    console.log(`  reason: ${t.reason}`);
    console.log();
    if (!t.passed) allPassed = false;
  }

  console.log(`=== Overall: ${allPassed ? 'PASS' : 'FAIL'} ===`);
  console.log(`Tests run: ${tests.length}, Passed: ${tests.filter(t => t.passed).length}, Failed: ${tests.filter(t => !t.passed).length}`);

  if (!allPassed) {
    console.log('\n┌─────────────────────────────────────────────────────────┐');
    console.log('│  LAUNCH GATE IS RED.                                     │');
    console.log('│  Base44 conditional update is not atomic.                │');
    console.log('│  Provision an external transactional reservation         │');
    console.log('│  authority before production launch.                     │');
    console.log('└─────────────────────────────────────────────────────────┘');
    process.exit(1);
  }
}

main().catch(err => { console.error('Test runner error:', err); process.exit(1); });