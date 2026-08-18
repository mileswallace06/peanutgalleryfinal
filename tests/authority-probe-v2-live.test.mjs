#!/usr/bin/env node
/**
 * authority-probe-v2-live.test.mjs — Phase 1B F.3.1 RETAIN-AND-CERTIFY gate.
 *
 * Substantive test with independent invariant assertions. Does NOT merely
 * check `pass === true` — each proof's evidence fields are independently
 * verified against expected invariants.
 *
 * Also verifies SQL artifact hashes: the SHA-256 of each committed SQL file
 * must match the hash recorded in the canonical results. If the SQL files
 * drift from what the probe was certified against, this test fails.
 *
 * Usage:
 *   npm run test:authority-probe-v2
 */
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const RESULTS_FILE = path.join(__dirname, 'authority-probe-v2-live-results.json');
const SQL_DIR = path.join(__dirname, '..', 'database', 'authority_probe_v2');

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  PASS: ${message}`);
    passed++;
  } else {
    console.error(`  FAIL: ${message}`);
    failed++;
  }
}

function sha256(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  return crypto.createHash('sha256').update(content).digest('hex');
}

function main() {
  console.log('╔══════════════════════════════════════════════════════════════════╗');
  console.log('║  Phase 1B F.3.1 — Authority Probe v2 Certification               ║');
  console.log('╚══════════════════════════════════════════════════════════════════╝\n');

  if (!fs.existsSync(RESULTS_FILE)) {
    console.error(`  FAIL: Results file not found: ${RESULTS_FILE}`);
    console.error('  Execute the live probe first (migrateSensitiveData action=authority_probe_v2)');
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

  // ── 1. Run identity ────────────────────────────────────────────────────
  assert(typeof data.run_id === 'string' && data.run_id.startsWith('run_'),
    `run_id present: ${data.run_id}`);
  assert(typeof data.started_at === 'string' && !isNaN(Date.parse(data.started_at)),
    `started_at valid ISO: ${data.started_at}`);
  assert(typeof data.completed_at === 'string' && !isNaN(Date.parse(data.completed_at)),
    `completed_at valid ISO: ${data.completed_at}`);
  assert(Date.parse(data.completed_at) >= Date.parse(data.started_at),
    'completed_at >= started_at');

  // ── 2. Overall verdict ─────────────────────────────────────────────────
  assert(data.verdict === 'PASS', `Overall verdict: ${data.verdict}`);

  // ── 3. SQL artifact hash consistency ───────────────────────────────────
  // The probe records SHA-256 hashes of the SQL files at certification time.
  // This test independently computes the hashes and asserts they match.
  // If the SQL files drift, this test catches it.
  const expectedHashes = data.sql_artifact_hashes;
  assert(typeof expectedHashes === 'object', 'sql_artifact_hashes present');
  for (const [file, expected] of Object.entries(expectedHashes)) {
    const filePath = path.join(SQL_DIR, file);
    assert(fs.existsSync(filePath), `SQL file exists: ${file}`);
    const actual = sha256(filePath);
    assert(actual === expected, `SQL hash match ${file}: ${actual.slice(0, 12)}...`);
  }

  // ── 4. No secret leakage ───────────────────────────────────────────────
  const rawStr = JSON.stringify(data);
  assert(!rawStr.includes('postgres://'), 'No postgres:// in results');
  assert(!rawStr.includes('postgresql://'), 'No postgresql:// in results');
  assert(!rawStr.includes('@neon.tech'), 'No Neon hostnames in results');
  assert(data.secret_leakage === false, 'secret_leakage flag is false');

  // ── 5. Zero synthetic rows ─────────────────────────────────────────────
  assert(data.synthetic_rows_remaining === 0, 'synthetic_rows_remaining === 0');
  assert(data.proofs.p15_cleanup.count_after.total === 0, 'P15 count_after.total === 0');

  // ── 6. Schema integrity ────────────────────────────────────────────────
  assert(data.proofs.schema_setup.schema_counts.tables === '3', '3 tables');
  assert(data.proofs.schema_setup.schema_counts.functions === '10', '10 functions');

  // ── 7. Safety checks ───────────────────────────────────────────────────
  const safety = data.proofs.safety.checks;
  assert(safety.executor_role === 'authority_probe_executor', 'executor role correct');
  assert(safety.executor_role_valid === true, 'executor role valid');
  assert(safety.database_fingerprint_match === true, 'Neon fingerprint match');
  assert(safety.admin_connects === true, 'admin connects');
  assert(safety.executor_connects === true, 'executor connects');
  assert(safety.no_secret_leakage === true, 'no secret leakage flag');

  // ── 8. P1: Initialize ──────────────────────────────────────────────────
  assert(data.proofs.p1_init.pass === true, 'P1 pass');
  assert(data.proofs.p1_init.result.ok === true, 'P1 result.ok');
  assert(data.proofs.p1_init.result.version === 0, 'P1 result.version === 0');

  // ── 9. P2: Replay ───────────────────────────────────────────────────────
  assert(data.proofs.p2_replay.pass === true, 'P2 pass');
  assert(data.proofs.p2_replay.result.ok === true, 'P2 result.ok');
  assert(data.proofs.p2_replay.result.version === 0, 'P2 result.version === 0');

  // ── 10. P3: Conflict persistence with eligibility restoration ──────────
  const p3 = data.proofs.p3_conflict_persistence;
  assert(p3.pass === true, 'P3 pass');
  assert(p3.step2_reserve.ok === true, 'P3 initial reservation succeeded');
  assert(p3.step2_reserve.version === 1, 'P3 reservation version 1');
  assert(p3.step3_conflict.ok === false, 'P3 conflict result ok=false');
  assert(p3.step3_conflict.code === 'CONFLICT', 'P3 stored conflict code');
  assert(p3.step4_release.ok === true, 'P3 release succeeded');
  assert(p3.state_after_release.lifecycle_state === 'available', 'P3 eligibility restored (available)');
  assert(p3.state_after_release.buyer_user_id === null, 'P3 buyer cleared after release');
  assert(p3.step5_replay.code === 'CONFLICT', 'P3 replay returns same conflict');
  assert(p3.exact_match === true, 'P3 semantic equality: stored conflict === replayed result');

  // ── 11. P4: Operation ID conflict ──────────────────────────────────────
  const p4 = data.proofs.p4_operation_id_conflict;
  assert(p4.pass === true, 'P4 pass');
  assert(p4.step1.ok === true, 'P4 step1 ok');
  assert(p4.step1.version === 0, 'P4 step1 version 0');
  assert(p4.step2.ok === false, 'P4 step2 ok=false');
  assert(p4.step2.code === 'OPERATION_ID_CONFLICT', 'P4 step2 code');

  // ── 12. P5: Stale version ──────────────────────────────────────────────
  const p5 = data.proofs.p5_stale_version;
  assert(p5.pass === true, 'P5 pass');
  assert(p5.result.ok === false, 'P5 result ok=false');
  assert(p5.result.code === 'CONFLICT', 'P5 result code CONFLICT');

  // ── 13. P6: Transactional rollback ────────────────────────────────────
  const p6 = data.proofs.p6_rollback;
  assert(p6.pass === true, 'P6 pass');
  assert(p6.injected_error === 'INJECTED_FAILURE', 'P6 exact injected failure');
  assert(p6.state_after_rollback.ok === true, 'P6 state ok after rollback');
  assert(p6.state_after_rollback.version === 0, 'P6 version unchanged (0)');
  assert(p6.state_after_rollback.lifecycle_state === 'available', 'P6 state available');
  assert(p6.state_after_rollback.buyer_user_id === null, 'P6 buyer null');
  assert(p6.operation_residue === 0, 'P6 no operation residue for failed op');
  assert(p6.retry_result.ok === true, 'P6 subsequent legitimate retry succeeded');
  assert(p6.retry_result.version === 1, 'P6 retry produced version 1');

  // ── 14. P7: Concurrent distinct ────────────────────────────────────────
  const p7 = data.proofs.p7_concurrent_distinct;
  assert(p7.pass === true, 'P7 pass');
  assert(p7.winners === 1, 'P7 exactly 1 winner');
  assert(p7.conflicts === 99, 'P7 99 conflicts');
  assert(p7.errors === 0, 'P7 0 errors');
  assert(p7.winner_version === 1, 'P7 winner version 1');

  // ── 15. P8: Concurrent identical ──────────────────────────────────────
  const p8 = data.proofs.p8_concurrent_identical;
  assert(p8.pass === true, 'P8 pass');
  assert(p8.operation_count === 1, 'P8 1 operation row');
  assert(p8.operation_status === 'committed', 'P8 status committed');
  assert(p8.successful_count === 100, 'P8 100 successful');
  assert(p8.all_identical === true, 'P8 all results identical');
  assert(p8.sample_version === 1, 'P8 sample version 1');

  // ── 16. P9: Release ────────────────────────────────────────────────────
  const p9 = data.proofs.p9_release;
  assert(p9.pass === true, 'P9 pass');
  assert(p9.state_before.lifecycle_state === 'reserved', 'P9 before reserved');
  assert(p9.state_before.buyer_user_id !== null, 'P9 before has buyer');
  assert(p9.result.ok === true, 'P9 release ok');
  assert(p9.result.version === 2, 'P9 release version 2');
  assert(p9.state_after.lifecycle_state === 'available', 'P9 after available');
  assert(p9.state_after.buyer_user_id === null, 'P9 after buyer null');

  // ── 17. P10: Unknown recovery ──────────────────────────────────────────
  const p10 = data.proofs.p10_unknown_recovery;
  assert(p10.pass === true, 'P10 pass');
  assert(p10.recovered.ok === true, 'P10 recovered ok');
  assert(p10.recovered.status === 'committed', 'P10 status committed');
  assert(p10.recovered.committed_version === 1, 'P10 committed version 1');
  assert(p10.recovered.result_ok === true, 'P10 result_json ok');

  // ── 18. P11: Concurrent incidents ──────────────────────────────────────
  const p11 = data.proofs.p11_concurrent_incidents;
  assert(p11.pass === true, 'P11 pass');
  assert(p11.successful_count === 100, 'P11 100 successful');
  assert(p11.error_count === 0, 'P11 0 errors');
  assert(p11.unique_incident_ids === 1, 'P11 1 unique incident');
  assert(p11.final_occurrence_count === 100, 'P11 occurrence_count === 100');
  assert(p11.all_same_id === true, 'P11 all same incident_id');

  // ── 19. P12: Privileges (strict) ───────────────────────────────────────
  const p12 = data.proofs.p12_privileges;
  assert(p12.pass === true, 'P12 pass');
  assert(p12.checks.executor_select_denied === true, 'P12 SELECT denied (42501)');
  assert(p12.checks.executor_insert_denied === true, 'P12 INSERT denied (42501)');
  assert(p12.checks.executor_update_denied === true, 'P12 UPDATE denied (42501)');
  assert(p12.checks.executor_delete_denied === true, 'P12 DELETE denied (42501)');
  assert(p12.checks.executor_acquire_operation_denied === true, 'P12 acquire_operation denied');
  assert(p12.checks.executor_cleanup_denied === true, 'P12 cleanup_synthetic denied');
  assert(p12.checks.executor_count_denied === true, 'P12 count_synthetic denied');
  assert(p12.checks.executor_test_only_denied === true, 'P12 reserve_and_fail denied');
  assert(p12.checks.public_execute_count === 0, 'P12 PUBLIC EXECUTE count 0');
  assert(p12.checks.public_execute_revoked === true, 'P12 PUBLIC EXECUTE revoked');
  assert(p12.method.includes('aclexplode'), 'P12 uses aclexplode ACL evaluation');

  // ── 20. P13: Executor secret ──────────────────────────────────────────
  const p13 = data.proofs.p13_executor_secret;
  assert(p13.pass === true, 'P13 pass');
  assert(p13.executor_user === 'authority_probe_executor', 'P13 executor user');
  assert(p13.admin_user !== p13.executor_user, 'P13 admin ≠ executor');
  assert(p13.executor_is_probe_role === true, 'P13 executor is probe role');
  assert(p13.admin_is_different === true, 'P13 admin is different');

  // ── 21. P14: Latency ───────────────────────────────────────────────────
  const p14 = data.proofs.p14_latency;
  assert(p14.pass === true, 'P14 pass');
  assert(p14.samples >= 20, `P14 samples >= 20: ${p14.samples}`);
  assert(p14.min_ms <= p14.median_ms, 'P14 min <= median');
  assert(p14.median_ms <= p14.p95_ms, 'P14 median <= p95');
  assert(p14.p95_ms <= p14.max_ms, 'P14 p95 <= max');

  // ── 22. P15: Cleanup ───────────────────────────────────────────────────
  const p15 = data.proofs.p15_cleanup;
  assert(p15.pass === true, 'P15 pass');
  assert(p15.cleanup.ok === true, 'P15 cleanup ok');
  assert(p15.cleanup.total_remaining === 0, 'P15 total_remaining 0');
  assert(p15.count_after.total === 0, 'P15 count_after.total 0');

  // ── Summary ────────────────────────────────────────────────────────────
  console.log('');
  console.log(`  Total: ${passed} passed, ${failed} failed`);
  if (failed === 0) {
    console.log('╔══════════════════════════════════════════════════════════════════╗');
    console.log('║  VERDICT: PASS — All F.3.1 invariants certified.               ║');
    console.log('╚══════════════════════════════════════════════════════════════════╝');
    process.exit(0);
  } else {
    console.log('╔══════════════════════════════════════════════════════════════════╗');
    console.log('║  VERDICT: FAIL — One or more invariants not satisfied.          ║');
    console.log('╚══════════════════════════════════════════════════════════════════╝');
    process.exit(1);
  }
}

main();