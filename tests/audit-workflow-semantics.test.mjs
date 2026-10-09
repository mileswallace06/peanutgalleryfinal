import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { transform } from 'esbuild';
import { restoreEventLocation, saveEventLocation, sameEventLocation, subscribeEventLocation, cityFromSuggestion, validCoordinates } from '../src/lib/eventLocation.js';
import { getEventDateDisplay } from '../src/lib/eventDateDisplay.js';
import { summarizeSellerHistory, SELLER_HISTORY_SCOPE } from '../src/lib/salesPresentation.js';
import { sellingEventList } from '../src/lib/sellingEventTiming.js';
import { createEventSearchRequest } from '../src/lib/eventSearchRequest.js';

const read = file => readFile(new URL(`../src/${file}`, import.meta.url), 'utf8');
const h = (type, props, ...children) => ({ type, props: { ...props, children } });
const nodes = value => Array.isArray(value) ? value.flatMap(nodes) : value == null || value === false ? [] : [value, ...nodes(value.props?.children)];
const text = value => nodes(value).filter(node => typeof node === 'string').join(' ');
async function compile(source, globals) {
  const output = await transform(source.replace(/^import .+\n/gm, ''), { loader: 'jsx', format: 'cjs', jsxFactory: 'h', jsxFragment: 'Fragment' });
  const module = { exports: {} };
  vm.runInNewContext(output.code, { module, exports: module.exports, h, Fragment: 'fragment', ...globals });
  return module.exports;
}
function hookFixture() {
  const slots = [];
  let cursor = 0;
  const pending = [];
  const hooks = {
    useState(initial) {
      const key = cursor++;
      if (!(key in slots)) slots[key] = typeof initial === 'function' ? initial() : initial;
      return [slots[key], value => { slots[key] = typeof value === 'function' ? value(slots[key]) : value; }];
    },
    useRef(initial) { const key = cursor++; return slots[key] ||= { current: initial }; },
    useId() { const key = cursor++; return slots[key] ||= `fixture-${key}`; },
    useCallback(fn, deps) {
      const key = cursor++;
      if (!slots[key] || deps.some((dep, i) => dep !== slots[key].deps[i])) slots[key] = { deps, fn };
      return slots[key].fn;
    },
    useEffect(fn, deps) {
      const key = cursor++;
      if (!slots[key] || !deps || deps.some((dep, i) => dep !== slots[key].deps?.[i])) {
        pending.push(() => { slots[key]?.cleanup?.(); slots[key] = { deps, cleanup: fn() }; });
      }
    },
  };
  return { hooks, render(fn) { cursor = 0; const result = fn(); pending.splice(0).forEach(effect => effect()); return result; }, close() { slots.forEach(slot => slot?.cleanup?.()); } };
}
const memoryStorage = () => {
  const values = new Map();
  return { getItem: key => values.get(key) || null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
};
async function marketFixture(storage, navigator = {}) {
  const fixture = hookFixture();
  const calls = [];
  const source = `${await read('hooks/useLocationDetect.js')}\n${await read('hooks/useSellingDiscovery.js')}`;
  const { useSellingDiscovery } = await compile(source, {
    ...fixture.hooks, navigator, localStorage: storage, createEventSearchRequest,
    base44: {}, validCoordinates, cityFromSuggestion, sameEventLocation, subscribeEventLocation,
    restoreEventLocation: client => restoreEventLocation(client, storage),
    saveEventLocation: area => saveEventLocation(area, storage),
    fetchSellingEvents: async (_client, request) => { calls.push(request); return { events: [], pgError: false, tmError: false }; },
  });
  let current;
  const settle = async () => { for (let i = 0; i < 5; i++) { current = fixture.render(() => useSellingDiscovery()); await Promise.resolve(); } return current; };
  await settle();
  return { settle, calls, close: fixture.close, get current() { return current; } };
}

test('selected markets propagate to retained discovery tabs and survive navigation/reload without GPS', async () => {
  const storage = memoryStorage();
  saveEventLocation(cityFromSuggestion({ city: 'Phoenix', state: 'AZ' }), storage);
  await Promise.resolve();
  let gps = 0;
  const navigator = { geolocation: { getCurrentPosition() { gps++; } } };
  const sell = await marketFixture(storage, navigator);
  const upgrades = await marketFixture(storage, navigator);
  try {
    assert.equal(sell.current.area.label, 'Phoenix, AZ');
    assert.equal(upgrades.current.area.label, 'Phoenix, AZ');
    sell.current.selectCity({ city: 'New York', state: 'NY' });
    await sell.settle(); await upgrades.settle();
    assert.equal(upgrades.current.area.label, 'New York, NY');
    assert.equal(upgrades.calls.at(-1).cityOverride, 'New York');
    const listing = await marketFixture(storage, navigator);
    try { assert.equal(listing.current.request.stateOverride, 'NY'); assert.equal(listing.current.area.label, 'New York, NY'); }
    finally { listing.close(); }
    assert.equal(gps, 0);
    assert.deepEqual(await restoreEventLocation({}, storage), { city: 'New York', state: 'NY', label: 'New York, NY' });
  } finally { sell.close(); upgrades.close(); }
});

test('denied and unavailable geolocation recover through manual city selection', async () => {
  for (const navigator of [{}, { geolocation: { getCurrentPosition(_ok, fail) { fail({ code: 1 }); } } }]) {
    const storage = memoryStorage();
    const fixture = await marketFixture(storage, navigator);
    try {
      assert.equal(fixture.current.area, null);
      fixture.current.locate(); await fixture.settle();
      assert.equal(fixture.current.editingLocation, true);
      assert.match(fixture.current.cityError, /Choose a city below/);
      fixture.current.selectCity({ city: 'New York', state: 'NY' }); await fixture.settle();
      assert.equal(fixture.current.area.label, 'New York, NY');
      assert.equal(fixture.current.cityError, '');
      assert.equal(fixture.current.editingLocation, false);
      assert.equal(fixture.calls.at(-1).ll, null);
    } finally { fixture.close(); }
  }
});

test('a late GPS result cannot replace an explicitly selected city', async () => {
  let complete;
  const fixture = await marketFixture(memoryStorage(), { geolocation: { getCurrentPosition(ok) { complete = ok; } } });
  try {
    fixture.current.locate(); await fixture.settle();
    fixture.current.selectCity({ city: 'Phoenix', state: 'AZ' }); await fixture.settle();
    complete({ coords: { latitude: 40.7, longitude: -74 } }); await fixture.settle();
    assert.equal(fixture.current.area.label, 'Phoenix, AZ');
    assert.equal(fixture.calls.at(-1).cityOverride, 'Phoenix');
  } finally { fixture.close(); }
});

const motion = new Proxy({}, { get: (_target, tag) => tag });
test('landing renders a main landmark and one real heading while preserving auth destinations', async () => {
  const paths = [];
  const { default: Landing } = await compile(await read('pages/Landing.jsx'), { PublicPage: 'public-page', motion, useNavigate: () => path => paths.push(path) });
  const root = Landing();
  assert.equal(root.props.as, 'main');
  const all = nodes(root);
  const headings = all.filter(node => node.type === 'h1');
  assert.equal(headings.length, 1);
  assert.equal(headings[0].props['aria-label'], 'Find. Upgrade. Experience.');
  assert.equal(root.props['aria-labelledby'], headings[0].props.id);
  all.filter(node => node.type === 'button').forEach(node => node.props.onClick());
  assert.deepEqual(paths, ['/register', '/login']);
});

test('onboarding exposes only the current slide heading through Next, Back, and progress controls', async () => {
  const fixture = hookFixture();
  const storage = memoryStorage();
  let done = 0;
  const { default: Onboarding } = await compile(await read('components/Onboarding.jsx'), {
    ...fixture.hooks, PublicPage: 'public-page', motion, AnimatePresence: 'presence',
    useMotionValue: () => ({ set() {} }), useSpring: value => value, localStorage: storage,
  });
  const render = () => fixture.render(() => Onboarding({ onDone: () => done++ }));
  let root = render();
  assert.equal(root.props.as, 'main');
  const title = value => nodes(value).find(node => node.type === 'h1').props['aria-label'];
  assert.equal(title(root), 'Find. Upgrade. Experience.');
  for (let i = 0; i < 4; i++) {
    nodes(root).find(node => node.type === 'button' && text(node).includes('Next →')).props.onClick();
    root = render();
    assert.equal(nodes(root).filter(node => node.type === 'h1').length, 1);
    assert.equal(nodes(root).find(node => node.props?.['aria-roledescription'] === 'slide').props['aria-label'], `Slide ${i + 2} of 5`);
    assert.equal(nodes(root).filter(node => node.type === 'presence').some(node => nodes(node).some(child => child.type === 'h1')), false, 'exiting animations must not retain a second slide heading');
  }
  nodes(root).find(node => node.type === 'button' && text(node).includes('← BACK')).props.onClick();
  root = render(); assert.equal(title(root), "Got Seats You Can't Use?");
  nodes(root).find(node => node.props?.['aria-label'] === 'Go to slide 1').props.onClick();
  root = render(); assert.equal(title(root), 'Find. Upgrade. Experience.');
  nodes(root).find(node => node.type === 'button' && text(node).includes('SKIP')).props.onClick();
  assert.equal(storage.getItem('pg_onboarded'), '1'); assert.equal(done, 1);
});

test('closed FAQ answers use native hidden, opening is uncapped, and closing safely returns panel focus', async () => {
  const fixture = hookFixture();
  const activeElement = {};
  const { default: FAQ } = await compile(await read('components/education/FaqAccordion.jsx'), { ...fixture.hooks, document: { activeElement }, ChevronDown: 'icon' });
  const render = () => nodes(fixture.render(() => FAQ({ items: [{ q: 'Question one?', a: h('a', { href: '/help' }, 'Answer link') }, { q: 'Question two?', a: 'Second answer' }] })));
  let all = render();
  const panels = () => all.filter(node => node.props?.role === 'region');
  const buttons = () => all.filter(node => node.type === 'button');
  assert.ok(panels().every(panel => panel.props.hidden === true));
  let focus = 0;
  const click = index => buttons()[index].props.onClick({ currentTarget: { focus() { focus++; } } });
  click(0); all = render();
  assert.equal(buttons()[0].props['aria-expanded'], true);
  assert.equal(panels()[0].props.hidden, false);
  assert.equal(panels()[0].props.style?.maxHeight, undefined);
  assert.equal(buttons()[0].props['aria-controls'], panels()[0].props.id);
  panels()[0].props.ref({ contains: value => value === activeElement });
  click(1); all = render();
  assert.equal(focus, 1);
  assert.equal(panels()[0].props.hidden, true);
  assert.equal(panels()[1].props.hidden, false);
  click(1); all = render();
  assert.ok(panels().every(panel => panel.props.hidden === true));
  assert.ok(buttons().every(button => button.props.type === 'button' && button.props['aria-expanded'] === false));
});

test('Sell uses shared read-only market discovery and preserves actionable city and error recovery', async () => {
  const source = await read('pages/Sell.jsx');
  assert.match(source, /const discovery = useSellingDiscovery\(\)/);
  assert.doesNotMatch(source, /getCurrentPosition|fetchTMEvents/);
  assert.match(source, /onSelect=\{discovery.selectCity\}/);
  assert.match(source, /onClick=\{discovery.refresh\}>Try again/);
  assert.match(source, /onClick=\{discovery.openLocation\}>Choose city/);
  const events = await read('pages/Events.jsx');
  assert.match(events, /subscribeEventLocation\(location =>/);
});

test('Friends and Following point to real community browsing instead of circular find-people promises', async () => {
  const me = await read('pages/Me.jsx');
  const fan = await read('pages/FanZone.jsx');
  assert.match(me, /to="\/fan-zone\?tab=trending"/);
  assert.match(me, /check Followers to follow someone back/);
  assert.match(fan, /params.get\('tab'\) === 'trending'/);
  assert.match(fan, /setFeedTab\('trending'\); setDateFilter\('all'\); \}\} className="pg-bucket-primary">Explore Trending/);
  assert.match(fan, /People search is not available yet/);
  assert.doesNotMatch(fan, /Follow fans from your profile|Follow people from your/);
});


