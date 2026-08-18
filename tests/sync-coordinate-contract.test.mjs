#!/usr/bin/env node
/**
 * sync-coordinate-contract.test.mjs — M0.3 TM coordinate contract tests.
 *
 * Tests the coordinate coercion logic (coerceCoordinate) and proves that
 * syncTMEvent re-validates coordinates before writing — WITHOUT making any
 * provider (Ticketmaster) API call. Uses the shared tmResponseHandler module
 * directly.
 *
 * Also verifies that normalizeTMEvent produces finite numeric coordinates
 * within valid ranges, and that invalid/missing/non-finite values become null.
 */
import assert from 'assert';
import {
  coerceCoordinate,
  normalizeTMEvent,
  classifyTMResponse,
} from '../base44/shared/tmResponseHandler.js';

let passed = 0, failed = 0;
const tests = [];
function test(name, fn) { tests.push({ name, fn }); }

console.log('╔══════════════════════════════════════════════════════════════════╗');
console.log('║  sync-coordinate-contract.test.mjs — M0.3 coordinate contract   ║');
console.log('╚══════════════════════════════════════════════════════════════════╝\n');

// ── 1. coerceCoordinate: valid values ──────────────────────────────────────
test('coerceCoordinate: valid lat (33.45) → 33.45', () => {
  assert.strictEqual(coerceCoordinate(33.45, -90, 90), 33.45);
});

test('coerceCoordinate: valid lng (-112.07) → -112.07', () => {
  assert.strictEqual(coerceCoordinate(-112.07, -180, 180), -112.07);
});

test('coerceCoordinate: string number "33.45" → 33.45', () => {
  assert.strictEqual(coerceCoordinate('33.45', -90, 90), 33.45);
});

test('coerceCoordinate: boundary lat 90 → 90', () => {
  assert.strictEqual(coerceCoordinate(90, -90, 90), 90);
});

test('coerceCoordinate: boundary lat -90 → -90', () => {
  assert.strictEqual(coerceCoordinate(-90, -90, 90), -90);
});

test('coerceCoordinate: boundary lng 180 → 180', () => {
  assert.strictEqual(coerceCoordinate(180, -180, 180), 180);
});

test('coerceCoordinate: boundary lng -180 → -180', () => {
  assert.strictEqual(coerceCoordinate(-180, -180, 180), -180);
});

// ── 2. coerceCoordinate: invalid values → null ─────────────────────────────
test('coerceCoordinate: null → null', () => {
  assert.strictEqual(coerceCoordinate(null, -90, 90), null);
});

test('coerceCoordinate: undefined → null', () => {
  assert.strictEqual(coerceCoordinate(undefined, -90, 90), null);
});

test('coerceCoordinate: empty string → null', () => {
  assert.strictEqual(coerceCoordinate('', -90, 90), null);
});

test('coerceCoordinate: NaN → null', () => {
  assert.strictEqual(coerceCoordinate(NaN, -90, 90), null);
});

test('coerceCoordinate: Infinity → null', () => {
  assert.strictEqual(coerceCoordinate(Infinity, -90, 90), null);
});

test('coerceCoordinate: -Infinity → null', () => {
  assert.strictEqual(coerceCoordinate(-Infinity, -90, 90), null);
});

test('coerceCoordinate: non-numeric string "abc" → null', () => {
  assert.strictEqual(coerceCoordinate('abc', -90, 90), null);
});

test('coerceCoordinate: lat > 90 (91) → null', () => {
  assert.strictEqual(coerceCoordinate(91, -90, 90), null);
});

test('coerceCoordinate: lat < -90 (-91) → null', () => {
  assert.strictEqual(coerceCoordinate(-91, -90, 90), null);
});

test('coerceCoordinate: lng > 180 (181) → null', () => {
  assert.strictEqual(coerceCoordinate(181, -180, 180), null);
});

test('coerceCoordinate: lng < -180 (-181) → null', () => {
  assert.strictEqual(coerceCoordinate(-181, -180, 180), null);
});

