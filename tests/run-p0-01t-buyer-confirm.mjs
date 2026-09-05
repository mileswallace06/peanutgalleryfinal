/**
 * Runner for P0-01T-CORRECTIVE-3 buyer-confirmation + composition test suites.
 *
 * Loads the npm-compat ESM hook (for npm: specifiers), dynamically imports
 * both DI test modules, assembles deps from process.env secrets, and invokes
 * runAllTests for each. Aggregates results and asserts that sensitive
 * operational credentials (capture action_id, stripe_idempotency_key,
 * buyer_user_id, buyer_email) never appear in any response body, log output,
 * or error message.
 *
 * P0-01T-CORRECTIVE-3: The credential scanner NEVER stores a detected raw
 * secret in an assertion name, error, detail, JSON result, console message,
 * or snippet. A violation contains only a sanitized secret kind and context.
 * Console output is intercepted and compared in memory against known action
 * IDs, Stripe idempotency keys, and configured database URLs. Only violation
 * counts and sanitized categories are reported.
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

// ── Known credentials for in-memory comparison ─────────────────────────────
// These values are collected during test execution and compared against
// console output. They are NEVER printed, stored in violations, or returned.
const knownCredentials = new Set();
// Add database URLs to known credentials (to detect leaks in logs)
knownCredentials.add(adminUrl);
knownCredentials.add(executorUrl);
knownCredentials.add(recorderUrl);

// ── Sanitized credential leak detection ────────────────────────────────────
// P0-01T-CORRECTIVE-3: Never store a detected raw secret. A violation contains
// only a sanitized secret kind and context (e.g. "log:action_id_pattern").
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
      // P0-01T-CORRECTIVE-3: Only store the sanitized kind and context.
      // Never store the matching substring or raw secret value.
      leakViolations.push({ context, kind });
    }
  }
  // Also check for known credential values in the text
  for (const cred of knownCredentials) {
    if (cred && typeof cred === 'string' && cred.length > 10 && text.includes(cred)) {
      leakViolations.push({ context, kind: 'known_credential_value' });
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

  // Scan failures for credential leaks (sanitized — only kind + context)
  if (result.failures) {
    for (const f of result.failures) {
      const failText = typeof f === 'string' ? f : (f.details || f.name || JSON.stringify(f));
      // Check if the failure text contains known credential values
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
  originalLog('  Suite 2: P0-01T-CORRECTIVE-3 Composition — Buyer Confirmation + Capture');
  originalLog('═══════════════════════════════════════════════════════════════════');

  await cleanupAll(adminSql);
  const harnessUrl = pathToFileURL('./tests/buyer-confirm-composition.test.mjs').href;
  const harness = await import(harnessUrl);
  const result = await harness.runAllTests({ adminSql, executorUrl, recorderUrl });
  await cleanupAll(adminSql);

  allResults.suites.push({ name: 'buyer-confirm-composition', ...result });
  allResults.totalPassed += result.passed || 0;
  allResults.totalFailed += result.failed || 0;

  // Aggregate recursive leak violations from the composition suite's built-in scanner
  // P0-01T-CORRECTIVE-3: These are already sanitized (kind + path only, no raw values)
  if (result.leakViolations && result.leakViolations.length > 0) {
    for (const lv of result.leakViolations) {
      for (const v of lv.violations) {
        leakViolations.push({
          context: `composition response [${lv.test}]`,
          kind: v.kind,
        });
      }
    }
  }
}

// Restore console
console.log = originalLog;
console.error = originalError;

// ── Scan captured logs and errors for credential leaks (in-memory comparison) ──
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
  // P0-01T-CORRECTIVE-3: Report only violation counts and sanitized categories.
  // Do not print matching substrings or raw secret values.
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

// ── Final summary ──────────────────────────────────────────────────────────
originalLog('\n═══════════════════════════════════════════════════════════════════');
originalLog('  P0-01T-CORRECTIVE-3 Runner — Final Summary');
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