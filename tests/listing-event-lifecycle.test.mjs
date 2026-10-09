import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { transform } from 'esbuild';
import { listingEventEligibility, checkListingEvent } from '../base44/shared/listingEventEligibility.js';
import { sellingEventTiming } from '../src/lib/sellingEventTiming.js';
import { authorizeListingCreation, deriveTestModeLabeling } from '../base44/shared/testModeAuth.js';

const start = Date.parse('2026-10-06T20:00:00Z');
const end = Date.parse('2026-10-06T21:00:00Z');
const event = { id: 'local-fixture', title: 'Fictional event', event_start_utc: new Date(start).toISOString(), event_end_utc: new Date(end).toISOString(), status: 'live' };
const h = (type, props, ...children) => ({ type, props: { ...props, children } });
const nodes = value => Array.isArray(value) ? value.flatMap(nodes) : value == null || value === false ? [] : [value, ...nodes(value.props?.children)];
const text = value => nodes(value).filter(value => typeof value === 'string').join(' ');
async function compile(file, globals, loader = 'jsx') {
  const source = (await readFile(new URL(file, import.meta.url), 'utf8')).replace(/^import .+\n/gm, '');
  const output = await transform(source, { loader, format: 'cjs', jsxFactory: 'h', jsxFragment: 'Fragment' });
  const module = { exports: {} };
  vm.runInNewContext(output.code, { module, exports: module.exports, h, Fragment: 'fragment', ...globals });
  return module.exports;
}

test('CTA and listing guard share explicit end boundaries with historical status/cancellation', async () => {
  const { default: CTA } = await compile('../src/components/eventmode/SellSeatsModule.jsx', { listingEventEligibility, Link: 'a', Tag: 'icon', ArrowRight: 'icon' });
  for (const now of [start - 1, start, end - 1, end, end + 1]) {
    assert.equal(listingEventEligibility(event, now).timing.status, sellingEventTiming(event, now).status);
    assert.equal(Boolean(CTA({ event, nowMs: now })), now < end);
  }
  for (const patch of [{ status: 'ended' }, { status: 'cancelled' }, { provider_status: 'canceled' }]) {
    assert.equal(listingEventEligibility({ ...event, ...patch }, start).allowed, false);
  }
  assert.equal(CTA({ event: null }), null, 'loading event cannot create an empty-ID link');
});

test('unknown timing is never made into an invented end; existing estimates remain bounded', () => {
  for (const patch of [{ event_start_utc: '2026-10-06T20:00:00' }, { date_tba: true }, { time_tba: true }, { no_specific_time: true }, { end_time_invalid: true }, { event_end_utc: 'invalid' }, { provider_status: 'postponed' }]) {
    const result = listingEventEligibility({ ...event, ...patch }, end + 86400000);
    assert.equal(result.allowed, true);
    assert.equal(result.timing.status, 'unknown');
    assert.equal(result.timing.end, null);
  }
  const estimate = listingEventEligibility({ ...event, event_end_utc: undefined }, start);
  assert.equal(estimate.timing.status, 'estimated_live');
  assert.equal(estimate.timing.estimatedHours, 4);
});

test('fresh pre-submit read detects stale ended data, missing records and failed reads without writes', async () => {
  let reads = 0;
  const client = { entities: { Event: { filter: async query => { reads++; assert.deepEqual(query, { id: event.id }); return [{ ...event, status: 'ended' }]; } } } };
  const current = await checkListingEvent(client, event.id, () => start);
  assert.equal(current.allowed, false);
  assert.equal(current.code, 'EVENT_ENDED');
  assert.equal(reads, 1);
  assert.equal((await checkListingEvent({ entities: { Event: { filter: async () => [] } } }, event.id)).code, 'EVENT_UNAVAILABLE');
  for (const result of [async () => { throw new Error('network'); }, async () => ({ malformed: true })]) {
    await assert.rejects(checkListingEvent({ entities: { Event: { filter: result } } }, event.id), /could not check/);
  }
});

