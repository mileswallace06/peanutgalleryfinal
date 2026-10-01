import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { getUpgradeEventState, getUpgradeShowtimeLabel, getUpgradeVenueDateParts, formatUpgradeStartsIn } from '../src/lib/upgradeEventState.js';

const event = {
  id: 'fixture-event', title: 'Fixture concert', status: 'upcoming',
  event_start_utc: '2026-10-02T02:00:00Z', date: '2026-10-03T02:00:00Z',
  event_end_utc: '2026-10-02T06:00:00Z',
  venue_timezone: 'America/Phoenix', category: 'concert',
};
const start = Date.parse(event.event_start_utc);
const bundle = await build({
  stdin: {
    contents: "export { default as MoveCloserRail } from './src/components/eventmode/MoveCloserRail.jsx'; export { default as GeneratedHero } from './src/components/eventmode/GeneratedHero.jsx';",
    resolveDir: fileURLToPath(new URL('../', import.meta.url)), loader: 'jsx',
  },
  alias: { '@': fileURLToPath(new URL('../src', import.meta.url)) },
  bundle: true, write: false, platform: 'browser', format: 'esm', jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"production"' },
});
const { MoveCloserRail, GeneratedHero } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);

function nodes(element) {
  if (element === null || element === undefined || element === false) return [];
  if (Array.isArray(element)) return element.flatMap(nodes);
  return [element, ...nodes(element?.props?.children)];
}
function renderState(nowMs, overrides = {}) {
  return nodes(MoveCloserRail({ event, nowMs, listings: [], notifyControl: 'Alert control', ...overrides }));
}
const text = elements => elements.filter(value => typeof value === 'string').join(' ');

test('countdown uses canonical UTC, rounds the last fraction upward, and flips at showtime despite stale upcoming status', () => {
  const before = getUpgradeEventState(event, start - 250);
  assert.equal(before.status, 'soon');
  assert.deepEqual(before.countdown, { days: 0, hours: 0, minutes: 0, seconds: 1 });
  assert.match(text(renderState(start - 250)), /Countdown to showtime/);
  const atStart = getUpgradeEventState(event, start);
  assert.equal(atStart.status, 'live');
  assert.equal(atStart.countdown, null);
  assert.match(text(renderState(start)), /No upgrades available right now/);
  assert.ok(!renderState(start).some(value => value?.props?.role === 'timer'));
  assert.match(text(renderState(start)), /Alert control/);
});

test('upcoming countdown spans days and ignores stale persisted live status', () => {
  const state = getUpgradeEventState({ ...event, status: 'live' }, start - 90061000);
  assert.equal(state.status, 'upcoming');
  assert.deepEqual(state.countdown, { days: 1, hours: 1, minutes: 1, seconds: 1 });
});

test('explicit end boundary and beta preview remain consistent with upgrade discovery', () => {
  assert.equal(getUpgradeEventState(event, start + 4 * 3600000 - 1).status, 'live');
  assert.equal(getUpgradeEventState(event, start + 4 * 3600000).status, 'ended');
  const ended = text(renderState(start + 4 * 3600000));
  assert.match(ended, /Event has ended/);
  assert.doesNotMatch(ended, /Alert control/);
  assert.equal(getUpgradeEventState({ ...event, is_beta_live: true }, start - 3600000).countdown, null);
  assert.equal(getUpgradeEventState({ ...event, is_beta_live: true }, start - 3600000).status, 'live');
});

test('venue time label and live detection are independent of the viewer timezone and preserve legacy fallback', () => {
  const previous = process.env.TZ;
  try {
    for (const zone of ['UTC', 'America/New_York', 'Asia/Tokyo']) {
      process.env.TZ = zone;
      assert.match(getUpgradeShowtimeLabel(event), /Oct 1, 2026, 7:00 PM/);
      assert.equal(getUpgradeEventState(event, start).status, 'live');
      assert.deepEqual(getUpgradeVenueDateParts(event, getUpgradeEventState(event, start).start), {
        month: 'Oct', day: '1', label: 'Oct 1 · 7:00 PM MST',
      });
    }
  } finally {
    if (previous === undefined) delete process.env.TZ;
    else process.env.TZ = previous;
  }
  const legacy = { ...event, event_start_utc: undefined, date: event.event_start_utc };
  assert.equal(getUpgradeEventState(legacy, start).status, 'live');
  assert.equal(getUpgradeShowtimeLabel({ ...event, event_start_utc: 'invalid' }), null);
  assert.equal(getUpgradeEventState({ id: 'unknown-time' }, start).countdown, null);
});

