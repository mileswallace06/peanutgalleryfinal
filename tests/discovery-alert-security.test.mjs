import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import {
  DiscoveryAlertError, discoveryWorkerAuthorized, manageDiscoveryAlerts,
  upgradeAlertEligible,
} from '../base44/shared/discoveryAlerts.js';

const now = Date.parse('2026-10-01T18:00:00Z');
const listing = {
  id: 'listing-1', event_id: 'event-1', status: 'active', listing_type: 'live_upgrade',
  is_demo_listing: false, inventory_source: 'fan', quantity: 2, asking_price: 25,
  reservation_mirror_state: 'available', reservation_version: 3,
};
const lp = {
  listing_id: listing.id, event_id: listing.event_id, seller_email: 'seller@example.com',
  proof_status: 'approved', is_demo_listing: false, quantity: 2,
  checkout_quarantined: false, recovery_blocked: false,
  reservation_lifecycle_state: 'available', reservation_version: 3,
  pending_effects_json: '[]',
  reservation_token: null, reserved_by_email: null, reservation_expires_at: null,
};
const event = { id: 'event-1', tm_id: 'tm-1', status: 'live' };
const cached = {
  tm_id: 'tm-1', event_start_utc: '2026-10-01T17:00:00Z',
  event_end_utc: '2026-10-01T21:00:00Z', fetched_at: '2026-10-01T17:55:00Z',
  provider_status: 'onsale',
};
const eligible = ({ l = {}, p = {}, e = {}, c = {}, rows } = {}) =>
  upgradeAlertEligible({ ...listing, ...l }, rows ?? [{ ...lp, ...p }],
    { ...event, ...e }, { ...cached, ...c }, 'buyer@example.com', now);

test('eligible upgrade baseline is positive without treating a cleared revision as a hold', () => {
  assert.equal(eligible(), true);
  assert.equal(eligible({ p: { reservation_revision: 'cleared-revision' } }), true);
});

test('missing, duplicate, mismatched or unapproved private records fail closed', () => {
  for (const value of [
    { rows: [] }, { rows: [lp, { ...lp }] }, { p: { listing_id: 'another' } },
    { p: { event_id: 'another' } }, { l: { event_id: 'another' } },
    { p: { proof_status: 'pending_review' } }, { p: { proof_status: undefined } },
    { p: { seller_email: 'buyer@example.com' } },
  ]) assert.equal(eligible(value), false, JSON.stringify(value));
});

test('every publication, fail-closed and authority hold blocks upgrade alerts', () => {
  for (const status of ['hidden', 'sold', 'cancelled', 'expired', 'pending_transfer', 'pending_verification', 'pending_payout_setup'])
    assert.equal(eligible({ l: { status } }), false, status);
  for (const field of ['checkout_quarantined', 'recovery_blocked', 'seller_cancel_requested_at', 'seller_pause_requested_at'])
    assert.equal(eligible({ p: { [field]: true } }), false, field);
  for (const state of ['reserved', 'frozen', 'sold', 'cancelled', 'expired', '', undefined, 'unknown']) {
    assert.equal(eligible({ p: { reservation_lifecycle_state: state } }), false, `private ${state}`);
    assert.equal(eligible({ l: { reservation_mirror_state: state } }), false, `mirror ${state}`);
  }
  assert.equal(eligible({ l: { hidden_reason: 'checkout_quarantine' } }), false);
});

test('any private reservation evidence blocks, including expired or malformed holds', () => {
  for (const [field, value] of Object.entries({ reservation_token: 'token', reserved_by_email: 'other@example.com', reservation_expires_at: '2020-01-01T00:00:00Z' }))
    assert.equal(eligible({ p: { [field]: value } }), false, field);
  assert.equal(eligible({ p: { reservation_expires_at: 'not-a-date' } }), false);
  for (const pending_effects_json of [undefined, '', '{}', 'invalid', '[{"type":"mirror"}]'])
    assert.equal(eligible({ p: { pending_effects_json } }), false, String(pending_effects_json));
});

test('public reservation leftovers also block a stale available projection', () => {
  for (const [field, value] of Object.entries({ reservation_token: 'token', reserved_by_email: 'other@example.com', reservation_expires_at: '2020-01-01T00:00:00Z' }))
    assert.equal(eligible({ l: { [field]: value } }), false, field);
});

test('demo and synthetic markers never produce upgrade alerts', () => {
  for (const value of [
    { l: { is_demo_listing: true } }, { p: { is_demo_listing: true } },
    { p: { is_demo_listing: undefined } }, { l: { inventory_source: 'pg_demo' } },
    { e: { is_demo: true } }, { e: { is_beta_live: true } },
  ]) assert.equal(eligible(value), false, JSON.stringify(value));
  for (const marker of ['[DEMO]', '[TEST]', '[AUTH_CANARY]']) {
    assert.equal(eligible({ l: { notes: `${marker} synthetic listing` } }), false, `public ${marker}`);
    assert.equal(eligible({ p: { notes: `${marker} synthetic listing` } }), false, `private ${marker}`);
  }
});

test('mismatched quantities and lagging authority versions fail closed', () => {
  assert.equal(eligible({ p: { quantity: 1 } }), false);
  assert.equal(eligible({ p: { reservation_version: 4 } }), false);
  for (const quantity of [0, -1, 1.5, NaN, Infinity, '2'])
    assert.equal(eligible({ l: { quantity } }), false, String(quantity));
});

test('local cancellation or postponement cannot be overridden by an onsale cache', () => {
  for (const status of ['ended', 'cancelled', 'canceled'])
    assert.equal(eligible({ e: { status } }), false, `status ${status}`);
  for (const provider_status of ['cancelled', 'canceled', 'postponed'])
    assert.equal(eligible({ e: { provider_status } }), false, `provider ${provider_status}`);
});

