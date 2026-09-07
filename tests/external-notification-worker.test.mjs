import assert from 'node:assert/strict';
import { test, before, after } from 'node:test';
import { randomUUID } from 'node:crypto';
import { notificationDatabase, defaultSeed, notification, barrier } from './helpers/notificationWorker.mjs';
import { runOnce, recoverReturned, publicStatus, WriteNotSent } from '../workers/notification/worker.mjs';
import { main } from '../workers/notification/cli.mjs';
import { dispatchSaleNotificationsDeps } from '../base44/shared/saleDispatch.js';
import { dispatchWebhookNotifications } from '../base44/shared/webhookNotifications.js';

let db;
before(async () => { db = await notificationDatabase(); });
after(async () => { await db?.close(); });
const run = (h, options = {}) => runOnce({ ...h, ...options });
const intent = () => ({ write_id: randomUUID(), entity: 'Notification', target_id: 'sale_a', patch: { dispatch_status: 'dispatched' }, dedupe_key: null });

test('existing in-app content, canonicalization and skipped channels match shared dispatch behavior', async () => {
  const seed = defaultSeed();
  seed.Notification.push(notification('sale_b', 'sale_created:purchase_synthetic', 'sale_created', 'pending', 2),
    notification('web_b', 'webhook:evt_synthetic', 'sale_complete', 'pending', 2));
  const h = await db.harness(seed), expected = await db.harness(structuredClone(seed));
  await dispatchSaleNotificationsDeps(expected.deps);
  await dispatchWebhookNotifications(expected.deps);
  assert.equal((await run(h)).ok, true);
  for (const entity of ['Notification', 'Purchase', 'PurchasePrivate']) {
    const comparable = rows => rows.map(row => { const copy = { ...row }; delete copy.updated_date; return copy; });
    assert.deepEqual(comparable(h.rows(entity)), comparable(expected.rows(entity)));
  }
  assert.deepEqual(h.deps._state.providerCalls, { push: 0, email: 0 });
  assert.equal(h.rows('Purchase')[0].payment_status, 'captured');
  assert.equal(h.rows('PurchasePrivate')[0].payment_captured, true);
  assert.ok((await h.journal()).every(row => row.phase === 'applied'));
});

test('ordinary overlapping workers cannot both dispatch; pending writes retain ownership', async () => {
  const h = await db.harness(), second = h.coordinatorFor(await db.connect('worker')), gate = barrier();
  const original = h.entities.Notification.update;
  h.entities.Notification.update = async (...args) => { await gate.wait(); return original(...args); };
  const first = run(h);
  await gate.reached;
  assert.equal((await run(h, { coordinator: second })).code, 'WRITE_BLOCKED');
  assert.equal((await recoverReturned({ ...h, coordinator: second })).code, 'WRITE_BLOCKED');
  gate.release();
  assert.equal((await first).ok, true);
  assert.equal(h.calls.filter(call => call.entity === 'Notification' && call.args[0] === 'sale_a').length, 1);
});

test('overlap before a write is busy; explicit idle recovery fences an old worker', async () => {
  const h = await db.harness(), gate = barrier();
  const filter = h.entities.Notification.filter;
  let firstRead = true;
  h.entities.Notification.filter = async (...args) => {
    if (firstRead) { firstRead = false; await gate.wait(); }
    return filter(...args);
  };
  const old = run(h);
  await gate.reached;
  assert.equal((await run(h)).code, 'BUSY');
  assert.equal((await recoverReturned(h)).ok, true);
  gate.release();
  assert.equal((await old).ok, false);
  assert.equal(h.calls.length, 0);
  assert.equal((await run(h)).ok, true);
});

test('known NOT SENT rejection is retried, without duplicating completed updates', async () => {
  const h = await db.harness(), original = h.entities.Notification.update;
  let reject = true;
  h.entities.Notification.update = async (...args) => {
    if (reject) { reject = false; throw new WriteNotSent(); }
    return original(...args);
  };
  assert.equal((await run(h)).ok, false);
  assert.equal((await h.coordinator.status()).pending, null);
  assert.equal((await run(h)).ok, true);
  const count = h.calls.length;
  assert.equal((await run(h)).ok, true);
  assert.equal(h.calls.length, count);
  assert.equal((await h.journal()).filter(row => row.phase === 'not_sent').length, 1);
});

