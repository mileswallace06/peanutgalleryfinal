/**
 * Legacy Revision Initialization Behavioral Tests (7C.9C.2)
 *
 * 10 independent tests covering the explicit L1-L4 state table
 * and partial-write handling for initializeLegacyRevision.
 */
import { createMockDeps, createDefaultSeed, initializeLegacyRevision, runTestSuite } from './helpers/mockDeps.mjs';

// L2 success: both revisions absent with matching tuples
async function testL2_bothAbsentMatchingTuples() {
  const { seed, listingId } = createDefaultSeed({
    listing: { reservation_revision: null },
    lp: { reservation_revision: null },
  });
  const deps = createMockDeps({ seed, generateRevision: () => 'deterministic_rev_001' });
  const result = await initializeLegacyRevision(deps, listingId);
  const listing = deps._state.stores.Listing[0];
  const lp = deps._state.stores.ListingPrivate[0];
  const passed = result.ok && result.revision === 'deterministic_rev_001' &&
    listing.reservation_revision === 'deterministic_rev_001' &&
    lp.reservation_revision === 'deterministic_rev_001' &&
    listing.reservation_token === 'res_token_123' && lp.reservation_token === 'res_token_123';
  return { name: 'L2_both_absent_matching_tuples', passed, ok: result.ok, revision: result.revision, state: result.state };
}

// L3: Listing revision absent only
async function testL3_listingRevAbsentOnly() {
  const { seed, listingId } = createDefaultSeed({
    listing: { reservation_revision: null },
    lp: { reservation_revision: 'existing_rev' },
  });
  const deps = createMockDeps({ seed, generateRevision: () => 'should_not_be_used' });
  const result = await initializeLegacyRevision(deps, listingId);
  const listing = deps._state.stores.Listing[0];
  const lp = deps._state.stores.ListingPrivate[0];
  const notOk = !result.ok;
  const listingUnchanged = !listing.reservation_revision;
  const lpUnchanged = lp.reservation_revision === 'existing_rev';
  const passed = notOk && listingUnchanged && lpUnchanged && result.state === 'L3';
  return { name: 'L3_listing_rev_absent_only', passed, not_ok: notOk, state: result.state };
}

// L3: ListingPrivate revision absent only
async function testL3_lpRevAbsentOnly() {
  const { seed, listingId } = createDefaultSeed({
    listing: { reservation_revision: 'existing_rev' },
    lp: { reservation_revision: null },
  });
  const deps = createMockDeps({ seed, generateRevision: () => 'should_not_be_used' });
  const result = await initializeLegacyRevision(deps, listingId);
  const listing = deps._state.stores.Listing[0];
  const lp = deps._state.stores.ListingPrivate[0];
  const notOk = !result.ok;
  const listingUnchanged = listing.reservation_revision === 'existing_rev';
  const lpUnchanged = !lp.reservation_revision;
  const passed = notOk && listingUnchanged && lpUnchanged && result.state === 'L3';
  return { name: 'L3_lp_rev_absent_only', passed, not_ok: notOk, state: result.state };
}

// L4: both revisions present but different
async function testL4_bothPresentDifferent() {
  const { seed, listingId } = createDefaultSeed({
    listing: { reservation_revision: 'rev_A' },
    lp: { reservation_revision: 'rev_B' },
  });
  const deps = createMockDeps({ seed, generateRevision: () => 'should_not_be_used' });
  const result = await initializeLegacyRevision(deps, listingId);
  const listing = deps._state.stores.Listing[0];
  const lp = deps._state.stores.ListingPrivate[0];
  const notOk = !result.ok;
  const listingUnchanged = listing.reservation_revision === 'rev_A';
  const lpUnchanged = lp.reservation_revision === 'rev_B';
  const passed = notOk && listingUnchanged && lpUnchanged && result.state === 'L4';
  return { name: 'L4_both_present_different', passed, not_ok: notOk, state: result.state };
}

// L2: both revisions absent with expiration mismatch
async function testL2_bothAbsentExpirationMismatch() {
  const { seed, listingId } = createDefaultSeed({
    listing: { reservation_revision: null, reservation_expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString() },
    lp: { reservation_revision: null, reservation_expires_at: new Date(Date.now() + 20 * 60 * 1000).toISOString() },
  });
  const deps = createMockDeps({ seed, generateRevision: () => 'should_not_be_used' });
  const result = await initializeLegacyRevision(deps, listingId);
  const listing = deps._state.stores.Listing[0];
  const lp = deps._state.stores.ListingPrivate[0];
  const notOk = !result.ok;
  const noRevisionWritten = !listing.reservation_revision && !lp.reservation_revision;
  const passed = notOk && noRevisionWritten && result.state === 'L2_tuple_mismatch';
  return { name: 'L2_both_absent_expiration_mismatch', passed, not_ok: notOk, state: result.state };
}

// L2: ListingPrivate revision write throws
async function testL2_lpWriteThrows() {
  const { seed, listingId } = createDefaultSeed({
    listing: { reservation_revision: null },
    lp: { reservation_revision: null },
  });
  const deps = createMockDeps({
    seed, generateRevision: () => 'det_rev_006',
    hooks: { 'before_ListingPrivate_update': () => ({ throw: new Error('LP write failed') }) },
  });
  const result = await initializeLegacyRevision(deps, listingId);
  const listing = deps._state.stores.Listing[0];
  const lp = deps._state.stores.ListingPrivate[0];
  const notOk = !result.ok;
  const listingUnchanged = !listing.reservation_revision;
  const lpUnchanged = !lp.reservation_revision;
  const passed = notOk && listingUnchanged && lpUnchanged && result.state === 'L2_lp_write_threw';
  return { name: 'L2_lp_write_throws', passed, not_ok: notOk, state: result.state };
}

