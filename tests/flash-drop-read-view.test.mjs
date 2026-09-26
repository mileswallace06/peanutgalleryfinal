import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { runInNewContext } from 'node:vm';
import { fileURLToPath } from 'node:url';
import {
  flashDropLeaders, projectFlashDrop, projectFlashDropWinner,
} from '../base44/shared/flashDropReadView.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const member = { id: 'member-id', email: 'member@example.test', role: 'user', disabled: false };
const other = { id: 'other-id', email: 'other@example.test', role: 'user' };
const rawDrop = {
  id: 'drop-id', event_id: 'event-id', section: '12', row: 'C', quantity: 2,
  donor_message: 'Enjoy the show!', donor_email: other.email, donor_name: 'Avery',
  is_anonymous: false, status: 'winner_selected', scheduled_label: 'Halftime',
  entry_closes_at: '2026-09-26T10:00:00Z', entry_count: 3,
  winner_email: member.email, winner_name: 'Morgan', winner_selected_at: '2026-09-26T10:00:01Z',
  ownership_verified: true, trust_score: 85, ownership_delivery_method: 'ticket_transfer', tier: 'lower',
  seats: 'SECRET_SEATS', source_purchase_id: 'SECRET_PURCHASE', source_donation_id: 'SECRET_DONATION',
  seat_inventory_id: 'SECRET_INVENTORY', ownership_listing_id: 'SECRET_LISTING',
  created_by: 'SECRET_CREATOR', created_by_id: 'SECRET_CREATOR_ID',
  winner_selection_request_id: 'SECRET_LOCK', winner_selection_locked_at: 'SECRET_LOCK_TIME',
  metrics: { secret: 'SECRET_METRICS' }, trust_breakdown: { secret: 'SECRET_BREAKDOWN' },
  abuse_flags: ['SECRET_FLAGS'], private_extension: { secret: 'SECRET_FUTURE_FIELD' },
};
const dropKeys = ['id', 'event_id', 'section', 'row', 'quantity', 'donor_message', 'is_anonymous',
  'donor_name', 'status', 'scheduled_label', 'entry_closes_at', 'entry_count', 'winner_selected_at',
  'winner_name', 'ownership_verified', 'trust_score', 'ownership_delivery_method', 'tier', 'is_donor', 'is_winner'];

function assertNoPrivate(value) {
  const serialized = JSON.stringify(value);
  assert.doesNotMatch(serialized, /SECRET_|member@example\.test|other@example\.test|donor_email|winner_email|created_by|seat_inventory_id|source_purchase_id|winner_selection|private_extension/);
}

test('drop projection preserves member display data and excludes all raw identity/internal fields for every role', () => {
  for (const viewer of [member, other, { ...member, role: 'admin' }]) {
    const projected = projectFlashDrop(rawDrop, viewer);
    assert.deepEqual(Object.keys(projected), dropKeys);
    assert.equal(projected.section, '12');
    assert.equal(projected.trust_score, 85);
    assert.equal(projected.is_donor, viewer.email === other.email);
    assert.equal(projected.is_winner, viewer.email === member.email);
    assertNoPrivate(projected);
  }
});

test('legacy email name fallbacks and anonymous names never enter drop or winner projections', () => {
  const projected = projectFlashDrop({ ...rawDrop, donor_name: other.email, winner_name: member.email }, member);
  assert.equal(projected.donor_name, null);
  assert.equal(projected.winner_name, null);
  assert.equal(projectFlashDrop({ ...rawDrop, is_anonymous: true }, member).donor_name, null);
  assert.deepEqual(projectFlashDropWinner({ ...rawDrop, winner_name: member.email }, member), { name: null, is_you: true });
  assertNoPrivate(projected);
});

test('nested values are not copied through scalar display fields or trusted as viewer identity', () => {
  const corrupt = Object.fromEntries(dropKeys.map(key => [key, { secret: 'SECRET_OBJECT' }]));
  const projected = projectFlashDrop({ ...rawDrop, ...corrupt, quantity: Infinity, trust_score: NaN }, { email: rawDrop.winner_email });
  assert.equal(projected.is_donor, false);
  assert.equal(projected.is_winner, false);
  assert.equal(projected.quantity, 1);
  assert.equal(projected.trust_score, 0);
  assertNoPrivate(projected);
});

test('leaderboard keeps anonymous contributions out of the same donor’s named totals', () => {
  const leaders = flashDropLeaders([
    { ...rawDrop, donor_name: 'Avery', status: 'active' },
    { ...rawDrop, is_anonymous: true },
    { ...rawDrop, donor_email: 'third@example.test', donor_name: 'Third', is_anonymous: true },
    { ...rawDrop, donor_email: 'fourth@example.test', donor_name: 'fourth@example.test', status: 'active' },
  ]);
  assert.deepEqual(leaders, [
    { name: 'Anonymous Fan', drops: 2, wins: 2 },
    { name: 'Avery', drops: 1, wins: 0 },
    { name: 'A generous fan', drops: 1, wins: 0 },
  ]);
  assert.doesNotMatch(JSON.stringify(leaders), /@|email|SECRET/);
});

