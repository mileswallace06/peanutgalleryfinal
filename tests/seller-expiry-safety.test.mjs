import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';
import { createMockDeps, createDefaultSeed } from './helpers/mockDeps.mjs';
import * as privateHelpers from '../base44/shared/orchestratorHelpers.js';
import { expirePurchaseSafely, assertNoOpenAccountObligations } from '../base44/shared/purchaseExpiry.js';
import * as expiryModule from '../base44/shared/purchaseExpiry.js';
import { runReleaseReservation } from '../base44/shared/releaseOrchestrator.js';
import { closeMission1Databases } from './helpers/mission1Postgres.mjs';

// Handler contract tests with synthetic runtime dependencies. Actual runtime
// wiring is exercised separately by mission1-handler-integration.test.mjs.
// No credentials, SDK network calls, or external data are available in this VM.
async function loadHandler(name, deps, injectAuthority = true) {
  let handler;
  const base44 = { asServiceRole: { entities: deps.entities }, auth: { me: async () => deps.user } };
  const context = vm.createContext({
    Response, Request, Date, crypto, console: { log() {}, warn() {}, error() {} },
    Deno: { serve: fn => { handler = fn; }, env: { get: key => key === 'MAINTENANCE_MODE' ? 'false' : 'sk_test_mock_only' } },
  });
  const mocks = {
    'npm:@base44/sdk@0.8.25': { createClientFromRequest: () => base44 },
    'npm:@base44/sdk@0.8.31': { createClientFromRequest: () => base44 },
    'npm:stripe@14.21.0': { default: class { constructor() { return deps.stripe; } } },
    'base44:runtime': { secrets: { get: () => null } },
    '../../shared/mission1Runtime.js': {
      createMission1Runtime: async () => injectAuthority ? { ...deps, drainRecovery: async () => ({ ok: true, results: [] }) } : (() => { throw new Error('APPROVED_AUTHORITY_REQUIRED'); })(),
      authorizeMission1Worker: async () => deps.user,
    },
    '../../shared/maintenance.ts': { isMaintenanceActive: () => false, maintenance503: () => Response.json({}, { status: 503 }) },
    '../../shared/privateData.ts': Object.fromEntries(Object.entries(privateHelpers).map(([key, fn]) => [key, (...args) => fn(deps, ...args.slice(1))])),
    '../../shared/notifications.ts': { sendUserNotification: async () => {}, sendTransactionalEmail: async () => {} },
    '../../shared/authCanary.js': { isCanaryListing: () => false, isCanaryEnabled: () => false },
    '../../shared/canaryScheduledRelease.js': { runCanaryScheduledRelease: async () => { throw new Error('Canary must not run'); } },
    '../../shared/abortCanaryOrchestrator.js': { maybeRouteCanaryAbort: async () => null },
    '../../shared/cancelPurchaseCanaryOrchestrator.js': { maybeRouteCanaryCancelPurchase: async () => null },
    '../../shared/stripeCancelProvider.js': { createStripeCancelProvider: () => { throw new Error('Canary provider must not run'); } },
    '../../shared/canaryGuard.js': { maybeRouteCanary: async () => null },
  };
  // Keep the established failure-injection contract fixtures. The separate
  // integration suite loads the real runtime and restricted SQL transports.
  if (injectAuthority) {
    const services = { paymentAuthority: deps.paymentAuthority, projectRelease: deps.projectRelease,
      projectFailure: deps.projectFailure, projectReservationRelease: deps.projectReservationRelease, hooks: deps.hooks };
    mocks['../../shared/purchaseExpiry.js'] = { ...expiryModule,
      expirePurchaseSafely: (runtimeDeps, ...args) => expirePurchaseSafely({ ...runtimeDeps, ...services }, ...args),
      assertNoOpenAccountObligations: (entities, email) => assertNoOpenAccountObligations(entities, email, deps),
    };
    mocks['../../shared/releaseOrchestrator.js'] = { runReleaseReservation: (runtimeDeps, ...args) => runReleaseReservation({ ...runtimeDeps, ...services }, ...args) };
  }
  mocks['../../shared/privateData.ts'].getUserPrivate = async () => { throw new Error('Deletion must stop before private data access'); };
  const source = await readFile(new URL(`../base44/functions/${name}/entry.ts`, import.meta.url), 'utf8');
  const entry = new vm.SourceTextModule(ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText, { context });
  await entry.link(async specifier => {
    const exports = mocks[specifier] || await import(new URL(`../base44/functions/${name}/${specifier}`, import.meta.url));
    return new vm.SyntheticModule(Object.keys(exports), function () {
      for (const [key, value] of Object.entries(exports)) this.setExport(key, value);
    }, { context });
  });
  await entry.evaluate();
  return async body => handler(new Request('https://offline.invalid', { method: 'POST', body: JSON.stringify(body || {}) }));
}

