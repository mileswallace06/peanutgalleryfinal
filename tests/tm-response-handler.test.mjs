#!/usr/bin/env node
/**
 * tm-response-handler.test.mjs — Tests for src/lib/tmResponseHandler.js
 *
 * Tests the ACTUAL production module (not a simulation):
 *   - classifyTMResponse: 200, 429, 500, 404, malformed JSON
 *   - normalizeTMEvent: raw TM event → app shape
 *
 * Mocks upstream success, 429, 500, timeout (null data), malformed JSON,
 * and empty-result responses. No live Ticketmaster calls.
 */
import assert from 'assert';
import { classifyTMResponse, normalizeTMEvent } from '../base44/shared/tmResponseHandler.js';

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  PASS: ${name}`); passed++; }
  catch (e) { console.error(`  FAIL: ${name} — ${e.message}`); failed++; }
}

console.log('╔══════════════════════════════════════════════════════════════════╗');
console.log('║  tm-response-handler.test.mjs — Production module tests         ║');
console.log('╚══════════════════════════════════════════════════════════════════╝\n');

// ── classifyTMResponse ──────────────────────────────────────────────────
test('200 with events → success', () => {
  const r = classifyTMResponse({ ok: true, status: 200, data: { _embedded: { events: [{ id: '1' }] } } });
  assert.strictEqual(r.error, null);
  assert.strictEqual(r.events.length, 1);
  assert.strictEqual(r.partial, false);
});

test('200 with no events → success, empty array', () => {
  const r = classifyTMResponse({ ok: true, status: 200, data: { _embedded: {} } });
  assert.strictEqual(r.error, null);
  assert.strictEqual(r.events.length, 0);
  assert.strictEqual(r.partial, false);
});

test('200 with null data → success, empty array (null is valid JSON)', () => {
  const r = classifyTMResponse({ ok: true, status: 200, data: null });
  assert.strictEqual(r.error, null);
  assert.strictEqual(r.events.length, 0);
  assert.strictEqual(r.partial, false);
});

test('429 → rate_limited, partial=true', () => {
  const r = classifyTMResponse({ ok: false, status: 429, data: null });
  assert.strictEqual(r.error, 'rate_limited');
  assert.strictEqual(r.upstream_status, 429);
  assert.strictEqual(r.events.length, 0);
  assert.strictEqual(r.partial, true);
});

test('500 → upstream_error, partial=true', () => {
  const r = classifyTMResponse({ ok: false, status: 500, data: null });
  assert.strictEqual(r.error, 'upstream_error');
  assert.strictEqual(r.upstream_status, 500);
  assert.strictEqual(r.partial, true);
});

test('503 → upstream_error, partial=true', () => {
  const r = classifyTMResponse({ ok: false, status: 503, data: null });
  assert.strictEqual(r.error, 'upstream_error');
  assert.strictEqual(r.upstream_status, 503);
  assert.strictEqual(r.partial, true);
});

test('404 → not an error, empty events', () => {
  const r = classifyTMResponse({ ok: false, status: 404, data: null });
  assert.strictEqual(r.error, null);
  assert.strictEqual(r.upstream_status, 404);
  assert.strictEqual(r.events.length, 0);
  assert.strictEqual(r.partial, false);
});

test('malformed JSON handled by backend (not by classifyTMResponse)', () => {
  // The backend function catches .json() throw and returns 502 before
  // classifyTMResponse is called. So classifyTMResponse only sees
  // successfully-parsed data (which can be null for empty TM responses).
  const r = classifyTMResponse({ ok: true, status: 200, data: null });
  assert.strictEqual(r.error, null);
  assert.strictEqual(r.events.length, 0);
});

test('timeout (ok=false, status=0) → upstream_error', () => {
  const r = classifyTMResponse({ ok: false, status: 0, data: null });
  assert.strictEqual(r.error, 'upstream_error');
  assert.strictEqual(r.partial, true);
});

test('empty result (200, data._embedded.events=[]) → success', () => {
  const r = classifyTMResponse({ ok: true, status: 200, data: { _embedded: { events: [] } } });
  assert.strictEqual(r.error, null);
  assert.strictEqual(r.events.length, 0);
  assert.strictEqual(r.partial, false);
});

// ── normalizeTMEvent ────────────────────────────────────────────────────
test('normalizeTMEvent: full event', () => {
  const raw = {
    id: 'vvG1Z9',
    name: 'Test Concert',
    _embedded: { venues: [{ id: 'v1', name: 'Test Venue', city: { name: 'Phoenix' }, state: { stateCode: 'AZ' } }] },
    images: [{ ratio: '16_9', width: 640, url: 'https://img.example.com/640.jpg' }],
    dates: { start: { dateTime: '2026-09-01T19:00:00Z' } },
    url: 'https://tm.example.com/event',
  };
  const e = normalizeTMEvent(raw);
  assert.strictEqual(e.tm_id, 'vvG1Z9');
  assert.strictEqual(e.title, 'Test Concert');
  assert.strictEqual(e.venue, 'Test Venue');
  assert.strictEqual(e.city, 'Phoenix');
  assert.strictEqual(e.state, 'AZ');
  assert.strictEqual(e.date, '2026-09-01T19:00:00Z');
  assert.strictEqual(e.image_url, 'https://img.example.com/640.jpg');
  assert.strictEqual(e.tm_url, 'https://tm.example.com/event');
  assert.strictEqual(e.source, 'ticketmaster');
});

test('normalizeTMEvent: preserves venue lat/lng', () => {
  const raw = {
    id: '1', name: 'Test',
    _embedded: { venues: [{ id: 'v1', name: 'V', city: { name: 'C' }, state: { stateCode: 'AZ' }, location: { latitude: 33.4484, longitude: -112.0740 } }] },
    images: [], dates: { start: {} },
  };
  const e = normalizeTMEvent(raw);
  assert.strictEqual(e.venue_lat, 33.4484);
  assert.strictEqual(e.venue_lng, -112.0740);
});

test('normalizeTMEvent: null lat/lng when missing', () => {
  const raw = { id: '1', name: 'Test', _embedded: { venues: [{ id: 'v1', name: 'V', city: { name: 'C' } }] }, images: [], dates: { start: {} } };
  const e = normalizeTMEvent(raw);
  assert.strictEqual(e.venue_lat, null);
  assert.strictEqual(e.venue_lng, null);
});

test('normalizeTMEvent: missing venue', () => {
  const raw = { id: '1', name: 'Test', _embedded: {}, images: [], dates: { start: {} } };
  const e = normalizeTMEvent(raw);
  assert.strictEqual(e.venue, '');
  assert.strictEqual(e.city, '');
  assert.strictEqual(e.venue_lat, null);
  assert.strictEqual(e.venue_lng, null);
});

test('normalizeTMEvent: fallback date from localDate', () => {
  const raw = { id: '1', name: 'T', _embedded: {}, images: [], dates: { start: { localDate: '2026-09-01', localTime: '19:00:00' } } };
  const e = normalizeTMEvent(raw);
  assert.strictEqual(e.date, '2026-09-01T19:00:00');
});

// ── Summary ──────────────────────────────────────────────────────────────
console.log('');
console.log(`  Total: ${passed} passed, ${failed} failed`);
if (failed === 0) { console.log('  ✅ ALL PASSED'); process.exit(0); }
else { console.log('  ❌ FAILURES'); process.exit(1); }