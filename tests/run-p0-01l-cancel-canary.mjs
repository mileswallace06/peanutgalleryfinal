/**
 * Temporary runner for cancel-purchase-canary + payment-saga-cancel.
 * Usage: node tests/run-p0-01l-cancel-canary.mjs
 */
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';

register(pathToFileURL('./tests/loaders/npm-compat-hook.mjs').href, pathToFileURL('./').href);

const { neon } = await import('npm:@neondatabase/serverless@0.10.4');

const adminUrl = process.env.AUTHORITY_DB_URL_DEV_ADMIN;
const executorUrl = process.env.AUTHORITY_V1_DB_URL_DEV_EXECUTOR;
const recorderUrl = process.env.AUTHORITY_V1_DB_URL_DEV_STRIPE_RECORDER;
if (!adminUrl) throw new Error('AUTHORITY_DB_URL_DEV_ADMIN not available');
if (!executorUrl) throw new Error('AUTHORITY_V1_DB_URL_DEV_EXECUTOR not available');
if (!recorderUrl) throw new Error('AUTHORITY_V1_DB_URL_DEV_STRIPE_RECORDER not available');

const adminSql = neon(adminUrl);

// Clean up leftover test data
await adminSql`TRUNCATE authority_v1.reservation_outbox, authority_v1.reservation_payment_bindings, authority_v1.payment_actions, authority_v1.stripe_webhook_events, authority_v1.operational_incidents, authority_v1.reservation_operations, authority_v1.reservation_authority RESTART IDENTITY CASCADE`;

const results = {};

// 1. cancel-purchase-canary
{
  const mod = await import(pathToFileURL('./tests/cancel-purchase-canary.test.mjs').href);
  const r = await mod.runAllTests({ adminSql, executorUrl, recorderUrl });
  results.cancelCanary = { passed: r.passed, failed: r.failed, failures: r.failures?.slice(0, 10) };
}

// Clean up between suites
await adminSql`TRUNCATE authority_v1.reservation_outbox, authority_v1.reservation_payment_bindings, authority_v1.payment_actions, authority_v1.stripe_webhook_events, authority_v1.operational_incidents, authority_v1.reservation_operations, authority_v1.reservation_authority RESTART IDENTITY CASCADE`;

// 2. payment-saga-cancel (needs execSql = neon(executorUrl), not executorUrl)
{
  const execSql = neon(executorUrl);
  const mod = await import(pathToFileURL('./tests/payment-saga-cancel.test.mjs').href);
  const r = await mod.runAllTests({ execSql, adminSql });
  results.paymentSaga = { passed: r.passed, failed: r.failed, failures: r.failures?.slice(0, 10) };
}

// Final cleanup
await adminSql`TRUNCATE authority_v1.reservation_outbox, authority_v1.reservation_payment_bindings, authority_v1.payment_actions, authority_v1.stripe_webhook_events, authority_v1.operational_incidents, authority_v1.reservation_operations, authority_v1.reservation_authority RESTART IDENTITY CASCADE`;

console.log('___RESULTS___');
console.log(JSON.stringify(results, null, 2));