function fixture() {
  const ctx = createDefaultSeed({ purchase: { seller_confirmed: false, created_date: new Date(Date.now() - 49 * 3600000).toISOString() } });
  const deps = createMockDeps({ seed: ctx.seed, hooks: {} });
  deps.user.role = 'admin';
  deps.stripe.pisById.set(ctx.piId, { id: ctx.piId, status: 'requires_capture' });
  const counts = { cancel: 0, active: 0, refund: 0 };
  const cancel = deps.stripe.paymentIntents.cancel;
  deps.stripe.paymentIntents.cancel = async (...args) => { counts.cancel++; return cancel(...args); };
  deps.hooks.before_Listing_updateMany = async (_query, data) => { if (data.status === 'active') counts.active++; };
  return { ctx, deps, stores: deps._state.stores, counts };
}

const cases = [];
function test(name, run) { cases.push({ name, run }); }
test('production seller expiry preserves inventory when Stripe retrieval fails', async () => {
  const { deps, stores } = fixture();
  deps.stripe.paymentIntents.retrieve = async () => { throw new Error('offline Stripe failure'); };
  const handler = await loadHandler('processTransferReminders', deps);
  const response = await handler();
  assert.notEqual(stores.Listing[0].status, 'active');
  assert.equal(stores.Purchase[0].transfer_status, 'pending_transfer');
  assert.ok(response.status >= 400);
  assert.equal(stores.AdminAlert.length, 1);
});

for (const mode of ['cancel failure', 'disagreeing cancellation response', 'verification retrieval failure']) {
  test(`production expiry fails closed on ${mode}`, async () => {
    const { deps, stores, ctx } = fixture();
    deps.stripe.paymentIntents.cancel = async () => {
      if (mode === 'cancel failure') throw new Error('cancel failed');
      return { id: ctx.piId, status: 'canceled' };
    };
    if (mode === 'verification retrieval failure') {
      let reads = 0;
      deps.stripe.paymentIntents.retrieve = async () => {
        if (++reads > 1) throw new Error('verification unavailable');
        return { id: ctx.piId, status: 'requires_capture' };
      };
    }
    const response = await (await loadHandler('processTransferReminders', deps))();
    assert.equal(response.status, 500);
    assert.notEqual(stores.Listing[0].status, 'active');
    assert.equal(stores.Listing[0].reservation_token, ctx.token);
    assert.equal(stores.ListingPrivate[0].recovery_blocked, true);
    assert.equal(stores.Purchase[0].transfer_status, 'pending_transfer');
    assert.equal(stores.AdminAlert.length, 1);
    assert.match(stores.AdminAlert[0].description, new RegExp(ctx.piId));
  });
}

