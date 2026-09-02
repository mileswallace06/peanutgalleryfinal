#!/usr/bin/env node
// Wrapper to run the ESM diagnostic script and output sanitized results
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

try {
  execSync('node tests/diag-c2c5c9-runner.mjs 2>tests/diag-stderr.log', {
    encoding: 'utf8',
    timeout: 120000,
  });
} catch (e) {
  // Script may exit non-zero on test failures — that's expected
}

try {
  const results = JSON.parse(readFileSync('./tests/diag-results.json', 'utf8'));
  console.log(JSON.stringify(results, null, 2));
} catch (e) {
  console.log('No results file produced');
  // Print stderr for debugging (sanitized — no credentials in test output)
  try {
    const stderr = readFileSync('./tests/diag-stderr.log', 'utf8');
    // Only print last 2000 chars, strip any potential URLs/credentials
    const clean = stderr.slice(-2000).replace(/https?:\/\/[^\s]+/g, '[URL_REDACTED]');
    console.log(clean);
  } catch (e2) {
    console.log('No stderr log');
  }
}