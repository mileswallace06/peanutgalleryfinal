import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { transform } from 'esbuild';
import { getEventDateDisplay } from '../src/lib/eventDateDisplay.js';
import { reliableTime, sellingEventDate, sellingEventTiming, SELLING_STATUS_LABELS } from '../src/lib/sellingEventTiming.js';
import { getUpgradeEventState, getUpgradeShowtimeLabel, getUpgradeVenueDateParts } from '../src/lib/upgradeEventState.js';
import { discoveryBackLink } from '../src/lib/eventDiscoveryState.js';
import { eventIdentityLabel } from '../src/lib/eventIdentity.js';
import { listingEventEligibility, checkListingEvent } from '../base44/shared/listingEventEligibility.js';
import { getEventUrl } from '../src/lib/eventUrl.js';
import { sharedListingSelection } from '../src/lib/sharedListingDestination.js';
import { TICKET_LISTING_TYPES } from '../src/lib/listingTypes.js';
import { normalizeTMEvent } from '../base44/shared/tmResponseHandler.js';

const event = {
  id: 'tm_fixture', tm_id: 'fixture', source: 'ticketmaster', title: 'Fixture show',
  event_start_utc: '2026-10-02T02:00:00Z', date: '2026-10-03T22:00:00Z',
  venue_timezone: 'America/Phoenix', state: 'NY',
};
const h = (type, props, ...children) => ({ type, props: { ...props, children } });
const nodes = value => Array.isArray(value) ? value.flatMap(nodes)
  : value == null || value === false ? [] : [value, ...nodes(value.props?.children)];
const text = value => nodes(value).filter(node => typeof node === 'string').join(' ');
async function compile(source, globals) {
  const output = await transform(source, { loader: 'jsx', format: 'cjs', jsxFactory: 'h', jsxFragment: 'Fragment' });
  const module = { exports: {} };
  vm.runInNewContext(output.code, { module, exports: module.exports, h, Fragment: 'fragment', ...globals });
  return module.exports;
}
const eventsSource = await readFile(new URL('../src/pages/Events.jsx', import.meta.url), 'utf8');
const { EventRow } = await compile(`${eventsSource.slice(eventsSource.indexOf('function EventRow('))}\nexport { EventRow };`, {
  getEventDateDisplay, eventIdentityLabel, getUpgradeEventState, getEventUrl, logNavEvent() {},
  Link: 'a', EventThumbnail: 'thumbnail', ShieldCheck: 'shield', ArrowRight: 'arrow',
});

test('Events card time, accessible label and date stub use canonical venue time across viewer zones', () => {
  const previous = process.env.TZ;
  try {
    for (const zone of ['UTC', 'America/New_York', 'Asia/Tokyo']) {
      process.env.TZ = zone;
      const rendered = nodes(EventRow({ event }));
      const byClass = className => rendered.find(node => node?.props?.className === className);
      assert.equal(text(byClass('pg-browse-ticket-month')), 'Oct');
      assert.equal(text(byClass('pg-browse-ticket-day')), '1');
      assert.equal(text(byClass('pg-browse-ticket-detail')), '7:00 PM MST');
      assert.equal(byClass('pg-browse-ticket-detail').props.title, 'Thu, Oct 1 · 7:00 PM MST');
      assert.equal(rendered.find(node => node?.type === 'a').props['aria-label'], 'View Fixture show, Thu, Oct 1 · 7:00 PM MST');
      assert.equal(getEventDateDisplay({ ...event, event_start_utc: '2026-10-03T22:00:00Z' }).time, '3:00 PM MST');
    }
  } finally {
    if (previous === undefined) delete process.env.TZ;
    else process.env.TZ = previous;
  }
});

test('provider titles survive normalization, JSON storage and Events card display without guessed repairs', () => {
  for (const title of ['Lotería Thursdays', "O'Connor’s show", '東京の音楽 · حفلة موسيقية', 'Loterã­A Thursdays']) {
    const normalized = normalizeTMEvent({ id: 'unicode-fixture', name: title, dates: { start: { dateTime: event.event_start_utc } } });
    const restored = JSON.parse(JSON.stringify(normalized));
    assert.equal(restored.title, title);
    const rendered = nodes(EventRow({ event: { ...restored, id: 'tm_unicode-fixture', source: 'ticketmaster' } }));
    assert.equal(text(rendered.find(node => node?.props?.className === 'pg-browse-ticket-title')), title);
  }
});

