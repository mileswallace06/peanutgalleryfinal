import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEventSearchRequest, buildEventSearchParams } from '../src/lib/eventSearchRequest.js';
import { mergeEventSources } from '../src/lib/eventSourceMerger.js';

const settled = value => ({ status: 'fulfilled', value });
test('a national artist search has no implicit city, radius, or coordinate requirement', () => {
  const { tmParams, pgQuery, pgLimit } = buildEventSearchParams(createEventSearchRequest('  Kahan  '));
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
test('Near me is explicitly bounded to 50 miles and preserves the keyword', () => {
  const { tmParams, pgQuery } = buildEventSearchParams(createEventSearchRequest('Kahan', { ll: '33.45,-112.07' }));
  assert.deepEqual(tmParams, { size: 40, keyword: 'Kahan', latlong: '33.45,-112.07', radius: '50' });
  assert.deepEqual(pgQuery.venue_lat, { $ne: null });
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
