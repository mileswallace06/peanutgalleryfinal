#!/usr/bin/env node
/**
 * M0.2 Integration Test — exercises the actual TM-cache function and the
 * production event-source merger used by Events.jsx.
 *
 * This test invokes the real fetchTMEvents (from src/lib/tmCache.js) with a
 * mocked Base44 client, then passes its real return value through the real
 * mergeEventSources (from src/lib/eventSourceMerger.js).
 *
 * Against commit 29e9760 this test FAILS because the inline Events.jsx merger
 * treated tmResult.value as an array (it is { events, fromCache }), causing
 * .map() to crash. After the M0.2 correction (extract .events, validate with
 * Array.isArray), this test PASSES.
 */
import { fetchTMEvents, bustTMCache } from '../src/lib/tmCache.js';
import { mergeEventSources } from '../src/lib/eventSourceMerger.js';

let passed = 0;
let failed = 0;

function assert(cond, msg) {
  if (cond) { console.log(`  PASS: ${msg}`); passed++; }
  else { console.error(`  FAIL: ${msg}`); failed++; }
}

// ── Mock Base44 client ─────────────────────────────────────────────────────
function makeMockBase44(response) {
  return {
    functions: {
      invoke: async (_name, _params) => response,
    },
  };
}

// Helper: run fetchTMEvents + mergeEventSources as Events.jsx does
async function runMerge(mockBase44, tmParams, filters) {
  bustTMCache(); // clear cache between tests
  const [localResult, tmResult] = await Promise.allSettled([
    Promise.resolve(filters.localData || []),
    fetchTMEvents(mockBase44, tmParams),
  ]);
  return mergeEventSources({ localResult, tmResult, filters });
}

const NOW = Date.now();
const baseFilters = { cityOverride: null, ll: null, keyword: null, isAdmin: false, now: NOW };

// ── Tests ──────────────────────────────────────────────────────────────────