test('offset legacy timestamps and venue daylight-saving rules retain the correct local date', () => {
  const legacy = getEventDateDisplay({ ...event, event_start_utc: undefined, date: '2026-10-01T19:00:00-07:00' });
  assert.equal(legacy.label, 'Thu, Oct 1 · 7:00 PM MST');
  const ny = { ...event, venue_timezone: 'America/New_York', state: 'AZ' };
  assert.equal(getEventDateDisplay({ ...ny, event_start_utc: '2026-07-02T01:00:00Z' }).label, 'Wed, Jul 1 · 9:00 PM EDT');
  assert.equal(getEventDateDisplay({ ...ny, event_start_utc: '2026-12-02T01:00:00Z' }).label, 'Tue, Dec 1 · 8:00 PM EST');
});

test('missing, naive, invalid and TBA starts never invent an Events card time or date stub', () => {
  const patches = [
    { event_start_utc: undefined, date: undefined },
    { event_start_utc: '2026-10-02T02:00:00' },
    { event_start_utc: '2026-10-02' },
    { event_start_utc: '2026-02-30T02:00:00Z' },
    { event_start_utc: 'invalid' },
    { date_tba: true }, { time_tba: true }, { no_specific_time: true },
  ];
  for (const patch of patches) {
    const sample = { ...event, ...patch };
    assert.equal(getEventDateDisplay(sample), null);
    const rendered = nodes(EventRow({ event: sample }));
    assert.match(text(rendered), /Time TBA/);
    assert.equal(text(rendered.find(node => node?.props?.className === 'pg-browse-ticket-month')), 'TBD');
    assert.equal(text(rendered.find(node => node?.props?.className === 'pg-browse-ticket-day')), '—');
    assert.equal(rendered.find(node => node?.type === 'a').props['aria-label'], 'View Fixture show, Date to be announced, Occurrence unconfirmed · Event reference tm_fixture');
  }
});

test('unavailable venue zones use explicitly labeled UTC without guessing from the state', () => {
  for (const venue_timezone of [undefined, '', 'Invalid/Zone']) {
    const display = getEventDateDisplay({ ...event, venue_timezone, state: 'AZ' });
    assert.equal(display.time, '2:00 AM UTC');
    assert.equal(display.day, '2');
    assert.match(display.label, /venue time unconfirmed$/);
    assert.match(display.detailLabel, /venue time unconfirmed$/);
    assert.match(text(EventRow({ event: { ...event, venue_timezone } })), /UTC · venue time unconfirmed/);
  }
});

// Exercise the existing route and selected-event JSX with deterministic hook state;
// no listing, location, notification or purchase action is invoked.
const nativeSource = (await readFile(new URL('../src/pages/EventDetail.jsx', import.meta.url), 'utf8')).replace(/^import .+\n/gm, '');
const nativeFixture = { event, now: Date.parse(event.event_start_utc), cursor: 0 };
const { default: NativeDetail } = await compile(nativeSource, {
  getEventDateDisplay, eventIdentityLabel, listingEventEligibility, discoveryBackLink, getUpgradeEventState, getUpgradeShowtimeLabel, sharedListingSelection, TICKET_LISTING_TYPES,
  useParams: () => ({ id: nativeFixture.event.id }), useLocation: () => ({ search: '', state: nativeFixture.routeState }),
  useUpgradeClock: () => nativeFixture.now, useEffect() {},
  useState: () => [[nativeFixture.event, [], false, null, null, false, null][nativeFixture.cursor++], () => {}],
  sessionStorage: { getItem: () => null },
  Link: 'a', MapPin: 'pin', Calendar: 'calendar', ArrowLeft: 'back', Ticket: 'ticket',
  Zap: 'zap', Plus: 'plus', Bell: 'bell', ShieldCheck: 'shield', ListingCard: 'listing',
  PurchaseDialog: 'purchase', Disclosure: 'details', DiscoveryAlertControl: 'upgrade-alert-control',
});
function renderNative(event, now = Date.parse(event.event_start_utc || event.date), routeState) {
  Object.assign(nativeFixture, { event, now, cursor: 0, routeState });
  return NativeDetail();
}
const summarySource = (await readFile(new URL('../src/components/listings/SellingEventSummary.jsx', import.meta.url), 'utf8')).replace(/^import .+\n/gm, '');
const { default: SellingSummary } = await compile(summarySource, {
  useEventClock: () => nativeFixture.now, sellingEventDate, sellingEventTiming, SELLING_STATUS_LABELS,
  EventThumbnail: 'thumbnail',
});

