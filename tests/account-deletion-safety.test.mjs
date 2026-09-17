import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  createAccountPseudonym,
  evaluateAccountDeletion,
  runCriticalDeletionSteps,
} from '../base44/shared/accountDeletionPolicy.js';

const email = 'fan@example.com';
const terminalListing = {
  id: 'listing-1',
  seller_email: 'seller@example.com',
  status: 'sold',
  reservation_mirror_state: 'sold',
};
const terminalListingPrivate = {
  id: 'listing-private-1',
  listing_id: 'listing-1',
  seller_email: 'seller@example.com',
  reservation_lifecycle_state: 'sold',
  ticket_custody_status: 'delivered_to_buyer',
  custody_status: 'verified',
};

function purchaseSnapshot(overrides = {}, privateOverrides = {}) {
  const purchase = {
    id: 'purchase-1',
    listing_id: 'listing-1',
    buyer_email: email,
    seller_email: 'seller@example.com',
    transfer_status: 'completed',
    payment_captured: true,
    ...overrides,
  };
  const purchasePrivate = {
    id: 'purchase-private-1',
    purchase_id: purchase.id,
    listing_id: purchase.listing_id,
    buyer_email: purchase.buyer_email,
    seller_email: purchase.seller_email,
    payment_captured: true,
    freeze_finalized_at: '2026-09-16T00:00:00.000Z',
    ...privateOverrides,
  };
  return {
    targetEmail: email,
    purchases: [purchase],
    purchasePrivates: [purchasePrivate],
    listings: [terminalListing],
    listingPrivates: [terminalListingPrivate],
    unresolvedAlerts: [],
    ownedListingIds: [],
  };
}

test('allows a completed buyer history while retaining its linked records', () => {
  const decision = evaluateAccountDeletion(purchaseSnapshot());
  assert.equal(decision.allowed, true);
  assert.deepEqual(decision.retainedListingIds, ['listing-1']);
});

test('blocks unresolved transfers, disputes, and payment anomalies', () => {
  for (const [overrides, privateOverrides, expected] of [
    [{ transfer_status: 'pending_transfer' }, {}, 'ACTIVE_PURCHASE_TRANSFER'],
    [{ transfer_status: 'disputed' }, {}, 'OPEN_DISPUTE'],
    [{ transfer_status: 'expired' }, { payment_captured: true }, 'CAPTURED_PAYMENT_REFUND_UNKNOWN'],
    [{ transfer_status: 'completed' }, { payment_capture_failed: true }, 'PAYMENT_REQUIRES_REVIEW'],
    [{ transfer_status: 'completed' }, { fulfillment_status: 'issue_reported' }, 'ACTIVE_FULFILLMENT'],
  ]) {
    const decision = evaluateAccountDeletion(purchaseSnapshot(overrides, privateOverrides));
    assert.equal(decision.allowed, false);
    assert.ok(decision.blockers.some((item) => item.code === expected), expected);
  }
});

test('fails closed when an authoritative private sidecar is missing', () => {
  const purchaseMissing = purchaseSnapshot();
  purchaseMissing.purchasePrivates = [];
  assert.ok(evaluateAccountDeletion(purchaseMissing).blockers.some((item) => item.code === 'PURCHASE_PRIVATE_MISSING'));

  const listingMissing = {
    targetEmail: email,
    purchases: [],
    purchasePrivates: [],
    listings: [{ id: 'owned-1', seller_email: email, status: 'cancelled', reservation_mirror_state: 'cancelled' }],
    listingPrivates: [],
    unresolvedAlerts: [],
    ownedListingIds: ['owned-1'],
  };
  assert.ok(evaluateAccountDeletion(listingMissing).blockers.some((item) => item.code === 'LISTING_PRIVATE_MISSING'));
});

test('blocks completed seller history because payout settlement is not durably represented', () => {
  const snapshot = purchaseSnapshot({ buyer_email: 'buyer@example.com', seller_email: email }, {
    buyer_email: 'buyer@example.com',
    seller_email: email,
  });
  const decision = evaluateAccountDeletion(snapshot);
  assert.ok(decision.blockers.some((item) => item.code === 'SELLER_PAYOUT_SETTLEMENT_UNVERIFIED'));
});

