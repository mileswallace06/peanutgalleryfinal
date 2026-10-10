import test from 'node:test';
import assert from 'node:assert/strict';
import { dedupeEventIdentities, eventIdentityKeys, eventIdentityLabel, markEventIdentityAmbiguity, resolveEventAlias } from '../src/lib/eventIdentity.js';
import { eventChoiceLabel, eventOccurrenceLabel } from '../src/lib/eventChoiceLabel.js';
import { fanEventChoices, fanEventHasTicket } from '../src/components/fanzone/fanEventChoice.js';
import { getEventUrl } from '../src/lib/eventUrl.js';
import { identityEvents } from './fixtures/event-identity/catalog.mjs';

const now = Date.parse('2026-10-09T20:00:00Z');
const base = { id: 'fixture-a', tm_id: 'provider-a', title: 'Same display title', venue: 'Same Venue', tm_venue_id: 'venue-a', city: 'Phoenix', state: 'AZ', date: '2026-10-06T22:00:00Z' };

test('matching title venue and exact instant are ambiguity evidence, never alias proof', () => {
  const result = dedupeEventIdentities([base, { ...base, id: 'fixture-b', tm_id: 'provider-b' }]);
  assert.equal(result.length, 2);
  assert.ok(result.every(event => event._identityAmbiguous));
  assert.ok(result.every(event => /Identity unconfirmed/.test(eventIdentityLabel(event))));
  assert.equal(new Set(result.map(eventIdentityLabel)).size, 2);
  assert.ok(eventIdentityKeys(base).every(key => !key.startsWith('occurrence:')));
});

test('exact provider copies and explicitly verified aliases collapse with every old reference retained', () => {
  for (const patch of [{ tm_id: 'provider-a' }, { tm_id: 'provider-b', provider_aliases_verified: true, provider_aliases: ['provider-a'] }]) {
    const rows = [base, { ...base, ...patch, id: 'fixture-b' }];
    for (const order of [rows, [...rows].reverse()]) {
      const result = dedupeEventIdentities(order);
      assert.equal(result.length, 1); assert.equal(result[0].id, base.id);
      for (const row of rows) {
        assert.equal(resolveEventAlias(result, row.id), result[0]);
        assert.equal(resolveEventAlias(result, `tm_${row.tm_id}`), result[0]);
        assert.equal(getEventUrl(row), `/events/${row.id}`);
      }
    }
  }
  const [verified] = dedupeEventIdentities([{ ...base, provider_aliases_verified: true, provider_aliases: ['retired-provider'] }]);
  assert.equal(resolveEventAlias([verified], 'tm_retired-provider'), verified);
  assert.equal(base._eventAliases, undefined);
});

test('unverified aliases, conflicting occurrences and conflicting provider venues stay separate', () => {
  for (const patch of [
    { tm_id: 'provider-b', provider_aliases: ['provider-a'] },
    { date: '2026-10-07T22:00:00Z' },
    { tm_venue_id: 'other-venue' },
  ]) assert.equal(dedupeEventIdentities([base, { ...base, ...patch, id: 'fixture-b' }]).length, 2);
});

test('observed Knocked Loose metadata shape retains both records and labels actual provider pages', () => {
  const rows = dedupeEventIdentities([
    { ...base, tm_id: 'fixture-axs-provider', tm_url: 'https://www.axs.com/events/fixture', tm_venue_id: 'fixture-axs-venue' },
    { ...base, id: 'fixture-b', tm_id: 'fixture-tm-provider', tm_url: 'https://www.ticketmaster.com/event/fixture', tm_venue_id: 'fixture-tm-venue' },
  ]);
  assert.equal(rows.length, 2);
  assert.match(eventIdentityLabel(rows[0]), /AXS event page.*Identity unconfirmed.*Event reference fixture-a/);
  assert.match(eventIdentityLabel(rows[1]), /Ticketmaster event page.*Identity unconfirmed.*Event reference fixture-b/);
  assert.doesNotMatch(eventIdentityLabel({ ...base, tm_url: 'https://ticketmaster.com.evil.invalid/event' }), /Ticketmaster event page/);
});