test('timeout and matching current values do not resolve a possibly outstanding write', async () => {
  const h = await db.harness(), original = h.entities.Notification.update;
  h.entities.Notification.update = async (...args) => { await original(...args); throw new Error('synthetic timeout with PRIVATE_VALUE'); };
  const result = await run(h);
  assert.equal(result.code, 'WRITE_OUTCOME_UNKNOWN');
  assert.equal(JSON.stringify(result).includes('PRIVATE_VALUE'), false);
  assert.equal(h.calls.length, 1);
  await db.admin.query("UPDATE notification_worker.control SET updated_at='2000-01-01' WHERE scope=$1", [h.scope]);
  assert.equal((await run(h)).code, 'WRITE_BLOCKED');
  assert.equal((await recoverReturned(h)).code, 'WRITE_BLOCKED');
  assert.equal((await h.coordinator.status()).pending.phase, 'started');
  assert.equal(publicStatus(await h.coordinator.status()).pending_write.length, 36);
});

test('response contradicting fresh state stays observable and never triggers an automatic rewrite', async () => {
  const h = await db.harness();
  h.entities.Notification.update = async () => ({ id: 'sale_a', dispatch_status: 'dispatched' });
  assert.equal((await run(h)).code, 'WRITE_VERIFICATION_REQUIRED');
  assert.equal((await h.coordinator.status()).pending.phase, 'returned');
  assert.equal((await recoverReturned(h)).code, 'WRITE_VERIFICATION_REQUIRED');
  assert.equal((await run(h)).code, 'WRITE_BLOCKED');
  assert.equal(h.rows('Notification')[0].dispatch_status, 'pending');
});

test('lost terminal-receipt persistence remains ambiguous even though Base44 applied the write', async () => {
  const h = await db.harness();
  assert.equal((await run(h, { coordinator: { ...h.coordinator, returned: async () => { throw new Error('lost acknowledgement'); } } })).code, 'COORDINATION_FAILED');
  assert.equal(h.rows('Notification')[0].dispatch_status, 'dispatched');
  assert.equal((await recoverReturned(h)).code, 'WRITE_BLOCKED');
});

test('terminal receipt survives interrupted verification and resumes read-only under maintenance', async () => {
  const h = await db.harness();
  const coordinator = { ...h.coordinator, finishWrite: async () => { throw new Error('interrupted acknowledgement'); } };
  assert.equal((await run(h, { coordinator })).code, 'COORDINATION_FAILED');
  const calls = h.calls.length;
  const oldOwner = (await h.coordinator.status()).owner_token;
  await h.configure(true);
  assert.equal((await recoverReturned(h)).ok, true);
  assert.equal(h.calls.length, calls);
  await assert.rejects(h.coordinator.begin(oldOwner, intent()));
  await h.configure(false);
  assert.equal((await run(h)).ok, true);
  assert.equal(h.calls.filter(call => call.args[0] === 'sale_a').length, 1);
});

test('verification read failure remains returned, then known read recovery completes', async () => {
  const h = await db.harness(), original = h.entities.Notification.filter;
  let failed = false;
  h.entities.Notification.filter = async (...args) => {
    if (!failed && args[0].id === 'sale_a' && h.calls.length) { failed = true; throw new Error('read disconnected'); }
    return original(...args);
  };
  assert.equal((await run(h)).code, 'WRITE_VERIFICATION_REQUIRED');
  const count = h.calls.length;
  assert.equal((await recoverReturned(h)).ok, true);
  assert.equal(h.calls.length, count);
  assert.equal((await run(h)).ok, true);
});

