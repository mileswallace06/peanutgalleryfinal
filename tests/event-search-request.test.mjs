import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEventSearchRequest, buildEventSearchParams } from '../src/lib/eventSearchRequest.js';
import { mergeEventSources } from '../src/lib/eventSourceMerger.js';
import { restoreEventLocation, saveEventLocation, validCoordinates, cityFromSuggestion } from '../src/lib/eventLocation.js';

const settled = value => ({ status: 'fulfilled', value });
test('a national artist search has no implicit city, radius, or coordinate requirement', () => {
  const { tmParams, pgQuery, pgLimit } = buildEventSearchParams(createEventSearchRequest('  Kahan  ', null, 'nationwide'));
  assert.deepEqual(tmParams, { size: 40, keyword: 'Kahan' });
  assert.deepEqual(pgQuery, { search_text_normalized: { $regex: 'kahan', $options: 'i' } });
  assert.equal(pgLimit, 100);
});
test('an explicit city uses the canonical city, not its display label', () => {
  const request = createEventSearchRequest('Kahan', { city: 'Phoenix', label: 'Phoenix, AZ' });
  const { tmParams, pgQuery } = buildEventSearchParams(request);
  assert.equal(tmParams.city, 'Phoenix');
  assert.equal(request.locationLabel, 'Phoenix, AZ');
  assert.equal(new RegExp(pgQuery.city.$regex, 'i').test('Phoenixville'), false);
  assert.equal(new RegExp(pgQuery.city.$regex, 'i').test('phoenix'), true);
});
test('removing a city preserves the artist query and removes geography from both sources', () => {
  const local = createEventSearchRequest('Noah Kahan', { city: 'Phoenix' });
  const global = buildEventSearchParams(createEventSearchRequest(local.keyword));
  assert.equal(global.tmParams.keyword, 'Noah Kahan');
  assert.equal('city' in global.tmParams, false);
  assert.equal('city' in global.pgQuery, false);
});
test('a local GPS keyword search is bounded to 50 miles', () => {
  const { tmParams, pgQuery } = buildEventSearchParams(createEventSearchRequest('Kahan', { ll: '33.45,-112.07' }));
  assert.deepEqual(tmParams, { size: 40, keyword: 'Kahan', latlong: '33.45,-112.07', radius: '50' });
  assert.deepEqual(pgQuery.venue_lat, { $ne: null });
});

test('nationwide removes all location restrictions without mutating the retained local area', () => {
  const area = Object.freeze({ city: 'Phoenix', state: 'AZ', label: 'Phoenix, AZ' });
  const local = createEventSearchRequest('Billy', area);
  const nationwide = createEventSearchRequest(local.keyword, area, 'nationwide');
  assert.deepEqual(buildEventSearchParams(nationwide), buildEventSearchParams(createEventSearchRequest('Billy', null, 'nationwide')));
  assert.equal(nationwide.stateOverride, null);
  assert.equal(nationwide.locationLabel, 'Nationwide');
  const nearby = createEventSearchRequest('', area);
  assert.deepEqual(buildEventSearchParams(nearby).tmParams, { size: 40, city: 'Phoenix' });
  assert.equal(nearby.keyword, '');
  assert.equal(nearby.scope, 'local');
  assert.equal(local.stateOverride, 'AZ');
});

