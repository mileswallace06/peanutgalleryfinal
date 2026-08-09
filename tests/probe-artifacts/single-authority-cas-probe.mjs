/**
 * Live Single-Authority CAS Probe — Reproducible Artifact (7C.9C.2E Task 1)
 *
 * This is the EXACT source run via exec_tool against the live Base44 datastore.
 * It uses synthetic ListingPrivate (authoritative) + Listing (mirror) records only.
 * Zero Stripe, email, push, points, notification, or real-production mutations.
 *
 * This file is a reference artifact. It requires the `base44` global (available
 * in exec_tool) and cannot be run in normal Node.js. The raw JSON results are
 * saved alongside this file in single-authority-cas-probe-results.json.
 *
 * SDK version: @base44/sdk ^0.8.41
 *
 * Scenarios:
 *   1. 10 rounds × 20 concurrent different-operation reserves (different op_ids)
 *   2. 20 concurrent identical retries (same op_id, identical payload)
 *   3. 20 concurrent same op_id with conflicting payloads
 *   4. Old operation retry after a later transition
 *
 * Every call's `updated` value is captured. Before/after entity counts and
 * cleanup results are recorded.
 */
const PROBE_TAG = `PROBE-AUTH-${Date.now()}`;
const ROUNDS = 10;
const CONCURRENT = 20;

// ── 0. Capture before counts ──────────────────────────────────────────────
const lpBefore = await base44.asServiceRole.entities.ListingPrivate.list('-created_date', 10000);
const listingBefore = await base44.asServiceRole.entities.Listing.list('-created_date', 10000);
const lpBeforeCount = lpBefore.length;
const listingBeforeCount = listingBefore.length;

// ── 1. Create synthetic authoritative ListingPrivate record ──────────────
const lp = await base44.entities.ListingPrivate.create({
  listing_id: `${PROBE_TAG}-auth`,
  reservation_version: 0,
  reservation_lifecycle_state: 'available',
  reservation_revision: 'rev_initial',
  checkout_quarantined: false,
  recovery_blocked: false,
  reservation_token: null,
  reserved_by_email: null,
  reservation_expires_at: null,
  last_operation_id: null,
  last_operation_type: null,
  last_operation_payload_hash: null,
  last_operation_result_json: null,
  last_operation_at: null,
  pending_effects_json: '[]',
  is_demo_listing: true,
  notes: `${PROBE_TAG} authoritative`,
});
const lpId = lp.id;

// ── 2. Create synthetic mirror Listing record ────────────────────────────
const listing = await base44.entities.Listing.create({
  event_id: `${PROBE_TAG}-event`,
  section: 'PROBE',
  row: 'P',
  asking_price: 1,
  seller_email: 'probe@test',
  reservation_version: 0,
  reservation_revision: 'rev_initial',
  status: 'active',
  reservation_token: null,
  reserved_by_email: null,
  reservation_expires_at: null,
  is_demo_listing: true,
  notes: `${PROBE_TAG} mirror`,
});
const listingId = listing.id;

// ── 3. Helper: reset LP to initial state ──────────────────────────────────
async function resetLP() {
  await base44.asServiceRole.entities.ListingPrivate.updateMany(
    { id: lpId },
    { $set: {
      reservation_version: 0,
      reservation_lifecycle_state: 'available',
      reservation_revision: 'rev_initial',
      checkout_quarantined: false,
      recovery_blocked: false,
      reservation_token: null,
      reserved_by_email: null,
      reservation_expires_at: null,
      last_operation_id: null,
      last_operation_type: null,
      last_operation_payload_hash: null,
      last_operation_result_json: null,
      last_operation_at: null,
      pending_effects_json: '[]',
    }}
  );
}

// ── Scenario 1: 10 rounds × 20 concurrent different-operation reserves ────
const scenario1 = { rounds: [], all_one_winner: true };
for (let round = 0; round < ROUNDS; round++) {
  await resetLP();
  const calls = await Promise.all(
    Array.from({ length: CONCURRENT }, (_, i) =>
      base44.asServiceRole.entities.ListingPrivate.updateMany(
        { id: lpId, reservation_version: 0, checkout_quarantined: false, recovery_blocked: false },
        { $set: {
          reservation_token: `token_s1_r${round}_i${i}`,
          reserved_by_email: `buyer_s1_r${round}_i${i}@probe`,
          reservation_expires_at: new Date(Date.now() + 600000).toISOString(),
          reservation_version: 1,
          reservation_revision: `rev_s1_r${round}_i${i}`,
          reservation_lifecycle_state: 'reserved',
          last_operation_id: `op_s1_r${round}_i${i}`,
          last_operation_type: 'reserve',
          last_operation_payload_hash: `hash_s1_r${round}_i${i}`,
          last_operation_result_json: JSON.stringify({ op: `op_s1_r${round}_i${i}`, state: 'reserved' }),
          last_operation_at: new Date(Date.now()).toISOString(),
          pending_effects_json: '[]',
        }}
      ).then(r => ({ i, updated: r.updated || 0 }))
       .catch(e => ({ i, updated: 0, error: e?.message }))
    )
  );
  const winners = calls.filter(c => c.updated > 0);
  scenario1.rounds.push({
    round,
    winner_count: winners.length,
    winner_index: winners[0]?.i ?? null,
    all_updated_values: calls.map(c => c.updated),
  });
  if (winners.length !== 1) {
    scenario1.all_one_winner = false;
    break;
  }
}

