#!/usr/bin/env node
/**
 * vertical-slice-live.test.mjs — Executable live-probe test for Phase 1B.
 *
 * Calls the deployed migrateSensitiveData function with action='authority_vertical_slice'
 * and verifies that all 11 live database proofs pass against the real Neon dev database.
 *
 * PREREQUISITES:
 *   - Maintenance mode ON
 *   - AUTHORITY_DB_URL_DEV_ADMIN secret set
 *   - migrateSensitiveData function deployed with the temporary authority_vertical_slice action
 *   - Admin authentication (this test uses the service role)
 *
 * This test was executed during Phase 1B and all proofs passed.
 * The function has since been restored to its original migration logic.
 * Re-running this test requires re-adding the temporary action.
 */
import { createClient } from '@base44/sdk';

const REQUIRED_TESTS = [
  'test1_init', 'test2_idempotent', 'test3_conflict', 'test4_stale',
  'test5_rollback', 'test6_concurrent', 'test7_release', 'test8_recovery',
  'test9_incident', 'test10_privileges', 'cleanup',
];

function assert(condition, message) {
  if (!condition) {
    console.error(`  FAIL: ${message}`);
    process.exit(1);
  }
  console.log(`  PASS: ${message}`);
}

async function main() {
  console.log('╔══════════════════════════════════════════════════════════════════╗');
  console.log('║  Phase 1B — Live Neon Vertical-Slice Gate                       ║');
  console.log('╚══════════════════════════════════════════════════════════════════╝\n');

  const base44 = createClient();

  // Invoke the deployed function with the vertical-slice action
  console.log('Invoking migrateSensitiveData with action=authority_vertical_slice...\n');
  const response = await base44.functions.invoke('migrateSensitiveData', {
    action: 'authority_vertical_slice',
  });

  const result = response.data || response;

  // Verify verdict
  assert(result.verdict === 'PASS', `Overall verdict: ${result.verdict}`);

  // Verify each test
  for (const testKey of REQUIRED_TESTS) {
    const test = result[testKey];
    assert(test?.pass === true, `${testKey}: pass=${test?.pass}`);
  }

  // Verify latency
  assert(result.test11_latency?.median_ms < 100, `Latency median < 100ms: ${result.test11_latency?.median_ms}ms`);

  // Verify cleanup
  assert(result.cleanup?.authority_remaining === 0, 'Cleanup: authority_remaining=0');
  assert(result.cleanup?.operations_remaining === 0, 'Cleanup: operations_remaining=0');
  assert(result.cleanup?.incidents_remaining === 0, 'Cleanup: incidents_remaining=0');

  console.log('\n╔══════════════════════════════════════════════════════════════════╗');
  console.log('║  VERDICT: PASS — All 11 live proofs passed.                    ║');
  console.log('╚══════════════════════════════════════════════════════════════════╝');
  process.exit(0);
}

main().catch((err) => {
  console.error('\n❌ Test failed:', err.message);
  process.exit(1);
});