test('recurring dates and same-name sessions stay distinguishable without invented labels', () => {
  for (const name of ['Fixture Recurring Show', 'Fixture Session Show']) {
    const rows = fanEventChoices(identityEvents, name);
    assert.equal(rows.length, 2);
    assert.equal(new Set(rows.map(event => eventChoiceLabel(event, now))).size, 2);
    assert.ok(rows.every(event => !event._identityAmbiguous));
  }
  const recurring = fanEventChoices(identityEvents, 'Fixture Recurring Show');
  assert.match(eventChoiceLabel(recurring[0], now), /May 7, 2026, 6:00 PM PDT/);
});

test('same-provider separately owned inventory survives all orders with its original routes and counts', () => {
  const inventory = identityEvents.filter(event => event.title === 'Fixture Inventory Show');
  const copy = { ...inventory[0], id: 'tm_fixture-inventory-provider', listing_count: undefined, inventory_id: undefined };
  for (const rows of [[...inventory, copy], [copy, ...inventory], [...inventory].reverse()]) {
    const result = dedupeEventIdentities(rows);
    assert.equal(result.length, 2);
    assert.deepEqual(result.map(row => row.listing_count).sort(), [2, 3]);
    assert.equal(new Set(result.map(row => eventIdentityLabel(row))).size, 2);
    for (const row of inventory) assert.equal(resolveEventAlias(result, row.id).inventory_id, row.inventory_id);
    assert.equal(resolveEventAlias(result, 'tm_fixture-inventory-provider'), null);
  }
});

test('missing timing and venue metadata are explicit and never use the viewer zone', () => {
  const sparse = identityEvents.find(event => event.id === 'fixture-sparse');
  assert.match(eventChoiceLabel(sparse, now), /Venue unconfirmed.*Date and time to be confirmed.*Timing unconfirmed.*Occurrence unconfirmed.*Event reference fixture-sparse/);
  for (const venue_timezone of [undefined, 'Invalid/Zone']) {
    assert.match(eventOccurrenceLabel({ ...base, venue_timezone }, now), /10:00 PM UTC · venue time unconfirmed/);
  }
});

test('composer retained sparse duplicates stay individually searchable by exact event reference', () => {
  for (const [query, count] of [['Fixture Hail', 2], ['Fixture Diamondbacks', 3]]) {
    const rows = fanEventChoices(identityEvents, query);
    assert.equal(rows.length, count);
    assert.equal(new Set(rows.map(row => eventChoiceLabel(row, now))).size, count);
    for (const row of rows) assert.deepEqual(fanEventChoices(identityEvents, row.id).map(event => event.id), [row.id]);
  }
  const aliases = fanEventChoices(identityEvents, 'Fixture Provider Alias');
  assert.equal(aliases.length, 1); assert.equal(fanEventHasTicket(aliases[0], ['fixture-alias-b']), true);
});

test('admin context retains exact action targets even when display aliases could collapse', () => {
  const choices = markEventIdentityAmbiguity(identityEvents);
  assert.equal(choices.length, identityEvents.length);
  const labels = choices.map(event => eventChoiceLabel(event, now, { alwaysReference: true }));
  assert.equal(new Set(labels).size, choices.length);
  for (const [index, event] of choices.entries()) assert.ok(labels[index].includes(`Event reference ${event.id}`));
  assert.equal(choices.filter(event => event.title === 'Fixture Provider Alias').length, 2);
});

test('complete unique discovery cards avoid event-reference clutter', () => {
  const [event] = dedupeEventIdentities([base]);
  assert.equal(eventIdentityLabel(event), '');
  assert.match(eventIdentityLabel(event, { alwaysReference: true }), /Event reference fixture-a/);
});
