#!/usr/bin/env node
/**
 * Aggregate Test Runner (Round 6B — Section 5)
 *
 * Non-short-circuiting runner that executes EVERY suite, records every exit
 * code, prints a final per-suite summary, and exits nonzero if any required
 * suite fails.
 *
 * The known-limitation suite (concurrent-alert-deduplication) is always
 * executed and its failure is reported, but it does not block the exit code
 * (it documents a known datastore limitation, not a regression).
 *
 * The only acceptable nonzero exit causes are:
 *   1. Production integration not implemented (launch-gate RED)
 *   2. Concurrent AdminAlert uniqueness not atomic (known-limitation)
 *
 * Any other failing suite is an additional blocker.
 */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = join(__dirname, '..');

// ── Suite definitions ────────────────────────────────────────────────────────
// Each suite: { name, file, required (true = blocks exit code) }
const SUITES = [
  // Legacy safety suites
  { name: 'freeze-completeness', file: 'tests/freeze-completeness.test.mjs', required: true },
  { name: 'payment-reconciliation', file: 'tests/payment-reconciliation.test.mjs', required: true },
  { name: 'payment-webhook', file: 'tests/payment-webhook.test.mjs', required: true },
  { name: 'checkout-concurrency', file: 'tests/checkout-concurrency.test.mjs', required: true },
  { name: 'legacy-revision-init', file: 'tests/legacy-revision-init.test.mjs', required: true },
  { name: 'durable-recovery', file: 'tests/durable-recovery.test.mjs', required: true },
  { name: 'partial-finalization-states', file: 'tests/partial-finalization-states.test.mjs', required: true },
  { name: 'post-clear-verification', file: 'tests/post-clear-verification.test.mjs', required: true },
  { name: 'mutation-paths', file: 'tests/mutation-paths.test.mjs', required: true },
  { name: 'post-prefetch-concurrency', file: 'tests/post-prefetch-concurrency.test.mjs', required: true },
  { name: 'tuple-invariant-validation', file: 'tests/tuple-invariant-validation.test.mjs', required: true },

  // Authority suites
  { name: 'authority-concurrency', file: 'tests/reservation-authority-concurrency.test.mjs', required: true },
  { name: 'authority-adversarial', file: 'tests/reservation-authority-adversarial.test.mjs', required: true },

  // Correction rounds
  { name: 'round5-corrections', file: 'tests/round5-correction-tests.test.mjs', required: true },
  { name: 'round6-corrections', file: 'tests/round6-correction-tests.test.mjs', required: true },
  { name: 'round6b-corrections', file: 'tests/round6b-correction-tests.test.mjs', required: true },

  // Ownership
  { name: 'listing-status-ownership', file: 'tests/listing-status-ownership.test.mjs', required: true },

  // Launch gate (RED = production integration not implemented — known blocker)
  { name: 'launch-gate', file: 'tests/launch-gate.test.mjs', required: true },

  // Known limitation (concurrent AdminAlert uniqueness — known datastore blocker)
  { name: 'concurrent-alert-deduplication', file: 'tests/concurrent-alert-deduplication.test.mjs', required: false },
];

// ── Runner ────────────────────────────────────────────────────────────────────
function runSuite(suite) {
  return new Promise((resolve) => {
    const child = spawn('node', [join(ROOT, suite.file)], {
      stdio: ['ignore', 'pipe', 'pipe'],
      cwd: ROOT,
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data) => { stdout += data.toString(); });
    child.stderr.on('data', (data) => { stderr += data.toString(); });

    child.on('close', (code) => {
      resolve({ suite, code, stdout, stderr });
    });

    child.on('error', (err) => {
      resolve({ suite, code: -1, stdout, stderr: err.message });
    });
  });
}

async function main() {
  console.log('╔══════════════════════════════════════════════════════════════════════╗');
  console.log('║  Aggregate Test Runner — Round 6B (non-short-circuiting)           ║');
  console.log('╚══════════════════════════════════════════════════════════════════════╝\n');

  const results = [];

  for (const suite of SUITES) {
    process.stdout.write(`  Running ${suite.name}...`);
    const result = await runSuite(suite);
    results.push(result);

    const status = result.code === 0 ? 'PASS' : 'FAIL';
    const required = suite.required ? ' [required]' : ' [known-limitation]';
    process.stdout.write(`\r  ${status}  ${suite.name}${required}\n`);

    // Print last 5 lines of output for failed suites
    if (result.code !== 0) {
      const lines = (result.stdout + result.stderr).trim().split('\n').filter(l => l.trim());
      const lastLines = lines.slice(-5);
      for (const line of lastLines) {
        console.log(`        ${line}`);
      }
    }
  }

  // ── Final summary ───────────────────────────────────────────────────────────
  console.log('\n╔══════════════════════════════════════════════════════════════════════╗');
  console.log('║  Final Per-Suite Summary                                           ║');
  console.log('╠══════════════════════════════════════════════════════════════════════╣');

  let requiredFailures = 0;
  let knownLimitationFailures = 0;

  for (const r of results) {
    const status = r.code === 0 ? 'PASS' : 'FAIL';
    const tag = r.suite.required ? ' [required]' : ' [known-limitation]';
    console.log(`║  ${status.padEnd(4)}  ${r.suite.name.padEnd(44)}${tag.padEnd(20)}║`);

    if (r.code !== 0) {
      if (r.suite.required) requiredFailures++;
      else knownLimitationFailures++;
    }
  }

  console.log('╠══════════════════════════════════════════════════════════════════════╣');
  console.log(`║  Required failures:    ${requiredFailures}                                            ║`);
  console.log(`║  Known-limitation fails:${knownLimitationFailures}                                            ║`);
  console.log(`║  Total suites:          ${results.length}                                           ║`);
  console.log('╚══════════════════════════════════════════════════════════════════════╝');

  // Exit nonzero if any required suite fails
  if (requiredFailures > 0) {
    console.log(`\n❌ ${requiredFailures} required suite(s) failed — exit 1`);
    process.exit(1);
  } else {
    console.log(`\n✅ All required suites passed. ${knownLimitationFailures} known-limitation suite(s) reported (non-blocking).`);
    process.exit(0);
  }
}

main().catch(err => { console.error('Runner error:', err); process.exit(1); });