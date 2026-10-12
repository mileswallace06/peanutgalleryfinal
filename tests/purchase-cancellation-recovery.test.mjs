/**
 * Execute the real PurchaseSuccess cancellation callback in a sealed fixture.
 * All API calls, confirmations, state setters and reads below are local fakes.
 * This tests callback recovery, not provider refunds or browser rendering.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(process.env.PG_CANCELLATION_SOURCE_FILE || new URL('../src/pages/PurchaseSuccess.jsx', import.meta.url), 'utf8');
const start = '  const handleCancel = async () => {';
const end = '\n\n  const handleDispute = ';
assert.equal(source.split(start).length, 2, 'One actual cancellation callback');
const from = source.indexOf(start);
const to = source.indexOf(end, from);
assert.ok(to > from, 'Complete cancellation callback must be found');
const callback = source.slice(from, to);
const recovery = 'The cancellation result could not be confirmed. Refresh this page to check the latest status before trying again.';
const purchaseId = 'synthetic-cancellation-fixture-not-a-real-purchase';
const clone = value => JSON.parse(JSON.stringify(value));
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
function fixture({ accept = true, response = async () => ({ data: { success: true } }), refresh = async () => {} } = {}) {
  const state = { busy: false, error: '', busyChanges: [], errorChanges: [], calls: [], reads: 0, confirmations: 0 };
  const cancel = vm.runInNewContext(`${callback}\nhandleCancel;`, {
    purchase: Object.freeze({ id: purchaseId }),
    confirm: message => {
      assert.equal(message, 'Cancel this purchase? The payment will be refunded.', 'Existing confirmation wording is unchanged');
      state.confirmations++;
      return accept;
    },
    setActionLoading: value => { state.busy = value; state.busyChanges.push(value); },
    setError: value => { state.error = value; state.errorChanges.push(value); },
    base44: { functions: { invoke: async (name, args) => {
      assert.equal(name, 'cancelPurchase', 'Only the local cancellation fake is permitted');
      assert.deepEqual(clone(args), { purchase_id: purchaseId }, 'Existing endpoint payload is unchanged');
      state.calls.push({ name, args: clone(args) });
      return response(state.calls.length);
    } } },
    load: async () => { state.reads++; await refresh(); },
  }, { timeout: 1000 });
  return { state, cancel };
}
const assertRecovered = state => {
  assert.equal(state.busy, false, 'Controls must be released after failure');
  assert.equal(state.error, recovery, 'Show uncertain outcome and an explicit read-only recovery step');
  assert.equal(state.calls.length, 1, 'Never automatically retry a cancellation');
  assert.deepEqual(state.busyChanges, [true, false]);
};

test('declining confirmation does not send a request or change state', async () => {
  const { state, cancel } = fixture({ accept: false });
  await cancel();
  assert.equal(state.confirmations, 1);
  assert.equal(state.calls.length, 0); assert.equal(state.reads, 0);
  assert.equal(state.error, ''); assert.deepEqual(state.busyChanges, []);
});

test('successful response preserves exact request and refresh behavior', async () => {
  const { state, cancel } = fixture();
  await cancel();
  assert.equal(state.calls.length, 1); assert.equal(state.reads, 1);
  assert.equal(state.error, ''); assert.deepEqual(state.busyChanges, [true, false]);
});

test('explicit server error is retained and controls are released', async () => {
  const { state, cancel } = fixture({ response: async () => ({ data: { error: 'Synthetic cancellation not allowed' } }) });
  await cancel();
  assert.equal(state.error, 'Synthetic cancellation not allowed');
  assert.equal(state.busy, false); assert.equal(state.reads, 0);
  assert.equal(state.calls.length, 1);
});

test('rejected request releases controls without inventing a cancellation result', async () => {
  const { state, cancel } = fixture({ response: async () => { throw new Error('PRIVATE_TRANSPORT_DIAGNOSTIC'); } });
  await cancel();
  assertRecovered(state); assert.equal(state.reads, 0);
  assert.doesNotMatch(state.error, /PRIVATE_TRANSPORT_DIAGNOSTIC/);
});

for (const [label, value] of [['missing', undefined], ['null', { data: null }], ['string', { data: 'unexpected' }], ['array', { data: [] }]]) {
  test(`${label} response is recoverable uncertainty, not a success`, async () => {
    const { state, cancel } = fixture({ response: async () => value });
    await cancel();
    assertRecovered(state); assert.equal(state.reads, 0);
  });
}

test('successful request keeps controls busy until its refresh finishes', async () => {
  const wait = deferred();
  const { state, cancel } = fixture({ refresh: () => wait.promise });
  const running = cancel();
  // Flush only deterministic promise work, not a time-based delay.
  for (let i = 0; i < 10 && !state.reads; i++) await Promise.resolve();
  assert.equal(state.reads, 1); assert.equal(state.busy, true);
  wait.resolve(); await running;
  assert.equal(state.busy, false); assert.equal(state.error, '');
});

test('late rejection releases the waiting controls', async () => {
  const wait = deferred();
  const { state, cancel } = fixture({ response: () => wait.promise });
  const running = cancel();
  assert.equal(state.busy, true); assert.equal(state.calls.length, 1);
  wait.reject(new Error('Synthetic late transport failure'));
  await running;
  assertRecovered(state); assert.equal(state.reads, 0);
});

test('refresh rejection still releases controls without repeating the write', async () => {
  const { state, cancel } = fixture({ refresh: async () => { throw new Error('Synthetic read failure'); } });
  await cancel();
  assertRecovered(state); assert.equal(state.reads, 1);
});

test('explicit later retry clears the old message and can succeed', async () => {
  const { state, cancel } = fixture({ response: async call => {
    if (call === 1) throw new Error('Synthetic transport failure');
    return { data: { success: true } };
  } });
  await cancel(); assertRecovered(state);
  await cancel();
  assert.equal(state.confirmations, 2); assert.equal(state.calls.length, 2);
  assert.equal(state.reads, 1); assert.equal(state.busy, false); assert.equal(state.error, '');
  assert.deepEqual(state.busyChanges, [true, false, true, false]);
});

test('object response without an error retains the existing read-back contract', async () => {
  const { state, cancel } = fixture({ response: async () => ({ data: {} }) });
  await cancel();
  assert.equal(state.reads, 1); assert.equal(state.busy, false); assert.equal(state.error, '');
  assert.equal(state.calls.length, 1);
});