const memoryStorage = values => ({ getItem: key => values[key] ?? null, setItem: (key, value) => { values[key] = value; } });
test('validated selected city survives reload; old artist-as-city state is ignored', async () => {
  const storage = memoryStorage({ pg_events_location: JSON.stringify({ city: 'Kahan' }) });
  assert.equal(await restoreEventLocation({}, storage), null);
  const city = cityFromSuggestion({ city: 'Phoenix', state: 'AZ', label: 'incorrect display string' });
  saveEventLocation(city, storage, 100);
  assert.deepEqual(await restoreEventLocation({}, storage, 200), { city: 'Phoenix', state: 'AZ', label: 'Phoenix, AZ' });
  assert.equal(cityFromSuggestion({ city: 'Kahan' }), null);
});
test('legacy recent city requires an exact service match, never the first unrelated suggestion', async () => {
  const storage = memoryStorage({ pg_recent_cities: JSON.stringify([{ city: 'Kahan', state: 'AZ' }]) });
  const base44 = { functions: { invoke: async () => ({ data: { cities: [{ city: 'Phoenix', state: 'AZ' }] } }) } };
  assert.equal(await restoreEventLocation(base44, storage), null);
  storage.setItem('pg_recent_cities', JSON.stringify([{ city: 'Phoenix', state: 'AZ' }]));
  assert.equal((await restoreEventLocation(base44, storage)).label, 'Phoenix, AZ');
});
test('saved GPS is range checked and expires; browsing does not extend its original lifetime', async () => {
  const storage = memoryStorage({ pg_location_cache: JSON.stringify({ latlong: '33.45,-112.07', ts: 1000 }) });
  const area = await restoreEventLocation({}, storage, 2000);
  assert.equal(area.ll, '33.45,-112.07');
  saveEventLocation(area, storage, 3000);
  assert.equal(await restoreEventLocation({}, storage, 3601000), null);
  for (const ll of ['91,0', '0,-181', ',', 'x,12', '1,2,3', 'Infinity,0']) assert.equal(validCoordinates(ll), null);
});
test('same-name cities in another state are excluded while provider identity deduplication remains intact', () => {
  const event = { tm_id: 'springfield-il', title: 'Billy', city: 'Springfield', state: 'IL' };
  const merged = mergeEventSources({
    localResult: settled([{ ...event, id: 'local' }]),
    tmResult: settled({ events: [event, { ...event, tm_id: 'springfield-mo', state: 'MO' }] }),
    filters: { cityOverride: 'Springfield', stateOverride: 'IL', keyword: 'Billy', tmKeywordApplied: true, now: Date.now() },
  });
  assert.deepEqual(merged.events.map(e => e.id), ['local']);
});
test('local matching stays normalized and queries remain bounded', () => {
  const result = buildEventSearchParams(createEventSearchRequest('Beyoncé (Live)'));
  assert.equal(result.pgQuery.search_text_normalized.$regex, 'beyonce live');
  assert.equal(createEventSearchRequest('x'.repeat(200)).keyword.length, 100);
  assert.equal(buildEventSearchParams(createEventSearchRequest('', { city: 'Boston' })).pgLimit, 200);
});
test('provider artist/attraction matches survive missing artist metadata on normalized cards', () => {
  const festival = { tm_id: 'festival', title: 'Summer Festival', city: 'Boston' };
  const params = {
    localResult: settled([{ id: 'local', title: 'Unrelated show' }]),
    tmResult: settled({ events: [festival] }),
    filters: { keyword: 'Kahan', tmKeywordApplied: true, now: Date.now() },
  };
  assert.deepEqual(mergeEventSources(params).events.map(e => e.id), ['tm_festival']);
  // Callers merging an unsearched provider list still get client keyword filtering.
  assert.equal(mergeEventSources({ ...params, filters: { ...params.filters, tmKeywordApplied: false } }).events.length, 0);
});
test('synced provider events appear once and retain the local event route', () => {
  const event = { tm_id: 'billy-boston', title: 'Billy', city: 'Boston', date: '2099-10-01T20:00:00Z' };
  const merged = mergeEventSources({
    localResult: settled([{ ...event, id: 'pg-boston' }, { ...event, id: 'pg-boston-copy' }]),
    tmResult: settled({ events: [event, event] }),
    filters: { keyword: 'Billy', tmKeywordApplied: true, now: Date.now() },
  });
  assert.deepEqual(merged.events.map(e => e.id), ['pg-boston']);
});
test('distinct provider IDs and local-only events are not collapsed by matching titles', () => {
  const merged = mergeEventSources({
    localResult: settled([{ id: 'local-one', title: 'Billy' }, { id: 'local-two', title: 'Billy' }]),
    tmResult: settled({ events: [{ tm_id: 'date-one', title: 'Billy' }, { tm_id: 'date-two', title: 'Billy' }] }),
    filters: { keyword: 'Billy', tmKeywordApplied: true, now: Date.now() },
  });
  assert.deepEqual(merged.events.map(e => e.id), ['local-one', 'local-two', 'tm_date-one', 'tm_date-two']);
});