test('Sell renders no-location, denied, empty, incomplete, and populated fixture recovery without transactions', async () => {
  const source = await read('pages/Sell.jsx');
  const fixture = hookFixture();
  const actions = [];
  const baseDiscovery = { result: { events: [], pgError: false, tmError: false }, area: null, editingLocation: false, cityError: '', locationStatus: 'idle',
    openLocation: () => actions.push('city'), refresh: () => actions.push('retry'), closeLocation() {}, changeLocationInput() {}, selectCity() {}, rejectCity() {}, locate() {} };
  let discovery = baseDiscovery;
  const user = { email: 'fixture@example.invalid', stripe_onboarding_complete: true };
  const { default: Sell, ListingRow } = await compile(`${source}\nexport { ListingRow };`, {
    ...fixture.hooks, useSellingDiscovery: () => discovery, useEventClock: () => Date.parse('2099-10-01T00:00:00Z'),
    useSellerSummary: () => ({ status: 'ready', summary: summarizeSellerHistory([]), reload() {} }), SELLER_HISTORY_SCOPE,
    sellingEventList, getEventDateDisplay, Link: 'a', useSearchParams: () => [new URLSearchParams()],
    LocationAutocomplete: 'city-picker', isAdmin: () => false,
    base44: { auth: { me: async () => user }, entities: { Listing: { filter: async () => [] } } },
    Plus: 'plus', Ticket: 'ticket', LogIn: 'login', ExternalLink: 'external', Loader2: 'loader', AlertCircle: 'alert', MapPin: 'pin', ChevronRight: 'next', ArrowRight: 'arrow', X: 'close',
  });
  let rendered;
  for (let i = 0; i < 2; i++) { rendered = fixture.render(Sell); await new Promise(resolve => setImmediate(resolve)); }
  assert.match(text(rendered), /Choose a city or use your location/);
  nodes(rendered).find(node => node.type === 'button' && text(node) === 'Choose city').props.onClick();
  assert.deepEqual(actions, ['city']);
  discovery = { ...baseDiscovery, editingLocation: true, cityError: 'Location permission was denied. Choose a city below.', locationStatus: 'denied' };
  rendered = fixture.render(Sell);
  assert.match(text(nodes(rendered).find(node => node.props?.role === 'alert')), /permission was denied/);
  assert.equal(nodes(rendered).find(node => node.type === 'city-picker').props.onSelect, discovery.selectCity);
  discovery = { ...baseDiscovery, area: { city: 'New York', state: 'NY', label: 'New York, NY' } };
  rendered = fixture.render(Sell); assert.match(text(rendered), /No events found near New York, NY. Try another city/);
  discovery = { ...discovery, result: { events: [], pgError: true } };
  rendered = fixture.render(Sell); assert.match(text(rendered), /Event results are incomplete/);
  assert.doesNotMatch(text(rendered), /No events found/);
  nodes(rendered).find(node => node.type === 'button' && text(node) === 'Try again').props.onClick();
  assert.deepEqual(actions, ['city', 'retry']);
  const event = { id: 'fixture-show', title: 'Fixture show', event_start_utc: '2099-10-02T02:00:00Z', venue_timezone: 'America/Phoenix', city: 'Phoenix', venue: 'Fixture venue' };
  discovery = { ...discovery, result: { events: [event] } };
  rendered = fixture.render(Sell);
  const eventLink = nodes(rendered).find(node => node.type === 'a' && node.props.to === '/create-listing?event_id=fixture-show');
  assert.match(text(eventLink), /Oct 1 · 7:00 PM MST/);
  const listing = { id: 'fixture-listing', status: 'active', section: '1', quantity: 1, asking_price: 10 };
  assert.match(text(ListingRow({ listing, event })), /Oct 1 · 7:00 PM MST/);
  assert.match(text(ListingRow({ listing, event: { ...event, venue_timezone: undefined } })), /2:00 AM UTC · venue time unconfirmed/);
  assert.match(text(ListingRow({ listing, event: { ...event, time_tba: true } })), /Date to be confirmed/);
  fixture.close();
});
