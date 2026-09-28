import test from 'node:test';
import assert from 'node:assert/strict';
import { loadSharedListing, listingHandoffHref, sharedListingSelection } from '../src/lib/sharedListingDestination.js';
import { safeAuthReturn, authPageHref } from '../src/lib/brandedAuth.js';
import { TICKET_LISTING_TYPES, UPGRADE_LISTING_TYPES } from '../src/lib/listingTypes.js';

const now = Date.parse('2026-09-28T20:00:00Z');
const listing = {
  id: 'listing-exact', event_id: 'event-exact', section: '101', row: 'A', quantity: 2,
  asking_price: 50, status: 'active', is_verified: true, is_demo_listing: false,
  reservation_state: 'available', listing_type: 'resale_ticket', viewer_is_seller: true,
};
const event = { id: 'event-exact', title: 'Fictional future event', event_start_utc: '2026-12-17T20:00:00Z', venue_timezone: 'America/Phoenix', status: 'upcoming' };
function reads({ single = listing, publicListings = [listing], events = [event], failure = null } = {}) {
  const calls = [];
  return {
    calls,
    invoke: async (name, body) => {
      calls.push([name, body]);
      if (failure) throw failure;
      assert.equal(name, 'getListingParticipantView');
      return { data: body.listing_id ? { listing: single } : { listings: publicListings } };
    },
    filterEvents: async query => { calls.push(['Event.filter', query]); return events; },
  };
}

test('exact public record is independently checked before event lookup; no writes or entity Listing access', async () => {
  const client = reads();
  const result = await loadSharedListing(client, listing.id, now);
  assert.equal(result.status, 'available');
  assert.equal(result.listing.id, listing.id);
  assert.equal(result.event.id, event.id);
  assert.deepEqual(client.calls, [
    ['getListingParticipantView', { listing_id: listing.id }],
    ['getListingParticipantView', { action: 'list_active_by_event', event_id: event.id }],
    ['Event.filter', { id: event.id }],
  ]);
});

test('owner/admin response does not expose seat numbers, identity, proof, token, or extra event data', async () => {
  const extra = { ...listing, seats: '7,8', seller_email: 'private@example.invalid', proof_url: 'private', reservation_token: 'private', unknown_future_private_field: 'private' };
  const result = await loadSharedListing(reads({ single: extra, publicListings: [extra], events: [{ ...event, admin_notes: 'private' }] }), listing.id, now);
  assert.equal(result.status, 'available');
  assert.equal(result.listing.viewer_is_seller, true);
  assert.equal(JSON.stringify(result).includes('private'), false);
  assert.equal('seats' in result.listing, false);
});

test('privileged single record omitted by public fail-closed gates stays unavailable', async () => {
  const result = await loadSharedListing(reads({ publicListings: [] }), listing.id, now);
  assert.deepEqual(result, { status: 'unavailable' });
});

test('public-list cap or different same-event listing cannot silently substitute another ticket', async () => {
  const other = { ...listing, id: 'other-listing' };
  assert.deepEqual(await loadSharedListing(reads({ publicListings: [other] }), listing.id, now), { status: 'unavailable' });
  assert.deepEqual(await loadSharedListing(reads({ single: other }), listing.id, now), { status: 'unavailable' });
});

test('sold, unreviewed, demo, reserved, unavailable-transfer and invalid-price listings do not get a public share', async () => {
  for (const change of [
    { status: 'sold' }, { status: 'hidden' }, { status: 'draft' }, { is_verified: false },
    { is_demo_listing: true }, { reservation_state: 'reserved_by_other' }, { reservation_state: 'reserved_for_you' },
    { transfer_status: 'transfer_disabled' }, { asking_price: NaN }, { asking_price: 0 }, { quantity: 0 }, { listing_type: 'unknown' },
    { listing_mode: 'instant', is_instant_ready: false },
  ]) {
    const value = { ...listing, ...change };
    assert.deepEqual(await loadSharedListing(reads({ single: value, publicListings: [value] }), listing.id, now), { status: 'unavailable' }, JSON.stringify(change));
  }
});

test('listing changing between reads or event mismatch cannot pass the second check', async () => {
  for (const change of [{ status: 'sold' }, { reservation_state: 'reserved_by_other' }, { event_id: 'wrong-event' }]) {
    assert.deepEqual(await loadSharedListing(reads({ publicListings: [{ ...listing, ...change }] }), listing.id, now), { status: 'unavailable' });
  }
  assert.deepEqual(await loadSharedListing(reads({ events: [{ ...event, id: 'wrong-event' }] }), listing.id, now), { status: 'unavailable' });
});

