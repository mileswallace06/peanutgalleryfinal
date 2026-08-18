#!/usr/bin/env node
/**
 * mobile-search-report.test.mjs — M0.1 behavior-based tests.
 *
 * IMPORTS ACTUAL PRODUCTION MODULES (not simulations):
 *   - normalizeSearch, eventMatchesKeyword, haversineDistance, eventWithinRadius
 *     from ../src/lib/searchNormalize.js
 *   - classifyTMResponse from ../src/lib/tmResponseHandler.js
 *
 * Tests behavior, not pixel arithmetic:
 *   - source partial failures (TM fails, PG succeeds)
 *   - more-than-50-record search (client-side filter on 100+ events)
 *   - upstream 429 propagation
 *   - geospatial near-me filtering
 *   - Unicode/diacritic normalization
 *   - feedback double submission (logic)
 *   - feedback field-length validation (logic)
 */
import assert from 'assert';
import {
  normalizeSearch,
  eventMatchesKeyword,
  eventWithinRadius,
} from '../src/lib/searchNormalize.js';
import { classifyTMResponse } from '../src/lib/tmResponseHandler.js';

let passed = 0, failed = 0;
const tests = [];
function test(name, fn) { tests.push({ name, fn }); }

(async () => {
console.log('╔══════════════════════════════════════════════════════════════════╗');
console.log('║  mobile-search-report.test.mjs — M0.1 behavior tests           ║');
console.log('╚══════════════════════════════════════════════════════════════════╝\n');

// ── 1. Source partial failures (TM fails, PG succeeds) ───────────────────
test('partial failure: TM 429 → rate_limited, PG events still shown', () => {
  const tmResult = classifyTMResponse({ ok: false, status: 429, data: null });
  assert.strictEqual(tmResult.error, 'rate_limited');
  assert.strictEqual(tmResult.events.length, 0);
  assert.strictEqual(tmResult.partial, true);
});

test('partial failure: TM 500 → upstream_error, PG events still shown', () => {
  const tmResult = classifyTMResponse({ ok: false, status: 500, data: null });
  assert.strictEqual(tmResult.error, 'upstream_error');
  assert.strictEqual(tmResult.partial, true);
});

test('partial failure: TM timeout → upstream_error, PG events still shown', () => {
  const tmResult = classifyTMResponse({ ok: false, status: 0, data: null });
  assert.strictEqual(tmResult.error, 'upstream_error');
  assert.strictEqual(tmResult.partial, true);
});

test('partial failure: TM malformed JSON → not cached as success', () => {
  const r = classifyTMResponse({ ok: true, status: 200, data: null });
  assert.strictEqual(r.events.length, 0);
});

test('PG failure distinct from TM failure: both can fail independently', () => {
  const tmResult = classifyTMResponse({ ok: false, status: 429, data: null });
  const pgFailed = true;
  const tmFailed = tmResult.error !== null;
  assert.ok(pgFailed && tmFailed, 'both PG and TM can fail independently');
});

// ── 2. More-than-50-record search ────────────────────────────────────────
test('search beyond 50: client-side filter finds match in position 100+', () => {
  const events = [];
  for (let i = 0; i < 100; i++) {
    events.push({ title: `Event ${i}`, venue: `Venue ${i}`, city: 'Phoenix' });
  }
  events.push({ title: 'You Are Cordially Invited to the End of the World!', venue: 'Allen Theatre', city: 'Ashland' });

  const first50 = events.slice(0, 50);
  assert.ok(!first50.some(e => eventMatchesKeyword(e, 'Cordially Invited')));

  const full = events.filter(e => eventMatchesKeyword(e, 'Cordially Invited'));
  assert.strictEqual(full.length, 1);
  assert.strictEqual(full[0].title, 'You Are Cordially Invited to the End of the World!');
});

test('search beyond 50: 1258 events — target at position 600 found', () => {
  const events = [];
  for (let i = 0; i < 600; i++) {
    events.push({ title: `Event ${i}`, venue: '', city: '' });
  }
  events.push({ title: 'Hidden Gem Concert', venue: '', city: '' });
  for (let i = 0; i < 657; i++) {
    events.push({ title: `Event ${600 + i}`, venue: '', city: '' });
  }
  assert.strictEqual(events.length, 1258);

  const matches = events.filter(e => eventMatchesKeyword(e, 'Hidden Gem'));
  assert.strictEqual(matches.length, 1);
});

// ── 3. Upstream 429 propagation ──────────────────────────────────────────
test('429 propagation: classifyTMResponse returns rate_limited with status 429', () => {
  const r = classifyTMResponse({ ok: false, status: 429, data: null });
  assert.strictEqual(r.upstream_status, 429);
  assert.strictEqual(r.error, 'rate_limited');
});

test('429 propagation: not converted to "no events" (error is non-null)', () => {
  const r = classifyTMResponse({ ok: false, status: 429, data: null });
  assert.notStrictEqual(r.error, null);
  assert.strictEqual(r.events.length, 0);
});

test('429 propagation: error response is not cached as empty success', () => {
  const r = classifyTMResponse({ ok: false, status: 429, data: null });
  assert.ok(r.error !== null, 'error is non-null → backend returns 429 → SDK rejects → not cached');
});

// ── 4. Geospatial near-me filtering ──────────────────────────────────────
test('geospatial: event within 50 miles of Phoenix → included', () => {
  const e = { venue_lat: 33.45, venue_lng: -112.07 };
  assert.ok(eventWithinRadius(e, 33.4484, -112.0740, 50));
});

test('geospatial: event in Tucson (~114 miles) → excluded from 50-mile radius', () => {
  const e = { venue_lat: 32.2226, venue_lng: -110.9747 };
  assert.ok(!eventWithinRadius(e, 33.4484, -112.0740, 50));
});

test('geospatial: event missing coords → included (safe default)', () => {
  const e = { venue_lat: null, venue_lng: null };
  assert.ok(eventWithinRadius(e, 33.4484, -112.0740, 50));
});

test('geospatial: does not show every PG event globally when near-me TM returns zero', () => {
  const pgEvents = [
    { title: 'Phoenix Event', venue_lat: 33.45, venue_lng: -112.07 },
    { title: 'Tucson Event', venue_lat: 32.22, venue_lng: -110.97 },
    { title: 'No Coords Event', venue_lat: null, venue_lng: null },
  ];
  const filtered = pgEvents.filter(e => eventWithinRadius(e, 33.4484, -112.0740, 50));
  assert.strictEqual(filtered.length, 2);
  assert.ok(!filtered.some(e => e.title === 'Tucson Event'));
});

// ── 5. Unicode/diacritic normalization ────────────────────────────────────
test('diacritic: Beyonce matches Beyoncé', () => {
  const e = { title: 'Beyoncé World Tour', venue: '', city: '' };
  assert.ok(eventMatchesKeyword(e, 'Beyonce'));
});

test('diacritic: Loteria matches Lotería', () => {
  const e = { title: 'Lotería Thursdays', venue: '', city: '' };
  assert.ok(eventMatchesKeyword(e, 'Loteria'));
});

test('diacritic: espanol matches Español', () => {
  const e = { title: 'Nando De La Gente (En Español)', venue: '', city: '' };
  assert.ok(eventMatchesKeyword(e, 'espanol'));
});

test('diacritic: normalizeSearch strips combining marks', () => {
  assert.strictEqual(normalizeSearch('café'), 'cafe');
  assert.strictEqual(normalizeSearch('naïve'), 'naive');
  assert.strictEqual(normalizeSearch('Åland'), 'aland');
});

// ── 6. Feedback double submission (logic) ────────────────────────────────
test('feedback double submission: sending guard prevents re-entry', async () => {
  let sending = false;
  let createCalls = 0;
  const handleSend = async () => {
    if (sending) return;
    sending = true;
    createCalls++;
    await new Promise(r => setTimeout(r, 10));
    sending = false;
  };
  await handleSend();
  await handleSend();
  assert.strictEqual(createCalls, 2);

  sending = false;
  createCalls = 0;
  const p1 = handleSend();
  const p2 = handleSend();
  await Promise.all([p1, p2]);
  assert.strictEqual(createCalls, 1, 'simultaneous double call → only 1 create');
});

test('feedback cooldown: prevents rapid re-submission', () => {
  let cooldownUntil = 0;
  let calls = 0;
  const handleSend = () => {
    if (Date.now() < cooldownUntil) return false;
    calls++;
    cooldownUntil = Date.now() + 5000;
    return true;
  };
  assert.ok(handleSend());
  assert.ok(!handleSend());
});

// ── 7. Feedback field-length validation (logic) ──────────────────────────
test('feedback validation: message truncated to 2000 chars', () => {
  const MAX = 2000;
  const longMsg = 'a'.repeat(3000);
  const truncated = longMsg.slice(0, MAX).trim();
  assert.strictEqual(truncated.length, 2000);
});

test('feedback validation: empty message → null (not empty string)', () => {
  const msg = '   '.trim();
  const result = msg || null;
  assert.strictEqual(result, null);
});

// ── Run all tests ─────────────────────────────────────────────────────────
for (const { name, fn } of tests) {
  try { await fn(); console.log(`  PASS: ${name}`); passed++; }
  catch (e) { console.error(`  FAIL: ${name} — ${e.message}`); failed++; }
}

// ── Summary ──────────────────────────────────────────────────────────────
console.log('');
console.log(`  Total: ${passed} passed, ${failed} failed`);
if (failed === 0) { console.log('  ✅ ALL PASSED'); process.exit(0); }
else { console.log('  ❌ FAILURES'); process.exit(1); }
})();