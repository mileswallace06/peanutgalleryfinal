/**
 * Runner for P0-01O real Stripe test-mode webhook transport certification.
 *
 * Loads the npm-compat ESM hook (for npm: specifiers), assembles deps from
 * process.env secrets, and invokes runAllTests. Outputs the result as JSON
 * on stdout.
 *
 * SAFETY:
 *   - STRIPE_SECRET_KEY is verified to be sk_test_ before use.
 *   - The live key is NEVER read.
 *   - STRIPE_WEBHOOK_SECRET_TEST and WEBHOOK_TEST_ENDPOINT_URL are checked
 *     for dedicated test endpoint isolation. If either is missing, the
 *     harness reports NEEDS_OWNER_ACTION.
 *   - No secret values are ever printed, logged, or returned.
 */
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';

// Register the npm-compat loader hook for npm: specifiers
register(pathToFileURL('./tests/loaders/npm-compat-hook.mjs').href, pathToFileURL('./').href);

const { neon } = await import('npm:@neondatabase/serverless@0.10.4');

// ── Verify and assemble deps from process.env ──────────────────────────────
// STRIPE_SECRET_KEY must be test-mode (sk_test_)
// The live key is NEVER read — only the test key is used.
const testKey = process.env.STRIPE_SECRET_KEY;
if (!testKey) throw new Error('STRIPE_SECRET_KEY not available');
if (!testKey.startsWith('sk_test_')) throw new Error('STRIPE_SECRET_KEY must be sk_test_ (test mode only)');

// Database URLs (existing canonical secrets)
const executorUrl = process.env.AUTHORITY_V1_DB_URL_DEV_EXECUTOR;
const recorderUrl = process.env.AUTHORITY_V1_DB_URL_DEV_STRIPE_RECORDER;
const adminUrl = process.env.AUTHORITY_DB_URL_DEV_ADMIN;
if (!executorUrl) throw new Error('AUTHORITY_V1_DB_URL_DEV_EXECUTOR not available');
if (!recorderUrl) throw new Error('AUTHORITY_V1_DB_URL_DEV_STRIPE_RECORDER not available');
if (!adminUrl) throw new Error('AUTHORITY_DB_URL_DEV_ADMIN not available');

// Dedicated test webhook endpoint and signing secret (required for isolation)
// These are NOT the production secrets. If missing, harness reports NEEDS_OWNER_ACTION.
const webhookTestSecret = process.env.STRIPE_WEBHOOK_SECRET_TEST || null;
const webhookTestEndpointUrl = process.env.WEBHOOK_TEST_ENDPOINT_URL || null;

// Production webhook secret (for isolation proof only — never used for test events)
const webhookSecretProd = process.env.STRIPE_WEBHOOK_SECRET || null;

const adminSql = neon(adminUrl);

// ── Dynamically import and run the harness ──────────────────────────────────
const harnessUrl = pathToFileURL('./tests/webhook-real-delivery.test.mjs').href;
const harness = await import(harnessUrl);

const result = await harness.runAllTests({
  adminSql,
  executorUrl,
  recorderUrl,
  testKey,
  webhookTestSecret,
  webhookTestEndpointUrl,
  webhookSecretProd,
});

// Output the result as JSON (sanitized — no secret values)
console.log('___RESULTS___');
console.log(JSON.stringify(result, null, 2));