for (const timing of ['before cleanup', 'during Stripe verification', 'before first tuple write', 'between tuple writes']) {
  test(`newer reservation ${timing} is never cleared`, async () => {
    const { deps, stores, ctx } = fixture();
    const inject = () => {
      for (const row of [stores.Listing[0], stores.ListingPrivate[0]]) {
        row.reservation_token = 'new-token'; row.reserved_by_email = 'new-buyer'; row.reservation_revision = 'new-revision';
      }
    };
    if (timing === 'before cleanup') inject();
    else if (timing === 'during Stripe verification') {
      const retrieve = deps.stripe.paymentIntents.retrieve;
      let calls = 0;
      deps.stripe.paymentIntents.retrieve = async id => { if (++calls === 2) inject(); return retrieve(id); };
    } else if (timing === 'before first tuple write') deps.hooks.beforeFirstTupleWrite = inject;
    else deps.hooks.betweenTupleWrites = inject;
    const result = await expirePurchaseSafely(deps, ctx.purchaseId);
    assert.equal(result.status, 500);
    for (const row of [stores.Listing[0], stores.ListingPrivate[0]]) {
      assert.equal(row.reservation_token, 'new-token');
      assert.equal(row.reserved_by_email, 'new-buyer');
      assert.equal(row.reservation_revision, 'new-revision');
    }
    assert.notEqual(stores.Listing[0].status, 'active');
  });
}

test('another active purchase blocks payment and inventory mutation', async () => {
  const { deps, stores, ctx, counts } = fixture();
  stores.Purchase.push({ ...stores.Purchase[0], id: 'new-purchase', reservation_token: 'new-token' });
  const result = await expirePurchaseSafely(deps, ctx.purchaseId);
  assert.equal(result.status, 500);
  assert.equal(counts.cancel, 0);
  assert.equal(stores.Listing[0].reservation_token, ctx.token);
});
test('another active purchase arriving immediately before release blocks the transition', async () => {
  const { deps, stores, ctx, counts } = fixture();
  deps.hooks.beforeFirstTupleWrite = async () => {
    stores.Purchase.push({ ...stores.Purchase[0], id: 'new-purchase', reservation_token: 'new-token' });
  };
  assert.equal((await expirePurchaseSafely(deps, ctx.purchaseId)).status, 500);
  assert.equal(counts.active, 0);
  assert.equal(stores.Listing[0].reservation_token, ctx.token);
});

test('already canceled payment and repeated completed cleanup have no repeated effects', async () => {
  const { deps, stores, ctx, counts } = fixture();
  deps.stripe.pisById.get(ctx.piId).status = 'canceled';
  assert.equal((await expirePurchaseSafely(deps, ctx.purchaseId)).status, 200);
  assert.equal((await expirePurchaseSafely(deps, ctx.purchaseId)).status, 200);
  assert.equal(counts.cancel, 0);
  assert.equal(counts.active, 1);
  assert.equal(stores.Purchase[0].transfer_status, 'expired');
  assert.equal(stores.Listing[0].reservation_token, null);
});

test('duplicate workers issue only one cancellation and inventory release', async () => {
  const { deps, ctx, counts } = fixture();
  const results = await Promise.all([expirePurchaseSafely(deps, ctx.purchaseId), expirePurchaseSafely(deps, ctx.purchaseId)]);
  assert.equal(results.filter(r => r.status === 200).length, 1);
  assert.equal(counts.cancel, 1);
  assert.equal(counts.active, 1);
});

test('failed payment retries update one durable alert and later recover safely', async () => {
  const { deps, stores, ctx } = fixture();
  const retrieve = deps.stripe.paymentIntents.retrieve;
  deps.stripe.paymentIntents.retrieve = async () => { throw new Error('unavailable'); };
  for (let i = 0; i < 2; i++) assert.equal((await expirePurchaseSafely(deps, ctx.purchaseId)).status, 500);
  assert.equal(stores.AdminAlert.length, 1);
  deps.stripe.paymentIntents.retrieve = retrieve;
  assert.equal((await expirePurchaseSafely(deps, ctx.purchaseId)).status, 200);
  assert.equal(stores.ListingPrivate[0].recovery_blocked, false);
});

test('duplicate failing workers create only one alert', async () => {
  const { deps, stores, ctx } = fixture();
  deps.stripe.paymentIntents.retrieve = async () => { throw new Error('unavailable'); };
  const results = await Promise.all([expirePurchaseSafely(deps, ctx.purchaseId), expirePurchaseSafely(deps, ctx.purchaseId)]);
  assert.ok(results.every(r => r.status === 500));
  assert.equal(stores.AdminAlert.length, 1);
});