test('blocks live or inconsistent seller listings and permits a coherent terminal listing', () => {
  const live = {
    targetEmail: email,
    purchases: [],
    purchasePrivates: [],
    listings: [{ id: 'owned-1', seller_email: email, status: 'active', reservation_mirror_state: 'available' }],
    listingPrivates: [{ listing_id: 'owned-1', seller_email: email, reservation_lifecycle_state: 'available' }],
    unresolvedAlerts: [],
    ownedListingIds: ['owned-1'],
  };
  assert.equal(evaluateAccountDeletion(live).allowed, false);

  const soldWithoutPurchase = structuredClone(live);
  soldWithoutPurchase.listings[0].status = 'sold';
  soldWithoutPurchase.listings[0].reservation_mirror_state = 'sold';
  soldWithoutPurchase.listingPrivates[0].reservation_lifecycle_state = 'sold';
  assert.ok(evaluateAccountDeletion(soldWithoutPurchase).blockers.some((item) => item.code === 'SOLD_LISTING_PURCHASE_MISSING'));

  const cancelled = structuredClone(live);
  cancelled.listings[0].status = 'cancelled';
  cancelled.listings[0].reservation_mirror_state = 'cancelled';
  cancelled.listingPrivates[0].reservation_lifecycle_state = 'cancelled';
  assert.equal(evaluateAccountDeletion(cancelled).allowed, true);
});

test('blocks unresolved operational alerts', () => {
  const snapshot = purchaseSnapshot();
  snapshot.unresolvedAlerts = [{ id: 'alert-1', resolved: false }];
  assert.ok(evaluateAccountDeletion(snapshot).blockers.some((item) => item.code === 'UNRESOLVED_OPERATIONAL_ALERT'));
});

test('uses a stable pseudonym without exposing the original address', async () => {
  const first = await createAccountPseudonym(email, 'user-1');
  const second = await createAccountPseudonym(email, 'user-1');
  assert.equal(first, second);
  assert.match(first, /^deleted\+[a-f0-9]{32}@account\.invalid$/);
  assert.equal(first.includes('fan'), false);
});

test('critical steps stop at the first failure and report partial completion', async () => {
  const calls = [];
  await assert.rejects(
    runCriticalDeletionSteps([
      { name: 'first', run: async () => { calls.push('first'); } },
      { name: 'second', run: async () => { calls.push('second'); throw new Error('no'); } },
      { name: 'third', run: async () => { calls.push('third'); } },
    ]),
    (error) => error.code === 'ACCOUNT_REMOVAL_INCOMPLETE' &&
      error.step === 'second' && error.completedSteps.join(',') === 'first',
  );
  assert.deepEqual(calls, ['first', 'second']);
});

test('handler preserves linked audit records and does not mutate Stripe or claim auth deletion', async () => {
  const source = await readFile(new URL('../base44/functions/deleteAccount/entry.ts', import.meta.url), 'utf8');
  assert.equal(source.includes("from 'npm:stripe"), false);
  assert.equal(source.includes('paymentIntents.cancel'), false);
  assert.equal(source.includes('Listing.deleteMany'), false);
  assert.equal(source.includes('PurchasePrivate.deleteMany'), false);
  assert.match(source, /evaluateAccountDeletion\(snapshot\)/);
  assert.match(source, /auth_identity_deleted: false/);
  assert.match(source, /financial_and_audit_records_retained: true/);
});

test('modal describes the bounded process instead of promising total deletion', async () => {
  const source = await readFile(new URL('../src/components/DeleteAccountModal.jsx', import.meta.url), 'utf8');
  assert.equal(source.includes('all associated data will be permanently'), false);
  assert.equal(source.includes('purchase and sales history will be deleted'), false);
  assert.equal(source.includes('pending payouts may be forfeited'), false);
  assert.match(source, /underlying Base44 sign-in identity/);
  assert.match(source, /Required transaction\/audit records/);
  assert.match(source, /result\?\.success !== true/);
});
