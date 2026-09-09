import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { getEventDiscoveryStatus as timing, getEventLiveStatus } from '../src/lib/eventTiming.js';
import { normalizeTMEvent } from '../base44/shared/tmResponseHandler.js';
import { discoverTMEvents } from '../base44/shared/tmEventDiscovery.js';
import { fetchTMEvents, bustTMCache } from '../src/lib/tmCache.js';
import { loadUpgradeEvents, matchesUpgradeLocation } from '../src/lib/upgradeDiscovery.js';
import { subscribeEventClock } from '../src/lib/eventClock.js';
import { loadFeedbackPage, submitAcceptedFeedback } from '../src/lib/feedbackInbox.js';

const start = Date.parse('2026-09-09T01:00:00Z');
const hour = 3600000;
const event = { date: new Date(start).toISOString(), city: 'Phoenix', state: 'AZ' };
const raw = (id, ms = start, end) => ({ id, name: id, dates: { start: { dateTime: new Date(ms).toISOString() }, end },
  _embedded: { venues: [{ city: { name: 'Phoenix' }, state: { stateCode: 'AZ' } }] } });
const response = events => Response.json({ _embedded: { events } });

test('discovery boundaries: soon, exact start, four-hour unknown fallback and exclusive end', () => {
  assert.equal(timing(event, start-hour-1).status, 'upcoming');
  assert.equal(timing(event, start-hour).status, 'soon');
  assert.equal(timing(event, start).status, 'live');
  assert.equal(timing(event, start+4*hour-1).status, 'live');
  assert.equal(timing(event, start+4*hour).status, 'ended');
  assert.equal(timing(event, start).end_estimated, true);
  assert.equal(timing({ ...event, category: 'theater' }, start+3*hour).status, 'ended');
  assert.equal(timing({ ...event, duration_hours: 6 }, start+5*hour).status, 'live');
  for (const duration_hours of [0, -1, Infinity, 'bad']) assert.equal(timing({ ...event, duration_hours }, start).end_utc_ms, start+4*hour);
  assert.equal(timing({ date: '2026-09-09T01:00:00' }, start).start_utc_ms, null);
});

test('actual end wins; invalid/approximate ends use a visibly estimated duration', () => {
  const end = new Date(start+2*hour).toISOString();
  assert.equal(timing({ ...event, event_end_utc: end }, start+2*hour).status, 'ended');
  assert.equal(timing({ ...event, event_end_utc: end }, start).end_estimated, false);
  for (const event_end_utc of ['bad', event.date, new Date(start-hour).toISOString()]) {
    assert.equal(timing({ ...event, event_end_utc }, start).end_utc_ms, start+4*hour);
  }
  const normalized = normalizeTMEvent(raw('show', start, { dateTime: end, approximate: true }));
  assert.equal(timing(normalized, start+3*hour).status, 'live');
  assert.equal(timing(normalized, start).end_estimated, true);
  const confirmed = normalizeTMEvent(raw('show', start, { dateTime: end }));
  assert.equal(timing(confirmed, start+2*hour).status, 'ended');
  const salesOnly = normalizeTMEvent({ ...raw('show'), sales: { public: { endDateTime: end } } });
  assert.equal(salesOnly.event_end_utc, null);
  const tba = raw('tba'); tba.dates.start.timeTBA = true;
  assert.equal(timing(normalizeTMEvent(tba), start).status, 'upcoming');
  assert.equal(normalizeTMEvent(tba).date, tba.dates.start.dateTime);
  // Purchase-facing legacy policy still uses its original duration and inclusive end.
  assert.equal(getEventLiveStatus(confirmed, start+2*hour).status, 'live');
  assert.equal(getEventLiveStatus(event, start+4*hour).status, 'live');
});

test('bounded past query retains ongoing after refresh/reopen without spending future result budget', async () => {
  const calls = [];
  const future = Array.from({ length: 40 }, (_, i) => raw(`future${i}`, start+10*hour+i*1000));
  const fetchImpl = async url => {
    const p = new URL(url).searchParams; calls.push(p);
    return response(p.has('endDateTime') ? [raw('ongoing'), raw('expired', start-10*hour)] : future);
  };
  for (const now of [start+hour, start+2*hour, start+4*hour]) {
    const result = await discoverTMEvents({ apiKey: 'synthetic', city: 'Phoenix', size: 40, includeOngoing: true }, { now, fetchImpl });
    assert.equal(result.body.events.filter(e => e.tm_id.startsWith('future')).length, 40);
    assert.equal(result.body.events.some(e => e.tm_id === 'ongoing'), now < start+4*hour);
    assert.equal(result.body.events.some(e => e.tm_id === 'expired'), false);
  }
  assert.equal(calls.length, 6);
  assert.equal(calls[0].get('size'), '40');
  assert.equal(calls[1].get('size'), '200');
  assert.equal(Date.parse(calls[1].get('endDateTime'))-Date.parse(calls[1].get('startDateTime')), 24*hour);
  const legacyCalls = [];
  await discoverTMEvents({ apiKey: 'synthetic', size: 40 }, { now: start, fetchImpl: async url => { legacyCalls.push(url); return response([]); } });
  assert.equal(legacyCalls.length, 1);
});

