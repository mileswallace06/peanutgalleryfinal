import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { selectCurrentPurchase, selectCurrentSeatInventory } from '../src/lib/currentTicketState.js';

const read = relativePath => readFileSync(new URL(`../${relativePath}`, import.meta.url), 'utf8');
let passed = 0;

function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

test('current ticket prefers a completed purchase', () => {
  const selected = selectCurrentPurchase([
    { id: 'pending-new', transfer_status: 'pending_transfer', created_date: '2026-09-16T12:00:00Z' },
    { id: 'complete-old', transfer_status: 'completed', created_date: '2026-09-15T12:00:00Z' },
  ]);
  assert.equal(selected.id, 'complete-old');
});

test('current ticket excludes terminal and disputed purchases', () => {
  const selected = selectCurrentPurchase([
    { id: 'expired', transfer_status: 'expired', created_date: '2026-09-16T15:00:00Z' },
    { id: 'cancelled', transfer_status: 'cancelled', created_date: '2026-09-16T14:00:00Z' },
    { id: 'disputed', transfer_status: 'disputed', created_date: '2026-09-16T13:00:00Z' },
    { id: 'pending', transfer_status: 'pending_transfer', created_date: '2026-09-16T12:00:00Z' },
  ]);
  assert.equal(selected.id, 'pending');
});

test('current ticket returns no purchase when every purchase is terminal', () => {
  assert.equal(selectCurrentPurchase([
    { transfer_status: 'expired' },
    { transfer_status: 'canceled' },
    { transfer_status: 'disputed' },
  ]), undefined);
});

test('current inventory excludes cancelled and transfer-expired records', () => {
  const selected = selectCurrentSeatInventory([
    { id: 'cancelled', section: '101', inventory_status: 'cancelled' },
    { id: 'transfer-expired', section: '102', transfer_status: 'transfer_expired' },
    { id: 'usable', section: '103', inventory_status: 'available' },
  ]);
  assert.equal(selected.id, 'usable');
});

test('CreateListing always releases upload and submission loading states', () => {
  const source = read('src/pages/CreateListing.jsx');
  assert.match(source, /finally\s*\{\s*setUploadingProof\(false\)/s);
  assert.match(source, /finally\s*\{\s*setUploadingPgProof\(false\)/s);
  assert.match(source, /finally\s*\{\s*setSubmitting\(false\)/s);
  assert.match(source, /role="alert"/);
});

test('attestation upload always releases its loading state', () => {
  const source = read('src/components/events/SellerTransferAttestation.jsx');
  assert.match(source, /finally\s*\{\s*setUploading\(false\)/s);
});

test('Ticketmaster listing setup recovers and reports errors', () => {
  const source = read('src/pages/EventDetailTM.jsx');
  assert.match(source, /finally\s*\{\s*setCreatingEvent\(false\)/s);
  assert.match(source, /createEventError/);
});

test('purchase cancellation and disputes always release action loading', () => {
  const source = read('src/pages/PurchaseSuccess.jsx');
  assert.match(source, /Cancellation was submitted, but the latest status could not be refreshed/);
  assert.match(source, /Your dispute was submitted, but the latest status could not be refreshed/);
  assert.ok((source.match(/finally\s*\{/g) || []).length >= 3);
  assert.match(source, /role="alert"/);
});

test('Stripe onboarding checks and redirects recover on failure', () => {
  const source = read('src/pages/Sell.jsx');
  assert.match(source, /setOnboardingError/);
  assert.match(source, /finally\s*\{\s*setOnboardingChecking\(false\)/s);
  assert.match(source, /finally\s*\{\s*setOnboardingLoading\(false\)/s);
});

test('payout-pending success returns to the page that actually renders drafts', () => {
  const createSource = read('src/pages/CreateListing.jsx');
  const sellSource = read('src/pages/Sell.jsx');
  assert.match(createSource, /<Link to="\/sell"[\s\S]*View Saved Draft/);
  assert.match(sellSource, /status === 'pending_payout_setup'/);
  assert.match(sellSource, /Awaiting Payout Setup/);
});

test('nested upgrade CTA cannot bubble into a duplicate navigation', () => {
  const source = read('src/pages/Upgrades.jsx');
  assert.match(source, /e\?\.stopPropagation\?\.\(\)/);
  assert.match(source, /if \(syncing\) return/);
});

test('Flash Drop empty state has no inert notification control', () => {
  const source = read('src/components/eventmode/FlashDropCenter.jsx');
  assert.doesNotMatch(source, />\s*Notify me\s*</);
});

test('scheduled Flash Drops are visibly unavailable and cannot be selected', () => {
  const source = read('src/components/flashdrops/CreateFlashDropSheet.jsx');
  assert.match(source, /disabled aria-disabled="true"/);
  assert.match(source, /Scheduled Drop · Coming Later/);
  assert.doesNotMatch(source, /Activate it manually/);
  assert.doesNotMatch(source, /setDropType\('scheduled'\)/);
});

test('Flash Drop loser state no longer links back to the same route', () => {
  const source = read('src/components/flashdrops/FlashDropCard.jsx');
  assert.doesNotMatch(source, /<Link/);
  assert.match(source, /open the Upgrades tab above/);
});

test('Flash Drop winner callback passes the identifier expected by its parent', () => {
  const source = read('src/components/flashdrops/FlashDropCard.jsx');
  assert.match(source, /onWinnerSelected\?\.\(drop\.id, data\.winner\)/);
});

console.log(`\n${passed} journey-repair tests passed.`);
