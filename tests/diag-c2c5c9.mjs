/**
 * Temporary diagnostic runner — runs ONLY C2, C5, C9 with sanitized
 * instrumentation enabled (P01T_DIAG=1) to capture the actual error from
 * the capture saga composition.
 *
 * No credentials, IDs, URLs, SQL, payloads, or stacks are printed.
 */
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';

register(pathToFileURL('./tests/loaders/npm-compat-hook.mjs').href, pathToFileURL('./').href);

process.env.P01T_DIAG = '1';

const adminUrl = process.env.AUTHORITY_DB_URL_DEV_ADMIN;
const executorUrl = process.env.AUTHORITY_V1_DB_URL_DEV_EXECUTOR;
const recorderUrl = process.env.AUTHORITY_V1_DB_URL_DEV_STRIPE_RECORDER;

if (!adminUrl) throw new Error('AUTHORITY_DB_URL_DEV_ADMIN not available');
if (!executorUrl) throw new Error('AUTHORITY_V1_DB_URL_DEV_EXECUTOR not available');
if (!recorderUrl) throw new Error('AUTHORITY_V1_DB_URL_DEV_STRIPE_RECORDER not available');

const { neon } = await import('npm:@neondatabase/serverless@0.10.4');
const adminSql = neon(adminUrl);

async function cleanupAll(sql) {
  await sql`DELETE FROM authority_v1.reservation_outbox`;
  await sql`DELETE FROM authority_v1.stripe_webhook_events`;
  await sql`DELETE FROM authority_v1.payment_actions`;
  await sql`DELETE FROM authority_v1.operational_incidents`;
  await sql`DELETE FROM authority_v1.reservation_payment_bindings`;
  await sql`DELETE FROM authority_v1.reservation_operations`;
  await sql`DELETE FROM authority_v1.reservation_authority`;
}

await cleanupAll(adminSql);

const harnessUrl = pathToFileURL('./tests/buyer-confirm-composition.test.mjs').href;
const harness = await import(harnessUrl);
const result = await harness.runAllTests({ adminSql, executorUrl, recorderUrl });

await cleanupAll(adminSql);

console.log('\n═══ DIAG RESULTS ═══');
console.log(`Passed: ${result.passed}, Failed: ${result.failed}`);
if (result.failures) {
  console.log('Failures:');
  for (const f of result.failures) {
    console.log(`  - ${f}`);
  }
}