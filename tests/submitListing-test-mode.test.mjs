/**
 * submitListing Test-Mode Authorization Tests (Round 6B.2)
 *
 * Verifies:
 * 1. Non-admin + is_test:true → 403 and zero entity writes
 * 2. Non-admin cannot use is_test:true to bypass:
 *    - ended-event validation
 *    - SeatInventory conflict checks
 *    - suspicious-listing review
 *    - duplicate-proof review
 * 3. Admin + is_test:true + maintenance ON → dry-run response with zero writes
 * 4. Admin + is_test:true + maintenance OFF → [TEST] note and is_demo_listing:true
 *    on both Listing and ListingPrivate
 * 5. Admin + is_test:false + maintenance OFF → no test note, is_demo_listing:false
 * 6. No request-supplied identity or role affects authorization
 */
import { authorizeListingCreation, deriveTestModeLabeling } from '../base44/shared/testModeAuth.js';

let passed = 0;
let failed = 0;
const failures = [];
const tests = [];

function check(name, fn) {
  tests.push({ name, fn });
}

// ── Mock entity store for write tracking ────────────────────────────────
function createWriteTrackingMock() {
  const writes = [];
  const entities = {
    Listing: {
      create: async (data) => { writes.push({ entity: 'Listing', method: 'create', data }); return { id: 'mock_listing_1', ...data }; },
      update: async (id, data) => { writes.push({ entity: 'Listing', method: 'update', id, data }); },
      filter: async (q) => { writes.push({ entity: 'Listing', method: 'filter', query: q }); return []; },
    },
    ListingPrivate: {
      create: async (data) => { writes.push({ entity: 'ListingPrivate', method: 'create', data }); return { id: 'mock_lp_1', ...data }; },
      update: async (id, data) => { writes.push({ entity: 'ListingPrivate', method: 'update', id, data }); },
      filter: async (q) => { writes.push({ entity: 'ListingPrivate', method: 'filter', query: q }); return []; },
    },
    SeatInventory: {
      create: async (data) => { writes.push({ entity: 'SeatInventory', method: 'create', data }); return { id: 'mock_si_1', ...data }; },
      update: async (id, data) => { writes.push({ entity: 'SeatInventory', method: 'update', id, data }); },
      filter: async (q) => { writes.push({ entity: 'SeatInventory', method: 'filter', query: q }); return []; },
    },
    ProofAsset: {
      create: async (data) => { writes.push({ entity: 'ProofAsset', method: 'create', data }); return { id: 'mock_pa_1', ...data }; },
      filter: async (q) => { writes.push({ entity: 'ProofAsset', method: 'filter', query: q }); return []; },
    },
    AdminAlert: {
      create: async (data) => { writes.push({ entity: 'AdminAlert', method: 'create', data }); return { id: 'mock_aa_1', ...data }; },
      filter: async (q) => { writes.push({ entity: 'AdminAlert', method: 'filter', query: q }); return []; },
    },
    Notification: {
      create: async (data) => { writes.push({ entity: 'Notification', method: 'create', data }); return { id: 'mock_n_1', ...data }; },
    },
    TransferVerificationLog: {
      create: async (data) => { writes.push({ entity: 'TransferVerificationLog', method: 'create', data }); return { id: 'mock_tvl_1', ...data }; },
    },
    Event: {
      filter: async (q) => { writes.push({ entity: 'Event', method: 'filter', query: q }); return []; },
    },
    User: {
      filter: async (q) => { writes.push({ entity: 'User', method: 'filter', query: q }); return []; },
    },
  };
  return { entities, writes };
}

