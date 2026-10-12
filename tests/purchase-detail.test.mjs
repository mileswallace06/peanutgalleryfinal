import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { readAuthorizedPurchase, readPurchaseContext, purchaseViewerRole } from '../src/lib/purchaseDetailRead.js';
import { summarizeSellerHistory, formatRecordedAmount } from '../src/lib/salesPresentation.js';

const purchase = { id: 'fixture-sale', event_id: 'fixture-event', listing_id: 'fixture-listing', transfer_status: 'completed', viewer_is_seller: true, amount: 15, seller_payout: 12 };
function clientFor(role = 'seller') {
  const calls = [], sdk = {
    auth: { me: async () => ({ email: `${role}@example.invalid`, role: role === 'admin' ? 'admin' : 'user' }) },
    functions: { invoke: async (name, args) => { calls.push({ name, args }); return { data: name === 'getPurchaseParticipantView' ? { purchase: { ...purchase, viewer_is_seller: role === 'seller', viewer_is_buyer: role === 'buyer' } } : { listing: { id: 'fixture-listing', section: '101', seats: '7–8' } } }; } },
    entities: { Event: { filter: async args => { calls.push({ name: 'Event.filter', args }); return [{ id: 'fixture-event', title: 'Authorized event' }]; } }, Purchase: { filter: async args => { calls.push({ name: 'Purchase.filter', args }); return [{ ...purchase, buyer_email: 'buyer@example.invalid' }]; } } },
  };
  return { sdk, calls };
}

