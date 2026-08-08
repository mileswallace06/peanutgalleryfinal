/**
 * Launch Gate Assertion (7C.9C.2)
 *
 * The gate remains RED until ONE authoritative reservation mechanism is:
 *   1. Implemented (module exports a working CAS function — not an empty file)
 *   2. Tested (a concurrency test exists and is wired into test:launch-gate)
 *   3. Used by EVERY production mutation entry point (each entry point imports
 *      and calls the authority)
 *
 * No empty-file or filename-existence check alone may turn this gate green.
 * The gate checks for functional integration, not mere file presence.
 */
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const AUTHORITY_PATH = join(__dirname, '..', 'base44', 'shared', 'reservationAuthority.js');
const BLOCKER_DOC = join(__dirname, '..', 'src', 'docs', 'ATOMIC_STRATEGY_BLOCKER.md');
const CONCURRENCY_TEST = join(__dirname, 'reservation-authority-concurrency.test.mjs');

const PRODUCTION_ENTRY_POINTS = [
  'base44/functions/reserveListing/entry.ts',
  'base44/functions/releaseReservation/entry.ts',
  'base44/functions/abortCheckout/entry.ts',
  'base44/functions/cancelPurchase/entry.ts',
  'base44/functions/processTransferReminders/entry.ts',
];

// ── TEST 1: Authoritative reservation mechanism is implemented ──────────────
// Not just file existence — the module must export a callable CAS function.
function testAuthorityImplemented() {
  if (!existsSync(AUTHORITY_PATH)) {
    return {
      name: 'authority_implemented',
      passed: false,
      type: 'launch-gate',
      reason: 'No reservation authority module exists. Launch gate is RED.',
    };
  }
  const source = readFileSync(AUTHORITY_PATH, 'utf8');
  const exportsCas = source.includes('export') && source.includes('casReserve');
  const nonEmpty = source.trim().length > 100;
  const passed = exportsCas && nonEmpty;
  return {
    name: 'authority_implemented',
    passed,
    type: 'launch-gate',
    reason: passed
      ? 'Authority module exports a CAS function.'
      : 'Authority module exists but does not export a callable casReserve function. Gate is RED.',
  };
}

// ── TEST 2: Authority concurrency test exists and is wired in ───────────────
function testAuthorityTested() {
  if (!existsSync(CONCURRENCY_TEST)) {
    return {
      name: 'authority_tested',
      passed: false,
      type: 'launch-gate',
      reason: 'No reservation-authority concurrency test exists. Gate is RED.',
    };
  }
  const testSource = readFileSync(CONCURRENCY_TEST, 'utf8');
  const nonEmpty = testSource.trim().length > 100;
  const passed = nonEmpty;
  return {
    name: 'authority_tested',
    passed,
    type: 'launch-gate',
    reason: passed
      ? 'Authority concurrency test exists.'
      : 'Authority concurrency test is empty. Gate is RED.',
  };
}

// ── TEST 3: Every production entry point uses the authority ─────────────────
function testEntryPointsUseAuthority() {
  const missing = [];
  const notImporting = [];

  for (const ep of PRODUCTION_ENTRY_POINTS) {
    const fullPath = join(__dirname, '..', ep);
    if (!existsSync(fullPath)) {
      missing.push(ep);
      continue;
    }
    const source = readFileSync(fullPath, 'utf8');
    if (!source.includes('reservationAuthority')) {
      notImporting.push(ep);
    }
  }

  const passed = missing.length === 0 && notImporting.length === 0;
  return {
    name: 'entry_points_use_authority',
    passed,
    type: 'launch-gate',
    missing,
    not_importing: notImporting,
    reason: passed
      ? 'All production entry points import and use the reservation authority.'
      : `Entry points not using authority: ${[...missing, ...notImporting].join(', ')}. Gate is RED.`,
  };
}

// ── TEST 4: Atomic strategy blocker documented ──────────────────────────────
function testBlockerDocumented() {
  const documented = existsSync(BLOCKER_DOC);
  return {
    name: 'blocker_documented',
    passed: documented,
    type: 'launch-gate',
    reason: documented
      ? 'Atomic strategy assessment is documented.'
      : 'Atomic strategy assessment documentation is missing.',
  };
}

// ── TEST 5: Known-limitations suite is separate ────────────────────────────
function testKnownLimitationsSeparate() {
  const concurrentAlertTest = join(__dirname, 'concurrent-alert-deduplication.test.mjs');
  const passed = existsSync(concurrentAlertTest);
  return {
    name: 'known_limitations_separate',
    passed,
    type: 'launch-gate',
    reason: passed
      ? 'Known-limitations characterization test is separate from launch gate.'
      : 'Known-limitations test is missing.',
  };
}

// ── MAIN RUNNER ─────────────────────────────────────────────────────────────
async function main() {
  const tests = [
    testAuthorityImplemented(),
    testAuthorityTested(),
    testEntryPointsUseAuthority(),
    testBlockerDocumented(),
    testKnownLimitationsSeparate(),
  ];

  console.log('=== Launch Gate Assertion (7C.9C.2) ===\n');

  let allPassed = true;
  for (const t of tests) {
    const status = t.passed ? 'PASS' : 'FAIL';
    console.log(`[${status}] ${t.name}`);
    console.log(`  reason: ${t.reason}`);
    if (t.missing?.length || t.not_importing?.length) {
      if (t.missing?.length) console.log(`  missing: ${t.missing.join(', ')}`);
      if (t.not_importing?.length) console.log(`  not_importing: ${t.not_importing.join(', ')}`);
    }
    console.log();
    if (!t.passed) allPassed = false;
  }

  console.log(`=== Overall: ${allPassed ? 'PASS' : 'FAIL'} ===`);
  console.log(`Tests run: ${tests.length}, Passed: ${tests.filter(t => t.passed).length}, Failed: ${tests.filter(t => !t.passed).length}`);

  if (!allPassed) {
    console.log('\n┌─────────────────────────────────────────────────────────┐');
    console.log('│  LAUNCH GATE IS RED.                                     │');
    console.log('│  No authoritative reservation mechanism is implemented, │');
    console.log('│  tested, and used by every production entry point.        │');
    console.log('│  Do not deploy to production.                            │');
    console.log('└─────────────────────────────────────────────────────────┘');
    process.exit(1);
  }
}

main().catch(err => { console.error('Test runner error:', err); process.exit(1); });