import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { transform } from 'esbuild';
import { getUpgradeEventState } from '../src/lib/upgradeEventState.js';
import { UPGRADE_LISTING_TYPES } from '../src/lib/listingTypes.js';
import { sharedListingSelection } from '../src/lib/sharedListingDestination.js';
import { listingEventEligibility } from '../base44/shared/listingEventEligibility.js';
import { discoveryBackLink } from '../src/lib/eventDiscoveryState.js';
import { eventIdentityLabel } from '../src/lib/eventIdentity.js';

const event = {
  id: 'clock-fixture', title: 'Fixture concert', status: 'upcoming',
  event_start_utc: '2026-10-02T02:00:00Z', event_end_utc: '2026-10-02T03:00:00Z',
  venue_timezone: 'America/Phoenix',
};
const start = Date.parse(event.event_start_utc), end = Date.parse(event.event_end_utc);
const h = (type, props, ...children) => ({ type, props: { ...props, children } });
const nodes = value => Array.isArray(value) ? value.flatMap(nodes)
  : value == null || value === false ? [] : [value, ...nodes(value.props?.children)];
async function compile(file, globals) {
  const source = (await readFile(new URL(file, import.meta.url), 'utf8')).replace(/^import .+\n/gm, '');
  const output = await transform(source, { loader: 'jsx', format: 'cjs', jsxFactory: 'h', jsxFragment: 'Fragment' });
  const module = { exports: {} };
  vm.runInNewContext(output.code, { module, exports: module.exports, h, Fragment: 'fragment', ...globals });
  return module.exports;
}

test('the hub presents existing eligibility requirements only during its shared live window', async () => {
  const listing = { id: 'gated-fixture', listing_type: 'live_upgrade', status: 'active', is_verified: true,
    reservation_state: 'available', asking_price: 50, requires_location: true, requires_existing_ticket: true };
  let cursor = 0, now = start - 1;
  const { default: Hub } = await compile('../src/pages/EventDetailUpgrade.jsx', {
    getUpgradeEventState, UPGRADE_LISTING_TYPES, sharedListingSelection, listingEventEligibility, eventIdentityLabel, discoveryBackLink,
    useParams: () => ({ id: event.id }), useLocation: () => ({ search: '' }), useUpgradeClock: () => now,
    useState: () => [[event, [listing], [], false, false, null, false, 'Upgrades', false, null, false, true, null, false, false][cursor++], () => {}],
    useRef: current => ({ current }), useEffect() {}, useCallback: fn => fn,
    EventHero: 'hero', CurrentTicketModule: 'ticket', UpgradeEligibilityGate: 'eligibility',
    MoveCloserRail: 'rail', DiscoveryAlertControl: 'alert-control', SellSeatsModule: 'sell', Link: 'a',
  });
  for (now of [start - 1, start, end - 1, end]) {
    cursor = 0;
    const rendered = nodes(Hub());
    const gate = rendered.find(node => node?.type === 'eligibility');
    assert.equal(Boolean(gate), getUpgradeEventState(event, now).isLive);
    if (gate) assert.equal(gate.props.listing, listing, 'timing must not alter the existing requirements');
    assert.equal(rendered.find(node => node?.type === 'hero').props.nowMs, now);
    assert.equal(rendered.find(node => node?.type === 'rail').props.nowMs, now);
    assert.equal(rendered.some(node => typeof node === 'string' && node.includes('Eligible —')), Boolean(gate));
  }
});

