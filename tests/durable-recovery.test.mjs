/**
 * Durable Block and Alert Behavioral Tests (7C.9C.2)
 *
 * 11 independent tests covering complete verification of
 * recovery_blocked fields and AdminAlert fields in durableBlockAndAlert.
 */
import { createMockDeps, createDefaultSeed, durableBlockAndAlert, runTestSuite } from './helpers/mockDeps.mjs';

async function runCase(name, config, expectations) {
  const { seed, listingId } = createDefaultSeed();
  const deps = createMockDeps({ seed, ...config });
  const result = await durableBlockAndAlert(deps, listingId, 'Test reason for blocking', 'pi_test_123', 'Test Alert Title');
  const passed = expectations(result, deps);
  return { name, passed, block_attempted: result.block_attempted, block_proven: result.block_proven, alert_attempted: result.alert_attempted, alert_proven: result.alert_proven, block_error: result.block_error, alert_error: result.alert_error };
}

// 1. Block write throws
async function testBlockWriteThrows() {
  return runCase('block_write_throws', {
    hooks: { 'before_ListingPrivate_update': (id, data) => {
      if (data.recovery_blocked === true) return { throw: new Error('Block write failed') };
    }},
  }, (result) => !result.block_proven && result.block_error !== null);
}

// 2. Block write silently loses recovery_blocked
async function testBlockSilentlyLosesRecoveryBlocked() {
  return runCase('block_silently_loses_recovery_blocked', {
    silentDropFields: { ListingPrivate: ['recovery_blocked'] },
  }, (result) => !result.block_proven && result.block_error !== null);
}

// 3. Block reason silently fails
async function testBlockReasonSilentlyFails() {
  return runCase('block_reason_silently_fails', {
    silentDropFields: { ListingPrivate: ['recovery_blocked_reason'] },
  }, (result) => !result.block_proven && result.block_error !== null);
}

// 4. Block timestamp silently fails
async function testBlockTimestampSilentlyFails() {
  return runCase('block_timestamp_silently_fails', {
    silentDropFields: { ListingPrivate: ['recovery_blocked_at'] },
  }, (result) => !result.block_proven && result.block_error !== null);
}

// 5. Alert create throws
async function testAlertCreateThrows() {
  return runCase('alert_create_throws', {
    hooks: { 'before_AdminAlert_create': () => ({ throw: new Error('Alert create failed') }) },
  }, (result) => !result.alert_proven && result.alert_error !== null);
}

// 6. Alert re-query throws
async function testAlertReQueryThrows() {
  return runCase('alert_requery_throws', {
    filterHooks: { AdminAlert: () => 'THROW' },
  }, (result) => !result.alert_proven && result.alert_error !== null);
}

// 7. Alert record has incorrect priority/reference/content
async function testAlertIncorrectFields() {
  return runCase('alert_incorrect_fields', {
    hooks: { 'after_AdminAlert_create': (record) => {
      record.priority = 'low';
      record.reference_id = 'wrong_listing';
      record.title = 'Wrong Title';
    }},
  }, (result) => !result.alert_proven && result.alert_error !== null);
}

// 8. Both mechanisms fail
async function testBothMechanismsFail() {
  return runCase('both_mechanisms_fail', {
    hooks: {
      'before_ListingPrivate_update': (id, data) => {
        if (data.recovery_blocked === true) return { throw: new Error('Block failed') };
      },
      'before_AdminAlert_create': () => ({ throw: new Error('Alert failed') }),
    },
  }, (result) => !result.block_proven && !result.alert_proven);
}

// 9. Only block succeeds
async function testOnlyBlockSucceeds() {
  return runCase('only_block_succeeds', {
    hooks: { 'before_AdminAlert_create': () => ({ throw: new Error('Alert failed') }) },
  }, (result) => result.block_proven && !result.alert_proven);
}

// 10. Only alert succeeds
async function testOnlyAlertSucceeds() {
  return runCase('only_alert_succeeds', {
    hooks: { 'before_ListingPrivate_update': (id, data) => {
      if (data.recovery_blocked === true) return { throw: new Error('Block failed') };
    }},
  }, (result) => !result.block_proven && result.alert_proven);
}

// 11. Both succeed
async function testBothSucceed() {
  return runCase('both_succeed', {}, (result) => result.block_proven && result.alert_proven);
}

// ── Main runner ────────────────────────────────────────────────────────────
async function main() {
  const tests = [
    await testBlockWriteThrows(),
    await testBlockSilentlyLosesRecoveryBlocked(),
    await testBlockReasonSilentlyFails(),
    await testBlockTimestampSilentlyFails(),
    await testAlertCreateThrows(),
    await testAlertReQueryThrows(),
    await testAlertIncorrectFields(),
    await testBothMechanismsFail(),
    await testOnlyBlockSucceeds(),
    await testOnlyAlertSucceeds(),
    await testBothSucceed(),
  ];
  await runTestSuite('Durable Block and Alert Tests (7C.9C.2)', tests);
}
main().catch(err => { console.error('Test runner error:', err); process.exit(1); });