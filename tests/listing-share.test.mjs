import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanShareText, getListingShareData, getListingShareUrl } from '../src/lib/listingShare.js';
import { createListingShareImage } from '../src/lib/listingShareImage.js';

const now = Date.parse('2026-10-01T12:00:00Z');
const listing = {
  id: 'listing-123', event_id: 'event-456', viewer_is_seller: true,
  status: 'active', proof_status: 'approved', reservation_state: 'available',
  is_demo_listing: false, listing_type: 'resale_ticket', listing_mode: 'standard',
  transfer_status: 'transfer_confirmed', quantity: 2, asking_price: 42.5,
  section: '118', row: 'C',
};
const event = {
  id: 'event-456', title: 'A night of live music', venue: 'The Great Hall',
  city: 'Phoenix', state: 'AZ', venue_timezone: 'America/Phoenix',
  event_start_utc: '2026-10-02T02:00:00Z', category: 'concert',
};
const project = (l = {}, e = {}) => getListingShareData({ ...listing, ...l }, { ...event, ...e }, now);

test('only the public export allowlist survives an overprivileged input', () => {
  const { data, reason } = project({
    seats: 'SECRET_SEATS', seller_email: 'SECRET_EMAIL', proof_url: 'SECRET_PROOF',
    ticket_file_url: 'SECRET_TICKET', reservation_token: 'SECRET_TOKEN', notes: 'SECRET_NOTES',
    transfer_verification_proof_url: 'SECRET_PRIVATE_ASSET', nested: { private: 'SECRET_NESTED' },
  }, { admin_transfer_notes: 'SECRET_ADMIN', image_url: 'SECRET_PROVIDER_IMAGE', venue_lat: 99 });
  assert.equal(reason, null);
  assert.deepEqual(Object.keys(data).sort(), ['city', 'dateLabel', 'id', 'isUpgrade', 'kindLabel', 'priceLabel', 'quantity', 'row', 'section', 'title', 'url', 'venue'].sort());
  assert.doesNotMatch(JSON.stringify(data), /SECRET|proof|email|token|image_url|latitude/);
  assert.equal(data.priceLabel, '$42.50');
});

test('canonical link uses one encoded ID, never the current host or input URL', () => {
  const { data } = project({ id: 'id/with?query=#hash', url: 'https://preview.example/?_preview_token=SECRET' });
  assert.equal(data.url, 'https://peanutgallery.store/listings/id%2Fwith%3Fquery%3D%23hash');
  for (const id of ['', '.', '..', ' space ', 'bad\nvalue', '\ud800', 'x'.repeat(201)]) assert.equal(getListingShareUrl(id), null);
});

test('seller authority is explicit and cannot be inferred from sensitive fields', () => {
  assert.equal(project({ viewer_is_seller: false, seller_email: 'same@example.com' }).data, null);
  assert.equal(project({ viewer_is_seller: undefined }).data, null);
  assert.equal(project({ viewer_is_seller: 'true' }).data, null);
});

test('single safe serializer and seller-list serializer approval flags both work', () => {
  assert.ok(project({ proof_status: undefined, is_verified: true }).data);
  assert.equal(project({ proof_status: 'pending_review', is_verified: false }).data, null);
  assert.equal(project({ proof_status: 'rejected' }).data, null);
});

test('inactive and unavailable listings are not advertised', () => {
  for (const status of ['sold', 'hidden', 'expired', 'cancelled', 'pending_payout_setup', 'pending_verification']) assert.equal(project({ status }).data, null, status);
  for (const reservation_state of ['reserved_for_you', 'reserved_by_other', undefined]) assert.equal(project({ reservation_state }).data, null);
  assert.equal(project({ hidden_reason: 'checkout_quarantine' }).data, null);
});

test('demo and unrelated event inputs cannot produce an export', () => {
  assert.equal(project({ is_demo_listing: true }).data, null);
  assert.equal(project({ is_demo_listing: undefined }).data, null);
  assert.equal(project({ inventory_source: 'pg_demo' }).data, null);
  assert.equal(project({}, { id: 'another-event' }).data, null);
  assert.equal(project({}, { is_beta_live: true }).data, null);
});

