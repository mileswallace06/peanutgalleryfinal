#!/usr/bin/env node
/**
 * canary-scheduled-release-protections.test.mjs
 *
 * Executable tests for the fail-closed protections in canaryScheduledRelease.js.
 * Imports the ACTUAL shared module and uses dependency injection + explicit
 * call counters to verify:
 *   - Active purchase prevents release
 *   - Lookup throw prevents release
 *   - Lookup reject prevents release
 *   - Lookup malformed/unknown data prevents release
 *
 * For each case: authority release call count = 0, mirror mutation count = 0,
 * outbox creation count = 0, result is structured fail-closed/non-success.
 *
 * This is an executable module proof — NOT a deployed runtime proof.
 */
import assert from 'assert';
import { runCanaryScheduledRelease } from '../base44/shared/canaryScheduledRelease.js';

let passed = 0, failed = 0;

async function test(name, fn) {
  try { await fn(); console.log(`  PASS: ${name}`); passed++; }
  catch (e) { console.error(`  FAIL: ${name} — ${e.message}`); failed++; }
}

// ── Mock factory with explicit call counters ──────────────────────────────
function makeMocks({ purchaseFilterBehavior }) {
  const counts = {
    authorityReleaseCalls: 0,
    authorityGetStateCalls: 0,
    authorityVerifyEnvCalls: 0,
    mirrorMutationCalls: 0,
    outboxCreationCalls: 0,
    listingUpdateCalls: 0,
    listingPrivateUpdateCalls: 0,
  };

  const entities = {
    Listing: {
      filter: async () => [{ id: 'test_canary_001', notes: '[AUTH_CANARY] test listing' }],
      update: async () => { counts.listingUpdateCalls++; },
    },
    Purchase: {
      filter: async () => purchaseFilterBehavior(),
    },
    ListingPrivate: {
      filter: async () => [],
      update: async () => { counts.listingPrivateUpdateCalls++; },
    },
    CanaryMirrorOutbox: {
      create: async () => { counts.outboxCreationCalls++; return { id: 'outbox_mock' }; },
    },
  };

  const client = {
    verifyEnvironment: async () => { counts.authorityVerifyEnvCalls++; },
    getState: async () => { counts.authorityGetStateCalls++; return { ok: true, version: 1, lifecycle_state: 'reserved' }; },
    releaseListing: async () => { counts.authorityReleaseCalls++; return { ok: true, version: 2, revision: 'rev' }; },
  };

  const createClientFn = () => client;
  const applyMirrorFn = async () => { counts.mirrorMutationCalls++; return { attempted: true }; };

  return { entities, createClientFn, applyMirrorFn, isCanaryEnabledFn: () => true, counts };
}

function assertFailClosed(result, counts, expectedCode) {
  assert.strictEqual(result.status, 409, `expected 409, got ${result.status}`);
  assert.strictEqual(result.body.code, expectedCode, `expected ${expectedCode}, got ${result.body.code}`);
  assert.notStrictEqual(result.body.ok, true, 'result must be non-success');
  assert.strictEqual(counts.authorityReleaseCalls, 0, 'authority release must not be called');
  assert.strictEqual(counts.authorityGetStateCalls, 0, 'authority getState must not be called');
  assert.strictEqual(counts.mirrorMutationCalls, 0, 'mirror mutation must not happen');
  assert.strictEqual(counts.outboxCreationCalls, 0, 'outbox creation must not happen');
  assert.strictEqual(counts.listingUpdateCalls, 0, 'Listing.update must not be called');
}

console.log('╔══════════════════════════════════════════════════════════════════╗');
console.log('║  canary-scheduled-release-protections.test.mjs                  ║');
console.log('║  Fail-closed protections — executable module tests               ║');
console.log('╚══════════════════════════════════════════════════════════════════╝\n');

// ── Active-purchase case ─────────────────────────────────────────────────
await test('Active purchase prevents release (ACTIVE_PURCHASE)', async () => {
  const m = makeMocks({ purchaseFilterBehavior: async () => [{ id: 'p1', transfer_status: 'pending_transfer' }] });
  const result = await runCanaryScheduledRelease({
    entities: m.entities, executorUrl: 'postgresql://mock', listing_id: 'test_canary_001',
    isCanaryEnabledFn: m.isCanaryEnabledFn, createClientFn: m.createClientFn, applyMirrorFn: m.applyMirrorFn,
  });
  assertFailClosed(result, m.counts, 'ACTIVE_PURCHASE');
});

