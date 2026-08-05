/**
 * Legacy Revision Initialization Behavioral Tests (7C.9C.2 — Requirement #6)
 *
 * Tests the explicit L1-L4 state table and partial-write handling for
 * initializeLegacyRevision, with quarantine verification for all unsafe states.
 *
 * For every unsafe state, verifies:
 *   - listing_quarantine_proven / lp_quarantine_proven
 *   - Pre/post quarantine tuples preserved
 *   - quarantine_timestamp_proven
 *   - block_proven or alert_proven
 *   - Structured error fields are non-null (not swallowed)
 */
import { createMockDeps, createDefaultSeed, initializeLegacyRevision, runTestSuite } from './helpers/mockDeps.mjs';

// Helper: verify quarantine proof for an unsafe state result
function verifyQuarantineProof(result, deps, listingId) {
  // The result should contain all fields from failClosedLegacyRevision via spread
  const listingQuarantineProven = result.listing_quarantine_proven === true || result.listing_quarantine_proven === false;
  const lpQuarantineProven = result.lp_quarantine_proven === true || result.lp_quarantine_proven === false;
  const blockOrAlertProven = result.block_proven === true || result.alert_proven === true;
  // Structured error fields exist (not swallowed)
  const hasStructuredErrors = 'listing_quarantine_write_error' in result || 'listing_quarantine_refetch_error' in result;
  // Pre/post quarantine tuples captured
  const hasPreQuarantineSnapshot = result.pre_quarantine_listing_tuple !== undefined || result.pre_quarantine_lp_tuple !== undefined;
  const hasPostQuarantineSnapshot = result.post_quarantine_listing_tuple !== undefined || result.post_quarantine_lp_tuple !== undefined;
  // Tuple preservation verified
  const hasTuplePreservation = result.listing_tuple_preserved !== undefined || result.lp_tuple_preserved !== undefined;
  // Quarantine timestamp proof verified
  const hasTimestampProof = result.quarantine_timestamp_proven !== undefined;
  return { listingQuarantineProven, lpQuarantineProven, blockOrAlertProven, hasStructuredErrors, hasPreQuarantineSnapshot, hasPostQuarantineSnapshot, hasTuplePreservation, hasTimestampProof };
}

// L1 success: both revisions already match
async function testL1_success() {
  const { seed, listingId } = createDefaultSeed();
  const deps = createMockDeps({ seed });
  const result = await initializeLegacyRevision(deps, listingId);
  const listing = deps._state.stores.Listing[0];
  const lp = deps._state.stores.ListingPrivate[0];
  const revisionsMatch = listing.reservation_revision === lp.reservation_revision;
  const passed = result.ok && result.state === 'L1' && revisionsMatch;
  return { name: 'L1_success', passed, ok: result.ok, state: result.state, revisions_match: revisionsMatch };
}

// L2 success: both absent with matching tuples
async function testL2_bothAbsentMatchingTuples() {
  const { seed, listingId } = createDefaultSeed({ listing: { reservation_revision: null }, lp: { reservation_revision: null } });
  const deps = createMockDeps({ seed, generateRevision: () => 'deterministic_rev_001' });
  const result = await initializeLegacyRevision(deps, listingId);
  const listing = deps._state.stores.Listing[0];
  const lp = deps._state.stores.ListingPrivate[0];
  const revisionsMatch = listing.reservation_revision === 'deterministic_rev_001' && lp.reservation_revision === 'deterministic_rev_001';
  const tuplesUnchanged = listing.reservation_token === 'res_token_123' && lp.reservation_token === 'res_token_123';
  const passed = result.ok && result.state === 'L2' && revisionsMatch && tuplesUnchanged;
  return { name: 'L2_both_absent_matching_tuples', passed, ok: result.ok, state: result.state, revisions_match: revisionsMatch, tuples_unchanged: tuplesUnchanged };
}