async function compile(relativePath) {
  const result = await build({
    absWorkingDir: root, entryPoints: [relativePath], bundle: true, write: false,
    platform: 'neutral', format: 'iife',
    plugins: [{ name: 'handler-fixtures', setup(builder) {
      builder.onResolve({ filter: /^npm:@base44\/sdk@/ }, () => ({ path: 'sdk', namespace: 'fixture' }));
      builder.onResolve({ filter: /shared\/notifications\.ts$/ }, () => ({ path: 'notifications', namespace: 'fixture' }));
      builder.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({
        contents: args.path === 'sdk'
          ? 'export function createClientFromRequest() { if (globalThis.clientError) throw globalThis.clientError; return globalThis.client; }'
          : 'export async function recordNotification(...args) { globalThis.notifications.push(args[1]); }', loader: 'js',
      }));
    } }],
  });
  return result.outputFiles[0].text;
}
const readSource = await compile('base44/functions/getFlashDropView/entry.ts');
const mutateSource = await compile('base44/functions/flashDrop/entry.ts');

function harness(source, { user = member, authError, clientError, maintenance = false, implementations = {} } = {}) {
  const calls = [];
  const notifications = [];
  let authCalls = 0;
  let handler;
  const entities = Object.fromEntries(['FlashDrop', 'FlashDropEntry', 'SeatInventory', 'Listing', 'Purchase', 'User', 'TransferOutcome', 'Event'].map(entity => [entity,
    Object.fromEntries(['filter', 'create', 'update'].map(method => [method, async (...args) => {
      calls.push({ entity, method, args });
      const implementation = implementations[`${entity}.${method}`];
      if (implementation) return implementation(...args);
      if (method === 'filter') return [];
      if (method === 'create') return { id: `${entity}-created`, ...args[0] };
      return { id: args[0], ...args[1] };
    }])),
  ]));
  runInNewContext(source, {
    client: { auth: { me: async () => { authCalls++; if (authError) throw authError; return user; } }, asServiceRole: { entities } },
    clientError, notifications, Response, Request,
    Deno: { serve: fn => { handler = fn; }, env: { get: name => name === 'MAINTENANCE_MODE' ? String(maintenance) : undefined } },
    console: { log() { throw new Error('Unexpected logging'); }, error() { throw new Error('Unexpected logging'); } },
  });
  return { calls, notifications, authCalls: () => authCalls, async invoke(body, raw = false) {
    const response = await handler(new Request('https://unit.invalid/function', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: raw ? body : JSON.stringify(body),
    }));
    return { status: response.status, data: await response.json() };
  } };
}

for (const [label, options] of [
  ['anonymous', { user: null }], ['missing ID', { user: { email: member.email } }],
  ['missing email', { user: { id: 'member-id' } }], ['malformed email', { user: { ...member, email: {} } }],
  ['disabled member', { user: { ...member, disabled: true } }],
  ['failed auth refresh', { authError: new Error('SECRET_AUTH_ERROR') }],
  ['failed client creation', { clientError: new Error('SECRET_CLIENT_ERROR') }],
]) {
  test(`both handlers reject ${label} before entity access, ignoring spoofed request identity`, async () => {
    for (const source of [readSource, mutateSource]) {
      const h = harness(source, options);
      const result = await h.invoke({ event_id: 'event-id', action: 'poll_result', flash_drop_id: 'drop-id',
        user: member, role: 'admin', email: member.email, is_winner: true, is_donor: true });
      assert.equal(result.status, 401);
      assert.equal(h.calls.length, 0);
      assert.deepEqual(result.data, { error: 'Unauthorized' });
    }
  });
}

test('new view uses only authenticated viewer and exact event filter, even during maintenance', async () => {
  const h = harness(readSource, { user: other, maintenance: true,
    implementations: { 'FlashDrop.filter': () => [rawDrop] } });
  const result = await h.invoke({ event_id: 'event-id', email: member.email, user: member, role: 'admin', is_winner: true });
  assert.equal(result.status, 200);
  assert.equal(h.authCalls(), 1);
  assert.equal(result.data.drops[0].is_donor, true);
  assert.equal(result.data.drops[0].is_winner, false);
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].entity, 'FlashDrop');
  assert.equal(h.calls[0].method, 'filter');
  assert.equal(JSON.stringify(h.calls[0].args), '[{"event_id":"event-id"}]');
  assertNoPrivate(result.data);
});

test('malformed read inputs fail before entity queries', async () => {
  for (const body of [null, [], 'event-id', {}, { event_id: '' }, { event_id: '   ' }, { event_id: 2 }, { event_id: {} }, { event_id: ['event-id'] }, { event_id: 'x'.repeat(201) }]) {
    const h = harness(readSource);
    assert.equal((await h.invoke(body)).status, 400);
    assert.equal(h.calls.length, 0);
  }
  const h = harness(readSource);
  assert.equal((await h.invoke('{bad', true)).status, 400);
  assert.equal(h.calls.length, 0);
});

