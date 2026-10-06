import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { tmEventTimezonePatch, validVenueTimezone } from '../base44/shared/tmEventTimezone.js';
import { resolveEventHero } from '../base44/shared/eventHero.js';
import { generateSearchTextNormalized } from '../base44/shared/searchNormalize.js';
import { coerceCoordinate, normalizeTMEvent } from '../base44/shared/tmResponseHandler.js';
import { getEventDateDisplay } from '../src/lib/eventDateDisplay.js';

const source = readFileSync(new URL('../base44/functions/syncTMEvent/entry.ts', import.meta.url), 'utf8')
  .replace(/^import .*;\n/gm, '');
const payload = (overrides = {}) => ({
  tm_id: 'tm-show', title: 'Fixture show', venue: 'Fixture Hall', city: 'New York', state: 'NY',
  tm_venue_id: 'tm-hall', venue_timezone: 'America/New_York', date: '2026-10-20T23:00:00Z',
  image_url: 'https://example.invalid/show.jpg', ...overrides,
});
const saved = (overrides = {}) => ({
  ...payload(), id: 'saved-show', updated_date: '2026-10-05T12:00:00Z', ...overrides,
});
function harness(records = [], { user = { id: 'fixture-user' }, failEventFilter = false } = {}) {
  const events = structuredClone(records);
  const writes = [];
  let run;
  const entities = {
    Event: {
      filter: async (filter) => {
        assert.equal(filter.tm_id, 'tm-show');
        if (failEventFilter) throw new Error('fixture-internal-error');
        return events;
      },
      create: async (record) => {
        const result = { ...record, id: 'new-show' };
        events.push(result);
        writes.push({ entity: 'Event', action: 'create', record: { ...record } });
        return result;
      },
      update: async (id, patch) => {
        writes.push({ entity: 'Event', action: 'update', id, patch: { ...patch } });
        const event = events.find((record) => record.id === id);
        Object.assign(event, patch);
        return event;
      },
      delete: async (id) => { writes.push({ entity: 'Event', action: 'delete', id }); },
    },
    Venue: {
      filter: async () => [{ id: 'saved-venue', name: 'Fixture Hall', city: 'New York', state: 'NY' }],
      create: async (record) => { writes.push({ entity: 'Venue', action: 'create', record }); return record; },
      update: async (id, patch) => { writes.push({ entity: 'Venue', action: 'update', id, patch }); },
    },
  };
  vm.runInNewContext(source, {
    Deno: { serve: (handler) => { run = handler; } },
    createClientFromRequest: () => ({ auth: { me: async () => user }, asServiceRole: { entities } }),
    tmEventTimezonePatch, resolveEventHero, generateSearchTextNormalized, coerceCoordinate, Response,
  });
  return {
    events, writes,
    invoke: async (body = payload()) => {
      const response = await run(new Request('https://example.invalid/syncTMEvent', {
        method: 'POST', body: JSON.stringify(body),
      }));
      return { status: response.status, body: await response.json() };
    },
  };
}

test('timezone validation accepts named zones and rejects invalid or inferred values', () => {
  for (const zone of ['America/New_York', 'America/Phoenix', 'Europe/London', 'Asia/Tokyo', 'UTC']) {
    assert.equal(validVenueTimezone(zone), zone);
  }
  assert.equal(validVenueTimezone(' America/New_York '), 'America/New_York');
  for (const zone of [undefined, null, '', ' ', false, [], {}, 4, 'New York', 'America/NotAZone', '+04:00']) {
    assert.equal(validVenueTimezone(zone), null);
  }
});

test('actual create path preserves the validated venue zone and the original UTC instant', async () => {
  for (const zone of ['America/New_York', 'America/Phoenix']) {
    const fixture = harness();
    const result = await fixture.invoke(payload({ venue_timezone: zone }));
    assert.deepEqual(result, { status: 200, body: { status: 'created', id: 'new-show' } });
    assert.equal(fixture.events[0].venue_timezone, zone);
    assert.equal(fixture.events[0].date, '2026-10-20T23:00:00Z');
    assert.equal(fixture.events[0].status, 'upcoming');
    assert.equal(fixture.writes.some((write) => write.entity === 'Venue'), false);
  }
});

