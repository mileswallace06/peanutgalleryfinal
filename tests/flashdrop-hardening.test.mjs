import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  canCloseFlashDrop,
  deliveryActorFor,
  isSafeFlashDrop,
  validateFlashDropListing,
} from '../base44/shared/flashDropPolicy.js';

const read = relativePath => readFileSync(new URL(`../${relativePath}`, import.meta.url), 'utf8');
let passed = 0;

function test(name, fn) {
  fn();
  passed += 1;
  console.log(`PASS ${name}`);
}

const validListing = {
  id: 'listing_1', seller_email: 'seller@example.com', event_id: 'event_1', section: '118', row: 'G',
  seats: '12, 13', quantity: 2, status: 'active', proof_status: 'approved',
  transfer_status: 'transfer_confirmed', transfer_method: 'email_transfer',
};
const validPrivate = {
  listing_id: 'listing_1', seller_email: 'seller@example.com', event_id: 'event_1', section: '118', row: 'G',
  seats: '12, 13', quantity: 2, proof_status: 'approved', checkout_quarantined: false,
  reservation_token: null, reserved_by_email: null,
};
const validate = (listing = validListing, listingPrivate = validPrivate, overrides = {}) => validateFlashDropListing({
  listing,
  listingPrivate,
  userEmail: 'seller@example.com',
  eventId: 'event_1',
  section: '118',
  ...overrides,
});

test('approved active transferable listing passes and supplies canonical seats', () => {
  const result = validate();
  assert.equal(result.ok, true);
  assert.deepEqual(result.canonical, { section: '118', row: 'G', seats: '12, 13', quantity: 2 });
});

for (const [name, listing, listingPrivate, overrides, code] of [
  ['seller mismatch', validListing, { ...validPrivate, seller_email: 'attacker@example.com' }, {}, 'OWNERSHIP_LISTING_MISMATCH'],
  ['event mismatch', { ...validListing, event_id: 'event_2' }, validPrivate, {}, 'OWNERSHIP_LISTING_MISMATCH'],
  ['section mismatch', validListing, validPrivate, { section: '119' }, 'OWNERSHIP_LISTING_MISMATCH'],
  ['inactive listing', { ...validListing, status: 'hidden' }, validPrivate, {}, 'OWNERSHIP_LISTING_NOT_ACTIVE'],
  ['unapproved public proof', { ...validListing, proof_status: 'pending_review' }, validPrivate, {}, 'OWNERSHIP_PROOF_NOT_APPROVED'],
  ['unapproved private proof', validListing, { ...validPrivate, proof_status: 'pending_review' }, {}, 'OWNERSHIP_PROOF_NOT_APPROVED'],
  ['unconfirmed transfer', { ...validListing, transfer_status: 'transfer_unconfirmed' }, validPrivate, {}, 'TRANSFER_NOT_SAFE'],
  ['in-person transfer', { ...validListing, transfer_method: 'in_person' }, validPrivate, {}, 'TRANSFER_NOT_SAFE'],
  ['quarantined listing', validListing, { ...validPrivate, checkout_quarantined: true }, {}, 'OWNERSHIP_LISTING_QUARANTINED'],
  ['reserved listing', validListing, { ...validPrivate, reservation_token: 'reserved' }, {}, 'OWNERSHIP_LISTING_RESERVED'],
]) {
  test(`${name} fails closed`, () => {
    const result = validate(listing, listingPrivate, overrides);
    assert.equal(result.ok, false);
    assert.equal(result.code, code);
  });
}

test('only donor or admin may close a drop', () => {
  const drop = { donor_email: 'donor@example.com' };
  assert.equal(canCloseFlashDrop(drop, { email: 'donor@example.com', role: 'user' }), true);
  assert.equal(canCloseFlashDrop(drop, { email: 'admin@example.com', role: 'admin' }), true);
  assert.equal(canCloseFlashDrop(drop, { email: 'entrant@example.com', role: 'user' }), false);
});

test('delivery actor is derived only from authenticated identity', () => {
  const drop = { donor_email: 'donor@example.com', winner_email: 'winner@example.com' };
  assert.equal(deliveryActorFor(drop, { email: 'donor@example.com' }), 'donor');
  assert.equal(deliveryActorFor(drop, { email: 'winner@example.com' }), 'winner');
  assert.equal(deliveryActorFor(drop, { email: 'outsider@example.com', role: 'admin' }), null);
});

test('safe drops require server-recognized ownership and official transfer', () => {
  const safe = { ownership_verified: true, ownership_verification_method: 'verified_listing', ownership_delivery_method: 'ticket_transfer' };
  assert.equal(isSafeFlashDrop(safe), true);
  assert.equal(isSafeFlashDrop({ ...safe, ownership_verification_method: 'ownership_proof_upload' }), false);
  assert.equal(isSafeFlashDrop({ ...safe, ownership_delivery_method: 'manual_release' }), false);
});

test('backend rejects raw proof URLs and caller-supplied delivery role', () => {
  const source = read('base44/functions/flashDrop/entry.ts');
  assert.match(source, /if \(ownership_proof_url\)[\s\S]*UNTRUSTED_OWNERSHIP_PROOF/);
  assert.match(source, /const actor = deliveryActorFor\(drop, user\)/);
  assert.doesNotMatch(source, /const \{ flash_drop_id, role \} = body/);
  assert.match(source, /canCloseFlashDrop\(drop, user\)/);
  assert.match(source, /Date\.now\(\) < closesAt/);
});

test('creation UI never submits a raw ownership URL and keeps scheduling disabled', () => {
  const source = read('src/components/flashdrops/CreateFlashDropSheet.jsx');
  assert.doesNotMatch(source, /ownership_proof_url:/);
  assert.doesNotMatch(source, /Upload ticket screenshot/);
  assert.match(source, /Scheduled Drop · Coming Later/);
  assert.match(source, /disabled aria-disabled="true"/);
  assert.match(source, /finally\s*\{\s*setLoading\(false\)/s);
  assert.match(source, /role="alert"/);
  assert.match(source, /overflow-y-auto overscroll-contain/);
  assert.match(source, /safe-area-inset-bottom/);
});

test('card polling is bounded, retryable, and entrants never select winners', () => {
  const source = read('src/components/flashdrops/FlashDropCard.jsx');
  assert.match(source, /POLL_TIMEOUT_MS = 30000/);
  assert.match(source, /Retry winner selection/);
  assert.match(source, /Retry result check/);
  assert.match(source, /finally\s*\{\s*setLoading\(false\)/s);
  assert.doesNotMatch(source, /Non-donors:[\s\S]*close_and_pick/);
  assert.match(source, /onWinnerSelected\?\.\(drop\.id,/);
});

console.log(`\n${passed} Flash Drop hardening tests passed.`);