test('read failure returns a generic response without error content or logging', async () => {
  for (const implementation of [() => { throw new Error('SECRET_DB_ERROR'); }, () => null]) {
    const h = harness(readSource, { implementations: { 'FlashDrop.filter': implementation } });
    const result = await h.invoke({ event_id: 'event-id' });
    assert.equal(result.status, 503);
    assert.deepEqual(result.data, { error: 'Could not load fan gifts. Please try again.' });
  }
});

test('malformed mutation envelopes receive a generic 400 without reads or writes', async () => {
  for (const body of [null, [], false, 'value']) {
    const h = harness(mutateSource);
    assert.equal((await h.invoke(body)).status, 400);
    assert.equal(h.calls.length, 0);
  }
});

test('existing mutating maintenance gate remains enforced for members and admins', async () => {
  for (const user of [member, { ...member, role: 'admin' }]) {
    const h = harness(mutateSource, { user, maintenance: true });
    const result = await h.invoke({ action: 'create', event_id: 'event-id', section: '12' });
    assert.equal(result.status, 503);
    assert.equal(result.data.code, 'MAINTENANCE');
    assert.equal(h.calls.length, 0);
  }
});

for (const [label, action, reads] of [
  ['poll result', 'poll_result', [rawDrop]],
  ['already selected at initial close', 'close_and_pick', [rawDrop]],
  ['already selected after concurrent close', 'close_and_pick', [{ ...rawDrop, status: 'active' }, rawDrop]],
  ['newly selected winner', 'close_and_pick', [{ ...rawDrop, status: 'active' }, { ...rawDrop, status: 'active' }]],
]) {
  test(`${label} returns only winner name and authenticated is_you`, async () => {
    for (const user of [member, other]) {
      const queue = reads.map(drop => ({ ...drop, winner_name: member.email }));
      const h = harness(mutateSource, { user, implementations: {
        'FlashDrop.filter': () => [queue.shift()],
        'FlashDropEntry.filter': () => [{ id: 'entry-id', entrant_email: member.email, entrant_name: member.email }],
      } });
      const result = await h.invoke({ action, flash_drop_id: 'drop-id', email: member.email, is_you: true });
      assert.equal(result.status, 200);
      assert.deepEqual(Object.keys(result.data.winner), ['name', 'is_you']);
      assert.equal(result.data.winner.is_you, user.email === member.email);
      assert.equal(result.data.winner.name, null);
      assertNoPrivate(result.data);
      if (label === 'newly selected winner') {
        assert.equal(result.data.winner.name, null);
        assert.equal(h.notifications.length, 1);
        assert.equal(h.notifications[0].user_email, member.email);
        assert.ok(h.calls.some(call => call.entity === 'FlashDrop' && call.method === 'update' && call.args[1].winner_email === member.email));
      }
    }
  });
}

test('admin maintenance poll remains available and returns the projected winner', async () => {
  const h = harness(mutateSource, { user: { ...member, role: 'admin' }, maintenance: true,
    implementations: { 'FlashDrop.filter': () => [rawDrop] } });
  const result = await h.invoke({ action: 'poll_result', flash_drop_id: 'drop-id' });
  assert.equal(result.status, 200);
  assert.deepEqual(result.data.winner, { name: 'Morgan', is_you: true });
  assertNoPrivate(result.data);
});

test('creation retains inventory mutations but returns only the safe drop view', async () => {
  const h = harness(mutateSource, { implementations: {
    'Event.filter': () => [{ id: 'event-id', title: 'A show' }],
    'FlashDrop.create': data => ({ ...rawDrop, ...data, id: 'new-drop' }),
  } });
  const result = await h.invoke({ action: 'create', event_id: 'event-id', section: '12',
    ownership_proof_url: 'https://unit.invalid/SECRET_PROOF', drop_type: 'immediate',
    donor_email: other.email, user: other });
  assert.equal(result.status, 200);
  assert.equal(result.data.drop.is_donor, true);
  assert.equal(result.data.drop.id, 'new-drop');
  assert.equal(result.data.success, true);
  assert.deepEqual(Object.keys(result.data.drop), dropKeys);
  assertNoPrivate(result.data);
  const write = h.calls.find(call => call.entity === 'FlashDrop' && call.method === 'create');
  assert.equal(write.args[0].donor_email, member.email);
  assert.ok(h.calls.some(call => call.entity === 'SeatInventory' && call.method === 'update'));
});

test('FlashDrop raw CRUD requires admin while FlashDropEntry self/admin reads remain intact', async () => {
  const drop = JSON.parse(await readFile(new URL('../base44/entities/FlashDrop.jsonc', import.meta.url), 'utf8'));
  assert.deepEqual(drop.rls, Object.fromEntries(['create', 'read', 'update', 'delete'].map(action => [action, { user_condition: { role: 'admin' } }])));
  const entry = JSON.parse(await readFile(new URL('../base44/entities/FlashDropEntry.jsonc', import.meta.url), 'utf8'));
  assert.deepEqual(entry.rls.read, { $or: [{ entrant_email: '{{user.email}}' }, { user_condition: { role: 'admin' } }] });
});