test('actual create path writes no guessed zone for absent or invalid metadata', async () => {
  for (const zone of [undefined, null, '', 'America/NotAZone', { timeZone: 'America/Phoenix' }]) {
    const fixture = harness();
    await fixture.invoke(payload({ venue_timezone: zone }));
    assert.equal(Object.hasOwn(fixture.events[0], 'venue_timezone'), false);
    assert.equal(fixture.events[0].date, '2026-10-20T23:00:00Z');
  }
});

test('actual existing path backfills missing or invalid zone for the same provider venue', async () => {
  for (const zone of [undefined, null, '', 'not/a-zone']) {
    const fixture = harness([saved({ venue_timezone: zone })]);
    const result = await fixture.invoke();
    assert.equal(result.body.status, 'updated');
    assert.equal(fixture.events[0].venue_timezone, 'America/New_York');
    assert.equal(fixture.events[0].date, '2026-10-20T23:00:00Z');
  }
});

test('actual existing path never overwrites valid saved zone with a conflict, invalid or absent zone', async () => {
  for (const zone of [undefined, null, 'invalid', 'America/Phoenix', 'America/New_York']) {
    const fixture = harness([saved()]);
    await fixture.invoke(payload({ venue_timezone: zone }));
    assert.equal(fixture.events[0].venue_timezone, 'America/New_York');
    assert.equal(Object.hasOwn(fixture.writes.find((write) => write.action === 'update').patch, 'venue_timezone'), false);
  }
});

test('actual existing path refuses cross-venue timezone fill even if venue text matches', async () => {
  const fixture = harness([saved({ venue_timezone: undefined, tm_venue_id: 'another-hall' })]);
  await fixture.invoke();
  assert.equal(fixture.events[0].venue_timezone, undefined);
});

test('repeated actual sync cannot fill a conflicting venue zone after the legacy ID update', async () => {
  const fixture = harness([saved({
    venue_timezone: undefined, tm_venue_id: 'phoenix-hall', venue: 'Phoenix Hall', city: 'Phoenix', state: 'AZ',
  })]);
  await fixture.invoke();
  assert.equal(fixture.events[0].tm_venue_id, 'tm-hall');
  assert.equal(fixture.events[0].venue_timezone, undefined);
  await fixture.invoke();
  assert.equal(fixture.events[0].venue_timezone, undefined);
  assert.equal(fixture.events[0].venue, 'Phoenix Hall');
  assert.equal(fixture.events[0].city, 'Phoenix');
});

test('incomplete venue identity cannot hide a known conflict after repeated sync', async () => {
  for (const missing of ['venue', 'city', 'state']) {
    const fixture = harness([saved({
      venue_timezone: undefined, tm_venue_id: 'phoenix-hall', venue: 'Phoenix Hall',
      city: 'Phoenix', state: 'AZ', [missing]: undefined,
    })]);
    await fixture.invoke();
    await fixture.invoke();
    assert.equal(fixture.events[0].tm_venue_id, 'tm-hall');
    assert.equal(fixture.events[0].venue_timezone, undefined);
  }
});

test('legacy records require complete matching venue identity when a stable ID is unavailable', async () => {
  const matching = harness([saved({ venue_timezone: undefined, tm_venue_id: undefined, venue: '  FIXTURE   Hall ' })]);
  await matching.invoke();
  assert.equal(matching.events[0].venue_timezone, 'America/New_York');
  for (const mismatch of [{ venue: 'Other Hall' }, { city: 'Phoenix' }, { state: 'AZ' }, { city: '' }, { venue: undefined }]) {
    const fixture = harness([saved({ venue_timezone: undefined, tm_venue_id: undefined, ...mismatch })]);
    await fixture.invoke();
    assert.equal(fixture.events[0].venue_timezone, undefined);
  }
});

test('actual dedup path keeps newest canonical and fills its missing zone', async () => {
  const fixture = harness([
    saved({ id: 'older-show', updated_date: '2026-10-04T12:00:00Z', venue_timezone: 'America/Phoenix' }),
    saved({ id: 'newer-show', venue_timezone: undefined }),
  ]);
  const result = await fixture.invoke();
  assert.deepEqual(result, { status: 200, body: { status: 'deduped', id: 'newer-show', duplicates_removed: 1 } });
  assert.equal(fixture.events.find((record) => record.id === 'newer-show').venue_timezone, 'America/New_York');
  assert.deepEqual(fixture.writes.filter((write) => write.action === 'delete'), [
    { entity: 'Event', action: 'delete', id: 'older-show' },
  ]);
});