async function listingForm({ read = async () => [event], now = start } = {}) {
  const states = [], refs = [];
  let cursor = 0, refCursor = 0, tree, writes = 0, reads = 0;
  const noop = () => {};
  const forbidden = () => { writes++; throw new Error('Mutation forbidden in fixture'); };
  const globals = {
    useState: initial => { const i = cursor++; if (!(i in states)) states[i] = initial; return [states[i], value => { states[i] = typeof value === 'function' ? value(states[i]) : value; }]; },
    useRef: initial => { const i = refCursor++; return refs[i] ||= { current: initial }; },
    useEffect: noop, useCallback: value => value, useUpgradeClock: () => now,
    useSearchParams: () => [new URLSearchParams()], isCanonicalEventId: value => Boolean(value),
    checkIsAdmin: () => false, listingEventEligibility, checkListingEvent,
    Date: { now: () => now }, MIN_LISTING_PRICE_CONFIG: { enabled: false }, formatFeeBreakdown: () => ({}), ACTIVE_FEE_MODEL_ID: 'fixture', FEE_MODELS: {},
    base44: { auth: { redirectToLogin: noop }, entities: { Event: { filter: async query => { reads++; return read(query); } }, Listing: { create: forbidden } }, functions: { invoke: forbidden }, analytics: { track: forbidden } },
  };
  for (const key of ['Link','ArrowLeft','ArrowRight','CheckCircle','Upload','Zap','Shield','InstantTransferAgreement','NotificationPermissionPrompt','SellerTransferAttestation','SellingEventPicker','SellingEventSummary','PageIntro','Disclosure']) globals[key] = key;
  const { default: Form } = await compile('../src/pages/CreateListing.jsx', globals);
  const render = () => { cursor = 0; refCursor = 0; tree = Form(); return tree; };
  const find = (type, predicate = () => true) => nodes(tree).find(node => node?.type === type && predicate(node));
  render();
  // useState index 6 is the authenticated user in this isolated hook fixture.
  const userIndex = 6;
  assert.equal(states[userIndex], null);
  states[userIndex] = { email: 'fixture@example.invalid', stripe_onboarding_complete: true };
  render();
  return { render, find, setNow(value) { now = value; }, get tree() { return tree; }, get writes() { return writes; }, get reads() { return reads; } };
}

test('direct ended form entry shows recovery/history and an open draft closes exactly at end', async () => {
  const app = await listingForm();
  app.find('SellingEventPicker').props.onSelect(event); app.render();
  assert.ok(app.find('section', node => node.props['aria-label'] === 'Seat details'));
  app.setNow(end); app.render();
  assert.ok(app.find('section', node => node.props['aria-label'] === 'Event listings closed'));
  assert.equal(app.find('section', node => node.props['aria-label'] === 'Seat details'), undefined);
  assert.equal(app.find('SellerTransferAttestation'), undefined, 'ended form cannot keep transfer/upload prompts active');
  assert.ok(app.find('Link', node => node.props.to === `/upgrades/${event.id}`));
  app.find('button', node => text(node) === 'Choose a current event').props.onClick(); app.render();
  assert.equal(app.find('div', node => node.props.hidden === false)?.props.hidden, false);
  app.find('SellingEventPicker').props.onSelect({ ...event, status: 'ended' }); app.render();
  assert.ok(app.find('section', node => node.props['aria-label'] === 'Event listings closed'));
  assert.equal(app.writes, 0);
});

test('stale open draft rereads before the submit callback and performs zero mutations for changed/failed events', async () => {
  for (const read of [async () => [{ ...event, status: 'ended' }], async () => { throw new Error('network'); }]) {
    const app = await listingForm({ read });
    app.find('SellingEventPicker').props.onSelect(event); app.render();
    // Drive navigation callbacks directly; never submit through a live SDK.
    app.find('button', node => text(node).includes('Price & review')).props.onClick(); app.render();
    await app.find('button', node => text(node).includes('List my tickets')).props.onClick(); app.render();
    assert.equal(app.reads, 1);
    assert.equal(app.writes, 0);
    assert.ok(app.find('p', node => node.props.role === 'alert'));
  }
});

test('actual submitListing endpoint rejects explicitly ended events and read failure before any write', async () => {
  for (const [read, expected] of [[async () => [{ ...event, status: 'ended' }], 409], [async () => [], 404], [async () => { throw new Error('offline'); }, 503]]) {
    let handler, writes = 0;
    const entity = name => ({
      filter: async () => { if (name === 'Event') return read(); if (name === 'User') return [{ stripe_onboarding_complete: true }]; if (name === 'SeatInventory') return []; throw new Error(`Unexpected ${name} read`); },
      create: async () => { writes++; throw new Error('Blocked'); }, update: async () => { writes++; throw new Error('Blocked'); },
    });
    const entities = new Proxy({}, { get: (_, name) => entity(name) });
    const client = { auth: { me: async () => ({ email: 'fixture@example.invalid', role: 'user' }) }, entities, asServiceRole: { entities } };
    await compile('../base44/functions/submitListing/entry.ts', { Deno: { serve: fn => { handler = fn; } }, createClientFromRequest: () => client, Response, authorizeListingCreation, deriveTestModeLabeling, checkListingEvent, isMaintenanceActive: () => false }, 'ts');
    const response = await handler({ json: async () => ({ event_id: event.id, section: '101', asking_price: 20 }) });
    assert.equal(response.status, expected);
    assert.equal(writes, 0);
  }
});