async function main() {
  console.log('╔══════════════════════════════════════════════════════════════════╗');
  console.log('║  M0.2 Integration — fetchTMEvents + mergeEventSources            ║');
  console.log('╚══════════════════════════════════════════════════════════════════╝\n');

  // ── 1. Fulfilled TM with valid events ───────────────────────────────────
  console.log('Test 1: Fulfilled TM with valid events');
  {
    const mock = makeMockBase44({
      data: { events: [{ tm_id: 'tm_1', title: 'Concert', venue: 'Arena', city: 'Phoenix' }] },
    });
    const merged = await runMerge(mock, { size: 10 }, baseFilters);
    assert(merged.events.length === 1, '1 event returned');
    assert(merged.events[0].source === 'ticketmaster', 'event source is ticketmaster');
    assert(merged.events[0].id === 'tm_tm_1', 'TM event id prefixed with tm_');
    assert(merged.tmFailed === false, 'tmFailed is false');
    assert(merged.partialData === false, 'partialData is false');
  }

  // ── 2. Rejected TM (429) → tmError, PG events shown ─────────────────────
  console.log('\nTest 2: Rejected TM (429) → tmError');
  {
    const mock = makeMockBase44({ data: { error: 'rate_limited', upstream_status: 429 }, status: 429 });
    // fetchTMEvents throws on error-in-200, so we simulate the allSettled result
    bustTMCache();
    const [localResult, tmResult] = await Promise.allSettled([
      Promise.resolve([{ id: 'pg1', title: 'PG Event', status: 'upcoming', date: null, is_beta_live: false }]),
      fetchTMEvents(mock, { size: 10 }),
    ]);
    const merged = mergeEventSources({ localResult, tmResult, filters: baseFilters });
    assert(merged.tmFailed === true, 'tmFailed is true');
    assert(merged.tmError === true, 'tmError is true (429)');
    assert(merged.partialData === false, 'partialData is false (429 takes priority)');
    assert(merged.events.length === 1, 'PG event shown');
    assert(merged.events[0].source === 'pg', 'event source is pg');
  }

  // ── 3. Rejected TM (500) → partialData, PG events shown ────────────────
  console.log('\nTest 3: Rejected TM (500) → partialData');
  {
    const mock = makeMockBase44({ data: { error: 'upstream_error', upstream_status: 500 }, status: 502 });
    bustTMCache();
    const [localResult, tmResult] = await Promise.allSettled([
      Promise.resolve([{ id: 'pg1', title: 'PG Event', status: 'upcoming', date: null, is_beta_live: false }]),
      fetchTMEvents(mock, { size: 10 }),
    ]);
    const merged = mergeEventSources({ localResult, tmResult, filters: baseFilters });
    assert(merged.tmFailed === true, 'tmFailed is true');
    assert(merged.tmError === false, 'tmError is false (not 429)');
    assert(merged.partialData === true, 'partialData is true (TM failed, PG succeeded)');
    assert(merged.events.length === 1, 'PG event shown');
  }

  // ── 4. Malformed fulfilled TM (events is null) → fetchTMEvents throws ──
  console.log('\nTest 4: Malformed fulfilled TM (events is null)');
  {
    const mock = makeMockBase44({ data: { events: null } });
    bustTMCache();
    let threw = false;
    try {
      await fetchTMEvents(mock, { size: 10 });
    } catch (e) {
      threw = true;
      assert(e.message === 'malformed_tm_response', 'error message is malformed_tm_response');
    }
    assert(threw, 'fetchTMEvents throws on null events (does not cache as empty)');
  }

  // ── 5. Malformed fulfilled TM (events is object, not array) ─────────────
  console.log('\nTest 5: Malformed fulfilled TM (events is object)');
  {
    const mock = makeMockBase44({ data: { events: { not: 'an array' } } });
    bustTMCache();
    let threw = false;
    try {
      await fetchTMEvents(mock, { size: 10 });
    } catch (e) {
      threw = true;
    }
    assert(threw, 'fetchTMEvents throws on non-array events');
  }

  // ── 6. Defense-in-depth: merger handles malformed fulfilled result ──────
  console.log('\nTest 6: Merger defense-in-depth (malformed fulfilled)');
  {
    // Simulate a scenario where fetchTMEvents somehow returns without throwing
    // but the value has non-array events (e.g., cache corruption).
    const merged = mergeEventSources({
      localResult: { status: 'fulfilled', value: [] },
      tmResult: { status: 'fulfilled', value: { events: null, fromCache: false } },
      filters: baseFilters,
    });
    assert(merged.tmFailed === true, 'merger classifies malformed fulfilled as tmFailed');
    assert(merged.events.length === 0, 'no events from malformed TM');
    assert(merged.tmEventsRaw.length === 0, 'tmEventsRaw is empty array');
  }

  // ── 7. PG-only (TM rejected) ────────────────────────────────────────────
  console.log('\nTest 7: PG-only (TM rejected)');
  {
    const mock = makeMockBase44({ data: { error: 'upstream_error' }, status: 502 });
    const pgData = [
      { id: 'pg1', title: 'PG Event 1', status: 'upcoming', date: null, is_beta_live: false },
      { id: 'pg2', title: 'PG Event 2', status: 'upcoming', date: null, is_beta_live: false },
    ];
    bustTMCache();
    const [localResult, tmResult] = await Promise.allSettled([
      Promise.resolve(pgData),
      fetchTMEvents(mock, { size: 10 }),
    ]);
    const merged = mergeEventSources({ localResult, tmResult, filters: baseFilters });
    assert(merged.events.length === 2, '2 PG events shown');
    assert(merged.events.every(e => e.source === 'pg'), 'all events are PG');
    assert(merged.partialData === true, 'partialData is true');
  }

  // ── 8. TM-only (PG rejected) ─────────────────────────────────────────────
  console.log('\nTest 8: TM-only (PG rejected)');
  {
    const mock = makeMockBase44({
      data: { events: [{ tm_id: 'tm_1', title: 'TM Concert', venue: 'Arena', city: 'Phoenix' }] },
    });
    bustTMCache();
    const [localResult, tmResult] = await Promise.allSettled([
      Promise.reject(new Error('PG fetch failed')),
      fetchTMEvents(mock, { size: 10 }),
    ]);
    const merged = mergeEventSources({ localResult, tmResult, filters: baseFilters });
    assert(merged.events.length === 1, '1 TM event shown');
    assert(merged.events[0].source === 'ticketmaster', 'event is TM');
    assert(merged.pgError === true, 'pgError is true');
  }

  // ── 9. Both succeed → both merged ────────────────────────────────────────
  console.log('\nTest 9: Both sources succeed');
  {
    const mock = makeMockBase44({
      data: { events: [{ tm_id: 'tm_1', title: 'TM Concert', venue: 'Arena', city: 'Phoenix' }] },
    });
    const pgData = [{ id: 'pg1', title: 'PG Event', status: 'upcoming', date: null, is_beta_live: false }];
    bustTMCache();
    const [localResult, tmResult] = await Promise.allSettled([
      Promise.resolve(pgData),
      fetchTMEvents(mock, { size: 10 }),
    ]);
    const merged = mergeEventSources({ localResult, tmResult, filters: baseFilters });
    assert(merged.events.length === 2, '2 events (1 PG + 1 TM)');
    assert(merged.events.some(e => e.source === 'pg'), 'contains PG event');
    assert(merged.events.some(e => e.source === 'ticketmaster'), 'contains TM event');
  }

  // ── 10. Keyword filter applied to both PG and TM ────────────────────────
  console.log('\nTest 10: Keyword filter on both sources');
  {
    const mock = makeMockBase44({
      data: { events: [
        { tm_id: 'tm_1', title: 'Beyoncé Concert', venue: 'Arena', city: 'Phoenix' },
        { tm_id: 'tm_2', title: 'Other Event', venue: 'Hall', city: 'Tucson' },
      ] },
    });
    const pgData = [
      { id: 'pg1', title: 'Beyoncé Live', status: 'upcoming', date: null, is_beta_live: false, city: 'Phoenix' },
      { id: 'pg2', title: 'Unrelated', status: 'upcoming', date: null, is_beta_live: false, city: 'Tucson' },
    ];
    bustTMCache();
    const [localResult, tmResult] = await Promise.allSettled([
      Promise.resolve(pgData),
      fetchTMEvents(mock, { size: 10 }),
    ]);
    const merged = mergeEventSources({
      localResult, tmResult,
      filters: { ...baseFilters, keyword: 'Beyonce' },
    });
    assert(merged.events.length === 2, '2 events match Beyonce (diacritic-insensitive)');
    assert(merged.events.every(e => e.title.toLowerCase().includes('beyonc') || e.title.includes('Beyoncé')), 'all events match Beyonce/Beyoncé');
  }

  // ── 11. Actual fetchTMEvents return shape ───────────────────────────────
  console.log('\nTest 11: fetchTMEvents return shape');
  {
    const mock = makeMockBase44({
      data: { events: [{ tm_id: 'tm_1', title: 'Test', venue: 'V', city: 'C' }] },
    });
    bustTMCache();
    const result = await fetchTMEvents(mock, { size: 5 });
    assert(result !== null && typeof result === 'object', 'result is an object');
    assert(Array.isArray(result.events), 'result.events is an array');
    assert(typeof result.fromCache === 'boolean', 'result.fromCache is boolean');
    assert(result.events.length === 1, '1 event in result');
  }

  // ── Summary ─────────────────────────────────────────────────────────────
  console.log('');
  console.log(`  Total: ${passed} passed, ${failed} failed`);
  if (failed === 0) {
    console.log('╔══════════════════════════════════════════════════════════════════╗');
    console.log('║  VERDICT: PASS — M0.2 integration seams verified.               ║');
    console.log('╚══════════════════════════════════════════════════════════════════╝');
    process.exit(0);
  } else {
    console.log('╔══════════════════════════════════════════════════════════════════╗');
    console.log('║  VERDICT: FAIL — Integration seams not satisfied.               ║');
    console.log('╚══════════════════════════════════════════════════════════════════╝');
    process.exit(1);
  }
}

main().catch(e => {
  console.error('Test runner crashed:', e);
  process.exit(1);
});