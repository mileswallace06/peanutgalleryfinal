import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = path => readFileSync(new URL(path, import.meta.url), 'utf8');

test('explicit Near Me actions request current GPS instead of reusing a saved market', () => {
  const events = source('../src/pages/Events.jsx');
  const selling = source('../src/hooks/useSellingDiscovery.js');

  assert.match(events, /const handleNearMe = \(\) => \{[\s\S]*requestCurrentLocation\(''\);[\s\S]*\};/);
  assert.doesNotMatch(events, /const handleNearMe = \(\) => \{[\s\S]*runSearch\(''\);[\s\S]*\};/);
  assert.match(selling, /nearMe: \(\) => locate\(''\)/);
  assert.doesNotMatch(selling, /nearMe: \(\) => \{ run\(''\); if \(!areaRef\.current\) locate\(''\); \}/);
});

test('Fan Zone location denial fails closed and offers a retry', () => {
  const fanZone = source('../src/pages/FanZone.jsx');

  assert.match(fanZone, /else if \(feedTab === 'nearby'\) \{[\s\S]*if \(!userLocation\) \{[\s\S]*base = \[\];/);
  assert.doesNotMatch(fanZone, /if \(!userLocation\) \{\s*base = posts\.filter/);
  assert.match(fanZone, /maximumAge: 0/);
  assert.match(fanZone, /onClick=\{retryNearbyLocation\}>Try again<\/button>/);
});