// ── Simulated submitListing flow ─────────────────────────────────────────
// Mirrors the authorization + labeling logic of submitListing/entry.ts
// without Deno dependencies. Returns { status, body, writes }.
async function simulateSubmitListing(user, body, maintenanceActive, mock) {
  const authResult = authorizeListingCreation(user.role, body, maintenanceActive);
  if (!authResult.authorized) {
    return { status: authResult.status, body: authResult.body, writes: mock.writes };
  }
  const { isTest, isAdmin } = authResult;
  const labeling = deriveTestModeLabeling(isTest);

  // Simulate Listing creation
  const listing = await mock.entities.Listing.create({
    event_id: body.event_id,
    seller_email: user.email,
    section: body.section,
    notes: labeling.notes,
    is_demo_listing: labeling.is_demo_listing,
    status: 'active',
  });

  // Simulate ListingPrivate creation
  await mock.entities.ListingPrivate.create({
    listing_id: listing.id,
    is_demo_listing: labeling.is_demo_listing,
    notes: labeling.notes,
  });

  // Simulate SeatInventory creation (only for non-test)
  if (!isTest) {
    await mock.entities.SeatInventory.create({
      event_id: body.event_id,
      owner_email: user.email,
      linked_listing_id: listing.id,
    });
  }

  // Simulate TransferVerificationLog (fire-and-forget)
  await mock.entities.TransferVerificationLog.create({
    listing_id: listing.id,
    event_id: body.event_id,
  });

  return { status: 200, body: { listing }, writes: mock.writes };
}

// ══════════════════════════════════════════════════════════════════════════
// TEST 1: Non-admin + is_test:true → 403 and zero writes
// ══════════════════════════════════════════════════════════════════════════
check('non_admin_is_test_true_returns_403', () => {
  const result = authorizeListingCreation('user', { is_test: true }, false);
  if (result.authorized !== false) throw new Error('should not be authorized');
  if (result.status !== 403) throw new Error(`status should be 403, got ${result.status}`);
  if (result.body.code !== 'FORBIDDEN') throw new Error('body.code should be FORBIDDEN');
});

check('non_admin_is_test_true_zero_writes', async () => {
  const mock = createWriteTrackingMock();
  const result = await simulateSubmitListing(
    { role: 'user', email: 'fan@test.com' },
    { is_test: true, event_id: 'evt1', section: 'A' },
    false,
    mock
  );
  if (result.status !== 403) throw new Error(`status should be 403, got ${result.status}`);
  if (result.writes.length !== 0) throw new Error(`expected 0 writes, got ${result.writes.length}: ${JSON.stringify(result.writes)}`);
});

// ══════════════════════════════════════════════════════════════════════════
// TEST 2: Non-admin cannot use is_test:true to bypass validation
// ══════════════════════════════════════════════════════════════════════════
check('non_admin_is_test_cannot_bypass_ended_event_validation', () => {
  const result = authorizeListingCreation('user', { is_test: true, event_id: 'ended_event' }, false);
  if (result.authorized !== false) throw new Error('should not be authorized — 403 before validation');
  if (result.status !== 403) throw new Error('should be 403, not reaching validation');
});

check('non_admin_is_test_cannot_bypass_seat_inventory_conflicts', () => {
  const result = authorizeListingCreation('user', { is_test: true, section: 'conflict_section' }, false);
  if (result.authorized !== false) throw new Error('should not be authorized — 403 before SeatInventory check');
  if (result.status !== 403) throw new Error('should be 403, not reaching SeatInventory check');
});

check('non_admin_is_test_cannot_bypass_suspicious_listing_review', () => {
  const result = authorizeListingCreation('user', { is_test: true, asking_price: 9999 }, false);
  if (result.authorized !== false) throw new Error('should not be authorized — 403 before suspicious check');
  if (result.status !== 403) throw new Error('should be 403, not reaching suspicious check');
});

check('non_admin_is_test_cannot_bypass_duplicate_proof_review', () => {
  const result = authorizeListingCreation('user', { is_test: true, proof_url: 'duplicate_url' }, false);
  if (result.authorized !== false) throw new Error('should not be authorized — 403 before duplicate proof check');
  if (result.status !== 403) throw new Error('should be 403, not reaching duplicate proof check');
});