test('partial windows preserve successful coverage, failures are sanitized and duplicates collapse', async () => {
  const params = { apiKey: 'synthetic', size: 40, includeOngoing: true };
  for (const failRecent of [true, false]) {
    const result = await discoverTMEvents(params, { now: start+hour, fetchImpl: async url => {
      if (new URL(url).searchParams.has('endDateTime') === failRecent) throw new Error('private upstream details');
      return response([raw('ongoing')]);
    } });
    assert.equal(result.status, 200); assert.equal(result.body.partial, true); assert.equal(result.body.events.length, 1);
    assert.equal(JSON.stringify(result).includes('private'), false);
  }
  const duplicate = await discoverTMEvents(params, { now: start+hour, fetchImpl: async () => response([raw('same')]) });
  assert.equal(duplicate.body.events.length, 1);
  const failed = await discoverTMEvents(params, { fetchImpl: async () => new Response('', { status: 429 }) });
  assert.equal(failed.status, 502); // invalid JSON is classified before HTTP status, as before
  const limited = await discoverTMEvents(params, { fetchImpl: async () => Response.json({}, { status: 429 }) });
  assert.equal(limited.status, 429);
});

test('actual deployed handler validates opt-in and calls both shared windows', async () => {
  let handler; const urls = [];
  const context = vm.createContext({ Response, URL, AbortController, setTimeout, clearTimeout,
    fetch: async url => { urls.push(url); return response([]); },
    Deno: { serve: fn => { handler = fn; }, env: { get: key => key === 'Ticketmaster_consumer_key' ? 'synthetic' : undefined } } });
  const modules = new Map();
  async function load(id) {
    if (!modules.has(id)) modules.set(id, new vm.SourceTextModule(await readFile(id, 'utf8'), { context, identifier: id }));
    return modules.get(id);
  }
  const entry = await load(resolve('base44/functions/getTicketmasterEvents/entry.ts'));
  await entry.link((name, parent) => load(resolve(dirname(parent.identifier), name)));
  await entry.evaluate();
  const request = body => handler({ json: async () => body });
  assert.equal((await request({ includeOngoing: 'yes' })).status, 400);
  assert.equal(urls.length, 0);
  assert.equal((await request({ includeOngoing: true, size: 40 })).status, 200);
  assert.equal(urls.length, 2);
});

test('cache deduplicates, retains ongoing on reopen, refreshes on demand, and never caches partial windows', async () => {
  bustTMCache(); let calls = 0; let partial = false;
  const sdk = { functions: { invoke: async () => { calls++; return { data: { events: [{ ...event, tm_id: 'ongoing' }], partial } }; } } };
  const params = { city: 'Phoenix', includeOngoing: true };
  const [a, b] = await Promise.all([fetchTMEvents(sdk, params), fetchTMEvents(sdk, params)]);
  assert.equal(calls, 1); assert.deepEqual(a.events, b.events);
  assert.equal((await fetchTMEvents(sdk, params)).fromCache, true);
  bustTMCache(params); await fetchTMEvents(sdk, params); assert.equal(calls, 2);
  partial = true; bustTMCache(); await fetchTMEvents(sdk, params); await fetchTMEvents(sdk, params); assert.equal(calls, 4);
});

test('GPS local membership is independent of empty/failed TM and excludes missing/far coordinates', async () => {
  const local = [{ ...event, id: 'near', venue_lat: 33.45, venue_lng: -112.07 },
    { ...event, id: 'far', venue_lat: 40, venue_lng: -80 }, { ...event, id: 'missing' }];
  for (const fail of [false, true]) {
    bustTMCache();
    const result = await loadUpgradeEvents({ entities: { Event: { list: async () => local } }, functions: { invoke: async () => {
      if (fail) throw { status: 502, message: 'synthetic_failure' };
      return { data: { events: [] } };
    } } }, { latlong: '33.45,-112.07' });
    assert.deepEqual(result.events.map(e => e.id), ['near']); assert.equal(result.partial, fail);
  }
  assert.equal(matchesUpgradeLocation({ ...event, venue_lat: '', venue_lng: '' }, { latlong: '0,0' }), false);
  assert.equal(matchesUpgradeLocation(event, { city: 'Phoenix, AZ' }), true);
  assert.equal(matchesUpgradeLocation(event, { city: 'Phoenix, OR' }), false);
  assert.equal(matchesUpgradeLocation({ ...event, city: 'Tempe', venue: 'Phoenix Arena' }, { city: 'Phoenix' }), false);
});

