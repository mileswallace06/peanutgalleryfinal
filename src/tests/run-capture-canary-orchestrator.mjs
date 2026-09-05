/**
 * Wrapper for capture-canary-orchestrator.test.mjs — registers npm-compat hook,
 * reads env vars, calls runAllTests, prints summary.
 */
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';

register(pathToFileURL('./tests/loaders/npm-compat-hook.mjs').href, pathToFileURL('./').href);

const adminUrl = process.env.AUTHORITY_DB_URL_DEV_ADMIN;
const executorUrl = process.env.AUTHORITY_V1_DB_URL_DEV_EXECUTOR;
const recorderUrl = process.env.AUTHORITY_V1_DB_URL_DEV_STRIPE_RECORDER;

if (!adminUrl) throw new Error('AUTHORITY_DB_URL_DEV_ADMIN not available');
if (!executorUrl) throw new Error('AUTHORITY_V1_DB_URL_DEV_EXECUTOR not available');
if (!recorderUrl) throw new Error('AUTHORITY_V1_DB_URL_DEV_STRIPE_RECORDER not available');

const { neon } = await import('npm:@neondatabase/serverless@0.10.4');
const adminSql = neon(adminUrl);

async function cleanupAll() {
  await adminSql`DELETE FROM authority_v1.reservation_outbox`;
  await adminSql`DELETE FROM authority_v1.stripe_webhook_events`;
  await adminSql`DELETE FROM authority_v1.payment_actions`;
  await adminSql`DELETE FROM authority_v1.operational_incidents`;
  await adminSql`DELETE FROM authority_v1.reservation_payment_bindings`;
  await adminSql`DELETE FROM authority_v1.reservation_operations`;
  await adminSql`DELETE FROM authority_v1.reservation_authority`;
}

await cleanupAll();

const harness = await import(pathToFileURL('./tests/capture-canary-orchestrator.test.mjs').href);
const result = await harness.runAllTests({ adminSql, executorUrl, recorderUrl });

await cleanupAll();

// runAllTests returns { total, passed, failed, allClean, counts, syntheticIds, results }
const passed = result.passed || 0;
const failed = result.failed || 0;

console.log('═══════════════════════════════════════════════════════════════════');
console.log('  Capture Canary Orchestrator Suite');
console.log('═══════════════════════════════════════════════════════════════════');
for (const r of (result.results || [])) {
  console.log(`  ${r.passed ? '✓' : '✗'} ${r.name}`);
}
console.log(`  allClean: ${result.allClean ? 'YES' : 'NO'}`);
console.log(`  TOTAL: ${passed} passed, ${failed} failed`);
console.log('═══════════════════════════════════════════════════════════════════');

if (failed > 0 || !result.allClean) process.exit(1);