test('price and quantity require genuine positive numbers', () => {
  for (const asking_price of [0, -1, NaN, Infinity, '42', 2.009, 1e18]) assert.equal(project({ asking_price }).data, null, String(asking_price));
  for (const quantity of [0, -1, 1.5, '2', NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) assert.equal(project({ quantity }).data, null, String(quantity));
});

test('ended, undated and naive dates fail closed without a device timezone guess', () => {
  assert.equal(project({}, { status: 'ended' }).data, null);
  assert.equal(project({}, { event_start_utc: '2026-09-01T00:00:00Z' }).data, null);
  for (const event_start_utc of ['', 'not a date', '2026-10-02', '2026-10-02T19:00:00', '2027-02-31T19:00:00Z']) assert.equal(project({}, { event_start_utc }).data, null);
  assert.equal(getListingShareData(listing, event, NaN).data, null);
});

test('dates display in venue timezone rather than device timezone', () => {
  const { data } = project();
  assert.match(data.dateLabel, /Oct 1, 2026/);
  assert.match(data.dateLabel, /7:00 PM/);
  assert.match(data.dateLabel, /MST/);
  const ny = project({}, { venue_timezone: 'America/New_York' }).data;
  assert.match(ny.dateLabel, /10:00 PM/);
  assert.match(ny.dateLabel, /EDT/);
});

test('missing/invalid venue timezone is explicitly labeled UTC, never a state guess', () => {
  for (const venue_timezone of ['', 'Invalid/Timezone']) {
    const { data } = project({}, { venue_timezone, state: 'AZ' });
    assert.match(data.dateLabel, /Oct 2, 2026/);
    assert.match(data.dateLabel, /UTC/);
    assert.match(data.dateLabel, /venue time unconfirmed/);
  }
});

test('transfer closure and pending instant custody block sharing', () => {
  assert.equal(project({ transfer_status: 'transfer_disabled' }).data, null);
  assert.equal(project({}, { transfer_window_status: 'manually_verified_closed' }).data, null);
  assert.equal(project({}, { transfer_window_closes_at: '2026-10-01T10:00:00Z' }).data, null);
  assert.equal(project({ upgrade_window_closes_at: 'invalid' }).data, null);
  assert.equal(project({ listing_mode: 'instant', is_instant_ready: false }).data, null);
  assert.ok(project({ listing_mode: 'instant', is_instant_ready: true }).data);
});

test('existing stale/unconfirmed transfer warnings are not turned into new purchase policy', () => {
  for (const transfer_status of ['transfer_unconfirmed', 'transfer_expired']) assert.ok(project({ transfer_status, last_transfer_verification: '2026-09-30T12:00:00Z' }).data);
});

test('upgrade label is a separate upgrade, not an admission ticket', () => {
  const { data } = project({ listing_type: 'live_upgrade' });
  assert.equal(data.kindLabel, 'Seat upgrade');
  assert.equal(data.isUpgrade, true);
  assert.equal(project({ listing_type: 'affiliate' }).data, null);
});

test('display fields remove controls and cap long Unicode text', () => {
  const { data } = project({ section: 'A'.repeat(80), row: 'B'.repeat(50) }, { title: `Concert\n\u202e${'🎵'.repeat(200)}`, venue: 'Hall\t  East' });
  assert.equal(Array.from(data.title).length, 150);
  assert.equal(data.section.length, 32);
  assert.equal(data.row.length, 24);
  assert.equal(data.venue, 'Hall East');
  assert.doesNotMatch(data.title, /[\n\u202e]/);
  assert.equal(cleanShareText({ toString: () => 'private' }), '');
});

test('PNG export rejects noncanonical links before touching a canvas', async () => {
  const data = project().data;
  let canvasOpened = false;
  await assert.rejects(createListingShareImage({ ...data, url: 'https://attacker.example' }, 'square', { canvasFactory: () => { canvasOpened = true; } }), /link/);
  assert.equal(canvasOpened, false);
  await assert.rejects(createListingShareImage(data, 'unknown'), /square post or story/);
});
