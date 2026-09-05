/**
 * Runner for P0-01T-CORRECTIVE-2 buyer-confirmation + composition test suites.
 *
 * Loads the npm-compat ESM hook (for npm: specifiers), dynamically imports
 * both DI test modules, assembles deps from process.env secrets, and invokes
 * runAllTests for each. Aggregates results and asserts that sensitive
 * operational credentials (capture action_id, stripe_idempotency_key,
 * buyer_user_id, buyer_email) never appear in any response body, log output,
 * or error message.
 *
 * P0-01T-CORRECTIVE-2: The credential scanner now scans successful response
 * bodies recursively (via the composition suite's built-in recursive scanner)
 * and aggregates leak violations from both suites.
 */
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';

// Register the npm-compat loader hook for npm: specifiers
register(pathToFileURL('./tests/loaders/npm-compat-hook.mjs').href, pathToFileURL('./').href);

// ── Verify and assemble deps from process.env ──────────────────────────────
const adminUrl = process.env.AUTHORITY_DB_URL_DEV_ADMIN;
const executorUrl = process.env.AUTHORITY_V1_DB_URL_DEV_EXECUTOR;
const recorderUrl = process.env.AUTHORITY_V1_DB_URL_DEV_STRIPE_RECORDER;

if (!adminUrl) throw new Error('AUTHORITY_DB_URL_DEV_ADMIN not available');
if (!executorUrl) throw new Error('AUTHORITY_V1_DB_URL_DEV_EXECUTOR not available');
if (!recorderUrl) throw new Error('AUTHORITY_V1_DB_URL_DEV_STRIPE_RECORDER not available');

const { neon } = await import('npm:@neondatabase/serverless@0.10.4');
const adminSql = neon(adminUrl);

// ── Credential leak detection ──────────────────────────────────────────────
// Sensitive field names that must never appear in response bodies.
// The composition suite's recursive scanner checks response bodies for these
// keys AND for known credential values. The runner scans logs and failure
// descriptions for these field name patterns.
const SENSITIVE_PATTERNS = [
  /action_id/i,
  /stripe_idempotency_key/i,
  /idem_key/i,
  /buyer_user_id/i,
  /buyer_email/i,
];

let leakViolations = [];

function scanForLeaks(context, value) {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  for (const pattern of SENSITIVE_PATTERNS) {
    if (pattern.test(text)) {
      leakViolations.push({ context, pattern: pattern.source, snippet: text.slice(0, 200) });
    }
  }
}

// ── Capture console output for leak scanning ────────────────────────────────
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

// ── Cleanup helper ──────────────────────────────────────────────────────────
async function cleanupAll(sql) {
  await sql`DELETE FROM authority_v1.reservation_outbox`;
  await sql`DELETE FROM authority_v1.stripe_webhook_events`;
  await sql`DELETE FROM authority_v1.payment_actions`;
  await sql`DELETE FROM authority_v1.operational_incidents`;
  await sql`DELETE FROM authority_v1.reservation_payment_bindings`;
  await sql`DELETE FROM authority_v1.reservation_operations`;
  await sql`DELETE FROM authority_v1.reservation_authority`;
}

// ── Run both suites ────────────────────────────────────────────────────────
const allResults = { suites: [], totalPassed: 0, totalFailed: 0 };

// 1. Buyer-confirmation canary suite
{
  originalLog('\n═══════════════════════════════════════════════════════════════════');
  originalLog('  Suite 1: P0-01T Buyer Transfer Confirmation — Canary');
  originalLog('═══════════════════════════════════════════════════════════════════');

  await cleanupAll(adminSql);
  const harnessUrl = pathToFileURL('./tests/buyer-confirmation-canary.test.mjs').href;
  const harness = await import(harnessUrl);
  const result = await harness.runAllTests({ adminSql, executorUrl });
  await cleanupAll(adminSql);

  allResults.suites.push({ name: 'buyer-confirmation-canary', ...result });
  allResults.totalPassed += result.passed || 0;
  allResults.totalFailed += result.failed || 0;

  // Scan all failures for credential leaks
  if (result.failures) {
    for (const f of result.failures) {
      scanForLeaks(`buyer-confirm failure: ${f.name || f}`, f.details || f);
    }
  }
}

// 2. Composition suite (buyer confirmation + capture)
{
  originalLog('\n═══════════════════════════════════════════════════════════════════');
  originalLog('  Suite 2: P0-01T-CORRECTIVE-2 Composition — Buyer Confirmation + Capture');
  originalLog('═══════════════════════════════════════════════════════════════════');

  await cleanupAll(adminSql);
  const harnessUrl = pathToFileURL('./tests/buyer-confirm-composition.test.mjs').href;
  const harness = await import(harnessUrl);
  const result = await harness.runAllTests({ adminSql, executorUrl, recorderUrl });
  await cleanupAll(adminSql);

  allResults.suites.push({ name: 'buyer-confirm-composition', ...result });
  allResults.totalPassed += result.passed || 0;
  allResults.totalFailed += result.failed || 0;

  // Scan all failures for credential leaks
  if (result.failures) {
    for (const f of result.failures) {
      scanForLeaks(`composition failure: ${typeof f === 'string' ? f : (f.name || f.details || f)}`, typeof f === 'string' ? f : (f.details || f));
    }
  }

  // Aggregate recursive leak violations from the composition suite's built-in scanner
  if (result.leakViolations && result.leakViolations.length > 0) {
    for (const lv of result.leakViolations) {
      leakViolations.push({
        context: `composition response [${lv.test}]`,
        pattern: lv.violations.map(v => v.type + ':' + (v.key || v.name)).join(','),
        snippet: JSON.stringify(lv.violations).slice(0, 200),
      });
    }
  }
}

// Restore console
console.log = originalLog;
console.error = originalError;

// ── Scan captured logs and errors for credential leaks ────────────────────
for (const line of capturedLogs) {
  scanForLeaks('log', line);
}
for (const line of capturedErrors) {
  scanForLeaks('error', line);
}

// ── Credential leak assertions ─────────────────────────────────────────────
originalLog('\n═══════════════════════════════════════════════════════════════════');
originalLog('  Credential Leak Scan (recursive response bodies + logs + errors)');
originalLog('═══════════════════════════════════════════════════════════════════');

let leakPass = 0, leakFail = 0;
if (leakViolations.length === 0) {
  originalLog('  ✅ No credential leaks detected in responses, logs, or errors');
  leakPass++;
} else {
  originalLog(`  ❌ ${leakViolations.length} credential leak(s) detected:`);
  for (const v of leakViolations) {
    originalLog(`    - [${v.context}] pattern "${v.pattern}": ${v.snippet}`);
  }
  leakFail = leakViolations.length;
}

// ── Final summary ──────────────────────────────────────────────────────────
originalLog('\n═══════════════════════════════════════════════════════════════════');
originalLog('  P0-01T-CORRECTIVE-2 Runner — Final Summary');
originalLog('═══════════════════════════════════════════════════════════════════');
for (const s of allResults.suites) {
  originalLog(`  ${s.name}: ${s.passed} passed, ${s.failed} failed`);
}
originalLog(`  Credential leak scan: ${leakPass} passed, ${leakFail} failed`);
originalLog(`  TOTAL: ${allResults.totalPassed + leakPass} passed, ${allResults.totalFailed + leakFail} failed`);
originalLog('═══════════════════════════════════════════════════════════════════');

const overallFailed = allResults.totalFailed + leakFail;
if (overallFailed > 0) {
  process.exit(1);
}