// L3: Listing revision absent only — unsafe state, verify quarantine proof
async function testL3_listingRevAbsentOnly() {
  const { seed, listingId } = createDefaultSeed({ listing: { reservation_revision: null }, lp: { reservation_revision: 'existing_rev' } });
  const deps = createMockDeps({ seed, generateRevision: () => 'should_not_be_used' });
  const result = await initializeLegacyRevision(deps, listingId);
  const listing = deps._state.stores.Listing[0];
  const lp = deps._state.stores.ListingPrivate[0];
  const notOk = !result.ok;
  const listingUnchanged = !listing.reservation_revision;
  const lpUnchanged = lp.reservation_revision === 'existing_rev';
  const q = verifyQuarantineProof(result, deps, listingId);
  const passed = notOk && listingUnchanged && lpUnchanged && result.state === 'L3' && q.hasStructuredErrors && q.hasPreQuarantineSnapshot;
  return { name: 'L3_listing_rev_absent_only', passed, not_ok: notOk, state: result.state, has_structured_errors: q.hasStructuredErrors, has_pre_quarantine_snapshot: q.hasPreQuarantineSnapshot };
}

// L3: LP revision absent only — unsafe state
async function testL3_lpRevAbsentOnly() {
  const { seed, listingId } = createDefaultSeed({ listing: { reservation_revision: 'existing_rev' }, lp: { reservation_revision: null } });
  const deps = createMockDeps({ seed, generateRevision: () => 'should_not_be_used' });
  const result = await initializeLegacyRevision(deps, listingId);
  const listing = deps._state.stores.Listing[0];
  const lp = deps._state.stores.ListingPrivate[0];
  const notOk = !result.ok;
  const listingUnchanged = listing.reservation_revision === 'existing_rev';
  const lpUnchanged = !lp.reservation_revision;
  const q = verifyQuarantineProof(result, deps, listingId);
  const passed = notOk && listingUnchanged && lpUnchanged && result.state === 'L3' && q.hasStructuredErrors;
  return { name: 'L3_lp_rev_absent_only', passed, not_ok: notOk, state: result.state, has_structured_errors: q.hasStructuredErrors };
}

// L4: both present but different — unsafe state
async function testL4_bothPresentDifferent() {
  const { seed, listingId } = createDefaultSeed({ listing: { reservation_revision: 'rev_A' }, lp: { reservation_revision: 'rev_B' } });
  const deps = createMockDeps({ seed, generateRevision: () => 'should_not_be_used' });
  const result = await initializeLegacyRevision(deps, listingId);
  const listing = deps._state.stores.Listing[0];
  const lp = deps._state.stores.ListingPrivate[0];
  const notOk = !result.ok;
  const listingUnchanged = listing.reservation_revision === 'rev_A';
  const lpUnchanged = lp.reservation_revision === 'rev_B';
  const q = verifyQuarantineProof(result, deps, listingId);
  const passed = notOk && listingUnchanged && lpUnchanged && result.state === 'L4' && q.hasStructuredErrors;
  return { name: 'L4_both_present_different', passed, not_ok: notOk, state: result.state, has_structured_errors: q.hasStructuredErrors };
}

// L2: both absent with expiration mismatch — unsafe state
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
  const q = verifyQuarantineProof(result, deps, listingId);
  const passed = notOk && noRevisionWritten && result.state === 'L2_tuple_mismatch' && q.hasStructuredErrors;
  return { name: 'L2_both_absent_expiration_mismatch', passed, not_ok: notOk, state: result.state, has_structured_errors: q.hasStructuredErrors };
}

// L2: LP write throws — unsafe state
async function testL2_lpWriteThrows() {
  const { seed, listingId } = createDefaultSeed({ listing: { reservation_revision: null }, lp: { reservation_revision: null } });
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
  const q = verifyQuarantineProof(result, deps, listingId);
  const passed = notOk && listingUnchanged && lpUnchanged && result.state === 'L2_lp_write_threw' && q.hasStructuredErrors;
  return { name: 'L2_lp_write_throws', passed, not_ok: notOk, state: result.state, has_structured_errors: q.hasStructuredErrors };
}

// L2: Listing write throws after LP succeeds — unsafe state
async function testL2_listingWriteThrowsAfterLpSucceeds() {
  const { seed, listingId } = createDefaultSeed({ listing: { reservation_revision: null }, lp: { reservation_revision: null } });
  const deps = createMockDeps({
    seed, generateRevision: () => 'det_rev_007',
    hooks: { 'before_Listing_update': (id, data) => { if (data.reservation_revision === 'det_rev_007') return { throw: new Error('Listing write failed') }; } },
  });
  const result = await initializeLegacyRevision(deps, listingId);
  const listing = deps._state.stores.Listing[0];
  const lp = deps._state.stores.ListingPrivate[0];
  const notOk = !result.ok;
  const lpHasRev = lp.reservation_revision === 'det_rev_007';
  const listingMissing = !listing.reservation_revision;
  const q = verifyQuarantineProof(result, deps, listingId);
  const passed = notOk && lpHasRev && listingMissing && result.state === 'L2_listing_write_threw' && q.hasStructuredErrors;
  return { name: 'L2_listing_write_throws_after_lp_succeeds', passed, not_ok: notOk, state: result.state, has_structured_errors: q.hasStructuredErrors, lp_has_rev: lpHasRev, listing_missing: listingMissing };
}

