import assert from 'node:assert/strict';
import test from 'node:test';
import { invokeListingParticipant, privateListingFields } from './helpers/listingParticipantFixture.mjs';
import { readAuthorizedPurchase, readPurchaseContext } from '../src/lib/purchaseDetailRead.js';
const sourceRef = process.env.PG_PURCHASE_LISTING_SOURCE_REF;
const invoke = options => invokeListingParticipant({ ...options, sourceRef });
const publicKeys = ['id','event_id','section','row','quantity','tier','asking_price','original_price','transfer_method','status','listing_mode','listing_type','transfer_status','listing_transfer_mode','transfer_confidence_score','last_transfer_verification','requires_location','location_requirement','requires_existing_ticket','is_demo_listing','is_verified','is_instant_ready','viewer_is_seller','reservation_state'];
function exactProjection(body, extras = []) {
  assert.deepEqual(Object.keys(body.listing).sort(), [...publicKeys, ...extras].sort());
  for (const key of Object.keys(privateListingFields)) assert.equal(Object.hasOwn(body.listing, key), false, `Private field ${key} omitted`);
  assert.doesNotMatch(JSON.stringify(body), /PRIVATE_/);
}
for (const role of ['seller', 'buyer', 'admin']) for (const platform of ['ticketmaster', 'axs']) {
  test(`actual authorized handler and purchase context preserve ${platform} for ${role} only`, async () => {
    const result = await invoke({ role, platform });
    assert.equal(result.status, 200); assert.equal(result.body.listing.transfer_platform, platform);
    exactProjection(result.body, ['seats', 'transfer_platform', ...(['seller', 'admin'].includes(role) ? ['reservation_expires_at'] : [])]);
    const calls = [];
    const purchase = { id: 'fixture-sale-aaaaaaaaaaaaaaaa', listing_id: 'fixture-listing', event_id: 'fixture-event', transfer_status: 'completed', viewer_is_seller: role === 'seller', viewer_is_buyer: role === 'buyer' };
    const sdk = { auth: { me: async () => ({ role: role === 'admin' ? 'admin' : 'user' }) }, entities: { Event: { filter: async () => [] } }, functions: { invoke: async name => { calls.push(name); return { data: name === 'getPurchaseParticipantView' ? { purchase } : result.body }; } } };
    const authorized = await readAuthorizedPurchase(sdk, purchase.id);
    const context = await readPurchaseContext(sdk, authorized.purchase, authorized.role);
    assert.equal(context.listing.value.transfer_platform, platform);
    assert.deepEqual(calls, ['getPurchaseParticipantView', 'getListingParticipantView']);
  });
}
for (const platform of ['seatgeek', 'stubhub', 'apple_wallet', 'other']) test(`schema platform ${platform} remains usable`, async () => {
  const result = await invoke({ platform }); assert.equal(result.body.listing.transfer_platform, platform);
});
for (const platform of [undefined, null, '', 'PRIVATE_UNKNOWN_PLATFORM', { url: 'PRIVATE_PROOF_URL' }]) test(`unknown/malformed platform ${JSON.stringify(platform)} is not copied through`, async () => {
  const result = await invoke({ platform, omitPlatform: platform === undefined });
  assert.equal(result.body.listing.transfer_platform, null); exactProjection(result.body, ['seats', 'transfer_platform', 'reservation_expires_at']);
});
for (const role of ['guest', 'unauthorized']) test(`${role} receives no platform or private listing fields, and cannot view sold listing`, async () => {
  const publicResult = await invoke({ role, status: 'active', legacySellerSpoof: true });
  assert.equal(publicResult.status, 200); exactProjection(publicResult.body);
  const soldResult = await invoke({ role, legacySellerSpoof: true });
  assert.equal(soldResult.status, 404); assert.deepEqual(soldResult.body, { error: 'Listing not found' });
});
test('reservation ownership cannot grant transfer platform or seat access', async () => {
  const result = await invoke({ role: 'unauthorized', status: 'active', reservedForViewer: true });
  assert.equal(result.status, 200); exactProjection(result.body, ['reservation_expires_at']);
  assert.equal(result.body.listing.reservation_state, 'reserved_for_you');
});
test('buyer authority lookup failure stays closed and missing private record never falls back to legacy data', async () => {
  assert.equal((await invoke({ role: 'buyer', buyerLookupFailure: true })).status, 404);
  for (const role of ['guest','unauthorized','seller','buyer','admin']) {
    const result = await invoke({ role, privateMissing: true });
    assert.equal(result.status, ['buyer', 'admin'].includes(role) ? 500 : 404);
    assert.equal(Object.hasOwn(result.body, 'listing'), false);
  }
});
test('public event-list projection is unchanged; participant access remains explicit', async () => {
  for (const role of ['guest','unauthorized','seller','buyer','admin']) {
    const result = await invoke({ role, status: 'active', action: 'list_active_by_event' });
    assert.equal(result.status, 200); assert.equal(result.body.listings.length, 1);
    const listing = result.body.listings[0];
    if (['guest','unauthorized'].includes(role)) exactProjection({ listing });
    else assert.equal(listing.transfer_platform, 'ticketmaster');
    for (const key of Object.keys(privateListingFields)) assert.equal(Object.hasOwn(listing, key), false);
  }
});
test('list_mine keeps the existing exact 26-key seller contract', async () => {
  const result = await invoke({ action: 'list_mine' });
  assert.equal(result.status, 200); const row = result.body.listings[0];
  assert.deepEqual(Object.keys(row).sort(), ['id','event_id','section','row','seats','quantity','tier','asking_price','original_price','transfer_method','status','hidden_reason','listing_mode','listing_type','transfer_status','listing_transfer_mode','transfer_confidence_score','last_transfer_verification','proof_status','proof_rejection_reason','is_demo_listing','is_instant_ready','reservation_state','reservation_expires_at','viewer_is_seller','created_date'].sort());
  for (const key of Object.keys(privateListingFields)) assert.equal(Object.hasOwn(row, key), false);
});