// ── 3. normalizeTMEvent: coordinates coerced to finite numbers ─────────────
test('normalizeTMEvent: valid coords → finite numbers', () => {
  const raw = {
    id: 'tm_123',
    name: 'Test Event',
    _embedded: {
      venues: [{
        id: 'KvnZdZJAdx1',
        name: 'Test Venue',
        city: { name: 'Phoenix' },
        state: { stateCode: 'AZ' },
        location: { latitude: 33.4484, longitude: -112.0740 },
      }],
    },
    dates: { start: { dateTime: '2026-09-01T19:00:00Z' } },
  };
  const n = normalizeTMEvent(raw);
  assert.strictEqual(n.venue_lat, 33.4484);
  assert.strictEqual(n.venue_lng, -112.0740);
  assert.ok(Number.isFinite(n.venue_lat));
  assert.ok(Number.isFinite(n.venue_lng));
  assert.strictEqual(n.tm_venue_id, 'KvnZdZJAdx1');
});

test('normalizeTMEvent: missing coords → null (not undefined)', () => {
  const raw = {
    id: 'tm_456',
    name: 'No Coords Event',
    _embedded: { venues: [{ id: 'v1', name: 'V', city: { name: 'C' } }] },
    dates: { start: { dateTime: '2026-09-01T19:00:00Z' } },
  };
  const n = normalizeTMEvent(raw);
  assert.strictEqual(n.venue_lat, null);
  assert.strictEqual(n.venue_lng, null);
});

test('normalizeTMEvent: string coords → finite numbers', () => {
  const raw = {
    id: 'tm_789',
    name: 'String Coords',
    _embedded: {
      venues: [{
        id: 'v2',
        name: 'V2',
        city: { name: 'Tucson' },
        location: { latitude: '32.2226', longitude: '-110.9747' },
      }],
    },
    dates: { start: { dateTime: '2026-09-01T19:00:00Z' } },
  };
  const n = normalizeTMEvent(raw);
  assert.strictEqual(n.venue_lat, 32.2226);
  assert.strictEqual(n.venue_lng, -110.9747);
});

test('normalizeTMEvent: out-of-range coords → null', () => {
  const raw = {
    id: 'tm_bad',
    name: 'Bad Coords',
    _embedded: {
      venues: [{
        id: 'v3',
        name: 'V3',
        city: { name: 'Nowhere' },
        location: { latitude: 999, longitude: -999 },
      }],
    },
    dates: { start: { dateTime: '2026-09-01T19:00:00Z' } },
  };
  const n = normalizeTMEvent(raw);
  assert.strictEqual(n.venue_lat, null);
  assert.strictEqual(n.venue_lng, null);
});

test('normalizeTMEvent: non-finite coords (Infinity) → null', () => {
  const raw = {
    id: 'tm_inf',
    name: 'Inf Coords',
    _embedded: {
      venues: [{
        id: 'v4',
        name: 'V4',
        city: { name: 'Infinite' },
        location: { latitude: Infinity, longitude: -Infinity },
      }],
    },
    dates: { start: { dateTime: '2026-09-01T19:00:00Z' } },
  };
  const n = normalizeTMEvent(raw);
  assert.strictEqual(n.venue_lat, null);
  assert.strictEqual(n.venue_lng, null);
});

// ── 4. tm_venue_id preserved ───────────────────────────────────────────────
test('normalizeTMEvent: tm_venue_id preserved from venue.id', () => {
  const raw = {
    id: 'tm_vid',
    name: 'Venue ID Test',
    _embedded: {
      venues: [{
        id: 'KovZpZAdx1e',
        name: 'Madison Square Garden',
        city: { name: 'New York' },
        state: { stateCode: 'NY' },
        location: { latitude: 40.7505, longitude: -73.9934 },
      }],
    },
    dates: { start: { dateTime: '2026-09-01T19:00:00Z' } },
  };
  const n = normalizeTMEvent(raw);
  assert.strictEqual(n.tm_venue_id, 'KovZpZAdx1e');
});

test('normalizeTMEvent: missing venue → empty tm_venue_id, null coords', () => {
  const raw = {
    id: 'tm_novenue',
    name: 'No Venue',
    dates: { start: { dateTime: '2026-09-01T19:00:00Z' } },
  };
  const n = normalizeTMEvent(raw);
  assert.strictEqual(n.tm_venue_id, '');
  assert.strictEqual(n.venue_lat, null);
  assert.strictEqual(n.venue_lng, null);
});

