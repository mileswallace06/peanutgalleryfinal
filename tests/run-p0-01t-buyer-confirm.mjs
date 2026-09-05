/**
 * Runner for P0-01T-CORRECTIVE-4 buyer-confirmation, composition, and
 * abort/cancel collision test suites.
 *
 * Loads the npm-compat ESM hook (for npm: specifiers), dynamically imports
 * all three DI test modules, assembles deps from process.env secrets, and
 * invokes runAllTests for each. Aggregates results and asserts that sensitive
 * operational credentials never appear in any response body, log output,
 * or error message.
 *
 * P0-01T-CORRECTIVE-4: Never print or return a secret. Report only sanitized
 * violation counts and categories. Return actual runtime assertion counts,
 * C1–C11 outcomes, abort/cancel collision results, direct frozen-retry proof,
 * sanitized leak count, and final seven-table cleanup counts.
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

const knownCredentials = new Set();
knownCredentials.add(adminUrl);
knownCredentials.add(executorUrl);
knownCredentials.add(recorderUrl);

const SENSITIVE_PATTERNS = [
  { kind: 'action_id', pattern: /action_id/i },
  { kind: 'stripe_idempotency_key', pattern: /stripe_idempotency_key/i },
  { kind: 'idem_key', pattern: /idem_key/i },
  { kind: 'buyer_user_id', pattern: /buyer_user_id/i },
  { kind: 'buyer_email', pattern: /buyer_email/i },
];

let leakViolations = [];

function scanForLeaks(context, value) {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  if (!text) return;
  for (const { kind, pattern } of SENSITIVE_PATTERNS) {
    if (pattern.test(text)) {
      leakViolations.push({ context, kind });
    }
  }
  for (const cred of knownCredentials) {
    if (cred && typeof cred === 'string' && cred.length > 10 && text.includes(cred)) {
      leakViolations.push({ context, kind: 'known_credential_value' });
    }
  }
}

const originalLog = console.log;
const originalError = console.error;
const capturedLogs = [];
const capturedErrors = [];

console.log = (...args) => {
  const text = args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' ');
  capturedLogs.push(text);
  originalLog(...args);
};
console.error = (...args) => {
  const text = args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' ');
  capturedErrors.push(text);
  originalError(...args);
};

async function cleanupAll(sql) {
  await sql`DELETE FROM authority_v1.reservation_outbox`;
  await sql`DELETE FROM authority_v1.stripe_webhook_events`;
  await sql`DELETE FROM authority_v1.payment_actions`;
  await sql`DELETE FROM authority_v1.operational_incidents`;
  await sql`DELETE FROM authority_v1.reservation_payment_bindings`;
  await sql`DELETE FROM authority_v1.reservation_operations`;
  await sql`DELETE FROM authority_v1.reservation_authority`;
}

async function getSevenTableCounts(sql) {
  const tables = [
    'reservation_authority', 'reservation_operations', 'reservation_outbox',
    'reservation_payment_bindings', 'payment_actions',
    'stripe_webhook_events', 'operational_incidents',
  ];
  const counts = {};
  for (const t of tables) {
    const rows = await sql(`SELECT count(*)::int as c FROM authority_v1."${t}"`);
    counts[t] = rows[0].c;
  }
  return counts;
}

const allResults = { suites: [], totalPassed: 0, totalFailed: 0 };

// 1. Buyer-confirmation canary suite
{
  originalLog('\n═══════════════════════════════════════════════════════════════════');
  originalLog('  Suite 1: P0-01T Buyer Transfer Confirmation — Canary');
  originalLog('═══════════════════════════════════════════════════════════════════');

  await cleanupAll(adminSql);
  const harness = await import(pathToFileURL('./tests/buyer-confirmation-canary.test.mjs').href);
  const result = await harness.runAllTests({ adminSql, executorUrl });
  await cleanupAll(adminSql);

  allResults.suites.push({ name: 'buyer-confirmation-canary', ...result });
  allResults.totalPassed += result.passed || 0;
  allResults.totalFailed += result.failed || 0;

  if (result.failures) {
    for (const f of result.failures) {
      const failText = typeof f === 'string' ? f : (f.details || f.name || JSON.stringify(f));
      for (const cred of knownCredentials) {
        if (cred && typeof cred === 'string' && cred.length > 10 && failText.includes(cred)) {
          leakViolations.push({ context: 'buyer-confirm failure', kind: 'known_credential_value' });
        }
      }
    }
  }
}

// 2. Composition suite (buyer confirmation + capture)
{
  originalLog('\n═══════════════════════════════════════════════════════════════════');
  originalLog('  Suite 2: P0-01T-CORRECTIVE-4 Composition — Buyer Confirmation + Capture');
  originalLog('═══════════════════════════════════════════════════════════════════');

  await cleanupAll(adminSql);
  const harness = await import(pathToFileURL('./tests/buyer-confirm-composition.test.mjs').href);
  const result = await harness.runAllTests({ adminSql, executorUrl, recorderUrl });
  await cleanupAll(adminSql);

  allResults.suites.push({ name: 'buyer-confirm-composition', ...result });
  allResults.totalPassed += result.passed || 0;
  allResults.totalFailed += result.failed || 0;

  if (result.leakViolations && result.leakViolations.length > 0) {
    for (const lv of result.leakViolations) {
      for (const v of lv.violations) {
        leakViolations.push({ context: `composition response [${lv.test}]`, kind: v.kind });
      }
    }
  }
}

// 3. Abort/Cancel collision suite
{
  originalLog('\n═══════════════════════════════════════════════════════════════════');
  originalLog('  Suite 3: P0-01T-CORRECTIVE-4 Abort/Cancel No-Relist Collision');
  originalLog('═══════════════════════════════════════════════════════════════════');

  await cleanupAll(adminSql);
  const harness = await import(pathToFileURL('./tests/abort-cancel-collision.test.mjs').href);
  const result = await harness.runAllTests({ adminSql, executorUrl });
  await cleanupAll(adminSql);

  allResults.suites.push({ name: 'abort-cancel-collision', ...result });
  allResults.totalPassed += result.passed || 0;
  allResults.totalFailed += result.failed || 0;
}

// Restore console
console.log = originalLog;
console.error = originalError;

// Scan captured logs and errors for credential leaks
for (const line of capturedLogs) {
  scanForLeaks('log', line);
}
for (const line of capturedErrors) {
  scanForLeaks('error', line);
}

// Credential leak assertions
originalLog('\n═══════════════════════════════════════════════════════════════════');
originalLog('  Credential Leak Scan (recursive response bodies + logs + errors)');
originalLog('═══════════════════════════════════════════════════════════════════');

let leakPass = 0, leakFail = 0;
if (leakViolations.length === 0) {
  originalLog('  ✅ No credential leaks detected in responses, logs, or errors');
  leakPass++;
} else {
  originalLog(`  ❌ ${leakViolations.length} credential leak violation(s) detected:`);
  const byKind = {};
  for (const v of leakViolations) {
    const key = `${v.context}:${v.kind}`;
    byKind[key] = (byKind[key] || 0) + 1;
  }
  for (const [key, count] of Object.entries(byKind)) {
    originalLog(`    - ${key}: ${count} violation(s)`);
  }
  leakFail = leakViolations.length;
}

// Final seven-table cleanup verification
originalLog('\n═══════════════════════════════════════════════════════════════════');
originalLog('  Final Seven-Table Cleanup Verification');
originalLog('═══════════════════════════════════════════════════════════════════');

await cleanupAll(adminSql);
const finalCounts = await getSevenTableCounts(adminSql);
let allZero = true;
for (const [table, count] of Object.entries(finalCounts)) {
  originalLog(`  ${table}: ${count}`);
  if (count !== 0) allZero = false;
}
if (allZero) {
  originalLog('  ✅ All seven tables empty after cleanup');
} else {
  originalLog('  ❌ Some tables still have rows after cleanup');
  allResults.totalFailed++;
}

// Final summary
originalLog('\n═══════════════════════════════════════════════════════════════════');
originalLog('  P0-01T-CORRECTIVE-4 Runner — Final Summary');
originalLog('═══════════════════════════════════════════════════════════════════');
for (const s of allResults.suites) {
  originalLog(`  ${s.name}: ${s.passed} passed, ${s.failed} failed`);
}
originalLog(`  Credential leak scan: ${leakPass} passed, ${leakFail} failed`);
originalLog(`  Seven-table cleanup: ${allZero ? 'PASS' : 'FAIL'}`);
originalLog(`  TOTAL: ${allResults.totalPassed + leakPass} passed, ${allResults.totalFailed + leakFail} failed`);
originalLog('═══════════════════════════════════════════════════════════════════');

const overallFailed = allResults.totalFailed + leakFail + (allZero ? 0 : 1);
if (overallFailed > 0) {
  process.exit(1);
}