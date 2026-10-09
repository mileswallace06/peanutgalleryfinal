import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDiscoveryPager, advanceDiscoveryPager, discoveryPagerResult, readLocalDiscoveryPage } from '../src/lib/eventDiscoveryPager.js';
import { createEventSearchRequest, buildDiscoveryStreams } from '../src/lib/eventSearchRequest.js';
import { buildTMDiscoveryRequest, discoveryPagination } from '../base44/shared/tmDiscoveryRequest.js';
import { dedupeEventIdentities, resolveEventAlias, eventVariantLabel } from '../src/lib/eventIdentity.js';
import { discoveryRequestFromSearch, discoverySearchFromRequest, safeDiscoveryReturnTo } from '../src/lib/eventDiscoveryState.js';
import { getEventUrl } from '../src/lib/eventUrl.js';
import { bustTMCache } from '../src/lib/tmCache.js';
import { discoveryMock } from './helpers/discoveryMock.mjs';

const now = Date.parse('2026-10-06T12:00:00Z');
const date = offset => new Date(now + offset * 3600000).toISOString();
const request = options => ({ ...createEventSearchRequest('', { city: 'New York', state: 'NY', label: 'New York, NY' }), ...options });
const event = (id, hour, extra = {}) => ({ id, title: `Show ${id}`, venue: 'Fixture Arena', city: 'New York', state: 'NY', date: date(hour), ...extra });
async function allPages(client, pager) {
  for (let i = 0; i < 30; i++) { pager = await advanceDiscoveryPager(client, pager); if (!discoveryPagerResult(pager).hasMore) return pager; }
  throw new Error('Pager failed to exhaust');
}

