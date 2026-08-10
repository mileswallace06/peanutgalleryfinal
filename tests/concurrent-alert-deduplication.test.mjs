/**
 * Concurrent Alert Deduplication Test (7C.9C.2 — Requirement #6)
 *
 * Proves that durableBlockAndAlert's filter-then-create pattern is
 * SEQUENTIAL IDEMPOTENCY ONLY — NOT CONCURRENTLY ATOMIC.
 *
 * Two concurrent calls with the same incident key both complete the lookup
 * (finding no existing alert), then both proceed to create. The result is
 * two unresolved alerts for the same incident — proving the datastore
 * does not enforce uniqueness on incident_key.
 */
import {
  createMockDeps, createDefaultSeed, runTestSuite,
} from './helpers/mockDeps.mjs';
import { durableBlockAndAlert } from '../base44/shared/orchestratorHelpers.js';

async function testConcurrentAlertDeduplication() {
  const ctx = createDefaultSeed();
  const deps = createMockDeps({ seed: ctx.seed });

  // Two concurrent calls with the SAME incident identity
  const reason = 'Concurrent alert test: same listing, same incident.';
  const piId = 'pi_test_concurrent';
  const purchaseId = ctx.purchaseId;
  const title = 'Concurrent test — listing_1';
  const incidentCategory = 'freeze:conflict';

  // Deferred barrier: both calls pause after lookup, then release together
  let signalA, signalB, releaseBarrier;
  const lookupA = new Promise((resolve) => { signalA = resolve; });
  const lookupB = new Promise((resolve) => { signalB = resolve; });
  const barrier = new Promise((resolve) => { releaseBarrier = resolve; });

  let lookupCount = 0;
  deps.hooks = {
    afterAlertLookup: async () => {
      lookupCount++;
      if (lookupCount === 1) signalA();
      if (lookupCount === 2) signalB();
      await barrier;
    },
  };

  // Start both calls
  const promiseA = durableBlockAndAlert(deps, ctx.listingId, reason, piId, title, purchaseId, incidentCategory);
  const promiseB = durableBlockAndAlert(deps, ctx.listingId, reason, piId, title, purchaseId, incidentCategory);

  // Wait for both lookups to complete
  await Promise.all([lookupA, lookupB]);

  // Release both together
  releaseBarrier();

  // Await both
  const [resultA, resultB] = await Promise.all([promiseA, promiseB]);

  // Count unresolved alerts for this incident
  const unresolved = deps._state.stores.AdminAlert.filter(a =>
    !a.resolved && a.incident_key &&
    a.incident_key.includes(ctx.listingId) &&
    a.incident_key.includes('freeze') &&
    a.incident_key.includes('conflict')
  );

  // JavaScript Array.filter on the raw store array
  const rawUnresolved = deps._state.stores.AdminAlert.filter(a => !a.resolved);

  const exactlyOne = rawUnresolved.length === 1;
  const bothCreated = rawUnresolved.length === 2;
  const bothAlertProven = resultA.alert_proven && resultB.alert_proven;

  // Round 4: This is an EXPECTED_FAILURE / BLOCKER, not a pass.
  // The unsafe behavior (duplicate alerts) is real. Label it honestly.
  const bugProven = !exactlyOne && bothCreated;

  return {
    name: 'concurrent_alert_deduplication',
    passed: false, // BLOCKER — always fails the gate
    verdict: bugProven
      ? 'EXPECTED_FAILURE / BLOCKER: SEQUENTIAL IDEMPOTENCY ONLY — NOT CONCURRENTLY ATOMIC'
      : 'unexpected: exactly one alert created (datastore may have unique constraint)',
    unresolved_alert_count: rawUnresolved.length,
    both_created: bothCreated,
    result_a_alert_proven: resultA.alert_proven,
    result_b_alert_proven: resultB.alert_proven,
    result_a_alert_created: resultA.alert_created,
    result_b_alert_created: resultB.alert_created,
    result_a_deduplicated: resultA.alert_deduplicated,
    result_b_deduplicated: resultB.alert_deduplicated,
    incident_key_a: resultA.incident_key,
    incident_key_b: resultB.incident_key,
    keys_match: resultA.incident_key === resultB.incident_key,
  };
}

// ── Sequential retry control: proves deduplication works when NOT concurrent ──
async function testSequentialAlertDeduplication() {
  const ctx = createDefaultSeed();
  const deps = createMockDeps({ seed: ctx.seed });

  const reason = 'Sequential alert test.';
  const piId = 'pi_test_sequential';
  const purchaseId = ctx.purchaseId;
  const title = 'Sequential test — listing_1';
  const incidentCategory = 'freeze:conflict';

  // No hooks — sequential calls
  deps.hooks = {};

  const resultA = await durableBlockAndAlert(deps, ctx.listingId, reason, piId, title, purchaseId, incidentCategory);
  const resultB = await durableBlockAndAlert(deps, ctx.listingId, reason, piId, title, purchaseId, incidentCategory);

  const rawUnresolved = deps._state.stores.AdminAlert.filter(a => !a.resolved);
  const exactlyOne = rawUnresolved.length === 1;

  return {
    name: 'sequential_alert_deduplication',
    passed: exactlyOne && resultA.alert_created && resultB.alert_deduplicated,
    unresolved_alert_count: rawUnresolved.length,
    first_created: resultA.alert_created,
    second_deduplicated: resultB.alert_deduplicated,
    keys_match: resultA.incident_key === resultB.incident_key,
  };
}

// ── Main runner ────────────────────────────────────────────────────────────
async function main() {
  console.log('=== Concurrent Alert Deduplication Test (7C.9C.2 — Requirement #6) ===\n');
  const tests = [
    await testConcurrentAlertDeduplication(),
    await testSequentialAlertDeduplication(),
  ];
  await runTestSuite('Concurrent Alert Deduplication Test (7C.9C.2 — Requirement #6)', tests);
}
main().catch(err => { console.error('Test runner error:', err); process.exit(1); });