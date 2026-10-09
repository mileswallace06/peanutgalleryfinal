import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { transform } from 'esbuild';
import { fanCoordinates, fanDistanceKm, fanLocationMessage, nearbyFanPosts } from '../src/components/fanzone/fanNearby.js';
import { fanEventChoices, fanEventHasTicket, fanEventOccurrence } from '../src/components/fanzone/fanEventChoice.js';
import { validCoordinates } from '../src/lib/eventLocation.js';

const now = Date.parse('2030-01-02T21:00:00Z');
const event = { id: 'fixture-one', tm_id: 'provider-one', title: 'Recurring tour', venue: 'Fixture Arena', city: 'Phoenix', state: 'AZ', venue_timezone: 'America/Phoenix', event_start_utc: '2030-01-02T20:00:00Z', event_end_utc: '2030-01-02T23:00:00Z' };

test('composer aliases deduplicate without losing recurring performances or ticket priority', () => {
  const alias = { ...event, id: 'fixture-alias', tm_id: 'provider-alias', provider_aliases_verified: true, provider_aliases: ['provider-one'] };
  const later = { ...event, id: 'fixture-later', tm_id: 'provider-later', event_start_utc: '2030-02-02T20:00:00Z', event_end_utc: '2030-02-02T23:00:00Z' };
  const choices = fanEventChoices([later, event, alias], '', [event.id]);
  assert.equal(choices.length, 2);
  assert.equal(fanEventHasTicket(choices[0], [event.id]), true);
  assert.equal(fanEventChoices([later, event, alias], 'Phoenix').length, 2);
  assert.equal(fanEventChoices([later, event, alias], 'Nothing here').length, 0);
  assert.match(fanEventOccurrence(choices[0], now), /Jan 2, 2030, 1:00 PM MST.*Current/);
  assert.match(fanEventOccurrence(later, now), /Feb 2, 2030, 1:00 PM MST.*Upcoming/);
  assert.match(fanEventOccurrence(event, now + 86400000), /Past/);
});

test('composer options retain substantive variants and explicitly unconfirmed times', () => {
  const premium = { ...event, id: 'fixture-vip', tm_id: 'provider-vip', product_type: 'VIP package' };
  assert.equal(fanEventChoices([event, premium]).length, 2);
  assert.match(fanEventOccurrence(premium, now), /VIP package/);
  for (const row of [{ ...event, venue_timezone: null }, { ...event, venue_timezone: 'Invalid/Timezone' }]) {
    assert.match(fanEventOccurrence(row, now), /UTC · venue time unconfirmed/);
  }
  for (const row of [{ ...event, time_tba: true }, { ...event, date_tba: true }, { ...event, event_start_utc: '2030-01-02T20:00:00' }]) {
    assert.match(fanEventOccurrence(row, now), /Date and time to be confirmed · Timing unconfirmed/);
  }
});

test('nearby filtering needs a validated area and distinguishes same-name cities', () => {
  const rows = [{ ...event, venue_lat: 33.45, venue_lng: -112.07 }, { ...event, id: 'fixture-other-state', state: 'NY' }];
  const posts = [{ id: 'p1', event_id: event.id }, { id: 'p2', event_id: 'fixture-other-state' }, { id: 'p3', event_city: 'Phoenix' }, { id: 'p4', event_city: 'Phoenix', event_state: 'AZ' }];
  assert.deepEqual(nearbyFanPosts(posts, rows, null), []);
  assert.deepEqual(nearbyFanPosts(posts, rows, { city: 'Phoenix' }), []);
  assert.deepEqual(nearbyFanPosts(posts, rows, { city: 'Phoenix', state: 'AZ' }).map(post => post.id), ['p1', 'p4']);
  assert.deepEqual(nearbyFanPosts(posts, rows, { ll: '33.45,-112.07' }).map(post => post.id), ['p1']);
  assert.deepEqual(nearbyFanPosts(posts, rows, { ll: '91,0' }), []);
});

