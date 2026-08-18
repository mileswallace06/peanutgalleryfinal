#!/usr/bin/env node
/**
 * search-normalize.test.mjs — Tests for src/lib/searchNormalize.js
 *
 * Tests the ACTUAL production module (not a simulation):
 *   - normalizeSearch: case, punctuation, whitespace, diacritic normalization
 *   - eventMatchesKeyword: multi-field matching
 *   - haversineDistance: great-circle distance
 *   - eventWithinRadius: geospatial filter with safe default for missing coords
 */
import assert from 'assert';
import { normalizeSearch, eventMatchesKeyword, haversineDistance, eventWithinRadius } from '../src/lib/searchNormalize.js';

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  PASS: ${name}`); passed++; }
  catch (e) { console.error(`  FAIL: ${name} — ${e.message}`); failed++; }
}

console.log('╔══════════════════════════════════════════════════════════════════╗');
console.log('║  search-normalize.test.mjs — Production module tests             ║');
console.log('╚══════════════════════════════════════════════════════════════════╝\n');

// ── normalizeSearch ──────────────────────────────────────────────────────
test('normalizeSearch: lowercase', () => {
  assert.strictEqual(normalizeSearch('HELLO'), 'hello');
});

test('normalizeSearch: strip punctuation', () => {
  assert.strictEqual(normalizeSearch('hello, world!'), 'hello world');
});

test('normalizeSearch: collapse whitespace', () => {
  assert.strictEqual(normalizeSearch('  hello   world  '), 'hello world');
});

test('normalizeSearch: null → empty string', () => {
  assert.strictEqual(normalizeSearch(null), '');
  assert.strictEqual(normalizeSearch(undefined), '');
});

test('normalizeSearch: diacritic — Beyoncé → beyonce', () => {
  assert.strictEqual(normalizeSearch('Beyoncé'), 'beyonce');
});

test('normalizeSearch: diacritic — Lotería → loteria', () => {
  assert.strictEqual(normalizeSearch('Lotería'), 'loteria');
});

test('normalizeSearch: diacritic — Español → espanol', () => {
  assert.strictEqual(normalizeSearch('Español'), 'espanol');
});

test('normalizeSearch: diacritic — café → cafe', () => {
  assert.strictEqual(normalizeSearch('café'), 'cafe');
});

test('normalizeSearch: diacritic — multiple marks (Beyoncé!) → beyonce', () => {
  assert.strictEqual(normalizeSearch('Beyoncé!'), 'beyonce');
});

test('normalizeSearch: empty string', () => {
  assert.strictEqual(normalizeSearch(''), '');
});

// ── eventMatchesKeyword ─────────────────────────────────────────────────
test('eventMatchesKeyword: exact title match', () => {
  const e = { title: 'Arizona Diamondbacks vs. Pittsburgh Pirates', venue: 'Chase Field', city: 'Phoenix' };
  assert.ok(eventMatchesKeyword(e, 'Diamondbacks'));
});

test('eventMatchesKeyword: case-insensitive', () => {
  const e = { title: 'Arizona Diamondbacks', venue: '', city: '' };
  assert.ok(eventMatchesKeyword(e, 'arizona diamondbacks'));
});

test('eventMatchesKeyword: punctuation-insensitive', () => {
  const e = { title: 'Arizona Diamondbacks vs. Pittsburgh Pirates', venue: '', city: '' };
  assert.ok(eventMatchesKeyword(e, 'Arizona Diamondbacks vs Pittsburgh Pirates'));
});

test('eventMatchesKeyword: whitespace-normalized', () => {
  const e = { title: 'RAYE THIS TOUR', venue: '', city: '' };
  assert.ok(eventMatchesKeyword(e, '  RAYE   THIS   TOUR  '));
});

test('eventMatchesKeyword: diacritic-insensitive — Beyonce matches Beyoncé', () => {
  const e = { title: 'Beyoncé World Tour', venue: '', city: '' };
  assert.ok(eventMatchesKeyword(e, 'Beyonce'));
});

test('eventMatchesKeyword: diacritic-insensitive — Loteria matches Lotería', () => {
  const e = { title: 'Lotería Thursdays', venue: '', city: '' };
  assert.ok(eventMatchesKeyword(e, 'Loteria'));
});

test('eventMatchesKeyword: venue match', () => {
  const e = { title: 'Some Event', venue: 'Chase Field', city: 'Phoenix' };
  assert.ok(eventMatchesKeyword(e, 'Chase'));
});

test('eventMatchesKeyword: city match', () => {
  const e = { title: 'Some Event', venue: '', city: 'Phoenix' };
  assert.ok(eventMatchesKeyword(e, 'phoenix'));
});

test('eventMatchesKeyword: no match', () => {
  const e = { title: 'Some Event', venue: 'Some Venue', city: 'Some City' };
  assert.ok(!eventMatchesKeyword(e, 'Nonexistent'));
});

test('eventMatchesKeyword: empty keyword matches all', () => {
  const e = { title: 'Some Event', venue: '', city: '' };
  assert.ok(eventMatchesKeyword(e, ''));
});

test('eventMatchesKeyword: null event fields', () => {
  const e = { title: null, venue: null, city: null, artist: null };
  assert.ok(!eventMatchesKeyword(e, 'something'));
});

// ── haversineDistance ───────────────────────────────────────────────────
test('haversineDistance: same point = 0', () => {
  assert.ok(haversineDistance(33.4484, -112.0740, 33.4484, -112.0740) < 0.01);
});

test('haversineDistance: Phoenix to Tucson ≈ 114 miles', () => {
  const d = haversineDistance(33.4484, -112.0740, 32.2226, -110.9747);
  assert.ok(d > 100 && d < 130, `expected ~114, got ${d}`);
});

test('haversineDistance: null coords = Infinity', () => {
  assert.strictEqual(haversineDistance(null, null, 33, -112), Infinity);
});

// ── eventWithinRadius ────────────────────────────────────────────────────
test('eventWithinRadius: event within radius', () => {
  const e = { venue_lat: 33.45, venue_lng: -112.07 };
  assert.ok(eventWithinRadius(e, 33.4484, -112.0740, 50));
});

test('eventWithinRadius: event outside radius', () => {
  const e = { venue_lat: 32.22, venue_lng: -110.97 }; // Tucson
  assert.ok(!eventWithinRadius(e, 33.4484, -112.0740, 50));
});

test('eventWithinRadius: missing coords → excluded (M0.2: no auto-include)', () => {
  const e = { venue_lat: null, venue_lng: null };
  assert.ok(!eventWithinRadius(e, 33.4484, -112.0740, 50));
});

test('eventWithinRadius: missing lat only → excluded', () => {
  const e = { venue_lat: null, venue_lng: -112.07 };
  assert.ok(!eventWithinRadius(e, 33.4484, -112.0740, 50));
});

// ── Summary ──────────────────────────────────────────────────────────────
console.log('');
console.log(`  Total: ${passed} passed, ${failed} failed`);
if (failed === 0) { console.log('  ✅ ALL PASSED'); process.exit(0); }
else { console.log('  ❌ FAILURES'); process.exit(1); }