test('ended and synthetic demo events are unavailable even when a listing remains active', async () => {
  for (const change of [{ status: 'ended' }, { event_start_utc: '2026-01-01T12:00:00Z' }, { is_demo: true }, { is_beta_live: true }]) {
    assert.deepEqual(await loadSharedListing(reads({ events: [{ ...event, ...change }] }), listing.id, now), { status: 'unavailable' });
  }
});

test('missing, impossible and zone-ambiguous times cannot advertise a current listing', async () => {
  for (const value of [undefined, 'not-a-date', '2027-02-30T20:00:00Z', '2026-12-17T20:00:00']) {
    assert.deepEqual(await loadSharedListing(reads({ events: [{ ...event, event_start_utc: value }] }), listing.id, now), { status: 'unavailable' });
  }
});

test('closed or invalid advertised transfer windows are unavailable and instant-ready metadata survives', async () => {
  for (const change of [{ transfer_window_status: 'closed' }, { transfer_window_status: 'manually_verified_closed' }, { transfer_window_closes_at: '2026-09-28T19:00:00Z' }, { transfer_window_closes_at: 'invalid' }]) {
    assert.deepEqual(await loadSharedListing(reads({ events: [{ ...event, ...change }] }), listing.id, now), { status: 'unavailable' });
  }
  const ready = { ...listing, listing_mode: 'instant', is_instant_ready: true };
  const result = await loadSharedListing(reads({ single: ready, publicListings: [ready] }), listing.id, now);
  assert.equal(result.listing.listing_mode, 'instant');
  assert.equal(result.listing.is_instant_ready, true);
});

test('unavailable HTTP responses and operational failures are distinct and never include provider errors', async () => {
  for (const status of [400, 401, 403, 404]) {
    assert.deepEqual(await loadSharedListing(reads({ failure: { response: { status, data: { secret: 'private' } } } }), listing.id, now), { status: 'unavailable' });
  }
  for (const failure of [new Error('sensitive transport details'), { response: { status: 500 } }]) {
    assert.deepEqual(await loadSharedListing(reads({ failure }), listing.id, now), { status: 'error' });
  }
  assert.deepEqual(await loadSharedListing(reads({ publicListings: null }), listing.id, now), { status: 'error' });
});

test('malformed identifier makes no remote call', async () => {
  for (const value of ['', ' ', 'a'.repeat(201), 'id\n', null]) {
    const client = reads();
    assert.deepEqual(await loadSharedListing(client, value, now), { status: 'unavailable' });
    assert.equal(client.calls.length, 0);
  }
});

test('handoff and existing branded sign-in keep the exact encoded listing and correct marketplace', () => {
  const ticket = { ...listing, id: 'listing+a&b', event_id: 'event/encoded' };
  const href = listingHandoffHref(ticket);
  assert.equal(href, '/events/event%2Fencoded?listing=listing%2Ba%26b');
  assert.equal(new URLSearchParams(authPageHref('/login', href).split('?')[1]).get('from_url'), href);
  assert.equal(safeAuthReturn(href, 'https://peanutgallery.store'), href);
  assert.equal(listingHandoffHref({ ...listing, listing_type: 'live_upgrade' }), '/upgrades/event-exact?listing=listing-exact');
  assert.equal(listingHandoffHref({ ...listing, listing_type: 'unknown' }), null);
});

test('targeted route limits the existing feed to its exact verified ticket', () => {
  const other = { ...listing, id: 'other', asking_price: 10 };
  const selection = sharedListingSelection([other, listing], event, '?listing=listing-exact', TICKET_LISTING_TYPES, now);
  assert.deepEqual(selection, { requested: true, listings: [listing] });
  assert.deepEqual(sharedListingSelection([other, listing], event, '', TICKET_LISTING_TYPES, now), { requested: false, listings: [other, listing] });
});

test('missing, ambiguous, changed or wrong-kind targets stay empty instead of opening an alternative', () => {
  for (const query of ['?listing=missing', '?listing=', '?listing=listing-exact&listing=other']) {
    assert.deepEqual(sharedListingSelection([listing], event, query, TICKET_LISTING_TYPES, now), { requested: true, listings: [] });
  }
  assert.deepEqual(sharedListingSelection([listing], event, '?listing=listing-exact', UPGRADE_LISTING_TYPES, now), { requested: true, listings: [] });
  assert.deepEqual(sharedListingSelection([{ ...listing, status: 'sold' }], event, '?listing=listing-exact', TICKET_LISTING_TYPES, now), { requested: true, listings: [] });
});