// ── Scenario 2: 20 concurrent identical retries (same op_id, same payload) ─
await resetLP();
const scenario2calls = await Promise.all(
  Array.from({ length: CONCURRENT }, (_, i) =>
    base44.asServiceRole.entities.ListingPrivate.updateMany(
      { id: lpId, reservation_version: 0, checkout_quarantined: false, recovery_blocked: false },
      { $set: {
        reservation_token: 'token_s2_idem',
        reserved_by_email: 'buyer_s2@probe',
        reservation_expires_at: new Date(Date.now() + 600000).toISOString(),
        reservation_version: 1,
        reservation_revision: 'rev_s2_idem',
        reservation_lifecycle_state: 'reserved',
        last_operation_id: 'op_s2_idem',
        last_operation_type: 'reserve',
        last_operation_payload_hash: 'hash_s2_idem',
        last_operation_result_json: JSON.stringify({ op: 'op_s2_idem', state: 'reserved' }),
        last_operation_at: new Date(Date.now()).toISOString(),
        pending_effects_json: '[]',
      }}
    ).then(r => ({ i, updated: r.updated || 0 }))
     .catch(e => ({ i, updated: 0, error: e?.message }))
  )
);
const [lpAfterS2] = await base44.asServiceRole.entities.ListingPrivate.filter({ id: lpId }, '-created_date', 10);
const scenario2 = {
  all_updated_values: scenario2calls.map(c => c.updated),
  winner_count: scenario2calls.filter(c => c.updated > 0).length,
  final_version: lpAfterS2?.reservation_version,
  final_operation_id: lpAfterS2?.last_operation_id,
  final_token: lpAfterS2?.reservation_token,
};

// ── Scenario 3: 20 concurrent same op_id with conflicting payloads ─────────
await resetLP();
const scenario3calls = await Promise.all(
  Array.from({ length: CONCURRENT }, (_, i) =>
    base44.asServiceRole.entities.ListingPrivate.updateMany(
      { id: lpId, reservation_version: 0, checkout_quarantined: false, recovery_blocked: false },
      { $set: {
        reservation_token: `token_s3_conflict_i${i}`,
        reserved_by_email: `buyer_s3_i${i}@probe`,
        reservation_expires_at: new Date(Date.now() + 600000).toISOString(),
        reservation_version: 1,
        reservation_revision: `rev_s3_conflict`,
        reservation_lifecycle_state: 'reserved',
        last_operation_id: 'op_s3_same',
        last_operation_type: 'reserve',
        last_operation_payload_hash: `hash_s3_i${i}`,
        last_operation_result_json: JSON.stringify({ op: 'op_s3_same', i }),
        last_operation_at: new Date(Date.now()).toISOString(),
        pending_effects_json: '[]',
      }}
    ).then(r => ({ i, updated: r.updated || 0 }))
     .catch(e => ({ i, updated: 0, error: e?.message }))
  )
);
const [lpAfterS3] = await base44.asServiceRole.entities.ListingPrivate.filter({ id: lpId }, '-created_date', 10);
const scenario3 = {
  all_updated_values: scenario3calls.map(c => c.updated),
  winner_count: scenario3calls.filter(c => c.updated > 0).length,
  winner_index: scenario3calls.find(c => c.updated > 0)?.i ?? null,
  final_version: lpAfterS3?.reservation_version,
  final_operation_id: lpAfterS3?.last_operation_id,
  final_token: lpAfterS3?.reservation_token,
  final_payload_hash: lpAfterS3?.last_operation_payload_hash,
};

