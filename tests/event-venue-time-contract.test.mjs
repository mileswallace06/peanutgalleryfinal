import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  formatEventVenueDateTime,
  getEventLiveStatus,
  parseCanonicalUtcMs,
  resolveEventStartUtc,
} from '../src/lib/eventTiming.js';
import { mergeEventSources } from '../src/lib/eventSourceMerger.js';

const ny = event_start_utc => ({ event_start_utc, venue_timezone: 'America/New_York' });

test('winter and summer dates use the venue offset and label', () => {
  assert.equal(
    formatEventVenueDateTime(ny('2026-01-15T00:30:00.000Z')),
    'Wed, Jan 14 · 7:30 PM EST',
  );
  assert.equal(
    formatEventVenueDateTime(ny('2026-07-15T00:30:00.000Z')),
    'Tue, Jul 14 · 8:30 PM EDT',
  );
});

test('spring DST transition skips the nonexistent venue-local hour', () => {
  assert.equal(
    formatEventVenueDateTime(ny('2026-03-08T06:30:00.000Z')),
    'Sun, Mar 8 · 1:30 AM EST',
  );
  assert.equal(
    formatEventVenueDateTime(ny('2026-03-08T07:30:00.000Z')),
    'Sun, Mar 8 · 3:30 AM EDT',
  );
});

test('naive legacy values are explicitly rejected instead of using the device timezone', () => {
  const event = { date: '2026-07-14T20:30:00', venue_timezone: 'America/New_York' };
  assert.equal(parseCanonicalUtcMs(event.date), null);
  assert.deepEqual(resolveEventStartUtc(event), {
    utcMs: null,
    source: 'date',
    error: 'naive_or_invalid_legacy_timestamp',
  });
  assert.equal(formatEventVenueDateTime(event), 'TBD');
  assert.equal(getEventLiveStatus(event, 0).start_utc_ms, null);
});

test('TBA flags are shown explicitly without manufacturing a local time', () => {
  const event = { ...ny('2026-07-15T00:30:00.000Z'), time_tba: true };
  assert.equal(formatEventVenueDateTime(event), 'Tue, Jul 14 · Time TBD');
  assert.equal(formatEventVenueDateTime({ ...event, date_tba: true }), 'Date TBD');
});

test('formatted venue time is independent of the device process timezone', () => {
  const moduleUrl = new URL('../src/lib/eventTiming.js', import.meta.url).href;
  const script = `import { formatEventVenueDateTime } from ${JSON.stringify(moduleUrl)}; process.stdout.write(formatEventVenueDateTime({event_start_utc:'2026-11-01T06:30:00.000Z',venue_timezone:'America/New_York'}));`;
  const render = timezone => execFileSync(process.execPath, ['--input-type=module', '--eval', script], {
    encoding: 'utf8',
    env: { ...process.env, TZ: timezone },
  });
  const phoenixDevice = render('America/Phoenix');
  const tokyoDevice = render('Asia/Tokyo');
  assert.equal(phoenixDevice, tokyoDevice);
  assert.equal(phoenixDevice, 'Sun, Nov 1 · 1:30 AM EST');
});

test('event-source filtering does not parse a naive legacy value in the device timezone', () => {
  const localResult = {
    status: 'fulfilled',
    value: [{ id: 'legacy', title: 'Legacy', date: '2026-07-14T20:30:00', status: 'upcoming' }],
  };
  const tmResult = { status: 'fulfilled', value: { events: [] } };
  const result = mergeEventSources({
    localResult,
    tmResult,
    filters: { now: Date.parse('2026-07-15T23:00:00Z'), isAdmin: false },
  });
  assert.deepEqual(result.events.map(event => event.id), ['legacy']);
});

test('provider end time overrides the category-duration estimate', () => {
  const event = {
    event_start_utc: '2026-07-15T00:00:00.000Z',
    event_end_utc: '2026-07-15T01:00:00.000Z',
    venue_timezone: 'America/New_York',
    category: 'concert',
  };
  assert.equal(getEventLiveStatus(event, Date.parse('2026-07-15T00:30:00Z')).status, 'live');
  assert.equal(getEventLiveStatus(event, Date.parse('2026-07-15T01:01:00Z')).status, 'ended');
  assert.equal(getEventLiveStatus(event, 0).end_utc_ms, Date.parse(event.event_end_utc));
});

test('provider-cancelled events are ended and excluded from merged discovery', () => {
  const cancelled = {
    id: 'cancelled',
    tm_id: 'tm-cancelled',
    event_start_utc: '2026-12-15T00:00:00.000Z',
    venue_timezone: 'America/New_York',
    provider_status: 'cancelled',
    status: 'upcoming',
  };
  assert.equal(getEventLiveStatus(cancelled, Date.parse('2026-07-15T00:00:00Z')).status, 'ended');
  const result = mergeEventSources({
    localResult: { status: 'fulfilled', value: [cancelled] },
    tmResult: { status: 'fulfilled', value: { events: [cancelled] } },
    filters: { now: Date.parse('2026-07-15T00:00:00Z'), isAdmin: false },
  });
  assert.deepEqual(result.events, []);
});