// ── Lookup throws ────────────────────────────────────────────────────────
await test('Lookup throw prevents release (LOOKUP_UNSAFE)', async () => {
  const m = makeMocks({ purchaseFilterBehavior: async () => { throw new Error('network timeout'); } });
  const result = await runCanaryScheduledRelease({
    entities: m.entities, executorUrl: 'postgresql://mock', listing_id: 'test_canary_001',
    isCanaryEnabledFn: m.isCanaryEnabledFn, createClientFn: m.createClientFn, applyMirrorFn: m.applyMirrorFn,
  });
  assertFailClosed(result, m.counts, 'LOOKUP_UNSAFE');
});

// ── Lookup rejects ────────────────────────────────────────────────────────
await test('Lookup reject prevents release (LOOKUP_UNSAFE)', async () => {
  const m = makeMocks({ purchaseFilterBehavior: async () => Promise.reject(new Error('connection refused')) });
  const result = await runCanaryScheduledRelease({
    entities: m.entities, executorUrl: 'postgresql://mock', listing_id: 'test_canary_001',
    isCanaryEnabledFn: m.isCanaryEnabledFn, createClientFn: m.createClientFn, applyMirrorFn: m.applyMirrorFn,
  });
  assertFailClosed(result, m.counts, 'LOOKUP_UNSAFE');
});

// ── Lookup returns malformed: object ─────────────────────────────────────
await test('Lookup malformed (object) prevents release (LOOKUP_MALFORMED)', async () => {
  const m = makeMocks({ purchaseFilterBehavior: async () => ({ not: 'an array' }) });
  const result = await runCanaryScheduledRelease({
    entities: m.entities, executorUrl: 'postgresql://mock', listing_id: 'test_canary_001',
    isCanaryEnabledFn: m.isCanaryEnabledFn, createClientFn: m.createClientFn, applyMirrorFn: m.applyMirrorFn,
  });
  assertFailClosed(result, m.counts, 'LOOKUP_MALFORMED');
});

// ── Lookup returns malformed: null ────────────────────────────────────────
await test('Lookup malformed (null) prevents release (LOOKUP_MALFORMED)', async () => {
  const m = makeMocks({ purchaseFilterBehavior: async () => null });
  const result = await runCanaryScheduledRelease({
    entities: m.entities, executorUrl: 'postgresql://mock', listing_id: 'test_canary_001',
    isCanaryEnabledFn: m.isCanaryEnabledFn, createClientFn: m.createClientFn, applyMirrorFn: m.applyMirrorFn,
  });
  assertFailClosed(result, m.counts, 'LOOKUP_MALFORMED');
});

// ── Lookup returns malformed: string ──────────────────────────────────────
await test('Lookup malformed (string) prevents release (LOOKUP_MALFORMED)', async () => {
  const m = makeMocks({ purchaseFilterBehavior: async () => 'unexpected string response' });
  const result = await runCanaryScheduledRelease({
    entities: m.entities, executorUrl: 'postgresql://mock', listing_id: 'test_canary_001',
    isCanaryEnabledFn: m.isCanaryEnabledFn, createClientFn: m.createClientFn, applyMirrorFn: m.applyMirrorFn,
  });
  assertFailClosed(result, m.counts, 'LOOKUP_MALFORMED');
});

// ── Sanity: empty array allows release to proceed ─────────────────────────
await test('Empty array allows release to proceed (sanity check)', async () => {
  const m = makeMocks({ purchaseFilterBehavior: async () => [] });
  const result = await runCanaryScheduledRelease({
    entities: m.entities, executorUrl: 'postgresql://mock', listing_id: 'test_canary_001',
    isCanaryEnabledFn: m.isCanaryEnabledFn, createClientFn: m.createClientFn, applyMirrorFn: m.applyMirrorFn,
  });
  assert.strictEqual(result.status, 200, `expected 200, got ${result.status}`);
  assert.strictEqual(result.body.ok, true, 'release should succeed');
  assert.strictEqual(m.counts.authorityReleaseCalls, 1, 'authority release should be called once');
  assert.strictEqual(m.counts.mirrorMutationCalls, 1, 'mirror mutation should happen once');
});

// ── Summary ────────────────────────────────────────────────────────────────
console.log('');
console.log(`  Total: ${passed} passed, ${failed} failed`);
if (failed === 0) { console.log('  ✅ ALL PASSED'); process.exit(0); }
else { console.log('  ❌ FAILURES'); process.exit(1); }