test('PG deduplication keeps independently verified provider ending without persisting new fields', async () => {
  bustTMCache(); const local = { ...event, id: 'pg', tm_id: 'match' };
  const end = new Date(start+2*hour).toISOString();
  const sdk = { entities: { Event: { list: async () => [local] } }, functions: { invoke: async () => ({ data: { events: [{ ...local, event_end_utc: end, end_estimated: false }] } }) } };
  const result = await loadUpgradeEvents(sdk, { city: 'Phoenix, AZ' });
  assert.equal(result.events.length, 1); assert.equal(result.events[0].id, 'pg');
  assert.equal(timing(result.events[0], start+2*hour).status, 'ended');
  assert.equal(local.event_end_utc, undefined);
});

test('minute clock redraws without fetch; foreground updates immediately; unsubscribe stops callbacks', () => {
  const document = new EventTarget(), window = new EventTarget(); document.visibilityState = 'visible';
  let interval, cleared, ticks = 0, refreshes = 0;
  const stop = subscribeEventClock({ document, window, onTick: () => ticks++, onForeground: () => refreshes++,
    setInterval: (fn, ms) => { assert.equal(ms, 60000); interval = fn; return 1; }, clearInterval: id => { cleared = id; } });
  interval(); assert.equal(ticks, 1); assert.equal(refreshes, 0);
  document.visibilityState = 'hidden'; interval(); document.dispatchEvent(new Event('visibilitychange')); assert.equal(ticks, 1);
  document.visibilityState = 'visible'; document.dispatchEvent(new Event('visibilitychange'));
  window.dispatchEvent(new Event('pageshow')); window.dispatchEvent(new Event('focus'));
  assert.equal(ticks, 4); assert.equal(refreshes, 3);
  stop(); window.dispatchEvent(new Event('focus')); assert.equal(refreshes, 3); assert.equal(cleared, 1);
});

test('admin inbox reads every page beyond old 500 cap, preserves full messages and rejects non-admin before access', async () => {
  const rows = Array.from({ length: 505 }, (_, i) => ({ id: String(i), message: 'Full message\n'+'x'.repeat(1900), feedback_type: ['bug','confused','idea','love'][i%4] }));
  let calls = 0;
  const sdk = { entities: { BetaFeedbackEvent: { filter: async (query, sort, limit, skip) => {
    calls++; assert.equal(sort, '-created_date');
    return rows.filter(r => !query.feedback_type || r.feedback_type === query.feedback_type).slice(skip, skip+limit);
  } } } };
  for (const user of [null, {}, { role: 'user' }]) await assert.rejects(loadFeedbackPage(sdk, user), /admin_required/);
  assert.equal(calls, 0);
  let offset = 0, page;
  do { page = await loadFeedbackPage(sdk, { role: 'admin' }, 'all', offset); offset += page.rows.length; } while (page.hasMore);
  assert.equal(offset, 505);
  for (const category of ['bug','confused','idea','love']) {
    const result = await loadFeedbackPage(sdk, { role: 'admin' }, category);
    assert(result.rows.every(r => r.feedback_type === category && r.message.length > 1900));
  }
  const schema = JSON.parse(await readFile('base44/entities/BetaFeedbackEvent.jsonc', 'utf8'));
  assert.equal(schema.rls.read.user_condition.role, 'admin');
});

test('submission succeeds only when existing backend acknowledges accepted record', async () => {
  const payload = { feedback_type: 'bug', page: '/me', message: 'Synthetic feedback' };
  for (const data of [{}, { status: 'submitted' }, { status: 'error', id: 'x' }]) {
    await assert.rejects(submitAcceptedFeedback({ functions: { invoke: async () => ({ data }) } }, payload));
  }
  const result = await submitAcceptedFeedback({ functions: { invoke: async (name, body) => {
    assert.equal(name, 'submitFeedback'); assert.deepEqual(body, payload); return { data: { status: 'submitted', id: 'accepted' } };
  } } }, payload);
  assert.equal(result.id, 'accepted');
});