test('alert write failure is reported and retains durable evidence and claim', async () => {
  const { deps, stores, ctx } = fixture();
  deps.stripe.paymentIntents.retrieve = async () => { throw new Error('unavailable'); };
  // The durable incident and claim now live in Postgres. Inject failure at
  // that storage boundary rather than the non-authoritative AdminAlert mirror.
  await deps._mission1.sql(`CREATE SEQUENCE incident_attempts;
    CREATE FUNCTION fail_incident() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN
      PERFORM nextval('incident_attempts'); RAISE EXCEPTION 'alert unavailable'; END$$;
    CREATE TRIGGER fail_incident BEFORE INSERT ON authority_v1.operational_incidents FOR EACH ROW EXECUTE FUNCTION fail_incident()`);
  const result = await expirePurchaseSafely(deps, ctx.purchaseId);
  assert.equal(result.status, 500);
  assert.equal(result.body.alert_proven, false);
  const saved = await deps.paymentAuthority.context(ctx.purchaseId);
  assert.ok(saved.owner);
  assert.equal(saved.context.payment_intent_id, ctx.piId);
  assert.equal(saved.context.snapshot.reservation_token, ctx.token);
  assert.equal((await expirePurchaseSafely(deps, ctx.purchaseId)).status, 500);
  assert.equal(Number((await deps._mission1.sql('SELECT last_value FROM incident_attempts'))[0].last_value), 1);
  assert.notEqual(stores.Listing[0].status, 'active');
});

function capturedFixture(refunded = false) {
  const f = fixture();
  f.deps.stripe.pisById.set(f.ctx.piId, { id: f.ctx.piId, status: 'succeeded', latest_charge: 'ch_1' });
  const charge = { id: 'ch_1', payment_intent: f.ctx.piId, amount: 10500, amount_refunded: refunded ? 10500 : 0, refunded };
  f.deps.stripe.charges = { retrieve: async () => ({ ...charge }) };
  f.deps.stripe.refunds = {
    list: async () => ({ data: [] }),
    create: async (_params, options) => {
      assert.equal(options.idempotencyKey, `pg-release-refund-${f.ctx.piId}`);
      f.counts.refund++; charge.refunded = true; charge.amount_refunded = charge.amount;
      return { id: 're_1', status: 'succeeded' };
    },
  };
  return { ...f, charge };
}
test('captured seller expiry requires review and never invents an automatic refund', async () => {
  const { deps, ctx, stores, counts } = capturedFixture();
  assert.equal((await expirePurchaseSafely(deps, ctx.purchaseId, { sellerExpiry: true })).status, 500);
  assert.equal(counts.refund, 0);
  assert.notEqual(stores.Listing[0].status, 'active');
});
test('fully refunded payment can be reconciled without another refund', async () => {
  const { deps, ctx, counts } = capturedFixture(true);
  assert.equal((await expirePurchaseSafely(deps, ctx.purchaseId)).status, 200);
  assert.equal(counts.refund, 0);
});
test('buyer cancellation refund is verified and idempotent', async () => {
  const { deps, ctx, counts } = capturedFixture();
  assert.equal((await expirePurchaseSafely(deps, ctx.purchaseId, { allowRefund: true })).status, 200);
  assert.equal((await expirePurchaseSafely(deps, ctx.purchaseId, { allowRefund: true })).status, 200);
  assert.equal(counts.refund, 1);
});
test('refund response without externally verified full refund cannot release inventory', async () => {
  const { deps, ctx, stores } = capturedFixture();
  deps.stripe.refunds.create = async () => ({ status: 'succeeded' });
  assert.equal((await expirePurchaseSafely(deps, ctx.purchaseId, { allowRefund: true })).status, 500);
  assert.notEqual(stores.Listing[0].status, 'active');
});

