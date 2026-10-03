import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { transform } from 'esbuild';
import { getEventDateDisplay } from '../src/lib/eventDateDisplay.js';
import { reliableTime } from '../src/lib/sellingEventTiming.js';
import { getEventLiveStatus } from '../src/lib/eventTiming.js';
import { getEventUrl } from '../src/lib/eventUrl.js';

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
  getEventDateDisplay, getEventLiveStatus, getEventUrl, logNavEvent() {},
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
    assert.equal(rendered.find(node => node?.type === 'a').props['aria-label'], 'View Fixture show, Date to be announced');
  }
});

test('unavailable venue zones use explicitly labeled UTC without guessing from the state', () => {
  for (const venue_timezone of [undefined, '', 'Invalid/Zone']) {
    const display = getEventDateDisplay({ ...event, venue_timezone, state: 'AZ' });
    assert.equal(display.time, '2:00 AM UTC');
    assert.equal(display.day, '2');
    assert.match(display.label, /venue time unconfirmed$/);
    assert.match(display.detailLabel, /venue time unconfirmed$/);
  }
});

async function renderDetail({ localEvent = event, passedEvent, tmId = 'fixture' } = {}) {
  const source = (await readFile(new URL('../src/pages/EventDetailTM.jsx', import.meta.url), 'utf8')).replace(/^import .+\n/gm, '');
  const state = [];
  const effects = [];
  let cursor = 0;
  let finishLoading;
  const loaded = new Promise(resolve => { finishLoading = resolve; });
  const calls = [];
  const reads = [];
  const { default: Detail } = await compile(source, {
    getEventDateDisplay, reliableTime,
    console: { info() {}, warn() {}, error() {} },
    useParams: () => ({ tmId }), useNavigate: () => () => {}, useLocation: () => ({ state: { tmEvent: passedEvent } }),
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
  return { rendered: text(Detail()), state, calls, reads };
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