// L2: Listing revision write throws after ListingPrivate succeeds
async function testL2_listingWriteThrowsAfterLpSucceeds() {
  const { seed, listingId } = createDefaultSeed({
    listing: { reservation_revision: null },
    lp: { reservation_revision: null },
  });
  const deps = createMockDeps({
    seed, generateRevision: () => 'det_rev_007',
    hooks: { 'before_Listing_update': (id, data) => {
      if (data.reservation_revision === 'det_rev_007') return { throw: new Error('Listing write failed') };
    }},
  });
  const result = await initializeLegacyRevision(deps, listingId);
  const listing = deps._state.stores.Listing[0];
  const lp = deps._state.stores.ListingPrivate[0];
  const notOk = !result.ok;
  // LP has the revision but Listing does not — partial write
  const lpHasRev = lp.reservation_revision === 'det_rev_007';
  const listingMissing = !listing.reservation_revision;
  const passed = notOk && lpHasRev && listingMissing && result.state === 'L2_listing_write_threw';
  return { name: 'L2_listing_write_throws_after_lp_succeeds', passed, not_ok: notOk, state: result.state, lp_has_rev: lpHasRev, listing_missing: listingMissing };
}

// L2: either write silently fails
async function testL2_silentFail() {
  const { seed, listingId } = createDefaultSeed({
    listing: { reservation_revision: null },
    lp: { reservation_revision: null },
  });
  const deps = createMockDeps({
    seed, generateRevision: () => 'det_rev_008',
    silentDropFields: { Listing: ['reservation_revision'] },
  });
  const result = await initializeLegacyRevision(deps, listingId);
  const lp = deps._state.stores.ListingPrivate[0];
  const notOk = !result.ok;
  // LP should have the revision, but Listing should NOT (silently dropped)
  const lpHasRev = lp.reservation_revision === 'det_rev_008';
  const passed = notOk && lpHasRev && result.state === 'L2_silent_fail';
  return { name: 'L2_silent_fail', passed, not_ok: notOk, state: result.state, lp_has_rev: lpHasRev };
}

// L2: tuple changes between the two revision writes
async function testL2_tupleChangesBetweenWrites() {
  const { seed, listingId } = createDefaultSeed({
    listing: { reservation_revision: null },
    lp: { reservation_revision: null },
  });
  const deps = createMockDeps({
    seed, generateRevision: () => 'det_rev_009',
    hooks: { 'after_ListingPrivate_update': (record) => {
      // Simulate concurrent mutation of Listing token between LP write and Listing write
      const listing = deps._state.stores.Listing[0];
      if (listing) listing.reservation_token = 'concurrent_token';
    }},
  });
  const result = await initializeLegacyRevision(deps, listingId);
  const notOk = !result.ok;
  const passed = notOk && (result.state === 'L2_listing_tuple_changed' || result.state === 'L2_lp_tuple_changed');
  return { name: 'L2_tuple_changes_between_writes', passed, not_ok: notOk, state: result.state };
}

// Retry after partial initialization does not generate a second revision
async function testRetryAfterPartialInitNoSecondRevision() {
  const { seed, listingId } = createDefaultSeed({
    listing: { reservation_revision: null },
    lp: { reservation_revision: null },
  });
  const revCounter = { count: 0 };
  const deps = createMockDeps({
    seed, generateRevision: () => `det_rev_${++revCounter.count}`,
    hooks: { 'before_Listing_update': (id, data) => {
      if (data.reservation_revision === 'det_rev_1') return { throw: new Error('Listing write failed') };
    }},
  });
  // First attempt — partial write (LP gets rev, Listing fails)
  const result1 = await initializeLegacyRevision(deps, listingId);
  const notOk1 = !result1.ok;
  const lpRev1 = deps._state.stores.ListingPrivate[0].reservation_revision;

  // Retry — should NOT generate a second revision (LP already has one, Listing doesn't → L3)
  const result2 = await initializeLegacyRevision(deps, listingId);
  const notOk2 = !result2.ok;
  const lpRev2 = deps._state.stores.ListingPrivate[0].reservation_revision;
  const listingRev2 = deps._state.stores.Listing[0].reservation_revision;

  // LP revision should be unchanged (same as after first attempt)
  const lpRevUnchanged = lpRev1 === lpRev2;
  // Listing still has no revision
  const listingStillMissing = !listingRev2;
  // Only one revision was generated
  const onlyOneRevGenerated = revCounter.count === 1;
  // Retry detected L3 (asymmetric revision)
  const detectedL3 = result2.state === 'L3';

  const passed = notOk1 && notOk2 && lpRevUnchanged && listingStillMissing && onlyOneRevGenerated && detectedL3;
  return { name: 'retry_after_partial_init_no_second_revision', passed, first_failed: notOk1, retry_failed: notOk2, lp_rev_unchanged: lpRevUnchanged, listing_still_missing: listingStillMissing, revs_generated: revCounter.count, retry_state: result2.state };
}

// ── Main runner ────────────────────────────────────────────────────────────
async function main() {
  const tests = [
    await testL2_bothAbsentMatchingTuples(),
    await testL3_listingRevAbsentOnly(),
    await testL3_lpRevAbsentOnly(),
    await testL4_bothPresentDifferent(),
    await testL2_bothAbsentExpirationMismatch(),
    await testL2_lpWriteThrows(),
    await testL2_listingWriteThrowsAfterLpSucceeds(),
    await testL2_silentFail(),
    await testL2_tupleChangesBetweenWrites(),
    await testRetryAfterPartialInitNoSecondRevision(),
  ];
  await runTestSuite('Legacy Revision Initialization Tests (7C.9C.2)', tests);
}
main().catch(err => { console.error('Test runner error:', err); process.exit(1); });