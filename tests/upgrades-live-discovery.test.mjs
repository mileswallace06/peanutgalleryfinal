import test from 'node:test';
import assert from 'node:assert/strict';
import { getUpgradeEventTiming, groupUpgradeEvents } from '../src/lib/upgradeDiscovery.js';
import { fetchSellingEvents } from '../src/lib/sellingEventDiscovery.js';
import { createEventSearchRequest } from '../src/lib/eventSearchRequest.js';
import { sellingEventList } from '../src/lib/sellingEventTiming.js';
import { matches } from './helpers/discoveryMock.mjs';
import { bustTMCache } from '../src/lib/tmCache.js';

const now = Date.parse('2026-09-28T01:30:00Z');
const iso = hours => new Date(now + hours * 3600000).toISOString();
const coverage = {
  discoveryWindow: 'ongoing', lookbackHours: 12, limit: 40,
  startDateTime: iso(-12), endDateTime: iso(0), truncated: false,
};
const event = (id, hours, extra = {}) => ({
  id, title: `Event ${id}`, date: iso(hours), city: 'Phoenix', state: 'AZ',
  venue: 'Sample Arena', category: 'concert', ...extra,
});
const tmEvent = (id, hours, extra = {}) => event(id, hours, { tm_id: id, ...extra });
const liveIds = events => events.map(value => value.id).sort();
const phoenixRequest = () => createEventSearchRequest('', { city: 'Phoenix', state: 'AZ', label: 'Phoenix, AZ' });

function discoveryClient({ pgFuture = [], pgOngoing = [], tmFuture = [], tmOngoing = [], fail = {} } = {}) {
  const calls = { pg: [], tm: [] };
  return {
    calls,
    entities: { Event: { filter: async (query, sort, limit, skip) => {
      calls.pg.push({ query, sort, limit, skip });
      const key = sort === '-date' ? 'pgOngoing' : 'pgFuture';
      if (fail[key]) throw fail[key];
      return (key === 'pgOngoing' ? pgOngoing : pgFuture).filter(row => matches(row, query));
    } } },
    functions: { invoke: async (name, params) => {
      assert.equal(name, 'getTicketmasterEvents');
      calls.tm.push(params);
      const key = params.discoveryWindow === 'ongoing' ? 'tmOngoing' : 'tmFuture';
      if (fail[key]) throw fail[key];
      return { data: {
        pagination: {page:params.page||0,size:40,hasMore:false,nextPage:null,truncated:false},
        events: key === 'tmOngoing' ? tmOngoing : tmFuture,
        ...(key === 'tmOngoing' ? { coverage } : {}),
      } };
    } },
  };
}

test('Upgrades finds started provider events absent from upcoming results and keeps canonical PG identities', async () => {
  bustTMCache();
  const client = discoveryClient({
    pgOngoing: [event('pg-canonical', -7, { tm_id: 'same-show', event_end_utc: null })],
    tmFuture: [tmEvent('tomorrow', 18)],
    tmOngoing: [tmEvent('same-show', -7, { event_end_utc: iso(1) }), tmEvent('ongoing-only', -1)],
  });

  const result = await fetchSellingEvents(client, phoenixRequest(), false, now);
  const groups = groupUpgradeEvents(result.events, now);

  assert.deepEqual(liveIds(groups.live), ['pg-canonical', 'tm_ongoing-only']);
  assert.deepEqual(liveIds(groups.upcoming), ['tm_tomorrow']);
  assert.equal(groups.live.find(value => value.id === 'pg-canonical').event_end_utc, iso(1));
  assert.deepEqual(client.calls.tm, [
    { size: 40, city: 'Phoenix', page:0, sort:'soonest', includePast:false, asOf:iso(0), stateCode:'AZ' },
    { size: 40, city: 'Phoenix', page:0, sort:'soonest', includePast:false, asOf:iso(0), stateCode:'AZ', discoveryWindow: 'ongoing' },
  ]);
  assert.equal(client.calls.pg.length, 3);
  assert.deepEqual(client.calls.pg.map(call => call.sort), ['event_start_utc', 'date', '-date']);
  assert.equal(client.calls.pg[0].query.$and[0].city.$regex, '^Phoenix$');
  assert.equal(client.calls.pg[0].query.$and[0].state.$regex, '^AZ$');
  assert.equal(result.tmError, false);
  assert.equal(result.pgError, false);
  assert.deepEqual(result.ongoingCoverage, coverage);
});