test('invalid, closed or not-yet-open windows and stale provider metadata fail closed', () => {
  for (const value of [
    { l: { upgrade_window_opens_at: '2026-10-01T18:00:01Z' } },
    { l: { upgrade_window_opens_at: 'invalid' } },
    { l: { upgrade_window_closes_at: '2026-10-01T18:00:00Z' } },
    { l: { upgrade_window_closes_at: 'invalid' } },
    { e: { transfer_window_status: 'closed' } },
    { e: { transfer_window_closes_at: 'invalid' } },
    { c: { tm_id: 'another' } }, { c: { provider_status: 'cancelled' } },
    { c: { fetched_at: '2026-10-01T11:00:00Z' } },
    { c: { event_end_utc: '2026-10-01T18:00:00Z' } },
    { c: { time_tba: true } },
  ]) assert.equal(eligible(value), false, JSON.stringify(value));
});

test('worker authorization permits only an admin or exact configured scheduler secret', async () => {
  const secret = 'x'.repeat(40);
  const check = args => discoveryWorkerAuthorized({ configuredSecret: secret, ...args });
  assert.equal(await check({ user: { role: 'admin' } }), true);
  assert.equal(await check({ user: null, providedSecret: secret }), true);
  for (const args of [
    { user: null }, { user: null, providedSecret: `${secret}x` },
    { user: null, providedSecret: 'y'.repeat(40) },
    { user: { role: 'user' }, providedSecret: secret },
    { user: null, configuredSecret: '', providedSecret: '' },
    { user: null, configuredSecret: 'short', providedSecret: 'short' },
  ]) assert.equal(await check(args), false, JSON.stringify(args));
});

// Execute the deployed endpoint body with local substitutes for runtime imports.
// No network, secrets, real users or datastore are touched.
function endpoint(name, { user = null, env = {}, authThrows = false } = {}) {
  let handler, serviceReads = 0, workCalls = 0;
  const source = readFileSync(new URL(`../base44/functions/${name}/entry.ts`, import.meta.url), 'utf8')
    .replace(/^import .*;\r?\n/gm, '');
  const client = { auth: { me: async () => { if (authThrows) throw new Error('auth unavailable'); return user; } } };
  Object.defineProperty(client, 'asServiceRole', { get() { serviceReads += 1; return { entities: {} }; } });
  vm.runInNewContext(source, {
    Deno: { env: { get: name => env[name] }, serve: fn => { handler = fn; } },
    Response, URLSearchParams, AbortSignal, DiscoveryAlertError, discoveryWorkerAuthorized,
    createClientFromRequest: () => client,
    processDiscoveryAlerts: async () => { workCalls += 1; return { ok: true }; },
    manageDiscoveryAlerts: async () => { workCalls += 1; return { enabled: false }; },
  });
  return { call: (method = 'POST', headers = {}) => handler(new Request('https://local.invalid', { method, headers })),
    counts: () => ({ serviceReads, workCalls }) };
}

test('deployed worker rejects wrong method, unauthenticated and ordinary user before service access', async () => {
  const secret = 's'.repeat(40);
  for (const [options, method, headers, status] of [
    [{}, 'GET', {}, 405], [{}, 'POST', {}, 403],
    [{ authThrows: true }, 'POST', {}, 403],
    [{ user: { role: 'user' }, env: { DISCOVERY_ALERT_SCHEDULER_SECRET: secret } }, 'POST', { 'x-discovery-scheduler-secret': secret }, 403],
    [{ user: { role: 'admin' } }, 'POST', {}, 503],
  ]) {
    const runner = endpoint('processDiscoveryAlerts', options);
    assert.equal((await runner.call(method, headers)).status, status);
    assert.deepEqual(runner.counts(), { serviceReads: 0, workCalls: 0 });
  }
});

test('deployed worker enabled gate and exact scheduler secret permit one local processing call', async () => {
  const secret = 's'.repeat(40);
  const runner = endpoint('processDiscoveryAlerts', { env: { DISCOVERY_ALERTS_ENABLED: 'true', DISCOVERY_ALERT_SCHEDULER_SECRET: secret } });
  assert.equal((await runner.call('POST', { 'x-discovery-scheduler-secret': secret })).status, 200);
  assert.deepEqual(runner.counts(), { serviceReads: 1, workCalls: 1 });
});

test('deployed preference endpoint requires authentication before service access', async () => {
  for (const [options, method, status] of [[{}, 'POST', 401], [{ authThrows: true }, 'POST', 401], [{}, 'GET', 405]]) {
    const runner = endpoint('manageDiscoveryAlerts', options);
    assert.equal((await runner.call(method)).status, status);
    assert.deepEqual(runner.counts(), { serviceReads: 0, workCalls: 0 });
  }
});

test('preference recipient identity is taken from authentication, never body recipient fields', async () => {
  const reads = [], writes = [];
  const entities = { DiscoveryAlertPreference: {
    filter: async query => { reads.push(query); return []; },
    create: async value => { writes.push(value); return value; },
  } };
  await manageDiscoveryAlerts({ entities, user: { id: 'owner', email: 'owner@example.com' }, now: () => now }, {
    action: 'set_preferences', enabled: false, user_id: 'victim', user_email: 'victim@example.com',
  });
  assert.deepEqual(reads, [{ user_id: 'owner' }]);
  assert.equal(writes[0].user_id, 'owner');
  assert.equal(writes[0].user_email, 'owner@example.com');
});