for (const name of ['abortCheckout', 'cancelPurchase']) {
  test(`actual ${name} cannot relist after provider failure`, async () => {
    const { deps, ctx, stores } = fixture();
    deps.stripe.paymentIntents.retrieve = async () => { throw new Error('unavailable'); };
    const result = await (await loadHandler(name, deps))({ purchase_id: ctx.purchaseId });
    assert.equal(result.status, 500);
    assert.equal(stores.Listing[0].reservation_token, ctx.token);
    assert.notEqual(stores.Listing[0].status, 'active');
  });
}
test('generic reservation release cannot bypass payment verification', async () => {
  const { deps, ctx, stores } = fixture();
  const result = await (await loadHandler('releaseReservation', deps))({ listing_id: ctx.listingId });
  assert.equal(result.status, 409);
  assert.equal(stores.Listing[0].reservation_token, ctx.token);
});
test('orphan reservation sweep does not treat failed lookup as empty', async () => {
  const { deps, stores } = fixture();
  stores.Purchase.length = 0;
  stores.Listing[0].reservation_expires_at = new Date(Date.now() - 1000).toISOString();
  deps.entities.PurchasePrivate.filter = async () => { throw new Error('lookup unavailable'); };
  const result = await (await loadHandler('processTransferReminders', deps))();
  assert.equal(result.status, 500);
  assert.notEqual(stores.Listing[0].status, 'active');
});
test('inventory automation preserves a hidden payment quarantine', async () => {
  const { deps, ctx, stores } = fixture();
  stores.Listing[0].status = 'hidden'; stores.Listing[0].hidden_reason = 'checkout_quarantine';
  stores.Listing[0].seat_inventory_id = 'inv_1';
  const inventory = { id: 'inv_1', inventory_status: 'reserved_for_purchase' };
  deps.entities.SeatInventory = { filter: async () => [inventory], update: async (_id, fields) => Object.assign(inventory, fields) };
  await (await loadHandler('syncInventoryOnListingChange', deps))({ data: { id: ctx.listingId } });
  assert.equal(inventory.inventory_status, 'reserved_for_purchase');
});