test('completed effects before lost run completion recover without repeating writes', async () => {
  const h = await db.harness();
  assert.equal((await run(h, { coordinator: { ...h.coordinator, finishRun: async () => { throw new Error(); } } })).ok, false);
  assert.equal((await h.coordinator.status()).pending, null);
  assert.equal((await run(h)).code, 'BUSY');
  const count = h.calls.length;
  assert.equal((await recoverReturned(h)).ok, true);
  assert.equal((await run(h)).ok, true);
  assert.equal(h.calls.length, count);
});

test('lost begin acknowledgement blocks retry even if this worker never issued a Base44 request', async () => {
  const h = await db.harness();
  const coordinator = { ...h.coordinator, begin: async (...args) => { await h.coordinator.begin(...args); throw new Error(); } };
  assert.equal((await run(h, { coordinator })).ok, false);
  assert.equal(h.calls.length, 0);
  assert.equal((await recoverReturned(h)).code, 'WRITE_BLOCKED');
});

test('only an independent operator may reconcile an unknown outcome; evidence and maintenance are mandatory', async () => {
  const h = await db.harness(), original = h.entities.Notification.update;
  h.entities.Notification.update = async (...args) => { await original(...args); throw new Error(); };
  await run(h);
  const status = await h.coordinator.status();
  const sql = 'SELECT notification_worker.reconcile_unknown($1,$2,$3,$4,$5,$6)';
  const args = [h.scope, status.owner_token, status.pending.write_id, 'applied', 'sale_a', JSON.stringify({ reference: 'synthetic-independent-evidence', executor_stopped: true, provider_terminal: true })];
  await assert.rejects(db.worker.query(sql, args));
  const operator = await db.connect('operator');
  await assert.rejects(operator.query(sql, args));
  await h.configure(true);
  await assert.rejects(operator.query(sql, [...args.slice(0, 5), '{}']));
  await operator.query(sql, args);
  // Operator acknowledgement alone does not complete delivery or resume a job.
  assert.equal((await h.coordinator.status()).pending.phase, 'returned');
  assert.equal((await recoverReturned(h)).ok, true);
  await assert.rejects(h.coordinator.begin(status.owner_token, intent()));
});

test('operator-confirmed not-applied outcome permits a new attempt; no runtime clear-claim API', async () => {
  const h = await db.harness(), owner = randomUUID();
  await h.coordinator.claim(owner);
  const pending = intent(); await h.coordinator.begin(owner, pending);
  await h.configure(true);
  await db.admin.query('SELECT notification_worker.reconcile_unknown($1,$2,$3,$4,$5,$6)',
    [h.scope, owner, pending.write_id, 'not_applied', null, JSON.stringify({ reference: 'synthetic-not-sent-proof', executor_stopped: true, provider_terminal: true })]);
  await assert.rejects(h.coordinator.returned(owner, pending.write_id, 'sale_a'));
  await h.configure(false);
  assert.equal((await run(h)).ok, true);
});

test('late duplicates respect an earlier canonical across bounded pages and later runs', async () => {
  const h = await db.harness();
  await run(h);
  h.rows('Notification').push(notification('late_web', 'webhook:evt_synthetic', 'sale_complete', 'pending', 2));
  for (let i = 0; i < 4; i++) await run(h, { batchSize: 1 });
  assert.equal(h.rows('Notification').find(row => row.id === 'web_a').dispatch_status, 'dispatched');
  assert.equal(h.rows('Notification').find(row => row.id === 'late_web').dispatch_status, 'superseded');
});

test('known integrity failures do not starve a later backlog and repeated alerts are deduplicated', async () => {
  const seed = defaultSeed(); seed.PurchasePrivate = [];
  for (let i = 2; i < 8; i++) seed.Notification.push(notification(`web_${i}`, `webhook:event_${i}`, 'sale_complete', 'pending', i));
  const h = await db.harness(seed);
  for (let i = 0; i < 20; i++) await run(h, { batchSize: 1 });
  assert.ok(h.rows('Notification').filter(row => row.type !== 'sale_created').every(row => row.dispatch_status === 'dispatched'));
  assert.equal(h.rows('Notification')[0].dispatch_status, 'pending');
  assert.equal(h.rows('AdminAlert').length, 1);
  h.rows('AdminAlert')[0].resolved = true;
  assert.equal(h.rows('Notification')[0].dispatch_status, 'pending');
});