test('generic upcoming browsing reaches later local/provider events without old local rows consuming capacity', async () => {
  bustTMCache();
  const pg = [...Array.from({ length: 240 }, (_, i) => event(`past${i}`, -i - 1)), ...Array.from({ length: 95 }, (_, i) => event(`next${i}`, i + 1))];
  const tm = Array.from({ length: 83 }, (_, i) => event(`tm${i}`, i + 1, { tm_id: `provider${i}` }));
  const client = discoveryMock(pg, tm);
  const pager = await allPages(client, createDiscoveryPager(request(), now));
  const result = discoveryPagerResult(pager);
  assert.equal(result.events.length, 178); assert.equal(result.exhausted, true);
  assert.equal(result.events.some(row => row.id.startsWith('past')), false);
  assert.equal(client.calls.filter(call => call.name === 'getTicketmasterEvents').length, 3);
  assert.ok(client.calls.filter(call => call.name === 'Event.filter').every(call => call.skip === 0));
});
test('local page ties drain by stable ID and preserve every boundary record in both directions', async () => {
  const rows = Array.from({ length: 123 }, (_, i) => event(String(i).padStart(3, '0'), i < 85 ? 2 : 3)).reverse();
  for (const sort of ['soonest', 'latest']) {
    const stream = buildDiscoveryStreams(request({ sort }), now).legacy;
    const client = discoveryMock(rows), seen = []; let cursor = null;
    for (let i = 0; i < 10; i++) { const page = await readLocalDiscoveryPage(client, stream, cursor); seen.push(...page.rows); cursor = page.cursor; if (!page.hasMore) break; }
    assert.equal(seen.length, 123); assert.equal(new Set(seen.map(row => row.id)).size, 123);
    assert.equal(seen[0].date, date(sort === 'latest' ? 3 : 2));
  }
});
test('canonical UTC eligibility overrides older legacy date and Latest is sent to both sources', async () => {
  bustTMCache();
  const client = discoveryMock([event('canonical', -50, { event_start_utc: date(100) }), event('early', 1), event('latest', 70)], [event('provider', 80, { tm_id: 'latest' })]);
  const pager = await advanceDiscoveryPager(client, createDiscoveryPager(request({ sort: 'latest' }), now));
  assert.deepEqual(discoveryPagerResult(pager).events.map(row => row.id), ['canonical', 'tm_latest', 'latest', 'early']);
  assert.equal(client.calls.find(call => call.name === 'getTicketmasterEvents').params.sort, 'latest');
  assert.ok(client.calls.some(call => call.sort === '-event_start_utc'));
});
test('Include past paginates historical and ended events while default excludes them', async () => {
  bustTMCache();
  const rows = Array.from({ length: 100 }, (_, i) => event(String(i), -i - 1, { status: 'ended' }));
  const pager = await allPages(discoveryMock(rows), createDiscoveryPager(request({ includePast: true }), now));
  assert.equal(discoveryPagerResult(pager).events.length, 100);
  const query = buildTMDiscoveryRequest({ includePast: true, page: 2, sort: 'latest', size: 40 }, now);
  assert.equal(query.params.has('startDateTime'), false); assert.equal(query.params.get('page'), '2'); assert.equal(query.params.get('sort'), 'date,desc');
});
test('failed provider keeps its cursor; successful local progress survives retry and no source is refetched unnecessarily', async () => {
  bustTMCache();
  const client = discoveryMock([event('local', 1)], [event('provider', 2, { tm_id: 'retry-provider' })]);
  client.failures.provider = true;
  let pager = await advanceDiscoveryPager(client, createDiscoveryPager(request(), now));
  assert.equal(discoveryPagerResult(pager).events.length, 1); assert.equal(pager.streams.provider.page, 0);
  const localCalls = client.calls.filter(call => call.name === 'Event.filter').length;
  client.failures.provider = false;
  pager = await advanceDiscoveryPager(client, pager, { retryFailed: true });
  assert.equal(discoveryPagerResult(pager).events.length, 2); assert.equal(discoveryPagerResult(pager).tmError, false);
  assert.equal(client.calls.filter(call => call.name === 'Event.filter').length, localCalls);
});
test('missing pagination contract and capped provider search are explicitly incomplete', async () => {
  bustTMCache();
  const client = discoveryMock(); client.functions.invoke = async () => ({ data: { events: [] } });
  const result = discoveryPagerResult(await advanceDiscoveryPager(client, createDiscoveryPager(request(), now)));
  assert.equal(result.tmError, true); assert.equal(result.exhausted, false);
  assert.equal(buildTMDiscoveryRequest({ page: 25, size: 40 }, now).error, 'provider_page_limit');
  const coverage = discoveryPagination({ page: 24, limit: 40 }, { page: { totalElements: 1600, totalPages: 40 } }, 40);
  assert.equal(coverage.truncated, true); assert.equal(coverage.hasMore, false);
});
test('submitted request URL round-trips filters and does not accept off-site return targets', () => {
  for (const original of [request({ keyword: 'Knocked Loose', sort: 'latest', includePast: true }), { ...createEventSearchRequest('Artist', null, 'nationwide'), sort: 'soonest', includePast: false }, { ...createEventSearchRequest('', { ll: '40.7,-74', label: 'your location · 50 miles' }), sort: 'soonest', includePast: false }]) assert.deepEqual(discoveryRequestFromSearch(discoverySearchFromRequest(original)), original);
  assert.equal(safeDiscoveryReturnTo('//attacker.example/events'), '/events');
  assert.equal(safeDiscoveryReturnTo('/events?browse=1&q=Artist'), '/events?browse=1&q=Artist');
});
test('equivalent provider occurrence aliases collapse deterministically without deleting old links', () => {
  const a = event('native-a', 10, { title: 'Knocked Loose', tm_id: 'provider-a', tm_venue_id: 'venue-1' });
  const b = { ...a, id: 'native-b', tm_id: 'provider-b' };
  const output = dedupeEventIdentities([b, a]);
  assert.equal(output.length, 1); assert.equal(output[0].id, a.id);
  for (const row of [a, b]) { assert.equal(getEventUrl(row), `/events/${row.id}`); assert.equal(resolveEventAlias(output, row.id).id, a.id); }
  assert.equal(a._eventAliases, undefined);
});
test('title alone, different dates/venues/products/sessions and distinct known inventory remain separate', () => {
  const a = event('a', 10, { title: 'Tour', tm_id: 'a', tm_venue_id: 'venue' });
  for (const patch of [{ date: date(11) }, { tm_venue_id: 'other' }, { product_type: 'VIP' }, { product_label: 'Balcony pass' }, { session_name: 'Meet and greet' }, { session_id: 'session-2' }, { listing_count: 2 }, { date: undefined }, { time_tba: true }]) assert.equal(dedupeEventIdentities([a, { ...a, ...patch, id: 'b', tm_id: 'b' }]).length, 2);
  assert.equal(dedupeEventIdentities([{ id: 'a', title: 'Tour' }, { id: 'b', title: 'Tour' }]).length, 2);
  assert.equal(eventVariantLabel({ product_type: 'VIP', session_name: 'Evening' }), 'Evening · VIP');
});

