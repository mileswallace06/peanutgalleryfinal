#!/usr/bin/env node
/**
 * authority-probe-v2-live.test.mjs — Phase 1B F.3 RETAIN-AND-CERTIFY gate.
 *
 * This test reads the live probe results from
 * tests/authority-probe-v2-live-results.json and verifies that all 15
 * required proofs passed against the real Neon development database.
 *
 * The live probe is executed by invoking the deployed migrateSensitiveData
 * function with action='authority_probe_v2'. The results are written to
 * the JSON file by the probe execution step.
 *
 * Usage:
 *   npm run test:authority-probe-v2
 *
 * Prerequisites:
 *   - Live probe has been executed and results written to the JSON file
 *   - Maintenance mode ON
 *   - AUTHORITY_DB_URL_DEV_ADMIN and AUTHORITY_DB_URL_DEV_EXECUTOR secrets set
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const RESULTS_FILE = path.join(__dirname, 'authority-probe-v2-live-results.json');

const REQUIRED_PROOFS = [
  'p1_init',
  'p2_replay',
  'p3_conflict_persistence',
  'p4_operation_id_conflict',
  'p5_stale_version',
  'p6_rollback',
  'p7_concurrent_distinct',
  'p8_concurrent_identical',
  'p9_release',
  'p10_unknown_recovery',
  'p11_concurrent_incidents',
  'p12_privileges',
  'p13_executor_secret',
  'p14_latency',
  'p15_cleanup',
];

function assert(condition, message) {
  if (!condition) {
    console.error(`  FAIL: ${message}`);
    return false;
  }
  console.log(`  PASS: ${message}`);
  return true;
}

function main() {
  console.log('╔══════════════════════════════════════════════════════════════════╗');
  console.log('║  Phase 1B F.3 — Authority Probe v2 Certification                 ║');
  console.log('╚══════════════════════════════════════════════════════════════════╝\n');

  if (!fs.existsSync(RESULTS_FILE)) {
    console.error(`  FAIL: Results file not found: ${RESULTS_FILE}`);
    console.error('  Execute the live probe first by invoking migrateSensitiveData with action=authority_probe_v2');
    process.exit(1);
  }

  const raw = fs.readFileSync(RESULTS_FILE, 'utf8');
  let data;
  try {
    data = JSON.parse(raw);
  } catch (e) {
    console.error(`  FAIL: Invalid JSON in results file: ${e.message}`);
    process.exit(1);
  }

  let allPass = true;

  // Verify verdict
  allPass = assert(data.verdict === 'PASS', `Overall verdict: ${data.verdict}`) && allPass;

  // Verify safety
  allPass = assert(data.proofs?.safety?.pass === true, 'Safety verification') && allPass;

  // Verify schema setup
  allPass = assert(data.proofs?.schema_setup?.pass === true, 'Schema setup') && allPass;

  // Verify each of the 15 proofs
  for (const proofKey of REQUIRED_PROOFS) {
    const proof = data.proofs?.[proofKey];
    allPass = assert(proof?.pass === true, `${proofKey}: pass=${proof?.pass}`) && allPass;
  }

  // Verify no secret leakage
  const rawStr = JSON.stringify(data);
  const hasSecretLeakage = rawStr.includes('postgres://') || rawStr.includes('postgresql://');
  allPass = assert(!hasSecretLeakage, 'No secret leakage in results') && allPass;

  // Verify zero synthetic rows (from P15)
  allPass = assert(data.proofs?.p15_cleanup?.count_after?.total === 0, 'Zero synthetic rows remain') && allPass;

  // Verify function count
  allPass = assert(data.proofs?.schema_setup?.schema_counts?.functions >= 10, `Function count: ${data.proofs?.schema_setup?.schema_counts?.functions}`) && allPass;

  console.log('');
  if (allPass) {
    console.log('╔══════════════════════════════════════════════════════════════════╗');
    console.log('║  VERDICT: PASS — All 15 live proofs certified.                  ║');
    console.log('╚══════════════════════════════════════════════════════════════════╝');
    process.exit(0);
  } else {
    console.log('╔══════════════════════════════════════════════════════════════════╗');
    console.log('║  VERDICT: FAIL — One or more proofs did not pass.               ║');
    console.log('╚══════════════════════════════════════════════════════════════════╝');
    process.exit(1);
  }
}

main();