test('oversized duplicate groups are not partially canonicalized and do not stop other groups', async () => {
  const seed = defaultSeed();
  seed.Notification.push(notification('sale_b', 'sale_created:purchase_synthetic'), notification('sale_c', 'sale_created:purchase_synthetic'));
  const h = await db.harness(seed);
  const result = await run(h, { groupLimit: 2 });
  assert.equal(result.ok, false);
  assert.equal(result.issues[0].code, 'GROUP_TOO_LARGE');
  assert.ok(h.rows('Notification').filter(row => row.type === 'sale_created').every(row => row.dispatch_status === 'pending'));
  assert.equal(h.rows('Notification').find(row => row.id === 'web_a').dispatch_status, 'dispatched');
});

test('bounded write budget makes progress on subsequent sweeps', async () => {
  const h = await db.harness();
  for (let i = 0; i < 6; i++) assert.ok((await run(h, { maxWrites: 1 })).writes <= 1);
  assert.ok(h.rows('Notification').every(row => row.dispatch_status === 'dispatched'));
  assert.equal(h.rows('PurchasePrivate')[0].seller_email_status, 'skipped');
});

test('existing dispatching state is reported and never reclaimed because time passed', async () => {
  const seed = defaultSeed(); seed.Notification[0].dispatch_status = 'dispatching';
  const h = await db.harness(seed);
  assert.equal((await run(h)).ok, false);
  assert.equal(h.rows('Notification')[0].dispatch_status, 'dispatching');
});

test('all maintenance gates fail closed; runtime role cannot enable itself or write financial fields', async () => {
  const h = await db.harness();
  assert.equal((await run(h, { maintenance: async () => true })).code, 'MAINTENANCE');
  assert.equal((await run(h, { maintenance: async () => { throw new Error('private'); } })).code, 'MAINTENANCE_UNVERIFIED');
  await h.configure(true);
  assert.equal((await run(h)).code, 'MAINTENANCE');
  assert.equal(h.calls.length, 0);
  await assert.rejects(db.worker.query('SELECT notification_worker.configure($1,false,$2)', [h.scope, 'untrusted-change']));
  await assert.rejects(db.worker.query('UPDATE notification_worker.control SET owner_token=NULL'));
  await h.configure(false);
  const owner = randomUUID(); await h.coordinator.claim(owner);
  await assert.rejects(h.coordinator.begin(owner, { ...intent(), entity: 'Purchase', patch: { payment_status: 'cancelled' } }));
  await assert.rejects(h.coordinator.begin(owner, { ...intent(), entity: 'Listing', patch: { status: 'active' } }));
});

test('shutdown before request records known-not-sent; shutdown during response retains a recoverable receipt', async () => {
  const h = await db.harness(), controller = new AbortController();
  const coordinator = { ...h.coordinator, begin: async (...args) => { const r = await h.coordinator.begin(...args); controller.abort(); return r; } };
  assert.equal((await run(h, { coordinator, signal: controller.signal })).ok, false);
  assert.equal(h.calls.length, 0);
  assert.equal((await h.coordinator.status()).pending, null);
  const other = await db.harness(), next = new AbortController(), original = other.entities.Notification.update;
  other.entities.Notification.update = async (...args) => { const row = await original(...args); next.abort(); return row; };
  assert.equal((await run(other, { signal: next.signal })).ok, false);
  assert.equal((await other.coordinator.status()).pending.phase, 'returned');
  assert.equal((await recoverReturned(other)).ok, true);
});