// ══════════════════════════════════════════════════════════════════════════
// TEST 3: Admin + is_test:true + maintenance ON → dry-run, zero writes
// ══════════════════════════════════════════════════════════════════════════
check('admin_is_test_maintenance_on_dry_run', () => {
  const result = authorizeListingCreation('admin', { is_test: true }, true);
  if (result.authorized !== false) throw new Error('should not be authorized (dry run)');
  if (result.status !== 200) throw new Error(`status should be 200 (dry run), got ${result.status}`);
  if (result.body.dry_run !== true) throw new Error('body.dry_run should be true');
  if (result.body.created !== false) throw new Error('body.created should be false');
});

check('admin_is_test_maintenance_on_zero_writes', async () => {
  const mock = createWriteTrackingMock();
  const result = await simulateSubmitListing(
    { role: 'admin', email: 'admin@test.com' },
    { is_test: true, event_id: 'evt1', section: 'A' },
    true,
    mock
  );
  if (result.body.dry_run !== true) throw new Error('should be dry run');
  if (result.writes.length !== 0) throw new Error(`expected 0 writes, got ${result.writes.length}`);
});

// ══════════════════════════════════════════════════════════════════════════
// TEST 4: Admin + is_test:true + maintenance OFF → [TEST] note, demo=true
// ══════════════════════════════════════════════════════════════════════════
check('admin_is_test_maintenance_off_test_labeling', async () => {
  const mock = createWriteTrackingMock();
  const result = await simulateSubmitListing(
    { role: 'admin', email: 'admin@test.com' },
    { is_test: true, event_id: 'evt1', section: 'A' },
    false,
    mock
  );
  if (result.status !== 200) throw new Error(`status should be 200, got ${result.status}`);

  const listingWrite = result.writes.find(w => w.entity === 'Listing' && w.method === 'create');
  if (!listingWrite) throw new Error('Listing create not found');
  if (listingWrite.data.notes !== '[TEST] Admin/demo listing') throw new Error(`Listing notes should be [TEST], got ${listingWrite.data.notes}`);
  if (listingWrite.data.is_demo_listing !== true) throw new Error('Listing is_demo_listing should be true');

  const lpWrite = result.writes.find(w => w.entity === 'ListingPrivate' && w.method === 'create');
  if (!lpWrite) throw new Error('ListingPrivate create not found');
  if (lpWrite.data.notes !== '[TEST] Admin/demo listing') throw new Error(`ListingPrivate notes should be [TEST], got ${lpWrite.data.notes}`);
  if (lpWrite.data.is_demo_listing !== true) throw new Error('ListingPrivate is_demo_listing should be true');

  const siWrite = result.writes.find(w => w.entity === 'SeatInventory' && w.method === 'create');
  if (siWrite) throw new Error('SeatInventory should NOT be created for test listing');
});

// ══════════════════════════════════════════════════════════════════════════
// TEST 5: Admin + is_test:false + maintenance OFF → no test note, demo=false
// ══════════════════════════════════════════════════════════════════════════
check('admin_normal_listing_no_test_labeling', async () => {
  const mock = createWriteTrackingMock();
  const result = await simulateSubmitListing(
    { role: 'admin', email: 'admin@test.com' },
    { is_test: false, event_id: 'evt1', section: 'A' },
    false,
    mock
  );
  if (result.status !== 200) throw new Error(`status should be 200, got ${result.status}`);

  const listingWrite = result.writes.find(w => w.entity === 'Listing' && w.method === 'create');
  if (!listingWrite) throw new Error('Listing create not found');
  if (listingWrite.data.notes !== undefined) throw new Error(`Listing notes should be undefined, got ${listingWrite.data.notes}`);
  if (listingWrite.data.is_demo_listing !== false) throw new Error('Listing is_demo_listing should be false');

  const lpWrite = result.writes.find(w => w.entity === 'ListingPrivate' && w.method === 'create');
  if (!lpWrite) throw new Error('ListingPrivate create not found');
  if (lpWrite.data.notes !== undefined) throw new Error(`ListingPrivate notes should be undefined, got ${lpWrite.data.notes}`);
  if (lpWrite.data.is_demo_listing !== false) throw new Error('ListingPrivate is_demo_listing should be false');
});

