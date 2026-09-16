import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { normalizeTMEvent } from '../base44/shared/tmResponseHandler.js';
import { buildTMEventTimingPatch } from '../base44/shared/tmEventTiming.js';
import { createTMEventSyncPayload } from '../src/lib/tmEventSyncPayload.js';

const rawEvent = (overrides = {}) => ({
  id: 'tm-1',
  name: 'Sample show',
  dates: {
    start: { dateTime: '2026-07-15T00:30:00Z', localDate: '2026-07-14', localTime: '20:30:00' },
    end: { dateTime: '2026-07-15T03:30:00Z' },
    timezone: 'America/New_York',
    status: { code: 'onsale' },
  },
  _embedded: { venues: [{ id: 'venue-1', name: 'Arena', city: { name: 'New York' }, state: { stateCode: 'NY' } }] },
  ...overrides,
});

test('Ticketmaster normalization retains canonical, local, zone, end and status fields', () => {
  const event = normalizeTMEvent(rawEvent());
  assert.equal(event.event_start_local, '2026-07-14T20:30:00');
  assert.equal(event.event_start_utc, '2026-07-15T00:30:00.000Z');
  assert.equal(event.event_end_utc, '2026-07-15T03:30:00.000Z');
  assert.equal(event.venue_timezone, 'America/New_York');
  assert.equal(event.provider_status, 'onsale');
});

test('frontend sync request sends only the provider identity', () => {
  const event = normalizeTMEvent(rawEvent({
    dates: {
      start: { localDate: '2026-10-01', localTime: '19:00:00', timeTBA: false },
      status: { code: 'postponed' },
    },
  }));
  const payload = createTMEventSyncPayload(event);
  assert.deepEqual(payload, { tm_id: 'tm-1' });
});

test('reschedule refresh replaces canonical start/date/end and provider state', () => {
  const existing = {
    event_start_utc: '2026-06-01T23:00:00.000Z',
    event_end_utc: '2026-06-02T02:00:00.000Z',
    date: '2026-06-01T23:00:00.000Z',
    venue_timezone: 'America/Chicago',
    provider_status: 'onsale',
  };
  const fresh = normalizeTMEvent(rawEvent());
  const patch = buildTMEventTimingPatch(fresh, existing);
  assert.equal(patch.event_start_utc, '2026-07-15T00:30:00.000Z');
  assert.equal(patch.date, patch.event_start_utc);
  assert.equal(patch.event_start_local, '2026-07-14T20:30:00');
  assert.equal(patch.event_end_utc, '2026-07-15T03:30:00.000Z');
  assert.equal(patch.venue_timezone, 'America/New_York');
  assert.equal(patch.provider_status, 'onsale');
});

test('changed start clears an end from the prior performance when no fresh end is supplied', () => {
  const patch = buildTMEventTimingPatch(
    { event_start_utc: '2026-08-01T20:00:00Z' },
    { event_start_utc: '2026-07-01T20:00:00Z', event_end_utc: '2026-07-01T23:00:00Z' },
  );
  assert.equal(patch.event_start_utc, '2026-08-01T20:00:00.000Z');
  assert.equal(patch.date, patch.event_start_utc);
  assert.equal(patch.event_end_utc, null);
});

test('an invalid provider end cannot be marked valid by a contradictory flag', () => {
  const patch = buildTMEventTimingPatch({
    event_start_utc: '2026-08-01T20:00:00Z',
    event_end_utc: '2026-08-01T19:00:00Z',
    end_time_invalid: false,
  });
  assert.equal(patch.event_end_utc, null);
  assert.equal(patch.end_time_invalid, true);
});

test('partial legacy callers cannot erase canonical timing or inject a naive date', () => {
  const existing = { event_start_utc: '2026-07-15T00:30:00Z', venue_timezone: 'America/New_York' };
  assert.deepEqual(buildTMEventTimingPatch({}, existing), {});
  assert.deepEqual(buildTMEventTimingPatch({ date: '2026-07-14T20:30:00' }, existing), {});
  assert.deepEqual(
    buildTMEventTimingPatch({ date: '2026-07-15T00:30:00-04:00' }, {}),
    { event_start_utc: '2026-07-15T04:30:00.000Z', date: '2026-07-15T04:30:00.000Z', event_end_utc: null },
  );
});

test('sync and Event schema include the additive canonical provider contract', () => {
  const syncSource = readFileSync(new URL('../base44/functions/syncTMEvent/entry.ts', import.meta.url), 'utf8');
  const schemaSource = readFileSync(new URL('../base44/entities/Event.jsonc', import.meta.url), 'utf8');
  const schema = JSON.parse(schemaSource);
  assert.match(syncSource, /discovery\/v2\/events\/\$\{encodeURIComponent\(requestedId\)\}/);
  assert.match(syncSource, /const body = normalizeTMEvent\(providerJson\)/);
  assert.doesNotMatch(syncSource, /const \{ tm_id, title[^\n]+\} = requestBody/);
  assert.match(syncSource, /buildTMEventTimingPatch\(body, canonical\)/);
  assert.match(syncSource, /buildTMEventTimingPatch\(body, existing\[0\]\)/);
  for (const field of ['event_end_utc', 'date_tba', 'time_tba', 'no_specific_time', 'end_time_invalid', 'provider_status']) {
    assert.ok(schema.properties[field], `Event schema missing ${field}`);
  }
  assert.equal(schema.required.includes('date'), false, 'TBA events must not require a manufactured date');
});

test('provider refresh can clear a stale venue timezone', () => {
  const patch = buildTMEventTimingPatch(
    { venue_timezone: null },
    { venue_timezone: 'America/Phoenix' },
  );
  assert.deepEqual(patch, { venue_timezone: null });
});