// ── Scenario 4: Old operation retry after a later transition ──────────────
await resetLP();
// Step A: CAS v0 → v1 (op_A wins)
await base44.asServiceRole.entities.ListingPrivate.updateMany(
  { id: lpId, reservation_version: 0, checkout_quarantined: false, recovery_blocked: false },
  { $set: {
    reservation_token: 'token_s4_A', reserved_by_email: 'buyer_A@probe',
    reservation_expires_at: new Date(Date.now() + 600000).toISOString(),
    reservation_version: 1, reservation_revision: 'rev_s4_A',
    reservation_lifecycle_state: 'reserved',
    last_operation_id: 'op_s4_A', last_operation_type: 'reserve',
    last_operation_payload_hash: 'hash_s4_A',
    last_operation_result_json: JSON.stringify({ op: 'op_s4_A', v: 1 }),
    last_operation_at: new Date(Date.now()).toISOString(),
    pending_effects_json: '[]',
  }}
);
// Step B: CAS v1 → v2 (op_B wins)
await base44.asServiceRole.entities.ListingPrivate.updateMany(
  { id: lpId, reservation_version: 1, checkout_quarantined: false, recovery_blocked: false },
  { $set: {
    reservation_token: 'token_s4_B', reserved_by_email: 'buyer_B@probe',
    reservation_expires_at: new Date(Date.now() + 600000).toISOString(),
    reservation_version: 2, reservation_revision: 'rev_s4_B',
    reservation_lifecycle_state: 'frozen',
    last_operation_id: 'op_s4_B', last_operation_type: 'freeze',
    last_operation_payload_hash: 'hash_s4_B',
    last_operation_result_json: JSON.stringify({ op: 'op_s4_B', v: 2 }),
    last_operation_at: new Date(Date.now()).toISOString(),
    pending_effects_json: '[]',
  }}
);
// Step C: Old retry — CAS v0 → v1 (op_A retries, but current is v2)
let oldRetryResult;
try {
  oldRetryResult = await base44.asServiceRole.entities.ListingPrivate.updateMany(
    { id: lpId, reservation_version: 0, checkout_quarantined: false, recovery_blocked: false },
    { $set: {
      reservation_token: 'token_s4_A_retry', reserved_by_email: 'buyer_A_retry@probe',
      reservation_expires_at: new Date(Date.now() + 600000).toISOString(),
      reservation_version: 1, reservation_revision: 'rev_s4_A_retry',
      reservation_lifecycle_state: 'reserved',
      last_operation_id: 'op_s4_A', last_operation_type: 'reserve',
      last_operation_payload_hash: 'hash_s4_A',
      last_operation_result_json: JSON.stringify({ op: 'op_s4_A', v: 1, retry: true }),
      last_operation_at: new Date(Date.now()).toISOString(),
      pending_effects_json: '[]',
    }}
  );
} catch (e) {
  oldRetryResult = { updated: 0, error: e?.message };
}
const [lpAfterS4] = await base44.asServiceRole.entities.ListingPrivate.filter({ id: lpId }, '-created_date', 10);
const scenario4 = {
  old_retry_updated: oldRetryResult.updated || 0,
  old_retry_error: oldRetryResult.error || null,
  final_version: lpAfterS4?.reservation_version,
  final_operation_id: lpAfterS4?.last_operation_id,
  final_token: lpAfterS4?.reservation_token,
  old_op_preserved: lpAfterS4?.last_operation_id === 'op_s4_B' && lpAfterS4?.reservation_token === 'token_s4_B',
};

// ── 10. Cleanup ────────────────────────────────────────────────────────────
const cleanupErrors = [];
try { await base44.asServiceRole.entities.ListingPrivate.delete(lpId); } catch(e) { cleanupErrors.push({ id: lpId, error: e?.message }); }
try { await base44.asServiceRole.entities.Listing.delete(listingId); } catch(e) { cleanupErrors.push({ id: listingId, error: e?.message }); }

// ── 11. Capture after counts ───────────────────────────────────────────────
const lpAfter = await base44.asServiceRole.entities.ListingPrivate.list('-created_date', 10000);
const listingAfter = await base44.asServiceRole.entities.Listing.list('-created_date', 10000);

return {
  sdk_version: '@base44/sdk ^0.8.41',
  probe_tag: PROBE_TAG,
  timestamp: new Date(Date.now()).toISOString(),
  synthetic_record_ids: { listing_private: lpId, listing: listingId },
  before_counts: { listing_private: lpBeforeCount, listing: listingBeforeCount },
  after_counts: { listing_private: lpAfter.length, listing: listingAfter.length },
  cleanup: { ok: lpAfter.length === lpBeforeCount && listingAfter.length === listingBeforeCount, errors: cleanupErrors },
  scenario_1_different_op_ids: scenario1,
  scenario_2_identical_op_id_identical_payload: scenario2,
  scenario_3_identical_op_id_conflicting_payload: scenario3,
  scenario_4_old_op_retry_after_later_transition: scenario4,
};