test('CLI defaults to maintenance without opening connections; scheduled loop is serial and 60 seconds', async () => {
  const controller = new AbortController(), delays = [], outputs = [];
  const options = { env: {}, signal: controller.signal, output: value => outputs.push(value),
    connectDb: async () => { throw new Error('must not connect'); }, loadAdapter: async () => { throw new Error('must not connect'); },
    clock: () => 10, sleep: async ms => { delays.push(ms); if (delays.length === 2) controller.abort(); } };
  assert.equal(await main(['--schedule'], options), 0);
  assert.deepEqual(delays, [60_000, 60_000]);
  assert.equal(outputs.length, 2);
  assert.ok(outputs.every(row => row.code === 'MAINTENANCE'));
});

test('ambiguous alert creation is retained and cannot duplicate the alert on retry', async () => {
  const seed = defaultSeed(); seed.PurchasePrivate = [];
  const h = await db.harness(seed), create = h.entities.AdminAlert.create;
  h.entities.AdminAlert.create = async fields => { await create(fields); throw new Error('lost alert response'); };
  assert.equal((await run(h)).code, 'WRITE_OUTCOME_UNKNOWN');
  assert.equal(h.rows('AdminAlert').length, 1);
  assert.equal((await run(h)).code, 'WRITE_BLOCKED');
  assert.equal((await recoverReturned(h)).code, 'WRITE_BLOCKED');
  assert.equal((await h.coordinator.status()).pending.entity, 'AdminAlert');
});

test('active scheduled loop awaits a slow write; no overlapping tick or catch-up fan-out', async () => {
  const h = await db.harness(), gate = barrier(), controller = new AbortController();
  const update = h.entities.Notification.update, outputs = [], delays = [];
  let elapsed = 0;
  h.entities.Notification.update = async (...args) => { await gate.wait(); return update(...args); };
  const running = main(['--schedule'], { env: { MAINTENANCE_MODE: 'false' }, signal: controller.signal,
    loadAdapter: async () => ({ entities: h.entities, maintenance: h.maintenance }), connectDb: async () => h.coordinator,
    output: value => outputs.push(value), clock: () => elapsed,
    sleep: async ms => { delays.push(ms); controller.abort(); } });
  await gate.reached;
  elapsed = 61_000;
  assert.deepEqual(delays, []);
  assert.deepEqual(outputs, []);
  gate.release();
  assert.equal(await running, 0);
  assert.deepEqual(delays, [0]);
  assert.equal(outputs.length, 1);
});

test('adapter shutdown errors are sanitized and return non-success', async () => {
  const h = await db.harness(), outputs = [];
  assert.equal(await main(['--once'], { env: { MAINTENANCE_MODE: 'false' }, output: value => outputs.push(value),
    loadAdapter: async () => ({ entities: h.entities, maintenance: h.maintenance, close: async () => { throw new Error('PRIVATE_VALUE'); } }),
    connectDb: async () => h.coordinator }), 2);
  assert.equal(outputs.at(-1).code, 'ADAPTER_CLOSE_FAILED');
  assert.equal(JSON.stringify(outputs).includes('PRIVATE_VALUE'), false);
});

test('CLI runs with injected workload dependencies, closes cleanly and sanitizes initialization errors', async () => {
  const h = await db.harness(), outputs = []; let closed = 0;
  assert.equal(await main(['--once'], { env: { MAINTENANCE_MODE: 'false' }, output: value => outputs.push(value),
    loadAdapter: async () => ({ entities: h.entities, maintenance: h.maintenance, close: async () => { closed++; } }),
    connectDb: async () => h.coordinator }), 0);
  assert.equal(closed, 1);
  assert.equal(outputs[0].ok, true);
  assert.equal(await main(['--once'], { env: { MAINTENANCE_MODE: 'false' }, output: value => outputs.push(value),
    loadAdapter: async () => { throw new Error('PRIVATE_VALUE synthetic token'); } }), 2);
  assert.equal(JSON.stringify(outputs).includes('PRIVATE_VALUE'), false);
  const messages = [];
  assert.equal(await main(['--once'], { env: { MAINTENANCE_MODE: 'false', BASE44_SERVICE_TOKEN: 'ignored_synthetic_value' }, output: value => messages.push(value) }), 2);
  assert.equal(messages[0].code, 'NOTIFICATION_ADAPTER_REQUIRED');
});
