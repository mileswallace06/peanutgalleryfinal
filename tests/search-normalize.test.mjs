#!/usr/bin/env node
/**
 * search-normalize.test.mjs — Regression tests for the search normalization fix.
 *
 * Tests normalizeSearch and eventMatchesKeyword for:
 *   - case-insensitive matching
 *   - punctuation-insensitive matching
 *   - whitespace-normalized matching
 *   - partial matching
 *   - exact matching
 *   - no-result queries
 *   - empty/null field handling
 */
import { normalizeSearch, eventMatchesKeyword } from '../src/lib/searchNormalize.js';

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { console.log(`  PASS: ${msg}`); passed++; }
  else { console.error(`  FAIL: ${msg}`); failed++; }
}

console.log('╔════════════════════════════════════════════════════════════╗');
console.log('║  Search Normalization Regression Tests                      ║');
console.log('╚════════════════════════════════════════════════════════════╝\n');

// ── normalizeSearch ──────────────────────────────────────────────────────
console.log('── normalizeSearch ──');
assert(normalizeSearch('Hello World') === 'hello world', 'basic lowercase');
assert(normalizeSearch('RAYE - THIS TOUR') === 'raye this tour', 'punctuation stripped');
assert(normalizeSearch('  multiple   spaces  ') === 'multiple spaces', 'whitespace normalized');
assert(normalizeSearch('Arizona Diamondbacks vs. Pittsburgh Pirates') === 'arizona diamondbacks vs pittsburgh pirates', 'punctuation + case');
assert(normalizeSearch('') === '', 'empty string');
assert(normalizeSearch(null) === '', 'null');
assert(normalizeSearch(undefined) === '', 'undefined');
assert(normalizeSearch('Hail-the-Sun') === 'hail the sun', 'hyphens to spaces');
assert(normalizeSearch('DIVA BLEACH x LAKE DRIVE') === 'diva bleach x lake drive', 'x separator preserved');

// ── eventMatchesKeyword ─────────────────────────────────────────────────
console.log('\n── eventMatchesKeyword ──');

const events = [
  { title: 'Hail the Sun', venue: 'Ace of Spades', city: 'Sacramento', artist: null },
  { title: 'Arizona Diamondbacks vs. Pittsburgh Pirates', venue: 'Chase Field', city: 'Phoenix', artist: null },
  { title: 'RAYE - THIS TOUR MAY CONTAIN NEW MUSIC', venue: 'The Cosmopolitan of Las Vegas', city: 'Las Vegas', artist: null },
  { title: 'Phoenix Mercury vs. Minnesota Lynx', venue: 'Mortgage Matchup Center', city: 'Phoenix', artist: null },
  { title: 'Season Closing Singalong', venue: 'ASU Kerr', city: 'Scottsdale', artist: null },
];

// Exact match (case-insensitive)
assert(eventMatchesKeyword(events[0], 'Hail the Sun') === true, 'exact title match');
assert(eventMatchesKeyword(events[0], 'hail the sun') === true, 'case-insensitive exact');

// Partial match
assert(eventMatchesKeyword(events[0], 'hail') === true, 'partial title match');
assert(eventMatchesKeyword(events[1], 'diamondbacks') === true, 'partial team name match');
assert(eventMatchesKeyword(events[2], 'RAYE') === true, 'partial artist-in-title match');
assert(eventMatchesKeyword(events[3], 'Phoenix Mercury') === true, 'partial team match');

// Punctuation-insensitive
assert(eventMatchesKeyword(events[1], 'Arizona Diamondbacks vs Pittsburgh Pirates') === true, 'punctuation-insensitive (no dots)');
assert(eventMatchesKeyword(events[2], 'RAYE THIS TOUR') === true, 'punctuation-insensitive (no dashes)');

// Whitespace-normalized
assert(eventMatchesKeyword(events[0], '  hail   the  sun  ') === true, 'whitespace-normalized');
assert(eventMatchesKeyword(events[4], 'Season  Closing  Singalong') === true, 'extra spaces normalized');

// Venue match
assert(eventMatchesKeyword(events[1], 'Chase Field') === true, 'venue match');
assert(eventMatchesKeyword(events[0], 'Ace of Spades') === true, 'venue match 2');

// City match
assert(eventMatchesKeyword(events[0], 'Sacramento') === true, 'city match');
assert(eventMatchesKeyword(events[1], 'Phoenix') === true, 'city match 2');

// No-result query
assert(eventMatchesKeyword(events[0], 'Taylor Swift') === false, 'no-result: Taylor Swift not in events');
assert(eventMatchesKeyword(events[1], 'Lakers') === false, 'no-result: Lakers not in events');
assert(eventMatchesKeyword(events[2], 'Beatles') === false, 'no-result: Beatles not in events');

// Empty keyword matches all
assert(eventMatchesKeyword(events[0], '') === true, 'empty keyword matches all');
assert(eventMatchesKeyword(events[0], '   ') === true, 'whitespace-only keyword matches all');

// Null fields
assert(eventMatchesKeyword({ title: 'Test', venue: null, city: null, artist: null }, 'Test') === true, 'null fields handled');
assert(eventMatchesKeyword({ title: null, venue: null, city: null, artist: null }, 'Test') === false, 'all null fields → no match');

// ── Filter simulation (mimics Events.jsx fetchEvents logic) ─────────────
console.log('\n── Filter simulation ──');
const keyword = 'diamondbacks';
const filtered = events.filter(e => eventMatchesKeyword(e, keyword));
assert(filtered.length === 1, `keyword "diamondbacks" → 1 result`);
assert(filtered[0].title.includes('Diamondbacks'), 'filtered result is the D-backs game');

const keyword2 = 'phoenix';
const filtered2 = events.filter(e => eventMatchesKeyword(e, keyword2));
assert(filtered2.length === 2, `keyword "phoenix" → 2 results (city + team)`);

const keyword3 = 'nonexistent artist 12345';
const filtered3 = events.filter(e => eventMatchesKeyword(e, keyword3));
assert(filtered3.length === 0, `no-result keyword → 0 results`);

// ── Summary ─────────────────────────────────────────────────────────────
console.log(`\n  Total: ${passed} passed, ${failed} failed`);
if (failed === 0) {
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║  VERDICT: PASS — Search normalization verified.            ║');
  console.log('╚════════════════════════════════════════════════════════════╝');
  process.exit(0);
} else {
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║  VERDICT: FAIL — Search normalization regression.          ║');
  console.log('╚════════════════════════════════════════════════════════════╝');
  process.exit(1);
}