test('native detail, seller summary, discovery and hub describe the same instant through DST transitions in every viewer zone', () => {
  const previous = process.env.TZ;
  const scenarios = [
    ['2026-07-02T00:00:00Z', 'America/New_York', '8:00 PM EDT', '1'],
    ['2026-03-08T06:30:00Z', 'America/New_York', '1:30 AM EST', '8'],
    ['2026-03-08T07:30:00Z', 'America/New_York', '3:30 AM EDT', '8'],
    ['2026-11-01T05:30:00Z', 'America/New_York', '1:30 AM EDT', '1'],
    ['2026-11-01T06:30:00Z', 'America/New_York', '1:30 AM EST', '1'],
    ['2026-10-02T02:00:00Z', 'America/Phoenix', '7:00 PM MST', '1'],
  ];
  try {
    for (const viewer of ['UTC', 'America/Los_Angeles', 'Asia/Tokyo']) {
      process.env.TZ = viewer;
      for (const [event_start_utc, venue_timezone, expectedTime, expectedDay] of scenarios) {
        const sample = { ...event, source: 'pg', event_start_utc, venue_timezone };
        const display = getEventDateDisplay(sample);
        const now = Date.parse(event_start_utc) - 1;
        assert.equal(display.time, expectedTime);
        assert.equal(display.day, expectedDay);
        assert.ok(text(renderNative(sample, now)).includes(display.detailLabel));
        assert.ok(text(SellingSummary({ event: sample })).includes(display.showtimeLabel));
        assert.equal(sellingEventDate(sample, now), getUpgradeShowtimeLabel(sample));
        assert.equal(getUpgradeVenueDateParts(sample, now + 1).label, display.compactLabel);
        assert.ok(text(EventRow({ event: sample, nowMs: now })).includes(expectedTime));
      }
    }
  } finally {
    if (previous === undefined) delete process.env.TZ;
    else process.env.TZ = previous;
  }
});

test('missing venue zones and unconfirmed starts remain explicit across native, seller and hub displays', () => {
  for (const venue_timezone of [undefined, '', 'Invalid/Zone']) {
    const sample = { ...event, venue_timezone, state: 'AZ' };
    assert.match(text(renderNative(sample)), /2:00 AM UTC · venue time unconfirmed/);
    assert.match(text(SellingSummary({ event: sample })), /2:00 AM UTC · venue time unconfirmed/);
    assert.match(getUpgradeShowtimeLabel(sample), /2:00 AM UTC · venue time unconfirmed/);
    assert.match(getUpgradeVenueDateParts(sample, Date.parse(sample.event_start_utc)).label, /2:00 AM UTC · venue time unconfirmed/);
  }
  for (const patch of [{ date_tba: true }, { time_tba: true }, { no_specific_time: true },
    { event_start_utc: '2026-10-02T02:00:00' }, { event_start_utc: undefined, date: undefined }]) {
    const sample = { ...event, ...patch };
    assert.match(text(renderNative(sample)), /Date to be confirmed/);
    assert.match(text(SellingSummary({ event: sample })), /Date and time to be confirmed/);
    assert.equal(getUpgradeShowtimeLabel(sample), null);
  }
});

test('native detail and Events badges agree with shared timing through start, explicit end and estimated windows after reload', () => {
  const start = Date.parse(event.event_start_utc);
  const sample = { ...event, id: 'native-fixture', source: 'pg', status: 'upcoming', event_end_utc: new Date(start + 8 * 3600000).toISOString() };
  for (const reload of [false, true]) {
    const record = reload ? JSON.parse(JSON.stringify(sample)) : sample;
    for (const now of [start - 1, start, start + 5 * 3600000, start + 8 * 3600000]) {
      const timing = getUpgradeEventState(record, now);
      const native = nodes(renderNative(record, now));
      const badges = native.filter(node => node?.props?.className === 'pg-event-status');
      const card = text(EventRow({ event: record, nowMs: now }));
      assert.equal(text(badges), timing.beforeShowtime ? 'Starting soon' : timing.isLive ? 'Live now' : 'Event ended');
      assert.equal(card.includes('LIVE'), timing.isLive);
      if (timing.beforeShowtime) assert.ok(text(native).replace(/\s+/g, ' ').includes(`Upgrades open ${getUpgradeShowtimeLabel(record)}`));
    }
  }
  const estimated = { ...sample, event_end_utc: undefined };
  assert.match(text(renderNative(estimated, start)), /Live · estimated window/);
  assert.match(text(EventRow({ event: estimated, nowMs: start })), /LIVE · EST\./);
  assert.match(text(SellingSummary({ event: estimated })), /Live · estimated window/);
});

