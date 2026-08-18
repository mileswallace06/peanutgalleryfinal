#!/usr/bin/env node
/**
 * feedback-security.test.mjs — M0.3 feedback security unit tests.
 *
 * Tests the submitFeedback function's security invariants by verifying:
 *  - The entity schema has rls.create=false (no direct creation).
 *  - The entity schema has no user_email/user_name fields.
 *  - The entity schema has submitter_user_id as required.
 *  - The entity schema has maxLength constraints.
 *  - The function source derives submitter_user_id from user.id only.
 *  - The function source uses asServiceRole for cooldown and create.
 *  - The function source does not read body.submitter_user_id/user_email/user_name.
 *  - The function source returns { status, id }.
 *
 * NOTE: Full runtime tests (200/429/401/denial) require a real non-admin
 * authenticated session and cannot be run by the build agent. See
 * feedback-runtime-normal-user.test.mjs → NEEDS_OWNER_ACTION.
 */
import assert from 'assert';
import { readFileSync } from 'fs';

let passed = 0, failed = 0;
const tests = [];
function test(name, fn) { tests.push({ name, fn }); }

console.log('╔══════════════════════════════════════════════════════════════════╗');
console.log('║  feedback-security.test.mjs — M0.3 feedback security           ║');
console.log('╚══════════════════════════════════════════════════════════════════╝\n');

// ── Load entity schema and function source ─────────────────────────────────
const entitySchema = JSON.parse(
  readFileSync(new URL('../base44/entities/BetaFeedbackEvent.jsonc', import.meta.url), 'utf8')
    .replace(/^[^{]*/, '') // strip any leading non-JSON (jsonc comments)
);
const fnSource = readFileSync(
  new URL('../base44/functions/submitFeedback/entry.ts', import.meta.url), 'utf8'
);

// ── 1. Entity: rls.create is false ─────────────────────────────────────────
test('entity: rls.create is false (no direct client creation)', () => {
  assert.strictEqual(entitySchema.rls.create, false);
});

test('entity: rls.read is admin-only', () => {
  assert.deepStrictEqual(entitySchema.rls.read, { user_condition: { role: 'admin' } });
});

test('entity: rls.update is admin-only', () => {
  assert.deepStrictEqual(entitySchema.rls.update, { user_condition: { role: 'admin' } });
});

test('entity: rls.delete is admin-only', () => {
  assert.deepStrictEqual(entitySchema.rls.delete, { user_condition: { role: 'admin' } });
});

// ── 2. Entity: no user_email or user_name ──────────────────────────────────
test('entity: user_email field removed', () => {
  assert.ok(!('user_email' in entitySchema.properties), 'user_email must not exist');
});

test('entity: user_name field removed', () => {
  assert.ok(!('user_name' in entitySchema.properties), 'user_name must not exist');
});

// ── 3. Entity: submitter_user_id is required ───────────────────────────────
test('entity: submitter_user_id exists', () => {
  assert.ok('submitter_user_id' in entitySchema.properties);
  assert.strictEqual(entitySchema.properties.submitter_user_id.type, 'string');
});

test('entity: submitter_user_id is in required array', () => {
  assert.ok(entitySchema.required.includes('submitter_user_id'));
});

// ── 4. Entity: maxLength constraints ───────────────────────────────────────
test('entity: page.maxLength = 500', () => {
  assert.strictEqual(entitySchema.properties.page.maxLength, 500);
});

test('entity: message.maxLength = 2000', () => {
  assert.strictEqual(entitySchema.properties.message.maxLength, 2000);
});

test('entity: screenshot_url.maxLength = 2048', () => {
  assert.strictEqual(entitySchema.properties.screenshot_url.maxLength, 2048);
});

// ── 5. Function: derives submitter_user_id from user.id only ───────────────
test('function: derives submitter_user_id from user.id', () => {
  assert.ok(fnSource.includes('submitter_user_id: user.id'),
    'must set submitter_user_id from user.id');
});

test('function: does not read body.submitter_user_id', () => {
  // Must not extract submitter_user_id from body
  assert.ok(!fnSource.match(/body\.submitter_user_id/),
    'must not read body.submitter_user_id');
});

test('function: does not read body.user_email', () => {
  assert.ok(!fnSource.match(/body\.user_email/), 'must not read body.user_email');
});

test('function: does not read body.user_name', () => {
  assert.ok(!fnSource.match(/body\.user_name/), 'must not read body.user_name');
});

test('function: does not read body.created_by_id', () => {
  assert.ok(!fnSource.match(/body\.created_by_id/), 'must not read body.created_by_id');
});

// ── 6. Function: uses asServiceRole ────────────────────────────────────────
test('function: cooldown lookup uses asServiceRole', () => {
  assert.ok(fnSource.includes('base44.asServiceRole.entities.BetaFeedbackEvent.filter'),
    'cooldown must use asServiceRole');
});

test('function: create uses asServiceRole', () => {
  assert.ok(fnSource.includes('base44.asServiceRole.entities.BetaFeedbackEvent.create'),
    'create must use asServiceRole');
});

test('function: cooldown filters by submitter_user_id', () => {
  assert.ok(fnSource.includes('{ submitter_user_id: user.id }'),
    'cooldown must filter by submitter_user_id');
});

// ── 7. Function: returns { status, id } ────────────────────────────────────
test('function: returns { status: "submitted", id }', () => {
  assert.ok(fnSource.includes('{ status: \'submitted\', id:'),
    'must return { status: "submitted", id }');
});

// ── 8. Function: does not log raw exceptions ────────────────────────────────
test('function: does not log raw exceptions', () => {
  assert.ok(!fnSource.match(/console\.(log|error|warn)\(.*error/i),
    'must not log raw exceptions');
  assert.ok(fnSource.includes('internal_error'), 'must return generic internal_error');
});

// ── 9. Function: honesty comment about best-effort cooldown ────────────────
test('function: documents best-effort cooldown honestly', () => {
  assert.ok(fnSource.includes('best-effort') || fnSource.includes('best_effort'),
    'must document cooldown as best-effort');
  // Must not CLAIM atomic rate limiting — "atomic rate limit" may appear only
  // in a negation ("NOT an atomic rate limit"), never as a positive claim.
  const atomicClaims = fnSource.match(/is\s+(?:an\s+)?atomic\s+rate\s+limit/gi) || [];
  const atomicNegations = fnSource.match(/not\s+(?:an?\s+)?atomic\s+rate\s+limit/gi) || [];
  assert.ok(atomicClaims.length === 0 || atomicNegations.length >= atomicClaims.length,
    'must not claim atomic rate limiting (only negate it)');
});

// ── Run all tests ─────────────────────────────────────────────────────────
for (const { name, fn } of tests) {
  try { fn(); console.log(`  PASS: ${name}`); passed++; }
  catch (e) { console.error(`  FAIL: ${name} — ${e.message}`); failed++; }
}

console.log('');
console.log(`  Total: ${passed} passed, ${failed} failed`);
if (failed === 0) { console.log('  ✅ ALL PASSED'); process.exit(0); }
else { console.log('  ❌ FAILURES'); process.exit(1); }