// ══════════════════════════════════════════════════════════════════════════
// TEST 6: No request-supplied identity or role affects authorization
// ══════════════════════════════════════════════════════════════════════════
check('body_is_admin_does_not_grant_admin', () => {
  const result = authorizeListingCreation('user', { is_test: true, is_admin: true }, false);
  if (result.authorized !== false) throw new Error('body.is_admin should not grant admin');
  if (result.status !== 403) throw new Error('should be 403');
});

check('body_role_admin_does_not_grant_admin', () => {
  const result = authorizeListingCreation('user', { is_test: true, role: 'admin' }, false);
  if (result.authorized !== false) throw new Error('body.role should not grant admin');
  if (result.status !== 403) throw new Error('should be 403');
});

check('admin_is_test_false_normal_listing_authorized', () => {
  const result = authorizeListingCreation('admin', { is_test: false }, false);
  if (result.authorized !== true) throw new Error('admin normal listing should be authorized');
  if (result.isTest !== false) throw new Error('isTest should be false');
  if (result.isAdmin !== true) throw new Error('isAdmin should be true');
});

check('non_admin_is_test_false_authorized', () => {
  const result = authorizeListingCreation('user', { is_test: false }, false);
  if (result.authorized !== true) throw new Error('non-admin normal listing should be authorized');
  if (result.isTest !== false) throw new Error('isTest should be false');
  if (result.isAdmin !== false) throw new Error('isAdmin should be false');
});

// ══════════════════════════════════════════════════════════════════════════
// TEST 7: deriveTestModeLabeling consistency
// ══════════════════════════════════════════════════════════════════════════
check('labeling_true_is_consistent', () => {
  const labeling = deriveTestModeLabeling(true);
  if (labeling.notes !== '[TEST] Admin/demo listing') throw new Error('notes should be [TEST]');
  if (labeling.is_demo_listing !== true) throw new Error('is_demo_listing should be true');
});

check('labeling_false_is_consistent', () => {
  const labeling = deriveTestModeLabeling(false);
  if (labeling.notes !== undefined) throw new Error('notes should be undefined');
  if (labeling.is_demo_listing !== false) throw new Error('is_demo_listing should be false');
});

// ══════════════════════════════════════════════════════════════════════════
// TEST 8: Maintenance gate edge cases
// ══════════════════════════════════════════════════════════════════════════
check('non_admin_is_test_true_maintenance_on_still_403', () => {
  const result = authorizeListingCreation('user', { is_test: true }, true);
  if (result.status !== 403) throw new Error(`should be 403 (not 503), got ${result.status}`);
});

check('non_admin_is_test_false_maintenance_on_503', () => {
  const result = authorizeListingCreation('user', { is_test: false }, true);
  if (result.status !== 503) throw new Error(`should be 503, got ${result.status}`);
});

check('admin_is_test_false_maintenance_on_503', () => {
  const result = authorizeListingCreation('admin', { is_test: false }, true);
  if (result.status !== 503) throw new Error(`should be 503, got ${result.status}`);
});

// ══════════════════════════════════════════════════════════════════════════
// MAIN RUNNER
// ══════════════════════════════════════════════════════════════════════════
async function main() {
  console.log('=== submitListing Test-Mode Authorization Tests (Round 6B.2) ===\n');
  for (const { name, fn } of tests) {
    try {
      await fn();
      console.log(`[PASS] ${name}`);
      passed++;
    } catch (e) {
      console.log(`[FAIL] ${name}`);
      console.log(`  ${e.message}`);
      failures.push(name);
      failed++;
    }
  }
  console.log(`\n=== Overall: ${failed === 0 ? 'PASS' : 'FAIL'} ===`);
  console.log(`Tests run: ${passed + failed}, Passed: ${passed}, Failed: ${failed}`);
  if (failed > 0) {
    console.log(`\nFailed: ${failures.join(', ')}`);
    process.exit(1);
  }
}

main().catch(err => { console.error('Test runner error:', err); process.exit(1); });