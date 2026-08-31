#!/usr/bin/env node
/**
 * Runner for P0-01R bind_payment_intent concurrency safety proof.
 *
 * Loads the npm-compat ESM hook (for npm: specifiers), dynamically imports
 * the concurrency harness, assembles deps from process.env secrets, and
 * invokes runAllTests. Outputs the result as JSON on stdout.
 *
 * Proves the deployed bind_payment_intent function is concurrency-safe
 * when two different synthetic PaymentIntent IDs race to bind the same
 * purchase. Every iteration must produce exactly one successful binding
 * and one structured PAYMENT_BINDING_CONFLICT (409), with zero thrown
 * database exceptions.
 *
 * Secrets are read from process.env (already set as app secrets). No secret
 * values are ever printed, logged, or returned.
 */
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';

// Register the npm-compat loader hook for npm: specifiers
register(pathToFileURL('./tests/loaders/npm-compat-hook.mjs').href, pathToFileURL('./').href);

// ── Verify and assemble deps from process.env ──────────────────────────────
const adminUrl = process.env.AUTHORITY_DB_URL_DEV_ADMIN;
const executorUrl = process.env.AUTHORITY_V1_DB_URL_DEV_EXECUTOR;
if (!adminUrl) throw new Error('AUTHORITY_DB_URL_DEV_ADMIN not available');
if (!executorUrl) throw new Error('AUTHORITY_V1_DB_URL_DEV_EXECUTOR not available');

const iterations = parseInt(process.env.CONCURRENCY_ITERATIONS || '25', 10);

// ── Dynamically import and run the harness ──────────────────────────────────
const harnessUrl = pathToFileURL('./tests/bind-payment-concurrency.test.mjs').href;
const harness = await import(harnessUrl);

const result = await harness.runAllTests({ adminUrl, executorUrl, iterations });

// Output the result as JSON (sanitized — no secret values)
console.log(JSON.stringify(result, null, 2));