/**
 * run-p0-01k-suites.mjs — Runs all P0-01K certification suites.
 * Usage: node --import ./tests/loaders/npm-compat-register.mjs tests/run-p0-01k-suites.mjs
 */
import { neon } from 'npm:@neondatabase/serverless@0.10.4';
import { readFileSync } from 'node:fs';

const adminUrl = process.env.AUTHORITY_DB_URL_DEV_ADMIN;
const executorUrl = process.env.AUTHORITY_V1_DB_URL_DEV_EXECUTOR;
const recorderUrl = process.env.AUTHORITY_V1_DB_URL_DEV_STRIPE_RECORDER;
const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
const adminSql = neon(adminUrl);

// Clean up ALL leftover test data
await adminSql`DELETE FROM authority_v1.stripe_webhook_events WHERE webhook_event_id LIKE 'cert_%'`;
await adminSql`DELETE FROM authority_v1.operational_incidents WHERE incident_key LIKE '%cert_%'`;
await adminSql`DELETE FROM authority_v1.reservation_outbox WHERE listing_id LIKE 'cert_%'`;
await adminSql`DELETE FROM authority_v1.payment_actions WHERE action_id LIKE 'cert_%'`;
await adminSql`DELETE FROM authority_v1.reservation_payment_bindings WHERE purchase_id LIKE 'cert_%'`;
await adminSql`DELETE FROM authority_v1.reservation_operations WHERE subject_id LIKE 'cert_%'`;
await adminSql`DELETE FROM authority_v1.reservation_authority WHERE listing_id LIKE 'cert_%'`;

const results = {};

// Helper: run a suite and capture results
async function runSuite(name, path, deps) {
  const logs = [];
  const origLog = console.log;
  console.log = (...args) => { logs.push(args.join(' ')); };
  try {
    const mod = await import(path);
    if (typeof mod.runAllTests === 'function') {
      const r = await mod.runAllTests(deps);
      results[name] = { passed: r.passed, failed: r.failed, failures: r.failures || [],
        failDetails: logs.filter(l => l.includes('[FAIL]')).slice(0, 10) };
    } else {
      results[name] = { error: 'no runAllTests export' };
    }
  } catch (e) {
    results[name] = { error: e.message, failDetails: logs.filter(l => l.includes('[FAIL]')).slice(0, 10) };
  }
  console.log = origLog;
}

// 1. Webhook processor
await runSuite('processor', 'file:///app/tests/webhook-processor.test.mjs', { adminSql, executorUrl, recorderUrl });

// 2. Webhook ingress
await runSuite('ingress', 'file:///app/tests/webhook-canary-ingress.test.mjs', { adminSql, executorUrl, recorderUrl, webhookSecret });

// 3. Capture-finalize-atomicity
await runSuite('captureFinalize', 'file:///app/tests/capture-finalize-atomicity.test.mjs', { adminSql, executorUrl, recorderUrl });

// 4. Payment-saga-cancel
await runSuite('paymentSaga', 'file:///app/tests/payment-saga-cancel.test.mjs', { adminSql, executorUrl, recorderUrl });

// 5. Scheduled-release protections (static — no DB deps)
await runSuite('scheduledRelease', 'file:///app/tests/canary-scheduled-release-protections.test.mjs', {});

// 6. Transfer-reminders wiring (static — no DB deps)
await runSuite('wiring', 'file:///app/tests/process-transfer-reminders-wiring.test.mjs', {});

// 7. Authority-contract (static — runs as script, not module)
{
  const logs = [];
  const origLog = console.log;
  console.log = (...args) => { logs.push(args.join(' ')); };
  try {
    // authority-contract.test.mjs is a self-executing script
    await import('file:///app/tests/authority-contract.test.mjs');
    const failLines = logs.filter(l => l.includes('[FAIL]'));
    const passCount = (logs.filter(l => l.includes('[PASS]')).length);
    results.authorityContract = { passed: passCount, failed: failLines.length, failures: failLines.slice(0, 10) };
  } catch (e) {
    results.authorityContract = { error: e.message, failed: 1, failures: [e.message] };
  }
  console.log = origLog;
}

// Final cleanup verification — all 7 authority tables must be empty
const finalCounts = await adminSql`
  SELECT
    (SELECT count(*) FROM authority_v1.stripe_webhook_events) as webhook,
    (SELECT count(*) FROM authority_v1.payment_actions) as actions,
    (SELECT count(*) FROM authority_v1.reservation_payment_bindings) as bindings,
    (SELECT count(*) FROM authority_v1.reservation_authority) as authority,
    (SELECT count(*) FROM authority_v1.reservation_operations) as operations,
    (SELECT count(*) FROM authority_v1.reservation_outbox) as outbox,
    (SELECT count(*) FROM authority_v1.operational_incidents) as incidents`;

// Output JSON for the sandbox to capture
console.log('___RESULTS___');
console.log(JSON.stringify({ results, finalCounts: finalCounts[0] }, null, 2));