/**
 * P0-01T-CORRECTIVE-4B Runner — Bounded Repair and Execution Pass
 *
 * Exports runP001T({ adminUrl, executorUrl, recorderUrl }) for same-process
 * execution. Importing this module does NOT execute tests or call process.exit.
 *
 * Requirements:
 *   - Environment reads exist only in the CLI wrapper (bottom of file)
 *   - Preflight runs before cleanup
 *   - Executes in the same process using the npm-compat hook
 *   - Suppresses harness logs instead of forwarding them before scanning
 *   - Accumulates generated action IDs, idempotency keys, buyer IDs, and known
 *     secrets in Sets via test callbacks
 *   - Recursively scans successful and failed response bodies in memory
 *   - Reports only sanitized category/path/count information
 *   - Uses try/finally to restore console methods
 *   - Finishes by proving all seven authority tables contain zero test rows
 */
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';

// Register the npm-compat hook for npm: specifiers (same process)
register(pathToFileURL('./tests/loaders/npm-compat-hook.mjs').href, pathToFileURL('./').href);

// ── Preflight ──────────────────────────────────────────────────────────────────
// P0-01T-CORRECTIVE-4C: Safe preflight with hostname normalization, schema
// verification, and initial-empty proof. No cleanup runs until preflight passes.
async function preflight({ adminUrl, executorUrl, recorderUrl }) {
  const checks = [];

  checks.push({ name: 'ADMIN_SECRET_EXISTS', pass: !!adminUrl });
  checks.push({ name: 'EXECUTOR_SECRET_EXISTS', pass: !!executorUrl });
  checks.push({ name: 'RECORDER_SECRET_EXISTS', pass: !!recorderUrl });

  if (!adminUrl || !executorUrl || !recorderUrl) {
    return { pass: false, checks, reason: 'MISSING_SECRET' };
  }

  function parseUrl(urlStr, expectedRole) {
    try {
      const parsed = new URL(urlStr);
      return {
        role: decodeURIComponent(parsed.username),
        hostname: parsed.hostname.toLowerCase().replace(/\.$/, ''),
        database: parsed.pathname ? parsed.pathname.replace(/^\//, '') : '',
        roleOk: decodeURIComponent(parsed.username) === expectedRole,
      };
    } catch (e) {
      return { role: null, hostname: null, database: null, roleOk: false };
    }
  }

  const adminInfo = parseUrl(adminUrl, 'neondb_owner');
  const execInfo = parseUrl(executorUrl, 'authority_executor');
  const recInfo = parseUrl(recorderUrl, 'authority_stripe_recorder');

  checks.push({ name: 'ADMIN_ROLE', pass: adminInfo.roleOk });
  checks.push({ name: 'EXECUTOR_ROLE', pass: execInfo.roleOk });
  checks.push({ name: 'RECORDER_ROLE', pass: recInfo.roleOk });

  // P0-01T-CORRECTIVE-4C: Restore endpoint/hostname verification.
  // Do NOT replace hostname verification with database-name equality.
  // Normalize only the legitimate pooler hostname variation (Neon -pooler suffix)
  // and compare all three normalized hostnames against each other.
  // The admin URL is the owner-verified reference; executor and recorder must
  // resolve to the same Neon development branch endpoint.
  function normalizeNeonHostname(hostname) {
    let h = (hostname || '').toLowerCase().replace(/\.$/, '');
    // Strip the -pooler suffix (Neon pooled vs direct endpoints on the same branch)
    h = h.replace(/-pooler\./, '.');
    return h;
  }

  const adminEndpoint = normalizeNeonHostname(adminInfo.hostname);
  const execEndpoint = normalizeNeonHostname(execInfo.hostname);
  const recEndpoint = normalizeNeonHostname(recInfo.hostname);
  const sameEndpoint = adminEndpoint === execEndpoint && execEndpoint === recEndpoint;
  checks.push({ name: 'SAME_ENDPOINT', pass: sameEndpoint });

  if (!sameEndpoint) {
    // Endpoints differ after normalization — require owner action.
    // Do not assume same branch just because database names match.
    return { pass: false, checks, reason: 'ENDPOINT_MISMATCH_NEEDS_OWNER_ACTION' };
  }

  const { neon } = await import('npm:@neondatabase/serverless@0.10.4');
  const connectResults = {};
  try { await neon(adminUrl)`SELECT 1`; connectResults.admin = true; } catch { connectResults.admin = false; }
  try { await neon(executorUrl)`SELECT 1`; connectResults.executor = true; } catch { connectResults.executor = false; }
  try { await neon(recorderUrl)`SELECT 1`; connectResults.recorder = true; } catch { connectResults.recorder = false; }

  checks.push({ name: 'ADMIN_CONNECT', pass: connectResults.admin });
  checks.push({ name: 'EXECUTOR_CONNECT', pass: connectResults.executor });
  checks.push({ name: 'RECORDER_CONNECT', pass: connectResults.recorder });

  if (!connectResults.admin || !connectResults.executor || !connectResults.recorder) {
    return { pass: false, checks, reason: 'CONNECTIVITY_FAILED' };
  }

  // Schema verification: authority_v1 must exist
  const adminSql = neon(adminUrl);
  let schemaExists = false;
  try {
    const rows = await adminSql`SELECT 1 FROM information_schema.schemata WHERE schema_name = 'authority_v1'`;
    schemaExists = rows.length > 0;
  } catch {}
  checks.push({ name: 'SCHEMA_EXISTS', pass: schemaExists });

  if (!schemaExists) {
    return { pass: false, checks, reason: 'SCHEMA_MISSING' };
  }

  // Initial-empty proof: all 7 authority tables must be empty before testing
  const tables = [
    'reservation_authority', 'reservation_operations', 'reservation_outbox',
    'reservation_payment_bindings', 'payment_actions',
    'stripe_webhook_events', 'operational_incidents',
  ];
  let allEmpty = true;
  const initialCounts = {};
  for (const t of tables) {
    try {
      const rows = await adminSql(`SELECT count(*)::int as c FROM authority_v1."${t}"`);
      initialCounts[t] = rows[0].c;
      if (rows[0].c !== 0) allEmpty = false;
    } catch {
      allEmpty = false;
    }
  }
  checks.push({ name: 'INITIAL_EMPTY', pass: allEmpty });

  if (!allEmpty) {
    // Existing rows present — require owner action. Do NOT cleanup.
    return { pass: false, checks, reason: 'TABLES_NOT_EMPTY_NEEDS_OWNER_ACTION', initialCounts };
  }

  const allPass = checks.every(c => c.pass);
  return { pass: allPass, checks, reason: allPass ? null : 'CHECKS_FAILED', adminSql };
}

// ── Credential accumulation Sets ──────────────────────────────────────────────
const knownActionIds = new Set();
const knownIdemKeys = new Set();
const knownBuyerIds = new Set();
const knownSecrets = new Set();

// ── Sanitized recursive leak scanner ──────────────────────────────────────────
const PROHIBITED_KEYS = new Set([
  'action_id', 'stripe_idempotency_key', 'idem_key',
  'buyer_user_id', 'buyer_email',
]);

// P0-01T-CORRECTIVE-4C: Scan ALL entries in each credential Set, not just
// the first. Accepts an object of Sets keyed by credential kind.
function scanRecursive(obj, credentialSets, path, violations) {
  if (obj === null || obj === undefined) return;
  if (typeof obj === 'string') {
    for (const [kind, set] of Object.entries(credentialSets)) {
      for (const value of set) {
        if (value && typeof value === 'string' && value.length > 5 && obj.includes(value)) {
          violations.push({ path, kind });
          break; // Report once per kind per string
        }
      }
    }
    return;
  }
  if (typeof obj !== 'object') return;
  for (const [key, value] of Object.entries(obj)) {
    const currentPath = path ? `${path}.${key}` : key;
    if (PROHIBITED_KEYS.has(key.toLowerCase())) {
      violations.push({ path: currentPath, kind: 'prohibited_key' });
    }
    scanRecursive(value, credentialSets, currentPath, violations);
  }
}

// ── Cleanup and table count helpers ───────────────────────────────────────────
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

// ── Main exported runner ──────────────────────────────────────────────────────
export async function runP001T({ adminUrl, executorUrl, recorderUrl }) {
  // 1. Preflight (before any cleanup or SQL mutation)
  const preflightResult = await preflight({ adminUrl, executorUrl, recorderUrl });
  if (!preflightResult.pass) {
    return { preflight: 'FAILED', checks: preflightResult.checks, reason: preflightResult.reason, suites: [], totalPassed: 0, totalFailed: 0 };
  }

  // Accumulate known secrets for leak scanning (values only, never printed)
  knownSecrets.add(adminUrl);
  knownSecrets.add(executorUrl);
  knownSecrets.add(recorderUrl);

  // P0-01T-CORRECTIVE-4C: Reuse the adminSql connection from preflight
  // (preflight already verified schema + initial-empty).
  const adminSql = preflightResult.adminSql;

  // 2. Suppress harness logs — capture instead of forwarding
  const originalLog = console.log;
  const originalError = console.error;
  const capturedLogs = [];
  const capturedErrors = [];

  console.log = (...args) => {
    const text = args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' ');
    capturedLogs.push(text);
  };
  console.error = (...args) => {
    const text = args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' ');
    capturedErrors.push(text);
  };

  const allResults = { suites: [], totalPassed: 0, totalFailed: 0 };
  const allResponseBodies = [];
  let leakViolations = [];

  try {
    // 3. Run test suites (same process, npm-compat hook already registered)
    const suiteConfigs = [
      { name: 'buyer-confirmation-canary', file: 'tests/buyer-confirmation-canary.test.mjs', deps: { adminSql, executorUrl } },
      { name: 'buyer-confirm-composition', file: 'tests/buyer-confirm-composition.test.mjs', deps: { adminSql, executorUrl, recorderUrl } },
      { name: 'abort-cancel-collision', file: 'tests/abort-cancel-collision.test.mjs', deps: { adminSql, executorUrl, recorderUrl } },
    ];

    // P0-01T-CORRECTIVE-4C: Register credential callbacks for leak scanning.
    const credentialCallbacks = {
      recordActionId: (id) => knownActionIds.add(id),
      recordIdemKey: (key) => knownIdemKeys.add(key),
      recordBuyerId: (id) => knownBuyerIds.add(id),
      responseBodies: allResponseBodies,
    };

    for (const config of suiteConfigs) {
      await cleanupAll(adminSql);
      const harness = await import(pathToFileURL(`./${config.file}`).href);
      if (harness.setCredentialCallbacks) {
        harness.setCredentialCallbacks(credentialCallbacks);
      }
      const result = await harness.runAllTests(config.deps);
      await cleanupAll(adminSql);

      allResults.suites.push({ name: config.name, passed: result.passed || 0, failed: result.failed || 0, failures: result.failures || [] });
      allResults.totalPassed += result.passed || 0;
      allResults.totalFailed += result.failed || 0;

      // Collect response bodies for leak scanning
      if (result.responseBodies) {
        for (const rb of result.responseBodies) {
          allResponseBodies.push(rb);
        }
      }
    }

    // 4. Scan captured logs and errors for credential leaks
    // P0-01T-CORRECTIVE-4C: Scan ALL entries in each Set, not just the first.
    const credentialSets = {
      action_id: knownActionIds,
      stripe_idem_key: knownIdemKeys,
      buyer_email: knownBuyerIds,
      secret: knownSecrets,
    };

    for (const line of capturedLogs) {
      const violations = [];
      scanRecursive(line, credentialSets, '', violations);
      if (violations.length > 0) {
        for (const v of violations) {
          leakViolations.push({ context: 'log', kind: v.kind, path: v.path });
        }
      }
    }
    for (const line of capturedErrors) {
      const violations = [];
      scanRecursive(line, credentialSets, '', violations);
      if (violations.length > 0) {
        for (const v of violations) {
          leakViolations.push({ context: 'error', kind: v.kind, path: v.path });
        }
      }
    }

    // 5. Scan all response bodies for credential leaks
    for (const { test, body } of allResponseBodies) {
      const violations = [];
      scanRecursive(body, credentialSets, '', violations);
      if (violations.length > 0) {
        for (const v of violations) {
          leakViolations.push({ context: `response[${test}]`, kind: v.kind, path: v.path });
        }
      }
    }

    // 6. Final seven-table cleanup verification
    await cleanupAll(adminSql);
    const finalCounts = await getSevenTableCounts(adminSql);
    let allZero = true;
    for (const count of Object.values(finalCounts)) {
      if (count !== 0) allZero = false;
    }
    if (!allZero) allResults.totalFailed++;

    return {
      preflight: 'PASSED',
      suites: allResults.suites,
      totalPassed: allResults.totalPassed,
      totalFailed: allResults.totalFailed,
      leakViolations: leakViolations.map(v => ({ context: v.context, kind: v.kind, path: v.path })),
      leakCount: leakViolations.length,
      sevenTableCounts: finalCounts,
      allTablesEmpty: allZero,
    };
  } finally {
    // P0-01T-CORRECTIVE-4C: Always clean up after preflight passes.
    try { await cleanupAll(adminSql); } catch {}
    // Restore console methods
    console.log = originalLog;
    console.error = originalError;
  }
}

