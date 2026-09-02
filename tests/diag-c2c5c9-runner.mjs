/**
 * Temporary diagnostic runner — runs the composition suite with sanitized
 * instrumentation and writes ONLY pass/fail counts + sanitized error classes
 * to a results file. No credentials, IDs, URLs, SQL, or stacks are written.
 */
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';
import { writeFileSync } from 'node:fs';

register(pathToFileURL('./tests/loaders/npm-compat-hook.mjs').href, pathToFileURL('./').href);

process.env.P01T_DIAG = '1';

const adminUrl = process.env.AUTHORITY_DB_URL_DEV_ADMIN;
const executorUrl = process.env.AUTHORITY_V1_DB_URL_DEV_EXECUTOR;
const recorderUrl = process.env.AUTHORITY_V1_DB_URL_DEV_STRIPE_RECORDER;

if (!adminUrl || !executorUrl || !recorderUrl) {
  writeFileSync('./tests/diag-results.json', JSON.stringify({ error: 'missing env' }));
  process.exit(1);
}

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

// Sanitized output — only pass/fail counts and failure names (no credentials)
const sanitized = {
  passed: result.passed,
  failed: result.failed,
  failures: (result.failures || []).map(f => {
    // Keep only the assertion name, strip any values that might contain IDs
    const name = String(f).split(':')[0];
    return name;
  }),
};

writeFileSync('./tests/diag-results.json', JSON.stringify(sanitized, null, 2));