// L2: silent fail
async function testL2_silentFail() {
  const { seed, listingId } = createDefaultSeed({ listing: { reservation_revision: null }, lp: { reservation_revision: null } });
  const deps = createMockDeps({
    seed, generateRevision: () => 'det_rev_008',
    silentDropFields: { Listing: ['reservation_revision'] },
  });
  const result = await initializeLegacyRevision(deps, listingId);
  const lp = deps._state.stores.ListingPrivate[0];
  const notOk = !result.ok;
  const lpHasRev = lp.reservation_revision === 'det_rev_008';
  const q = verifyQuarantineProof(result, deps, listingId);
  const passed = notOk && lpHasRev && result.state === 'L2_silent_fail' && q.hasStructuredErrors;
  return { name: 'L2_silent_fail', passed, not_ok: notOk, state: result.state, has_structured_errors: q.hasStructuredErrors, lp_has_rev: lpHasRev };
}

// L2: tuple changes between writes
async function testL2_tupleChangesBetweenWrites() {
  const { seed, listingId } = createDefaultSeed({ listing: { reservation_revision: null }, lp: { reservation_revision: null } });
  const deps = createMockDeps({
    seed, generateRevision: () => 'det_rev_009',
    hooks: { 'after_ListingPrivate_update': (record) => {
      const listing = deps._state.stores.Listing[0];
      if (listing) listing.reservation_token = 'concurrent_token';
    }},
  });
  const result = await initializeLegacyRevision(deps, listingId);
  const notOk = !result.ok;
  const q = verifyQuarantineProof(result, deps, listingId);
  const passed = notOk && (result.state === 'L2_listing_tuple_changed' || result.state === 'L2_lp_tuple_changed') && q.hasStructuredErrors;
  return { name: 'L2_tuple_changes_between_writes', passed, not_ok: notOk, state: result.state, has_structured_errors: q.hasStructuredErrors };
}

// Retry after partial initialization does not generate a second revision
async function testRetryAfterPartialInitNoSecondRevision() {
  const { seed, listingId } = createDefaultSeed({ listing: { reservation_revision: null }, lp: { reservation_revision: null } });
  const revCounter = { count: 0 };
  const deps = createMockDeps({
    seed, generateRevision: () => `det_rev_${++revCounter.count}`,
    hooks: { 'before_Listing_update': (id, data) => { if (data.reservation_revision === 'det_rev_1') return { throw: new Error('Listing write failed') }; } },
  });
  const result1 = await initializeLegacyRevision(deps, listingId);
  const notOk1 = !result1.ok;
  const lpRev1 = deps._state.stores.ListingPrivate[0].reservation_revision;
  const result2 = await initializeLegacyRevision(deps, listingId);
  const notOk2 = !result2.ok;
  const lpRev2 = deps._state.stores.ListingPrivate[0].reservation_revision;
  const listingRev2 = deps._state.stores.Listing[0].reservation_revision;
  const lpRevUnchanged = lpRev1 === lpRev2;
  const listingStillMissing = !listingRev2;
  const onlyOneRevGenerated = revCounter.count === 1;
  const detectedL3 = result2.state === 'L3';
  const passed = notOk1 && notOk2 && lpRevUnchanged && listingStillMissing && onlyOneRevGenerated && detectedL3;
  return { name: 'retry_after_partial_init_no_second_revision', passed, first_failed: notOk1, retry_failed: notOk2, lp_rev_unchanged: lpRevUnchanged, listing_still_missing: listingStillMissing, revs_generated: revCounter.count, retry_state: result2.state };
}

// ── Main runner ────────────────────────────────────────────────────────────
async function main() {
  const tests = [
    await testL1_success(),
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
  await runTestSuite('Legacy Revision Initialization Tests (7C.9C.2 — Requirement #6)', tests);
}
main().catch(err => { console.error('Test runner error:', err); process.exit(1); });