test('the native empty-event alert control stays scoped to this event and describes upgrades', () => {
  const rendered = nodes(renderNative(event, Date.parse(event.event_start_utc) - 1));
  const control = rendered.find(node => node?.type === 'upgrade-alert-control');
  assert.equal(control.props.eventId, event.id);
  assert.equal(control.props.user, null);
  assert.ok(rendered.some(node => node?.type === 'details' && node.props.title === 'Upgrade alerts'));
  assert.doesNotMatch(text(rendered), /alert you the moment a listing goes live|Manage alerts/);
});

async function renderDetail({ localEvent = event, passedEvent, tmId = 'fixture', routeState } = {}) {
  const source = (await readFile(new URL('../src/pages/EventDetailTM.jsx', import.meta.url), 'utf8')).replace(/^import .+\n/gm, '');
  const state = [];
  const effects = [];
  let cursor = 0;
  let finishLoading;
  const loaded = new Promise(resolve => { finishLoading = resolve; });
  const calls = [];
  const reads = [];
  const { default: Detail } = await compile(source, {
    getEventDateDisplay, eventIdentityLabel, listingEventEligibility, checkListingEvent, discoveryBackLink, reliableTime,
    useUpgradeClock: () => Date.parse(localEvent.event_start_utc || localEvent.date) - 1,
    console: { info() {}, warn() {}, error() {} },
    useParams: () => ({ tmId }), useNavigate: () => () => {}, useLocation: () => ({ state: { ...routeState, tmEvent: passedEvent } }),
    useEffect: fn => effects.push(fn),
    useState: initial => {
      const index = cursor++;
      if (!(index in state)) state[index] = initial;
      return [state[index], value => { state[index] = value; if (index === 3 && value === false) finishLoading(); }];
    },
    base44: {
      auth: { me: async () => null },
      entities: { Event: { filter: async query => { reads.push(query); return [{ ...localEvent, id: 'local-fixture' }]; } } },
      functions: { invoke: async (name, body) => { calls.push({ name, body }); return { data: { listings: [] } }; } },
    },
    Link: 'a', MapPin: 'pin', Calendar: 'calendar', ArrowLeft: 'back', Ticket: 'ticket',
    ExternalLink: 'external', Plus: 'plus', ListingCard: 'listing', PurchaseDialog: 'purchase', Disclosure: 'details',
  });
  Detail();
  effects[0]();
  await loaded;
  cursor = 0;
  const tree = Detail();
  return { rendered: text(tree), tree, state, calls, reads };
}

test('Ticketmaster detail preserves local timing metadata and renders venue time or TBA without writes', async () => {
  for (const time_tba of [false, true]) {
    const { rendered, state, calls } = await renderDetail({ localEvent: { ...event, time_tba } });
    assert.match(rendered, time_tba ? /Date to be confirmed/ : /Thursday, October 1, 2026 · 7:00 PM MST/);
    assert.equal(state[0].event_start_utc, event.event_start_utc);
    assert.equal(state[0].venue_timezone, event.venue_timezone);
    assert.equal(state[0].time_tba, time_tba);
    assert.deepEqual(calls.map(call => call.name), ['getListingParticipantView']);
  }
});

const missingZoneEvent = {
  ...event, venue: 'The Rose Theatre', city: 'Phoenix', state: 'AZ',
  event_start_utc: undefined, date: '2026-10-03T22:00:00Z', venue_timezone: undefined,
};
const matchingRouterEvent = {
  ...missingZoneEvent, event_start_utc: '2026-10-03T15:00:00-07:00',
  venue_timezone: 'America/Phoenix',
};

