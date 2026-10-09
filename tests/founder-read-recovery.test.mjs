import assert from 'node:assert/strict';
import test from 'node:test';
import { readOperationalRows, operationalValue } from '../src/lib/operationalReads.js';
import { createNavigationSpikeCoordinator, NAVIGATION_SPIKE_TITLE } from '../src/lib/navigationSpikeAlert.js';
const logs = Array.from({ length: 3 }, (_, i) => ({ id: `failure-${i}`, result: 'navigation_error', timestamp: '2026-10-09T10:00:00Z' }));
const memory = () => { const values = new Map(); return { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value) }; };
function entity() { const calls = []; const rows = []; return { calls, rows, filter: async () => rows, create: async data => { calls.push(data); rows.push(data); return data; } }; }
test('independent success, failure and malformed sources never collapse into empty success', async () => {
 const sources = await Promise.all([readOperationalRows(() => [{ id: 'one' }]), readOperationalRows(() => { throw new Error('blocked'); }), readOperationalRows(() => null), readOperationalRows(() => [])]);
 assert.deepEqual(sources.map(s => s.status), ['ready', 'error', 'unavailable', 'ready']);
 assert.equal(sources[0].rows.length, 1); assert.equal(operationalValue(sources[1], 0), 'Unavailable'); assert.equal(operationalValue(sources[3], 0), 0);
});
test('read timeout settles and a late rejected response cannot escape or report success', async () => {
 let reject; const deferred = new Promise((_, fail) => { reject = fail; });
 assert.equal((await readOperationalRows(() => deferred, 5)).status, 'error');
 reject(new Error('late')); await new Promise(resolve => setTimeout(resolve, 0));
});
test('failed read recovers independently on retry', async () => {
 let fail = true; const read = () => fail ? Promise.reject(new Error('first')) : [{ id: 'recovered' }];
 assert.equal((await readOperationalRows(read)).status, 'error'); fail = false;
 assert.deepEqual((await readOperationalRows(read)).rows, [{ id: 'recovered' }]);
});
test('an empty log sample and sub-threshold failure sample never write an alert', async () => {
 const api = entity(); const ensure = createNavigationSpikeCoordinator();
 assert.equal(await ensure(api, []), 'not-needed'); assert.equal(await ensure(api, logs.slice(0,2)), 'not-needed'); assert.equal(api.calls.length, 0);
});
test('simultaneous mounts and repeated refresh share one operational alert', async () => {
 const api = entity(); const ensure = createNavigationSpikeCoordinator(); let release;
 api.filter = () => new Promise(resolve => { release = () => resolve([]); });
 const a = ensure(api, logs); const b = ensure(api, logs); await Promise.resolve(); release();
 await Promise.all([a,b]); await ensure(api, logs); assert.equal(api.calls.length, 1);
});
test('remount/reload with session memory does not recreate the same incident', async () => {
 const api = entity(); const storage = memory(); await createNavigationSpikeCoordinator()(api, logs, storage);
 api.rows.length = 0;
 assert.equal(await createNavigationSpikeCoordinator()(api, logs, storage), 'already-recorded'); assert.equal(api.calls.length, 1);
});
test('existing unresolved spike deduplicates across a fresh session', async () => {
 const api = entity(); api.rows.push({ title: NAVIGATION_SPIKE_TITLE, resolved: false });
 assert.equal(await createNavigationSpikeCoordinator()(api, logs, memory()), 'recorded'); assert.equal(api.calls.length, 0);
});
test('failed or malformed alert lookup blocks writes and remains retryable', async () => {
 for (const result of ['reject', undefined, {}]) {
  const api = entity(); api.filter = async () => { if (result === 'reject') throw new Error('read failed'); return result; };
  const ensure = createNavigationSpikeCoordinator(); assert.equal(await ensure(api, logs), 'unavailable'); assert.equal(api.calls.length, 0);
  api.filter = async () => []; assert.equal(await ensure(api, logs), 'recorded'); assert.equal(api.calls.length, 1);
 }
});
test('uncertain failed create is rechecked against persisted alert before another write', async () => {
 const api = entity(); api.create = async data => { api.calls.push(data); api.rows.push(data); throw new Error('response lost'); };
 const ensure = createNavigationSpikeCoordinator(); assert.equal(await ensure(api, logs), 'unavailable');
 assert.equal(await ensure(api, logs), 'recorded'); assert.equal(api.calls.length, 1);
});
test('storage denied does not break the in-memory guard', async () => {
 const api = entity(); const ensure = createNavigationSpikeCoordinator(); const storage = { getItem: () => { throw new Error(); }, setItem: () => { throw new Error(); } };
 await ensure(api, logs, storage); await ensure(api, logs, storage); assert.equal(api.calls.length, 1);
});