test('account deletion rejects unresolved payment before any mutation', async () => {
  const { deps, stores } = fixture();
  const before = JSON.stringify(stores);
  const result = await (await loadHandler('deleteAccount', deps))();
  assert.equal(result.status, 409);
  assert.equal(JSON.stringify(stores), before);
});
test('account obligation lookup checks later pages', async () => {
  const { deps, stores } = fixture();
  stores.Purchase.unshift(...Array.from({ length: 100 }, (_, i) => ({ id: `old_${i}`, buyer_email: deps.user.email, transfer_status: 'expired' })));
  await assert.rejects(assertNoOpenAccountObligations(deps.entities, deps.user.email), /OPEN_PAYMENT_OBLIGATIONS/);
});
test('seller expiry older than 72 hours remains retryable', async () => {
  const { deps, stores } = fixture();
  stores.Purchase[0].created_date = new Date(Date.now() - 100 * 3600000).toISOString();
  const result = await (await loadHandler('processTransferReminders', deps))();
  assert.equal(result.status, 200);
  assert.equal(stores.Purchase[0].transfer_status, 'expired');
});
test('ongoing fulfillment before seller expiry stays locked without a false worker failure', async () => {
  const { deps, stores, ctx, counts } = fixture();
  stores.Purchase[0].created_date = new Date(Date.now() - 2 * 3600000).toISOString();
  stores.Listing[0].reservation_expires_at = new Date(Date.now() - 3600000).toISOString();
  stores.ListingPrivate[0].reservation_expires_at = stores.Listing[0].reservation_expires_at;
  const result = await (await loadHandler('processTransferReminders', deps))();
  assert.equal(result.status, 200);
  assert.equal(stores.Listing[0].reservation_token, ctx.token);
  assert.equal(counts.cancel, 0);
});
test('missing Stripe configuration never implies no payment', async () => {
  const { deps, ctx, stores } = fixture();
  deps.stripe = null;
  assert.equal((await expirePurchaseSafely(deps, ctx.purchaseId)).status, 500);
  assert.equal(stores.Listing[0].reservation_token, ctx.token);
  assert.equal(stores.AdminAlert.length, 1);
});
test('lost cancellation response is reconciled without a second cancel', async () => {
  const { deps, ctx, counts } = fixture();
  deps.stripe.paymentIntents.cancel = async () => {
    counts.cancel++;
    deps.stripe.pisById.get(ctx.piId).status = 'canceled';
    throw new Error('response lost');
  };
  assert.equal((await expirePurchaseSafely(deps, ctx.purchaseId)).status, 200);
  assert.equal(counts.cancel, 1);
});
test('partial or pending refunds never cause another refund or inventory release', async () => {
  for (const pending of [false, true]) {
    const { deps, ctx, charge, counts, stores } = capturedFixture();
    if (pending) deps.stripe.refunds.list = async () => ({ data: [{ status: 'pending' }] });
    else charge.amount_refunded = 100;
    assert.equal((await expirePurchaseSafely(deps, ctx.purchaseId, { allowRefund: true })).status, 500);
    assert.equal(counts.refund, 0);
    assert.notEqual(stores.Listing[0].status, 'active');
  }
});
test('seller-confirmed checkout cannot be aborted into available inventory', async () => {
  const { deps, ctx, stores, counts } = fixture();
  stores.Purchase[0].seller_confirmed = true;
  const result = await (await loadHandler('abortCheckout', deps))({ purchase_id: ctx.purchaseId });
  assert.equal(result.status, 500);
  assert.equal(counts.cancel, 0);
  assert.equal(stores.Listing[0].reservation_token, ctx.token);
});
test('unpersisted claim cannot call Stripe or release inventory', async () => {
  const { deps, ctx, stores, counts } = fixture();
  await deps._mission1.sql(`CREATE FUNCTION drop_claim() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RETURN NULL; END$$;
    CREATE TRIGGER drop_claim BEFORE INSERT ON authority_v1.reservation_operations FOR EACH ROW EXECUTE FUNCTION drop_claim()`);
  assert.equal((await expirePurchaseSafely(deps, ctx.purchaseId)).status, 500);
  assert.equal(counts.cancel, 0);
  assert.equal(stores.Listing[0].reservation_token, ctx.token);
});
test('synthetic canary expiry remains owned by the Postgres authority', async () => {
  const { deps, ctx, stores, counts } = fixture();
  stores.Listing[0].notes = '[AUTH_CANARY]';
  const before = JSON.stringify(stores);
  assert.equal((await expirePurchaseSafely(deps, ctx.purchaseId)).status, 500);
  assert.equal(JSON.stringify(stores), before);
  assert.equal(counts.cancel, 0);
});

test('unconfigured seller-expiry handler fails closed before financial or inventory effects', async () => {
  const { deps, stores, counts } = fixture();
  const before = structuredClone(stores.Listing);
  const response = await (await loadHandler('processTransferReminders', deps, false))();
  assert.equal(response.status, 500);
  assert.equal(counts.cancel, 0);
  assert.deepEqual(stores.Listing, before);
});

test('legacy unpaid reminder entry cannot bypass authority with an empty purchase lookup', async () => {
  const { deps, stores, counts } = fixture();
  stores.Purchase.length = 0; stores.PurchasePrivate.length = 0;
  stores.Listing[0].status = 'active';
  for (const row of [stores.Listing[0], stores.ListingPrivate[0]]) row.reservation_expires_at = new Date(0).toISOString();
  const before = structuredClone(stores.Listing);
  const response = await (await loadHandler('processTransferReminders', deps, false))();
  assert.equal(response.status, 500);
  assert.equal(counts.cancel, 0);
  assert.deepEqual(stores.Listing, before);
});

let failed = 0;
for (const { name, run } of cases) {
  try { await run(); console.log(`PASS ${name}`); }
  catch (error) { failed++; console.error(`FAIL ${name}: ${error.stack}`); }
}
console.log(`${cases.length - failed} passed, ${failed} failed`);
await closeMission1Databases();
process.exitCode = failed ? 1 : 0;
