import assert from 'node:assert/strict';
import { createMockDeps, createDefaultSeed, runReleaseReservation } from './helpers/mockDeps.mjs';
import { expirePurchaseSafely, assertNoOpenAccountObligations } from '../base44/shared/purchaseExpiry.js';
import { closeMission1Databases } from './helpers/mission1Postgres.mjs';
import { hashReservationToken } from '../base44/shared/mission1Authority.js';

const cases = [];
const test = (name, run) => cases.push({ name, run });
function fixture() {
  const ctx = createDefaultSeed({ purchase: { seller_confirmed: false, created_date: new Date(Date.now() - 49 * 3600000).toISOString() } });
  const deps = createMockDeps({ seed: ctx.seed, hooks: {} });
  deps.stripe.pisById.set(ctx.piId, { id: ctx.piId, status: 'requires_capture' });
  return { ctx, deps, stores: deps._state.stores };
}

test('checkout creates purchase after unpaid lookup: release must refuse', async () => {
  const { ctx, deps, stores } = fixture();
  stores.Listing[0].status = 'active';
  const purchase = { ...stores.Purchase[0], reservation_token: 'checkout-new-token' };
  const pp = { ...stores.PurchasePrivate[0], reservation_token: 'checkout-new-token' };
  stores.Purchase.length = 0; stores.PurchasePrivate.length = 0;
  await deps.paymentAuthority.getState(ctx.listingId);
  const filter = deps.entities.PurchasePrivate.filter;
  let injected = false;
  deps.entities.PurchasePrivate.filter = async (...args) => {
    const snapshot = await filter(...args);
    if (!injected) {
      injected = true;
      // The exact audit window: release already read no Purchase or PP. The
      // checkout now admits and binds in Postgres before Base44 rows appear.
      await deps.paymentAuthority.beginCheckout({ listingId:ctx.listingId,version:0,buyerId:'user_buyer',
        tokenHash:await hashReservationToken(pp.reservation_token),expiresAt:ctx.expiry,operationId:'audit-checkout' });
      await deps.paymentAuthority.attachIntent('audit-checkout',ctx.piId);
      await deps.paymentAuthority.bindCheckout('audit-checkout',ctx.purchaseId,ctx.piId);
      stores.Purchase.push(purchase); stores.PurchasePrivate.push(pp);
    }
    return snapshot;
  };
  const result = await runReleaseReservation(deps, { listing_id: ctx.listingId });
  assert.notEqual(result.status, 200);
  assert.ok(['AUTHORITY_OWNERSHIP_CHANGED','PAYMENT_OBLIGATION'].includes(result.body.code), result.body.code);
  assert.equal(stores.Listing[0].reservation_token, ctx.token);
});

test('release-before-purchase-persistence failure can resume to completion', async () => {
  const { ctx, deps } = fixture();
  deps.hooks.before_Purchase_updateMany = async () => { throw new Error('Purchase persistence unavailable'); };
  assert.notEqual((await expirePurchaseSafely(deps, ctx.purchaseId)).status, 200);
  delete deps.hooks.before_Purchase_updateMany;
  assert.equal((await expirePurchaseSafely(deps, ctx.purchaseId)).status, 200);
});

for (const settlement of ['canceled', 'refunded', 'unresolved']) {
  test(`historical deletion reconciles ${settlement} without a new completion marker`, async () => {
    const { ctx, deps, stores } = fixture();
    stores.Purchase[0].transfer_status = 'expired';
    stores.Listing[0].status = 'active';
    for (const row of [stores.Listing[0], stores.ListingPrivate[0]]) {
      row.reservation_token = null; row.reserved_by_email = null; row.reservation_expires_at = null;
    }
    const pi = deps.stripe.pisById.get(ctx.piId);
    pi.status = settlement === 'refunded' ? 'succeeded' : settlement === 'canceled' ? 'canceled' : 'requires_capture';
    pi.latest_charge = 'ch_historical';
    stores.PurchasePrivate[0].payment_captured = settlement === 'refunded';
    deps.stripe.charges = { retrieve: async () => ({ id: 'ch_historical', payment_intent: ctx.piId, amount: 10500, amount_refunded: 10500, refunded: true }) };
    const check = () => assertNoOpenAccountObligations(deps.entities, ctx.buyerEmail, deps);
    if (settlement === 'unresolved') await assert.rejects(check);
    else await check();
  });
}

for (const state of ['finalized', 'unresolved', 'unfinished_capture']) {
  test(`historical completed sale ${state} is reconciled without trusting capture flags alone`, async () => {
    const { ctx, deps, stores } = fixture();
    stores.Purchase[0].transfer_status = 'completed';
    stores.PurchasePrivate[0].payment_captured = true;
    for (const row of [stores.Listing[0], stores.ListingPrivate[0]]) {
      row.reservation_token = null; row.reserved_by_email = null; row.reservation_expires_at = null;
    }
    await deps.paymentAuthority.getState(ctx.listingId);
    if (state !== 'unfinished_capture') await deps._mission1.sql("UPDATE authority_v1.reservation_payment_bindings SET capture_state='finalized'");
    deps.stripe.pisById.get(ctx.piId).status = state === 'unresolved' ? 'processing' : 'succeeded';
    const check = () => assertNoOpenAccountObligations(deps.entities, ctx.buyerEmail, deps);
    if (state === 'finalized') await check();
    else await assert.rejects(check);
  });
}

test('historical completion marker cannot override a current provider retrieval failure', async () => {
  const { ctx, deps, stores } = fixture();
  stores.Purchase[0].transfer_status = 'expired';
  stores.PurchasePrivate[0].cleanup_completed_at = new Date().toISOString();
  deps.stripe.paymentIntents.retrieve = async () => { throw new Error('provider unavailable'); };
  await assert.rejects(assertNoOpenAccountObligations(deps.entities, ctx.buyerEmail, deps), /provider unavailable/);
});

let failed = 0;
for (const { name, run } of cases) {
  try { await run(); console.log(`PASS ${name}`); }
  catch (error) { failed++; console.error(`FAIL ${name}: ${error.message}`); }
}
console.log(`${cases.length - failed} passed, ${failed} failed`);
await closeMission1Databases();
process.exitCode = failed ? 1 : 0;