test('Sell and Upgrades agree on live IDs across explicit ends, estimated windows, offsets and uncertain times', () => {
  const rows = [
    event('long-confirmed', -10, { event_end_utc: iso(1) }),
    event('estimated', -1),
    event('offset-time', -1, { date: '2026-09-27T17:30:00-07:00', venue_timezone: 'America/Phoenix' }),
    event('ended-at-boundary', -1, { event_end_utc: iso(0) }),
    event('estimate-expired', -4),
    event('bounded-estimate-expired', -9, { duration_hours: 1000 }),
    event('tba', -1, { time_tba: true }),
    event('invalid-end', -1, { event_end_utc: 'invalid' }),
    event('naive-time', -1, { date: '2026-09-27T18:30:00' }),
    event('cancelled', -1, { provider_status: 'cancelled' }),
    event('postponed', -1, { provider_status: 'postponed' }),
    event('beta', -1, { is_beta_live: true }),
    event('soon', 0.5),
    event('later', 2),
  ];
  const groups = groupUpgradeEvents(rows, now);

  assert.deepEqual(liveIds(groups.live), liveIds(sellingEventList(rows, 'live', now).map(value => value.event)));
  assert.deepEqual(liveIds(groups.live), ['estimated', 'long-confirmed', 'offset-time']);
  assert.equal(getUpgradeEventTiming(rows.find(value => value.id === 'estimated'), now).status, 'estimated_live');
  assert.equal(getUpgradeEventTiming(rows.find(value => value.id === 'long-confirmed'), now).status, 'live');
  assert.equal(getUpgradeEventTiming(rows.find(value => value.id === 'soon'), now).status, 'soon');
  assert.deepEqual(liveIds(groups.upcoming), ['invalid-end', 'later', 'naive-time', 'postponed', 'soon', 'tba']);
});

test('the same loaded event moves from soon to live and disappears exactly at its actual end', () => {
  const startsInOneMinute = event('boundary', 1 / 60, { event_end_utc: iso(2 / 60) });
  assert.equal(getUpgradeEventTiming(startsInOneMinute, now).status, 'soon');
  assert.deepEqual(liveIds(groupUpgradeEvents([startsInOneMinute], now).upcoming), ['boundary']);
  assert.deepEqual(liveIds(groupUpgradeEvents([startsInOneMinute], now + 60000).live), ['boundary']);
  assert.deepEqual(groupUpgradeEvents([startsInOneMinute], now + 120000), { live: [], upcoming: [] });
});

test('Sell and Upgrades share both provider caches and explicit refresh invalidates both windows', async () => {
  bustTMCache();
  const client = discoveryClient({ tmFuture: [tmEvent('future', 2)], tmOngoing: [tmEvent('live', -1)] });
  const request = phoenixRequest();
  const sell = await fetchSellingEvents(client, request, false, now);
  const upgrades = await fetchSellingEvents(client, phoenixRequest(), false, now);

  assert.equal(client.calls.tm.length, 2, 'changing screens must reuse both provider responses');
  assert.deepEqual(liveIds(groupUpgradeEvents(upgrades.events, now).live), liveIds(sellingEventList(sell.events, 'live', now).map(value => value.event)));
  await fetchSellingEvents(client, phoenixRequest(), true, now);
  assert.equal(client.calls.tm.length, 4);
  assert.equal(client.calls.tm.filter(params => params.discoveryWindow === 'ongoing').length, 2);
  assert.equal(client.calls.tm.filter(params => !params.discoveryWindow).length, 2);
});

test('failed ongoing provider discovery retains PG live events and marks coverage incomplete', async () => {
  bustTMCache();
  const client = discoveryClient({
    pgOngoing: [event('pg-live', -1, { event_end_utc: iso(1) })],
    tmFuture: [tmEvent('future', 2)],
    fail: { tmOngoing: { status: 429 } },
  });
  const result = await fetchSellingEvents(client, phoenixRequest(), false, now);

  assert.deepEqual(liveIds(groupUpgradeEvents(result.events, now).live), ['pg-live']);
  assert.deepEqual(liveIds(groupUpgradeEvents(result.events, now).upcoming), ['tm_future']);
  assert.equal(result.tmOngoingError, true);
  assert.equal(result.tmError, true);
  assert.equal(result.rateLimited, true);
  assert.equal(result.pgError, false);
  assert.equal(result.ongoingCoverage, null);
});

test('a failed PG partition does not discard provider results or claim complete discovery', async () => {
  bustTMCache();
  const client = discoveryClient({
    pgFuture: [event('pg-future', 3)],
    tmOngoing: [tmEvent('provider-live', -1)],
    fail: { pgOngoing: new Error('PG unavailable') },
  });
  const result = await fetchSellingEvents(client, phoenixRequest(), false, now);

  assert.deepEqual(liveIds(groupUpgradeEvents(result.events, now).live), ['tm_provider-live']);
  assert.deepEqual(liveIds(groupUpgradeEvents(result.events, now).upcoming), ['pg-future']);
  assert.equal(result.pgError, true);
  assert.equal(result.tmError, false);
  assert.equal(result.tmOngoingError, false);
});

test('GPS discovery keeps nearby PG live events even when upcoming provider results are empty', async () => {
  bustTMCache();
  const client = discoveryClient({ pgOngoing: [
    event('nearby', -1, { venue_lat: 33.45, venue_lng: -112.07, event_end_utc: iso(1) }),
    event('far-away', -1, { venue_lat: 34.0522, venue_lng: -118.2437, event_end_utc: iso(1) }),
  ] });
  const result = await fetchSellingEvents(client, createEventSearchRequest('', { ll: '33.45,-112.07' }), false, now);

  assert.deepEqual(liveIds(groupUpgradeEvents(result.events, now).live), ['nearby']);
  assert.deepEqual(client.calls.tm, [
    { size: 40, latlong: '33.45,-112.07', radius: '50', page:0, sort:'soonest', includePast:false, asOf:iso(0) },
    { size: 40, latlong: '33.45,-112.07', radius: '50', page:0, sort:'soonest', includePast:false, asOf:iso(0), discoveryWindow: 'ongoing' },
  ]);
});
