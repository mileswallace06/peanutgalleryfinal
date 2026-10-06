import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeEventSources } from '../src/lib/eventSourceMerger.js';
import { withMatchingProviderTimezone } from '../src/lib/providerVenueTimezone.js';
import { withProviderTiming, applyProviderTiming } from '../src/lib/sellingEventTiming.js';
import { fetchSellingEvents } from '../src/lib/sellingEventDiscovery.js';
import { resolveSellingEvent } from '../src/lib/resolveSellingEvent.js';
import { getEventDateDisplay } from '../src/lib/eventDateDisplay.js';
import { bustTMCache } from '../src/lib/tmCache.js';

const start = '2026-10-06T23:00:00Z';
const local = Object.freeze({ id: 'pg-ny', tm_id: 'provider-ny', tm_venue_id: 'venue-ny',
  title: 'Fixture event', venue: 'Fixture Arena', city: 'New York', state: 'NY', date: start,
  event_start_utc: start, event_end_utc: '2026-10-07T03:00:00Z', status: 'upcoming' });
const provider = Object.freeze({ ...local, id: 'tm_provider-ny', venue_timezone: 'America/New_York',
  event_end_utc: '2026-10-07T02:00:00Z', status: 'live' });
const ok = value => ({ status: 'fulfilled', value });
const merge = (pg, tm) => mergeEventSources({ localResult: ok(pg), tmResult: ok({ events: tm }),
  filters: { now: Date.parse('2026-10-06T20:00:00Z'), isAdmin: false } });

test('browse merge fills a legacy zone while preserving PG identity, all timing/status and both input objects', () => {
  const before = structuredClone({ local, provider });
  const result = merge([local, { ...local, id: 'pg-duplicate' }], [provider]);
  assert.equal(result.events.length, 1);
  assert.deepEqual(result.events[0], { ...local, source: 'pg', venue_timezone: 'America/New_York' });
  assert.deepEqual({ local, provider }, before);
  assert.equal(getEventDateDisplay(result.events[0]).time, '7:00 PM EDT');
  assert.deepEqual(result.tmEventsRaw, [provider]);
});

test('valid stored zones remain authoritative; invalid or missing zones can be repaired', () => {
  for (const venue_timezone of ['America/Phoenix', 'UTC', ' America/Los_Angeles ']) {
    const record = { ...local, venue_timezone };
    assert.equal(withMatchingProviderTimezone(record, provider), record);
    assert.equal(merge([record], [provider]).events[0].venue_timezone, venue_timezone);
  }
  for (const venue_timezone of [undefined, null, '', ' ', 'Invalid/Timezone']) {
    assert.equal(merge([{ ...local, venue_timezone }], [provider]).events[0].venue_timezone, 'America/New_York');
  }
});

test('same title or changed provider/venue identity cannot supply a timezone', () => {
  for (const incoming of [
    { ...provider, tm_id: 'another-event' },
    { ...provider, tm_id: undefined },
    { ...provider, tm_venue_id: 'another-venue' },
    { ...provider, tm_venue_id: undefined, city: 'Boston' },
    { ...provider, tm_venue_id: undefined, state: '' },
    { ...provider, venue_timezone: 'Invalid/Timezone' },
    { ...provider, venue_timezone: '+04:00' },
  ]) assert.equal(withMatchingProviderTimezone(local, incoming), local);
  assert.equal(withMatchingProviderTimezone({ ...local, tm_id: undefined }, provider).venue_timezone, undefined);
});

test('legacy venue IDs can be absent only with complete matching venue identity', () => {
  const legacy = { ...local, tm_venue_id: undefined };
  assert.equal(withMatchingProviderTimezone(legacy, provider).venue_timezone, 'America/New_York');
  for (const field of ['venue', 'city', 'state']) {
    const incomplete = { ...legacy, [field]: '' };
    assert.equal(withMatchingProviderTimezone(incomplete, provider), incomplete);
  }
});

test('missing provider timezone stays explicitly unconfirmed and viewer-independent', () => {
  for (const venue_timezone of [undefined, '', 'Invalid/Timezone']) {
    const event = merge([local], [{ ...provider, venue_timezone }]).events[0];
    assert.equal(event.venue_timezone, undefined);
    assert.equal(getEventDateDisplay(event).timeLabel, '11:00 PM UTC · venue time unconfirmed');
  }
});