test('actual dedup path preserves valid canonical zone despite absent, invalid or conflicting payload', async () => {
  for (const zone of [undefined, 'invalid', 'America/Phoenix']) {
    const fixture = harness([
      saved({ id: 'older-show', updated_date: '2026-10-04T12:00:00Z' }), saved(),
    ]);
    await fixture.invoke(payload({ venue_timezone: zone }));
    assert.equal(fixture.events.find((record) => record.id === 'saved-show').venue_timezone, 'America/New_York');
  }
});

test('actual dedup path refuses invalid payload or a conflicting venue without adopting deleted record metadata', async () => {
  for (const overrides of [{ venue_timezone: 'invalid' }, { tm_venue_id: 'wrong-hall' }]) {
    const fixture = harness([
      saved({ id: 'older-show', updated_date: '2026-10-04T12:00:00Z' }),
      saved({ venue_timezone: undefined }),
    ]);
    await fixture.invoke(payload(overrides));
    assert.equal(fixture.events.find((record) => record.id === 'saved-show').venue_timezone, undefined);
  }
});

test('actual handler retains authentication, validation and sanitized failures', async () => {
  const anonymous = harness([], { user: null });
  assert.deepEqual(await anonymous.invoke(), { status: 401, body: { error: 'Unauthorized' } });
  assert.equal(anonymous.writes.length, 0);
  const missingTitle = harness();
  assert.deepEqual(await missingTitle.invoke({ tm_id: 'tm-show' }), {
    status: 400, body: { error: 'tm_id and title are required' },
  });
  assert.equal(missingTitle.writes.length, 0);
  const failed = harness([], { failEventFilter: true });
  assert.deepEqual(await failed.invoke(), { status: 500, body: { error: 'internal_error' } });
});

test('normalized provider event keeps its venue-local display and exact instant after actual create and reload', async () => {
  const cases = [
    ['America/New_York', '2026-07-20T23:00:00Z', '7:00 PM EDT'],
    ['America/New_York', '2026-12-20T00:00:00Z', '7:00 PM EST'],
    ['America/Phoenix', '2026-07-20T23:00:00Z', '4:00 PM MST'],
    ['America/Phoenix', '2026-12-20T00:00:00Z', '5:00 PM MST'],
    ['America/Los_Angeles', '2026-07-20T23:00:00Z', '4:00 PM PDT'],
    ['America/Los_Angeles', '2026-12-20T00:00:00Z', '4:00 PM PST'],
    ['Europe/London', '2026-07-20T18:00:00Z', '7:00 PM GMT+1'],
    ['Europe/London', '2026-12-20T19:00:00Z', '7:00 PM GMT'],
    ['Asia/Tokyo', '2026-07-20T10:00:00Z', '7:00 PM GMT+9'],
  ];
  for (const [zone, instant, expectedTime] of cases) {
    const normalized = normalizeTMEvent({
      id: 'tm-show', name: 'Fixture show', dates: { start: { dateTime: instant }, timezone: zone },
      _embedded: { venues: [{ id: 'tm-hall', name: 'Fixture Hall', city: { name: 'Fixture City' }, state: { stateCode: 'ZZ' } }] },
    });
    const before = getEventDateDisplay(normalized);
    const fixture = harness();
    await fixture.invoke(normalized);
    const reloaded = JSON.parse(JSON.stringify(fixture.events[0]));
    const after = getEventDateDisplay(reloaded);
    assert.equal(reloaded.venue_timezone, zone);
    assert.equal(reloaded.date, instant);
    assert.equal(Date.parse(reloaded.date), Date.parse(normalized.event_start_utc));
    assert.equal(after.time, expectedTime, zone);
    assert.deepEqual(after, before, `${zone} ${instant}`);
    assert.doesNotMatch(after.detailLabel, /unconfirmed/);
  }
});
