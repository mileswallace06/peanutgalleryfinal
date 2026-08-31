/**
 * Runner for P0-01R confirm-checkout real Stripe test-mode certification.
 *
 * Loads the npm-compat ESM hook (for npm: specifiers), dynamically imports
 * the certification harness, assembles deps from process.env secrets, and
 * invokes runAllTests. Outputs the result as JSON on stdout.
 *
 * Secrets are read from process.env (already set as app secrets). The Stripe
 * key is verified to be sk_test_ before use. No secret values are ever
 * printed, logged, or returned.
 */
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';

// Register the npm-compat loader hook for npm: specifiers
register(pathToFileURL('./tests/loaders/npm-compat-hook.mjs').href, pathToFileURL('./').href);

// ── Verify and assemble deps from process.env ──────────────────────────────
const testKey = process.env.STRIPE_SECRET_KEY;
if (!testKey) throw new Error('STRIPE_SECRET_KEY not available');
if (!testKey.startsWith('sk_test_')) throw new Error('STRIPE_SECRET_KEY must be sk_test_ (test mode only)');

const executorUrl = process.env.AUTHORITY_V1_DB_URL_DEV_EXECUTOR;
const adminUrl = process.env.AUTHORITY_DB_URL_DEV_ADMIN;
if (!executorUrl) throw new Error('AUTHORITY_V1_DB_URL_DEV_EXECUTOR not available');
if (!adminUrl) throw new Error('AUTHORITY_DB_URL_DEV_ADMIN not available');

const { neon } = await import('npm:@neondatabase/serverless@0.10.4');
const adminSql = neon(adminUrl);

// ── Dynamically import and run the harness ──────────────────────────────────
const harnessUrl = pathToFileURL('./tests/confirm-canary-real-stripe.test.mjs').href;
const harness = await import(harnessUrl);

const result = await harness.runAllTests({ adminSql, executorUrl, testKey });

// Output the result as JSON (sanitized — no secret values)
console.log(JSON.stringify(result, null, 2));