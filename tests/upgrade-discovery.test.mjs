import test from 'node:test';
import assert from 'node:assert/strict';
import { groupUpgradeEvents, loadOwnedUpgradeEvents } from '../src/lib/upgradeDiscovery.js';

function clientFor(purchases, readEvent = async ({ id }) => [{ id }]) {
  const calls = [];
  return {
    calls,
    functions: {
      invoke: async (name, payload) => {
        calls.push({ name, payload });
        return { data: { purchases } };
      },
    },
    entities: {
      Event: {
        filter: async query => {
          calls.push({ name: 'Event.filter', payload: query });
          return readEvent(query);
        },
      },
    },
  };
}

test('owned upgrades use the authenticated buyer view and unique completed-purchase event IDs', async () => {
  const client = clientFor([
    { transfer_status: 'completed', event_id: 'owned-live' },
    { transfer_status: 'pending_transfer', event_id: 'pending' },
    { transfer_status: 'completed', event_id: 'owned-live' },
    { transfer_status: 'disputed', event_id: 'disputed' },
    { transfer_status: 'expired', event_id: 'expired' },
    { event_id: 'unknown-status' },
    { transfer_status: 'completed', event_id: 'owned-upcoming' },
    { transfer_status: 'completed', event_id: null },
    { transfer_status: 'completed', event_id: '' },
    { transfer_status: 'completed', event_id: 42 },
  ]);

  const result = await loadOwnedUpgradeEvents(client);

  assert.deepEqual(client.calls, [
    { name: 'getPurchaseParticipantView', payload: { action: 'list_mine', perspective: 'buyer' } },
    { name: 'Event.filter', payload: { id: 'owned-live' } },
    { name: 'Event.filter', payload: { id: 'owned-upcoming' } },
  ]);
  assert.deepEqual(result, {
    events: [{ id: 'owned-live' }, { id: 'owned-upcoming' }],
    unavailableCount: 0,
  });
});

test('partial event lookup failures retain matching events and count every unavailable event once', async () => {
  const eventIds = ['good-one', 'rejected', 'missing', 'wrong-id', 'malformed', 'good-two'];
  const client = clientFor(eventIds.map(event_id => ({ transfer_status: 'completed', event_id })), async ({ id }) => {
    if (id === 'rejected') throw new Error('Provider unavailable');
    if (id === 'missing') return [];
    if (id === 'wrong-id') return [{ id: 'unrelated-event' }];
    if (id === 'malformed') return { id };
    return [{ id: 'unrelated-event' }, { id, title: id }];
  });

  assert.deepEqual(await loadOwnedUpgradeEvents(client), {
    events: [{ id: 'good-one', title: 'good-one' }, { id: 'good-two', title: 'good-two' }],
    unavailableCount: 4,
  });
});

test('a successful empty purchase history does not read events', async () => {
  const client = clientFor([]);
  assert.deepEqual(await loadOwnedUpgradeEvents(client), { events: [], unavailableCount: 0 });
  assert.equal(client.calls.length, 1);
});

test('malformed purchase responses reject instead of appearing as an empty ticket history', async () => {
  for (const response of [undefined, {}, { data: {} }, { data: { purchases: null } }, { data: { purchases: {} } }]) {
    let eventReads = 0;
    const client = {
      functions: { invoke: async () => response },
      entities: { Event: { filter: async () => { eventReads += 1; return []; } } },
    };
    await assert.rejects(loadOwnedUpgradeEvents(client), /Ticket list unavailable/);
    assert.equal(eventReads, 0);
  }
});

test('purchase-view failures propagate so the caller can offer retry', async () => {
  const failure = new Error('Purchase history unavailable');
  const client = { functions: { invoke: async () => { throw failure; } } };
  await assert.rejects(loadOwnedUpgradeEvents(client), error => error === failure);
});

test('discovery combines soon and upcoming, retains live, and excludes ended events', () => {
  const now = Date.parse('2026-09-27T18:00:00Z');
  const event = (id, start, extra = {}) => ({
    id, event_start_utc: start, duration_hours: 4, venue_timezone: 'UTC', ...extra,
  });
  const groups = groupUpgradeEvents([
    event('upcoming', '2026-09-28T18:00:00Z'),
    event('live', '2026-09-27T17:00:00Z'),
    event('soon', '2026-09-27T18:30:00Z'),
    event('elapsed', '2026-09-27T12:00:00Z'),
    event('marked-ended', '2026-09-29T18:00:00Z', { status: 'ended' }),
    event('beta-live', '2026-10-01T18:00:00Z', { is_beta_live: true }),
  ], now);

  assert.deepEqual(groups.live.map(value => value.id), ['live']);
  assert.deepEqual(groups.upcoming.map(value => value.id), ['soon', 'upcoming']);
});

test('discovery sorts by canonical UTC start, falls back to date, and puts unknown dates last', () => {
  const now = Date.parse('2026-09-27T18:00:00Z');
  const groups = groupUpgradeEvents([
    { id: 'unknown', venue_timezone: 'UTC' },
    { id: 'later', event_start_utc: '2026-09-30T20:00:00Z', date: '2026-09-28T20:00:00Z' },
    { id: 'date-fallback', date: '2026-09-29T20:00:00Z' },
    { id: 'earlier', event_start_utc: '2026-09-28T20:00:00Z', date: '2026-10-02T20:00:00Z' },
    { id: 'live-later', event_start_utc: '2026-09-27T17:30:00Z', date: '2026-09-27T16:00:00Z' },
    { id: 'live-earlier', event_start_utc: '2026-09-27T17:00:00Z', date: '2026-09-27T17:45:00Z' },
  ], now);

  assert.deepEqual(groups.upcoming.map(value => value.id), ['earlier', 'date-fallback', 'later', 'unknown']);
  assert.deepEqual(groups.live.map(value => value.id), ['live-earlier', 'live-later']);
});