// ── CLI wrapper — environment reads exist ONLY here ───────────────────────────
// Importing this module does NOT execute tests or call process.exit.
// The CLI wrapper is invoked only when run directly via `node tests/run-p0-01t-buyer-confirm.mjs`.
const isMainModule = process.argv[1] && process.argv[1].includes('run-p0-01t-buyer-confirm.mjs');
if (isMainModule) {
  const adminUrl = process.env.AUTHORITY_DB_URL_DEV_ADMIN;
  const executorUrl = process.env.AUTHORITY_V1_DB_URL_DEV_EXECUTOR;
  const recorderUrl = process.env.AUTHORITY_V1_DB_URL_DEV_STRIPE_RECORDER;

  if (!adminUrl) throw new Error('AUTHORITY_DB_URL_DEV_ADMIN not available');
  if (!executorUrl) throw new Error('AUTHORITY_V1_DB_URL_DEV_EXECUTOR not available');
  if (!recorderUrl) throw new Error('AUTHORITY_V1_DB_URL_DEV_STRIPE_RECORDER not available');

  const result = await runP001T({ adminUrl, executorUrl, recorderUrl });

  // Print sanitized results
  console.log('═══════════════════════════════════════════════════════════════════');
  console.log('  P0-01T-CORRECTIVE-4B Runner — Final Summary');
  console.log('═══════════════════════════════════════════════════════════════════');
  console.log(`  Preflight: ${result.preflight}`);
  if (result.preflight === 'FAILED') {
    console.log(`  Reason: ${result.reason || 'unknown'}`);
    for (const c of result.checks || []) {
      console.log(`    ${c.pass ? '✓' : '✗'} ${c.name}`);
    }
  }
  for (const s of result.suites || []) {
    console.log(`  ${s.name}: ${s.passed} passed, ${s.failed} failed`);
  }
  if (result.leakCount !== undefined) {
    console.log(`  Credential leak scan: ${result.leakCount} violation(s)`);
  }
  if (result.sevenTableCounts) {
    console.log('  Seven-table cleanup:');
    for (const [table, count] of Object.entries(result.sevenTableCounts)) {
      console.log(`    ${table}: ${count}`);
    }
    console.log(`  All tables empty: ${result.allTablesEmpty ? 'YES' : 'NO'}`);
  }
  console.log(`  TOTAL: ${result.totalPassed} passed, ${result.totalFailed} failed`);
  console.log('═══════════════════════════════════════════════════════════════════');

  if (result.totalFailed > 0 || (result.leakCount || 0) > 0 || !result.allTablesEmpty) {
    process.exit(1);
  }
}