test('provider occurrence aliases cannot bridge two inventory-bearing local records in any input order', () => {
  const a = event('local-a', 10, { title: 'Tour', tm_id: 'tm-a', tm_venue_id: 'venue', listing_count: 3 });
  const b = { ...a, id: 'local-b', tm_id: 'tm-b', listing_count: 2 };
  const pa = { ...a, id: 'tm_tm-a', listing_count: undefined, source: 'ticketmaster' };
  const pb = { ...b, id: 'tm_tm-b', listing_count: undefined, source: 'ticketmaster' };
  for (const order of [[a,b,pa,pb], [pa,pb,a,b], [pb,a,pa,b], [b,pb,pa,a]]) {
    const result = dedupeEventIdentities(order);
    assert.deepEqual(result.map(row => row.id).sort(), ['local-a', 'local-b']);
    assert.equal(result.find(row => row.id === a.id).listing_count, 3);
    assert.equal(result.find(row => row.id === b.id).listing_count, 2);
  }
  const sameProvider = dedupeEventIdentities([a, { ...b, tm_id: a.tm_id }, pa]);
  assert.deepEqual(sameProvider.map(row => row.id).sort(), ['local-a', 'local-b']);
});
test('local continuation records return depth independently of exhausted provider progress', async () => {
  bustTMCache();
  const client = discoveryMock(Array.from({ length: 190 }, (_, i) => event(`local-${i}`, i + 1)));
  let pager = createDiscoveryPager(request(), now);
  for (let i = 0; i < 5; i++) pager = await advanceDiscoveryPager(client, pager);
  assert.equal(pager.streams.legacy.pagesLoaded, 5);
  assert.equal(pager.streams.provider.pagesLoaded, 1);
  assert.equal(pager.streams.provider.page, 0);
  assert.equal(discoveryPagerResult(pager).events.length, 190);
});

test('opaque session identifiers preserve case and punctuation distinctions', () => {
  const a = event('a', 2, { tm_id: 'a', title: 'Tour', tm_venue_id: 'venue', session_id: 'SessionABC' });
  for (const session_id of ['Sessionabc', 'Session-ABC', 'Session_ABC']) assert.equal(dedupeEventIdentities([a, { ...a, id: 'b', tm_id: 'b', session_id }]).length, 2);
});

test('a sparse local alias cannot hide a known inventory reference in the canonical card', () => {
  const inventory = event('z-inventory', 2, { tm_id: 'same-provider', title: 'Tour', tm_venue_id: 'venue', listing_count: 3, inventory_id: 'inventory-reference' });
  const sparse = { ...inventory, id: 'a-sparse-copy', listing_count: undefined, inventory_id: undefined };
  for (const rows of [[inventory, sparse], [sparse, inventory]]) {
    const [canonical] = dedupeEventIdentities(rows);
    assert.equal(canonical.id, inventory.id);
    assert.equal(canonical.listing_count, 3);
    assert.equal(canonical.inventory_id, 'inventory-reference');
    assert.equal(resolveEventAlias([canonical], sparse.id), canonical);
  }
});