test('existing Ticketmaster record uses the matching Events card zone only for display', async () => {
  for (const venue_timezone of [undefined, '', '  ']) {
    const localEvent = { ...missingZoneEvent, venue_timezone };
    const { rendered, state, calls, reads } = await renderDetail({ localEvent, passedEvent: matchingRouterEvent });
    assert.match(rendered, /Saturday, October 3, 2026 · 3:00 PM MST/);
    assert.doesNotMatch(rendered, /venue time unconfirmed/);
    assert.equal(state[0].venue_timezone, venue_timezone, 'router zone must not modify the stored event state');
    assert.equal(state[0].date, localEvent.date);
    assert.equal(state[0].event_start_utc, undefined);
    assert.deepEqual(reads.map(query => query.tm_id), ['fixture']);
    assert.deepEqual(calls.map(call => call.name), ['getListingParticipantView']);
    assert.equal(calls[0].body.event_id, 'local-fixture');
  }
  for (const field of ['date_tba', 'time_tba', 'no_specific_time']) {
    const { rendered, state } = await renderDetail({
      localEvent: { ...missingZoneEvent, [field]: true },
      passedEvent: { ...matchingRouterEvent, [field]: false },
    });
    assert.match(rendered, /Date to be confirmed/);
    assert.equal(state[0][field], true);
  }
  const { rendered } = await renderDetail({
    localEvent: { ...missingZoneEvent, venue_timezone: 'America/New_York' }, passedEvent: matchingRouterEvent,
  });
  assert.match(rendered, /Saturday, October 3, 2026 · 6:00 PM EDT/);
});

test('Ticketmaster detail rejects conflicting or unconfirmed router timezone donors', async () => {
  const cases = [
    { passedEvent: undefined },
    { tmId: 'different-route' },
    { localEvent: { ...missingZoneEvent, tm_id: 'different-local-event' } },
    ...[
      { tm_id: 'different-provider-event' }, { venue: 'Different theatre' }, { venue: '' },
      { city: 'New York' }, { state: 'NY' },
      { event_start_utc: '2026-10-04T22:00:00Z' },
      { event_start_utc: '2026-10-03T22:00:00' },
      { event_start_utc: undefined, date: undefined },
      { venue_timezone: 'Invalid/Zone' }, { venue_timezone: '' },
    ].map(patch => ({ passedEvent: { ...matchingRouterEvent, ...patch } })),
  ];
  for (const scenario of cases) {
    const { rendered, state, calls } = await renderDetail({
      localEvent: missingZoneEvent, passedEvent: matchingRouterEvent, ...scenario,
    });
    assert.match(rendered, /Saturday, October 3, 2026 · 10:00 PM UTC · venue time unconfirmed/);
    assert.equal(state[0].venue_timezone, undefined);
    assert.deepEqual(calls.map(call => call.name), ['getListingParticipantView']);
  }
});


test('native and provider details retain the originating list entry in their actual Back links', async () => {
  for (const [routeState, expected] of [
    [{discoveryReturnTo:'/events?browse=1&q=Fixture',discoveryReturnKey:'events-entry'}, '/events?browse=1&q=Fixture'],
    [{upgradesReturnTo:'/upgrades?view=live',upgradesReturnKey:'upgrade-entry'}, '/upgrades?view=live'],
  ]) {
    const wantedKey = routeState.discoveryReturnKey || routeState.upgradesReturnKey;
    const native = nodes(renderNative(event, Date.parse(event.event_start_utc)-1, routeState));
    const nativeBack = native.find(node => node?.type==='a' && node.props.className==='pg-event-back');
    assert.equal(nativeBack.props.to,expected);assert.equal(nativeBack.props.state.restoreDiscoveryEntry,wantedKey);
    const hubLinks = native.filter(node=>node?.type==='a' && node.props.to===`/upgrades/${event.id}`);
    assert.ok(hubLinks.length>0);for(const link of hubLinks)assert.equal(link.props.state,routeState);
    const provider = nodes((await renderDetail({routeState})).tree);
    const providerBack = provider.find(node=>node?.type==='a' && node.props.className==='pg-event-back');
    assert.equal(providerBack.props.to,expected);assert.equal(providerBack.props.state.restoreDiscoveryEntry,wantedKey);
  }
});