test('seller timing keeps the existing start/end/status reconciliation but never overwrites a valid saved zone', () => {
  const saved = { ...local, venue_timezone: 'America/Phoenix' };
  const fresh = withProviderTiming(provider);
  const merged = applyProviderTiming(saved, fresh._providerTiming, fresh);
  assert.equal(merged.venue_timezone, 'America/Phoenix');
  assert.equal(merged.event_end_utc, provider.event_end_utc);
  assert.equal(merged.id, local.id);
  assert.equal(applyProviderTiming(local, fresh._providerTiming, fresh).venue_timezone, 'America/New_York');
  assert.equal(applyProviderTiming(local, fresh._providerTiming, { ...fresh, tm_venue_id: 'changed' }).venue_timezone, undefined);
});

test('seller discovery and canonical reread retain the matching venue timezone without introducing writes', async () => {
  bustTMCache();
  const now = Date.parse('2026-10-06T20:00:00Z');
  const calls = [];
  const client = { entities: { Event: {
    filter: async (_query, sort) => sort === 'date' ? [local] : [],
    get: async id => { assert.equal(id, local.id); return local; },
  } }, functions: { invoke: async (name, params) => {
    calls.push(name);
    assert.equal(name, 'getTicketmasterEvents');
    return { data: { events: [provider], ...(params.discoveryWindow ? { coverage: {
      discoveryWindow: 'ongoing', lookbackHours: 12, limit: 40,
      startDateTime: '2026-10-06T08:00:00Z', endDateTime: '2026-10-06T20:00:00Z', truncated: false,
    } } : {}) } };
  } } };
  const result = await fetchSellingEvents(client, { cityOverride: 'New York', stateOverride: 'NY' }, true, now);
  const selected = result.events[0];
  assert.equal(selected.id, local.id);
  assert.equal(selected.venue_timezone, 'America/New_York');
  const resolved = await resolveSellingEvent(client, selected);
  assert.equal(resolved.id, local.id);
  assert.equal(resolved.venue_timezone, 'America/New_York');
  assert.deepEqual(calls, ['getTicketmasterEvents', 'getTicketmasterEvents']);
});

test('seller resolution preserves persisted zone and blocks conflicting venue metadata', async () => {
  for (const [record, expected] of [
    [{ ...local, venue_timezone: 'America/Phoenix' }, 'America/Phoenix'],
    [{ ...local, tm_venue_id: 'different-venue' }, undefined],
  ]) {
    const result = await resolveSellingEvent({ entities: { Event: { filter: async () => [record] } } },
      withProviderTiming({ ...provider, source: 'ticketmaster' }));
    assert.equal(result.venue_timezone, expected);
    assert.equal(result.id, local.id);
  }
});

test('seller resolution cannot validate timezone against identity fields inherited from the candidate', async () => {
  const withoutProviderId = { ...local };
  delete withoutProviderId.tm_id;
  const incompleteVenue = { ...local };
  delete incompleteVenue.tm_venue_id;
  delete incompleteVenue.venue;
  delete incompleteVenue.city;
  for (const record of [withoutProviderId, incompleteVenue]) {
    const result = await resolveSellingEvent({ entities: { Event: { filter: async () => [record] } } },
      withProviderTiming({ ...provider, source: 'ticketmaster' }));
    assert.equal(result.venue_timezone, undefined);
    assert.equal(result.id, local.id);
    assert.equal(result.event_end_utc, provider.event_end_utc, 'existing provider timing reconciliation is retained');
    assert.match(getEventDateDisplay(result).timeLabel, /UTC · venue time unconfirmed/);
  }
});

test('new seller selection transmits zone in its existing single sync, then uses canonical persisted metadata', async () => {
  const calls = [];
  const client = { entities: { Event: { filter: async () => [], get: async () => ({ ...local, venue_timezone: 'America/New_York' }) } },
    functions: { invoke: async (name, payload) => { calls.push({ name, payload }); return { data: { id: local.id } }; } } };
  const result = await resolveSellingEvent(client, { ...provider, source: 'ticketmaster' });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].name, 'syncTMEvent');
  assert.equal(calls[0].payload.venue_timezone, 'America/New_York');
  assert.equal(calls[0].payload.tm_venue_id, 'venue-ny');
  assert.equal(Object.hasOwn(calls[0].payload, 'event_end_utc'), false);
  assert.equal(result.id, local.id);
  assert.equal(result.venue_timezone, 'America/New_York');
});