// ── 5. syncTMEvent source: re-validates coordinates ─────────────────────────
test('syncTMEvent source: imports coerceCoordinate', async () => {
  const { readFileSync } = await import('fs');
  const src = readFileSync(
    new URL('../base44/functions/syncTMEvent/entry.ts', import.meta.url), 'utf8'
  );
  assert.ok(src.includes("import { coerceCoordinate }"),
    'syncTMEvent must import coerceCoordinate');
});

test('syncTMEvent source: re-validates venue_lat and venue_lng', async () => {
  const { readFileSync } = await import('fs');
  const src = readFileSync(
    new URL('../base44/functions/syncTMEvent/entry.ts', import.meta.url), 'utf8'
  );
  assert.ok(src.includes('coerceCoordinate(body.venue_lat, -90, 90)'),
    'must re-validate venue_lat with coerceCoordinate');
  assert.ok(src.includes('coerceCoordinate(body.venue_lng, -180, 180)'),
    'must re-validate venue_lng with coerceCoordinate');
});

// ── 6. Events.jsx passes tm_venue_id to syncTMEvent ─────────────────────────
test('Events.jsx: passes tm_venue_id to syncTMEvent', async () => {
  const { readFileSync } = await import('fs');
  const src = readFileSync(
    new URL('../src/pages/Events.jsx', import.meta.url), 'utf8'
  );
  assert.ok(src.includes('tm_venue_id: e.tm_venue_id'),
    'Events.jsx must pass tm_venue_id to syncTMEvent');
});

// ── 7. No-provider-call proof: coordinates and tm_venue_id persist correctly ─
// This test does NOT call the Ticketmaster API. It uses normalizeTMEvent
// (the same function the backend uses) to prove the contract, then simulates
// the syncTMEvent coordinate validation layer.
test('no-provider-call: normalized coords pass syncTMEvent re-validation', () => {
  const raw = {
    id: 'tm_synthetic_test',
    name: 'Synthetic Test Event',
    _embedded: {
      venues: [{
        id: 'synthetic_venue_123',
        name: 'Synthetic Arena',
        city: { name: 'Test City' },
        state: { stateCode: 'TX' },
        location: { latitude: 29.7604, longitude: -95.3698 },
      }],
    },
    dates: { start: { dateTime: '2026-12-01T20:00:00Z' } },
  };
  // Layer 1: normalizeTMEvent (in getTicketmasterEvents)
  const n = normalizeTMEvent(raw);
  // Layer 2: syncTMEvent re-validation (same coerceCoordinate call)
  const validated_lat = coerceCoordinate(n.venue_lat, -90, 90);
  const validated_lng = coerceCoordinate(n.venue_lng, -180, 180);
  assert.strictEqual(validated_lat, 29.7604);
  assert.strictEqual(validated_lng, -95.3698);
  assert.ok(Number.isFinite(validated_lat));
  assert.ok(Number.isFinite(validated_lng));
  assert.strictEqual(n.tm_venue_id, 'synthetic_venue_123');
});

test('no-provider-call: invalid coords nullified through both layers', () => {
  const raw = {
    id: 'tm_synthetic_bad',
    name: 'Bad Synthetic',
    _embedded: {
      venues: [{
        id: 'bad_venue',
        name: 'Bad Arena',
        city: { name: 'Bad City' },
        location: { latitude: 200, longitude: -200 },
      }],
    },
    dates: { start: { dateTime: '2026-12-01T20:00:00Z' } },
  };
  const n = normalizeTMEvent(raw);
  const validated_lat = coerceCoordinate(n.venue_lat, -90, 90);
  const validated_lng = coerceCoordinate(n.venue_lng, -180, 180);
  assert.strictEqual(validated_lat, null);
  assert.strictEqual(validated_lng, null);
});

// ── Run all tests ─────────────────────────────────────────────────────────
for (const { name, fn } of tests) {
  try { await fn(); console.log(`  PASS: ${name}`); passed++; }
  catch (e) { console.error(`  FAIL: ${name} — ${e.message}`); failed++; }
}

console.log('');
console.log(`  Total: ${passed} passed, ${failed} failed`);
if (failed === 0) { console.log('  ✅ ALL PASSED'); process.exit(0); }
else { console.log('  ❌ FAILURES'); process.exit(1); }