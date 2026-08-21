#!/usr/bin/env node
/**
 * process-transfer-reminders-wiring.test.mjs
 *
 * AST-based wiring proof that processTransferReminders/entry.ts delegates to
 * the tested canaryScheduledRelease.js module.
 *
 * Parses the actual entry.ts source with acorn and walks the AST to verify:
 *   1. An ImportDeclaration imports runCanaryScheduledRelease from canaryScheduledRelease
 *   2. A CallExpression invokes runCanaryScheduledRelease
 *   3. The call is guarded by isCanaryListing && isCanaryEnabled
 *
 * This is an executable module/wiring proof — NOT a deployed runtime proof.
 */
import assert from 'assert';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import * as acorn from 'acorn';

const __dirname = dirname(fileURLToPath(import.meta.url));
const entryPath = join(__dirname, '..', 'base44', 'functions', 'processTransferReminders', 'entry.ts');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  PASS: ${name}`); passed++; }
  catch (e) { console.error(`  FAIL: ${name} — ${e.message}`); failed++; }
}

// ── Simple recursive AST walker (no acorn-walk dependency) ────────────────
function walkAst(node, visitor) {
  if (!node || typeof node.type !== 'string') return;
  visitor(node);
  for (const key of Object.keys(node)) {
    const child = node[key];
    if (Array.isArray(child)) {
      for (const c of child) walkAst(c, visitor);
    } else if (child && typeof child.type === 'string') {
      walkAst(child, visitor);
    }
  }
}

function extractIdentifiers(node) {
  const names = [];
  walkAst(node, (n) => {
    if (n.type === 'Identifier') names.push(n.name);
  });
  return names;
}

console.log('╔══════════════════════════════════════════════════════════════════╗');
console.log('║  process-transfer-reminders-wiring.test.mjs                    ║');
console.log('║  AST-based wiring proof (executable module proof)             ║');
console.log('╚══════════════════════════════════════════════════════════════════╝\n');

// ── Read and parse the actual entry.ts ────────────────────────────────────
const source = readFileSync(entryPath, 'utf8');

let ast;
test('entry.ts parses with acorn (valid ECMAScript syntax)', () => {
  ast = acorn.parse(source, {
    ecmaVersion: 'latest',
    sourceType: 'module',
    allowReturnOutsideFunction: true,
  });
  assert.ok(ast, 'AST must be produced');
  assert.strictEqual(ast.type, 'Program', 'root must be Program');
});

// ── Verify the import ─────────────────────────────────────────────────────
let foundImport = false;
let importSource = null;

test('imports runCanaryScheduledRelease from canaryScheduledRelease', () => {
  walkAst(ast, (node) => {
    if (node.type === 'ImportDeclaration') {
      const src = node.source?.value || '';
      if (src.includes('canaryScheduledRelease')) {
        for (const spec of node.specifiers || []) {
          if (spec.type === 'ImportSpecifier' && spec.imported?.name === 'runCanaryScheduledRelease') {
            foundImport = true;
            importSource = src;
          }
        }
      }
    }
  });
  assert.ok(foundImport, 'Must import runCanaryScheduledRelease from canaryScheduledRelease');
  assert.ok(importSource.includes('canaryScheduledRelease'),
    `import source must reference canaryScheduledRelease, got: ${importSource}`);
});

// ── Verify the call ───────────────────────────────────────────────────────
let callCount = 0;

test('calls runCanaryScheduledRelease in the handler body', () => {
  walkAst(ast, (node) => {
    if (node.type === 'CallExpression' &&
        node.callee?.type === 'Identifier' &&
        node.callee.name === 'runCanaryScheduledRelease') {
      callCount++;
    }
  });
  assert.ok(callCount > 0, 'Must call runCanaryScheduledRelease at least once');
  assert.ok(callCount >= 2,
    `Should call runCanaryScheduledRelease in both expired-reservation blocks (expected >= 2, got ${callCount})`);
});

// ── Verify the call is guarded by isCanaryListing + isCanaryEnabled ────────
test('call is guarded by isCanaryListing && isCanaryEnabled condition', () => {
  let foundGuardedCall = false;

  walkAst(ast, (node) => {
    if (node.type !== 'IfStatement') return;

    // Check if this if-statement's consequent contains a runCanaryScheduledRelease call
    let hasCall = false;
    walkAst(node.consequent, (n) => {
      if (n.type === 'CallExpression' &&
          n.callee?.type === 'Identifier' &&
          n.callee.name === 'runCanaryScheduledRelease') {
        hasCall = true;
      }
    });

    if (!hasCall) return;

    // Check the test condition includes isCanaryListing and isCanaryEnabled
    const testIdents = extractIdentifiers(node.test);
    if (testIdents.includes('isCanaryListing') && testIdents.includes('isCanaryEnabled')) {
      foundGuardedCall = true;
    }
  });

  assert.ok(foundGuardedCall,
    'runCanaryScheduledRelease call must be guarded by isCanaryListing && isCanaryEnabled');
});

// ── Verify the call passes the correct deps shape ─────────────────────────
test('call passes entities, executorUrl, and listing_id', () => {
  let foundCorrectDeps = false;

  walkAst(ast, (node) => {
    if (node.type !== 'CallExpression') return;
    if (node.callee?.type !== 'Identifier' || node.callee.name !== 'runCanaryScheduledRelease') return;

    const arg = node.arguments?.[0];
    if (!arg || arg.type !== 'ObjectExpression') return;

    const props = (arg.properties || []).map(p => p.key?.name).filter(Boolean);
    if (props.includes('entities') && props.includes('executorUrl') && props.includes('listing_id')) {
      foundCorrectDeps = true;
    }
  });

  assert.ok(foundCorrectDeps,
    'runCanaryScheduledRelease call must pass entities, executorUrl, and listing_id');
});

// ── Summary ────────────────────────────────────────────────────────────────
console.log('');
console.log(`  Total: ${passed} passed, ${failed} failed`);
if (failed === 0) { console.log('  ✅ ALL PASSED'); process.exit(0); }
else { console.log('  ❌ FAILURES'); process.exit(1); }