test('coordinate zero is valid and missing/invalid event coordinates are not nearby', () => {
  assert.deepEqual(fanCoordinates('0,0'), { lat: 0, lng: 0 });
  assert.equal(fanDistanceKm({ lat: 0, lng: 0 }, { venue_lat: 0, venue_lng: 0 }), 0);
  assert.equal(fanDistanceKm({ lat: 0, lng: 0 }, { venue_lat: null, venue_lng: null }), null);
  assert.equal(fanDistanceKm({ lat: 0, lng: 0 }, { venue_lat: 900, venue_lng: 0 }), null);
});

test('location states offer deliberate recovery and accurate selected-area copy', () => {
  assert.match(fanLocationMessage('idle'), /Choose a city or enable location/);
  assert.match(fanLocationMessage('requesting'), /Finding your location/);
  assert.match(fanLocationMessage('denied'), /browser’s site settings.*try again.*choose a city/);
  assert.match(fanLocationMessage('timeout'), /timed out.*Try again.*choose a city/);
  assert.match(fanLocationMessage('unavailable'), /unavailable.*Try again.*choose a city/);
  assert.match(fanLocationMessage('idle', { city: 'Phoenix', state: 'AZ' }), /Phoenix, AZ/);
  assert.match(fanLocationMessage('granted', { ll: '0,0' }), /within 80 km/);
});

const hookSource = await readFile(new URL('../src/hooks/useLocationDetect.js', import.meta.url), 'utf8');
const hookCode = await transform(hookSource.replace(/^import .+\n/gm, ''), { loader: 'js', format: 'cjs' });
function locationFixture({ geolocation = true, cache = null } = {}) {
  const states = [], refs = [], effects = [], calls = [], results = [], errors = [], saved = new Map(cache ? Object.entries(cache) : []);
  let stateCursor = 0, refCursor = 0;
  const module = { exports: {} };
  vm.runInNewContext(hookCode.code, {
    module, exports: module.exports, validCoordinates, Date,
    navigator: geolocation ? { geolocation: { getCurrentPosition: (success, failure, options) => calls.push({ success, failure, options }) } } : {},
    localStorage: { getItem: key => saved.get(key), setItem: (key, value) => saved.set(key, value), removeItem: key => saved.delete(key) },
    useRef: initial => refs[refCursor++] ||= { current: initial },
    useState: initial => { const index = stateCursor++; if (!(index in states)) states[index] = initial; return [states[index], value => { states[index] = typeof value === 'function' ? value(states[index]) : value; }]; },
    useCallback: fn => fn, useEffect: fn => effects.push(fn),
  });
  const render = () => { stateCursor = 0; refCursor = 0; effects.length = 0; return module.exports.useLocationDetect({ restoreCache: true, retryOnTimeout: false, onSuccess: value => results.push(value), onError: value => errors.push(value) }); };
  let hook = render(); effects.forEach(effect => effect());
  return { get hook() { hook = render(); return hook; }, calls, results, errors, saved };
}

test('location hook never prompts automatically, locks concurrent requests and validates success', () => {
  const app = locationFixture();
  assert.equal(app.calls.length, 0);
  app.hook.requestLocation(); app.hook.requestLocation();
  assert.equal(app.calls.length, 1);
  assert.equal(app.hook.locationStatus, 'requesting');
  app.calls[0].success({ coords: { latitude: 0, longitude: 0 } });
  assert.equal(app.hook.locationStatus, 'granted');
  assert.equal(app.hook.latlong, '0,0');
  assert.deepEqual(app.results, ['0,0']);
  app.hook.requestLocation();
  app.calls[1].success({ coords: { latitude: 200, longitude: 0 } });
  assert.equal(app.hook.locationStatus, 'unavailable');
  assert.deepEqual(app.results, ['0,0']);
});

test('denied, timeout and unavailable need deliberate retry, with no second automatic request', () => {
  for (const [code, status] of [[1, 'denied'], [2, 'unavailable'], [3, 'timeout']]) {
    const app = locationFixture();
    app.hook.requestLocation(); app.calls[0].failure({ code });
    assert.equal(app.hook.locationStatus, status);
    assert.equal(app.calls.length, 1);
    app.hook.requestLocation();
    assert.equal(app.calls.length, 2);
  }
  const unavailable = locationFixture({ geolocation: false });
  unavailable.hook.requestLocation();
  assert.equal(unavailable.hook.locationStatus, 'unavailable');
  assert.equal(unavailable.calls.length, 0);
});

