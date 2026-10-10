import listingParticipantResponses from 'virtual:listing-participant-responses';
import { guardFixtureSdk } from '../../helpers/fixtureSdkGuard.js';
const query = new URLSearchParams(location.search);
const role = query.get('role') || 'seller';
export const fixture = window.purchaseReview = {
  calls: [], blocked: [], role, listingResponses: [],
  metadata: query.get('metadata') || 'populated',
  readFailure: query.get('readFailure') === '1',
  stripe: query.get('stripe') || 'missing-readiness',
  recordLoading: query.get('recordLoading') === '1',
};
const user = { id: `fixture-${role}`, email: `${role}@example.invalid`, full_name: 'Fixture participant', role: role === 'admin' ? 'admin' : 'user' };
const base = { listing_id: 'fixture-listing', event_id: 'fixture-event', amount: 15, seller_payout: 12, quantity: 2, transfer_status: 'completed', seller_confirmed: true, buyer_confirmed: true, payment_captured: true, created_date: '2026-10-09T12:00:00Z', seller_confirmed_at: '2026-10-09T13:00:00Z', buyer_email: 'buyer@example.invalid', seller_email: 'seller@example.invalid' };
if (query.get('pending') === '1') Object.assign(base, { transfer_status: 'pending_transfer', seller_confirmed: false, buyer_confirmed: false, seller_payout: null });
const purchases = [ { ...base, id: 'fixture-sale-aaaaaaaaaaaaaaaa' }, { ...base, id: 'fixture-sale-bbbbbbbbbbbbbbbb' } ];
const event = { id: 'fixture-event', title: 'Fictional Friday concert', venue: 'Fixture Hall', date: '2026-10-10T03:00:00Z', venue_timezone: 'America/Phoenix' };
const listing = { id: 'fixture-listing', event_id: event.id, status: 'sold', listing_type: 'resale_ticket', section: '101', row: 'B', seats: '7–8', quantity: 2, viewer_is_seller: role === 'seller' };
function deny(name) { window.__PG_RECORD_FIXTURE_BLOCK__?.({ kind: 'sdk', name }); fixture.blocked.push(name); throw new Error(`Forbidden fixture operation: ${name}`); }
function record(name, args) { fixture.calls.push({ name, args }); }
async function metadata(name, rows) {
  if (fixture.metadata === 'loading') await new Promise(resolve => { (fixture.releaseMetadata ||= []).push(resolve); });
  if (fixture.metadata === 'error' || fixture.metadata === `${name}-error`) throw new Error('Fixture metadata unavailable');
  return fixture.metadata === 'sparse' ? [] : rows;
}
const sdk = {
  auth: { me: async () => { record('auth.me'); return role === 'guest' ? null : user; }, redirectToLogin: () => deny('redirectToLogin') },
  entities: {
    Purchase: { filter: async ({ id }) => { record('Purchase.filter', { id }); if (fixture.readFailure) throw new Error('Fixture record unavailable'); return purchases.filter(row => row.id === id); } },
    Event: { filter: async args => { record('Event.filter', args); return metadata('event', [event]); } },
    Listing: { filter: async args => { record('Listing.filter', args); return metadata('listing', [listing]); } },
  },
  functions: { invoke: async (name, args) => {
    record(name, args);
    if (name === 'getPurchaseParticipantView') {
      if (fixture.recordLoading) await new Promise(resolve => { fixture.releaseRecord = resolve; });
      if (fixture.readFailure) throw { status: 503 };
      if (role === 'unauthorized') throw { status: 404 };
      const serialize = p => { const { buyer_email, seller_email, ...publicData } = p; return { ...publicData, viewer_is_seller: role === 'seller', viewer_is_buyer: role === 'buyer' }; };
      if (args.action === 'list_mine') return { data: { sales: (query.get('history') === 'mixed' ? [purchases[0], { ...purchases[1], seller_payout: null }, { ...purchases[0], id: 'fixture-demo', is_demo: true, seller_payout: 1000 }, { ...purchases[0], id: 'fixture-pending', transfer_status: 'pending_transfer', seller_payout: 1000 }] : purchases).map(serialize), purchases: [] } };
      const p = purchases.find(row => row.id === args.purchase_id);
      return { data: { purchase: p ? serialize(p) : null } };
    }
    if (name === 'getListingParticipantView') {
      const response = listingParticipantResponses[role][query.get('platform') || 'other'];
      if (response.status !== 200) throw { status: response.status };
      const rows = await metadata('listing', [response.body.listing]);
      const data = args.action === 'list_mine' ? { listings: rows } : { listing: rows[0] || null };
      fixture.listingResponses.push(data);
      return { data };
    }
    if (name === 'checkSellerOnboarding') {
      if (fixture.stripe === 'loading') await new Promise(resolve => { fixture.releaseStripe = resolve; });
      if (fixture.stripe === 'error') throw new Error('Fixture Stripe unavailable');
      return { data: fixture.stripe === 'disconnected' ? { complete: false, details_submitted: false, charges_enabled: false } : { details_submitted: true, charges_enabled: true } };
    }
    return deny(name);
  } },
  integrations: { Core: {} },
};
export const base44 = guardFixtureSdk(sdk, name => fixture.blocked.push(name));