test('authoritative participant roles win over legacy emails, creator hints and admin ownership guesses', async () => {
  for (const role of ['seller', 'buyer', 'admin']) {
    const { sdk } = clientFor(role);
    assert.equal((await readAuthorizedPurchase(sdk, purchase.id)).role, role);
  }
  assert.equal(purchaseViewerRole({ buyer_email: 'viewer', created_by: 'viewer' }, { email: 'viewer' }), null);
  assert.equal(purchaseViewerRole({ viewer_is_buyer: true, seller_email: 'viewer' }, { email: 'viewer', role: 'admin' }), 'buyer');
  const { sdk, calls } = clientFor('unauthorized');
  assert.equal((await readAuthorizedPurchase(sdk, purchase.id)).status, 'unavailable');
  assert.deepEqual(calls.map(c => c.name), ['getPurchaseParticipantView']);
});
test('missing, failed, signed-out and mismatched record reads never hydrate another transaction', async () => {
  const { sdk, calls } = clientFor();
  sdk.auth.me = async () => null;
  assert.equal((await readAuthorizedPurchase(sdk, purchase.id)).status, 'signed-out'); assert.equal(calls.length, 0);
  sdk.auth.me = async () => ({ role: 'user' });
  sdk.functions.invoke = async () => ({ data: { purchase: { ...purchase, id: 'other' } } });
  assert.equal((await readAuthorizedPurchase(sdk, purchase.id)).status, 'unavailable');
  sdk.functions.invoke = async () => { throw { status: 503 }; };
  await assert.rejects(readAuthorizedPurchase(sdk, purchase.id), error => error.status === 503);
});
test('completed context uses existing event and participant listing reads without legacy purchase read', async () => {
  const { sdk, calls } = clientFor();
  const context = await readPurchaseContext(sdk, purchase, 'seller');
  assert.equal(context.event.status, 'ready'); assert.equal(context.listing.value.seats, '7–8');
  assert.equal(context.transfer.status, 'missing'); assert.equal(calls.some(c => c.name === 'Purchase.filter'), false);
  assert.deepEqual(calls.find(c => c.name === 'getListingParticipantView').args, { listing_id: 'fixture-listing' });
});
test('metadata absent and failures stay independent and retry recovers only authorized record context', async () => {
  const { sdk } = clientFor();
  sdk.entities.Event.filter = async () => { throw new Error('Fixture read failed'); };
  let context = await readPurchaseContext(sdk, purchase, 'seller');
  assert.equal(context.event.status, 'error'); assert.equal(context.listing.status, 'ready');
  sdk.entities.Event.filter = async () => [];
  context = await readPurchaseContext(sdk, purchase, 'seller'); assert.equal(context.event.status, 'missing');
  sdk.entities.Event.filter = async () => [{ id: 'fixture-event', title: 'Recovered' }];
  context = await readPurchaseContext(sdk, purchase, 'seller'); assert.equal(context.event.value.title, 'Recovered');
  sdk.functions.invoke = async () => { throw { status: 404 }; };
  context = await readPurchaseContext(sdk, purchase, 'seller'); assert.equal(context.event.status, 'ready'); assert.equal(context.listing.status, 'missing');
});
test('pending user-scoped transfer dependency is exact-ID only and cannot establish role', async () => {
  const { sdk, calls } = clientFor();
  const context = await readPurchaseContext(sdk, { ...purchase, transfer_status: 'pending_transfer' }, 'seller');
  assert.equal(context.transfer.value.buyer_email, 'buyer@example.invalid');
  assert.deepEqual(calls.find(c => c.name === 'Purchase.filter').args, { id: purchase.id });
  assert.equal(purchaseViewerRole(context.transfer.value, {}), 'seller');
});
test('finite/missing seller amount mixtures preserve order-total distinction and exclude demos and incomplete transfers', () => {
  const complete = { ...purchase, transfer_status: 'completed' };
  assert.deepEqual(summarizeSellerHistory([complete, { ...complete, seller_payout: 0 }, ...[null, undefined, NaN, Infinity, '12'].map(seller_payout => ({ ...complete, seller_payout })), { ...complete, is_demo: true, seller_payout: 1000 }, { ...complete, transfer_status: 'pending_transfer', seller_payout: 1000 }]), { completedCount: 7, recordedAmount: 12, missingAmounts: 5 });
  for (const amount of [NaN, Infinity, null, undefined, '15']) assert.equal(formatRecordedAmount(amount), 'Amount unavailable');
  assert.equal(formatRecordedAmount(15), '$15.00');
});
test('actual participant handler enforces seller identity, stable 500-record window and no viewer leakage', async () => {
  const source = (await readFile(new URL('../base44/functions/getPurchaseParticipantView/entry.ts', import.meta.url), 'utf8')).replace(/^import .*;$/gm, '');
  const calls = [], sidecars = Array.from({ length: 501 }, (_, i) => ({ id: `pp-${i}`, purchase_id: `sale-${String(i).padStart(3, '0')}`, seller_email: 'seller@example.invalid', buyer_email: 'other@example.invalid' }));
  const sales = sidecars.map((pp, i) => ({ id: pp.purchase_id, amount: 15, seller_payout: i === 0 ? null : 12, transfer_status: 'completed', created_date: '2026-10-09T12:00:00Z', is_demo: i === 1 }));
  const sdk = { auth: { me: async () => ({ email: 'seller@example.invalid', role: 'user' }) }, asServiceRole: { entities: {
    PurchasePrivate: { filter: async (query, sort, limit) => { calls.push({ entity: 'private', query, sort, limit }); assert.equal(query.seller_email, 'seller@example.invalid'); return sidecars.slice(0, limit); } },
    Purchase: { filter: async (query, sort, limit) => { calls.push({ entity: 'purchase', query, sort, limit }); return query.id ? sales.filter(p => query.id.$in.includes(p.id)).slice(0, limit) : sales.slice(0, limit); } },
    AdminAlert: { filter: async () => { throw new Error('Unexpected integrity read'); }, create: async () => { throw new Error('Forbidden write'); } },
  } } };
  let handler;
  vm.runInNewContext(source, { createClientFromRequest: () => sdk, Deno: { serve: fn => { handler = fn; } }, Response, console, getPurchasePrivate: async () => { throw new Error('Unexpected single read'); } });
  const response = await handler({ json: async () => ({ action: 'list_mine', perspective: 'seller' }) });
  const body = await response.json(); assert.equal(response.status, 200); assert.equal(body.sales.length, 500);
  assert.equal(body.sales[0].id, 'sale-499'); assert.equal(body.sales.at(-1).id, 'sale-000');
  assert.ok(body.sales.every(row => row.viewer_is_seller && !row.viewer_is_buyer && !('seller_email' in row)));
  assert.ok(calls.every(call => call.limit === 500));
  assert.deepEqual(summarizeSellerHistory(body.sales), { completedCount: 499, recordedAmount: 498 * 12, missingAmounts: 1 });
});