test('manual selection and cancellation reject stale GPS callbacks', () => {
  const app = locationFixture();
  app.hook.requestLocation(); app.hook.setManualCity('Phoenix, AZ');
  app.calls[0].success({ coords: { latitude: 42, longitude: -71 } });
  assert.equal(app.hook.locationLabel, 'Phoenix, AZ');
  assert.equal(app.hook.latlong, '');
  assert.deepEqual(app.results, []);
  app.hook.requestLocation(); app.hook.cancelRequest();
  app.calls[1].failure({ code: 1 });
  assert.equal(app.hook.locationStatus, 'idle');
  assert.deepEqual(app.errors, []);
});

test('invalid, expired and future GPS cache cannot become a granted location', () => {
  for (const row of [{ latlong: '200,0', ts: Date.now() }, { latlong: '0,0', ts: Date.now() - 7200000 }, { latlong: '0,0', ts: Date.now() + 7200000 }]) {
    const app = locationFixture({ cache: { pg_location_cache: JSON.stringify(row) } });
    assert.equal(app.hook.locationStatus, 'idle');
    assert.deepEqual(app.results, []);
    assert.equal(app.calls.length, 0);
  }
});

const sortSource = await readFile(new URL('../src/components/fanzone/FanSortSheet.jsx', import.meta.url), 'utf8');
const sortCode = await transform(sortSource.replace(/^import .+\n/gm, ''), { loader: 'jsx', format: 'cjs', jsxFactory: 'h', jsxFragment: 'Fragment' });
const nodes = value => Array.isArray(value) ? value.flatMap(nodes) : value == null || value === false ? [] : [value, ...nodes(value.props?.children)];
const text = value => nodes(value).filter(node => typeof node === 'string').join(' ');

test('sort sheet uses a named Radix modal, accessible selection state and exact trigger restoration', () => {
  const module = { exports: {} }, focus = [], changed = [], closed = [];
  vm.runInNewContext(sortCode.code, { module, exports: module.exports, h: (type, props, ...children) => ({ type, props: { ...props, children } }),
    Dialog: Object.fromEntries(['Root', 'Portal', 'Overlay', 'Content', 'Close', 'Title', 'Description'].map(key => [key, `dialog-${key}`])), Check: 'icon', X: 'icon', useRef: () => ({ current: { focus: () => focus.push('close') } }) });
  const triggerRef = { current: { isConnected: true, focus: () => focus.push('trigger') } };
  const render = allowDistance => module.exports.default({ value: 'upcoming', allowDistance, triggerRef, onChange: value => changed.push(value), onClose: () => closed.push(true) });
  const tree = render(false), all = nodes(tree), content = all.find(node => node.type === 'dialog-Content');
  assert.equal(tree.type, 'dialog-Root');
  assert.equal(tree.props.open, true);
  assert.equal(text(all.find(node => node.type === 'dialog-Title')), 'Sort posts');
  content.props.onOpenAutoFocus({ preventDefault() {} }); content.props.onCloseAutoFocus({ preventDefault() {} });
  assert.deepEqual(focus, ['close', 'trigger']);
  triggerRef.current.isConnected = false; content.props.onCloseAutoFocus({ preventDefault() {} });
  assert.deepEqual(focus, ['close', 'trigger']);
  const options = all.filter(node => node.type === 'button' && 'aria-pressed' in node.props);
  assert.equal(options.length, 6);
  assert.equal(options.filter(node => node.props['aria-pressed']).length, 1);
  for (const option of options) option.props.onClick();
  assert.equal(new Set(changed).size, 6);
  assert.equal(closed.length, 6);
  tree.props.onOpenChange(false); assert.equal(closed.length, 7);
  assert.equal(nodes(render(true)).filter(node => node.type === 'button' && 'aria-pressed' in node.props).length, 7);
  // Actual Tab trapping/backdrop/Escape is delegated to Radix and verified by
  // the isolated browser runner; structural markers are not browser evidence.
});