test('explicit long events remain live past the estimated window, while estimated events are labeled and bounded', () => {
  const long = { ...event, event_end_utc: '2026-10-02T10:00:00Z' };
  assert.equal(getUpgradeEventState(long, start + 5 * 3600000).status, 'live');
  assert.equal(getUpgradeEventState(long, start + 8 * 3600000).status, 'ended');
  const estimated = { ...event, event_end_utc: undefined };
  assert.equal(getUpgradeEventState(estimated, start).status, 'estimated_live');
  assert.match(text(nodes(GeneratedHero({ event: estimated, nowMs: start }))), /LIVE · EST\./);
  assert.equal(getUpgradeEventState(estimated, start + 4 * 3600000).status, 'ended');
});

test('missing, TBA, naive, postponed and invalid timing never create a countdown or a live hero', () => {
  const listing = { id: 'unconfirmed-offer', listing_type: 'live_upgrade', status: 'active', is_verified: true, reservation_state: 'available', asking_price: 50 };
  const uncertain = [
    { event_start_utc: undefined, date: undefined },
    { event_start_utc: '2026-10-02T02:00:00' },
    { event_start_utc: '2026-02-30T02:00:00Z' },
    { date_tba: true }, { time_tba: true }, { no_specific_time: true },
    { provider_status: 'postponed' }, { end_time_invalid: true },
    { event_end_utc: 'invalid' }, { event_end_utc: '2026-10-02T01:00:00Z' },
  ];
  for (const patch of uncertain) {
    const sample = { ...event, ...patch };
    const timing = getUpgradeEventState(sample, start - 60000);
    assert.equal(timing.status, 'unknown', JSON.stringify(patch));
    assert.equal(timing.countdown, null);
    assert.equal(timing.isLive, false);
    assert.equal(getUpgradeShowtimeLabel(sample), null);
    assert.equal(getUpgradeVenueDateParts(sample, timing.start), null);
    assert.doesNotMatch(text(nodes(GeneratedHero({ event: sample, nowMs: start }))), /LIVE/);
    const rail = renderState(start, { event: sample, listings: [listing] });
    assert.ok(!rail.some(value => value?.props?.listing));
    assert.match(text(rail), /Event time unconfirmed/);
    assert.doesNotMatch(text(rail), /No upgrades available|Countdown/);
  }
});

test('ended and cancelled records suppress remaining offer cards, countdowns and live badges', () => {
  const listing = { id: 'remaining-offer', listing_type: 'live_upgrade', status: 'active', is_verified: true, reservation_state: 'available', asking_price: 50 };
  for (const patch of [{ status: 'ended' }, { status: 'cancelled' }, { provider_status: 'canceled' }]) {
    const sample = { ...event, ...patch };
    const timing = getUpgradeEventState(sample, start);
    assert.equal(timing.status, 'ended');
    assert.equal(timing.countdown, null);
    const rail = renderState(start, { event: sample, listings: [listing] });
    assert.ok(!rail.some(value => value?.props?.listing));
    assert.doesNotMatch(text(rail), /Alert control|Countdown/);
    assert.doesNotMatch(text(nodes(GeneratedHero({ event: sample, nowMs: start }))), /LIVE/);
  }
});

test('new visible upgrades replace the empty state while existing proof and reservation filters remain enforced', () => {
  const listing = { id: 'upgrade-1', listing_type: 'live_upgrade', status: 'active', is_verified: true, reservation_state: 'available', asking_price: 50 };
  const available = renderState(start, { listings: [listing] });
  assert.ok(available.some(value => value?.props?.listing?.id === listing.id));
  assert.doesNotMatch(text(available), /No upgrades available/);
  for (const unavailable of [{ is_verified: false }, { status: 'sold' }, { reservation_state: 'reserved_by_other' }]) {
    const filtered = renderState(start, { listings: [{ ...listing, ...unavailable }] });
    assert.ok(!filtered.some(value => value?.props?.listing));
    assert.match(text(filtered), /No upgrades available right now/);
  }
});

test('a failed availability read reports the failure instead of asserting that inventory is empty', () => {
  const failed = renderState(start, { loadError: true, onRetry: () => {}, refreshing: false });
  assert.match(text(failed), /Unable to load upgrades/);
  assert.match(text(failed), /Try again/);
  assert.doesNotMatch(text(failed), /No upgrades available right now|Alert control/);
});

test('compact browse countdowns cover days through the final second without negative or stale labels', () => {
  assert.equal(formatUpgradeStartsIn(start, start - 90061000), 'Starts in 1d 1h');
  assert.equal(formatUpgradeStartsIn(start, start - 3661000), 'Starts in 1h 1m');
  assert.equal(formatUpgradeStartsIn(start, start - 61000), 'Starts in 1m 1s');
  assert.equal(formatUpgradeStartsIn(start, start - 1), 'Starts in 1s');
  assert.equal(formatUpgradeStartsIn(start, start), null);
  assert.equal(formatUpgradeStartsIn(start, start + 1), null);
  assert.equal(formatUpgradeStartsIn(NaN, start), null);
});