test('the shared detail clock flips exactly at showtime and end, refreshes after tab resume, and cleans up', async () => {
  let now = start - 250, state, effect;
  let timerId = 0;
  const timers = new Map(), listeners = new Map();
  const document = { hidden: false,
    addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: name => listeners.delete(name) };
  const window = { addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: name => listeners.delete(name) };
  const { useUpgradeClock } = await compile('../src/hooks/useUpgradeClock.js', {
    getUpgradeEventState, Date: { now: () => now }, document, window,
    useState: initial => { if (state === undefined) state = initial(); return [state, value => { state = value; }]; },
    useEffect: fn => { effect = fn; },
    setTimeout: (fn, delay) => { timers.set(++timerId, { fn, delay }); return timerId; },
    clearTimeout: id => timers.delete(id),
  });
  assert.equal(useUpgradeClock(event), start - 250);
  const cleanup = effect();
  assert.equal([...timers.values()][0].delay, 250);
  now = start;
  [...timers.values()][0].fn();
  assert.equal(getUpgradeEventState(event, state).status, 'live');
  now = end - 25;
  listeners.get('focus')();
  assert.equal([...timers.values()][0].delay, 25);
  now = end;
  [...timers.values()][0].fn();
  assert.equal(getUpgradeEventState(event, state).status, 'ended');
  document.hidden = true;
  now = end + 60000;
  listeners.get('visibilitychange')();
  assert.equal(state, end);
  document.hidden = false;
  listeners.get('visibilitychange')();
  assert.equal(state, now);
  cleanup();
  assert.equal(timers.size, 0);
  assert.equal(listeners.size, 0);
});

test('seller and Events clocks use the requested cadence and refresh on foreground without fetching', async () => {
  let now = start - 1, state, effect, interval, cleared = false;
  const listeners = new Map();
  const target = { addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: name => listeners.delete(name) };
  const { useEventClock } = await compile('../src/hooks/useEventClock.js', {
    Date: { now: () => now }, document: { ...target, visibilityState: 'visible' }, window: target,
    useState: initial => { state = initial(); return [state, value => { state = value; }]; },
    useEffect: fn => { effect = fn; }, setInterval: (fn, delay) => { interval = { fn, delay }; return 1; },
    clearInterval: () => { cleared = true; },
  });
  useEventClock(1000);
  const cleanup = effect();
  assert.equal(interval.delay, 1000);
  now = start;
  interval.fn();
  assert.equal(state, start);
  now = end;
  listeners.get('visibilitychange')();
  assert.equal(state, end);
  cleanup();
  assert.equal(cleared, true);
  assert.equal(listeners.size, 0);
});

test('both Fan Gifts launchers establish a focus-return target and empty gifts do not promise unsupported alerts', async () => {
  let cursor = 0;
  const calls = [];
  const { default: Hub } = await compile('../src/pages/EventDetailUpgrade.jsx', {
    getUpgradeEventState, UPGRADE_LISTING_TYPES, sharedListingSelection, listingEventEligibility, eventIdentityLabel, discoveryBackLink, Date: { now: () => start },
    useParams: () => ({ id: event.id }), useLocation: () => ({ search: '' }), useUpgradeClock: () => start,
    useState: () => {
      const index = cursor++;
      return [[event, [], [], false, false, null, false, 'Fan Gifts', false, null, false, false, null, false, false][index], value => {
        if (index === 8) calls.push(['open', value]);
      }];
    },
    useRef: current => ({ current }), useEffect() {}, useCallback: fn => fn,
    EventHero: 'hero', CurrentTicketModule: 'ticket', FlashDropCenter: 'gifts', Link: 'a',
  });
  const giftProps = nodes(Hub()).find(node => node?.type === 'gifts').props;
  const { default: Center } = await compile('../src/components/eventmode/FlashDropCenter.jsx', {
    Gift: 'icon', Clock: 'icon', CheckCircle2: 'icon', FlashDropCard: 'card',
    motion: { div: 'div', span: 'span' }, AnimatePresence: 'fragment',
  });
  const tree = nodes(Center(giftProps));
  assert.ok(tree.some(node => typeof node === 'string' && node.includes('Fan gift alerts aren’t available yet.')));
  const launchers = tree.filter(node => node?.type === 'button' && node.props.onClick === giftProps.onDropSeats);
  assert.equal(launchers.length, 2);
  for (const launcher of launchers) {
    calls.length = 0;
    launcher.props.onClick({ currentTarget: { focus: options => calls.push(['focus', options.preventScroll]) } });
    assert.deepEqual(calls, [['focus', true], ['open', true]]);
  }
});
