/** Test-only SDK boundary: fictional data, no backend client and no network. */
const params = new URLSearchParams(window.location.search);
const scenario = ['populated', 'empty', 'provider-error', 'share-unavailable', 'auth-denied'].includes(params.get('scenario')) ? params.get('scenario') : 'populated';
const now = Date.now();
const iso = (minutes) => new Date(now + minutes * 60000).toISOString();
const artwork = new URL('./fixture-arena.svg', import.meta.url).href;
export const fixtureSignedIn = params.get('auth') !== 'guest';
export const fixtureUser = {
  id: 'fixture-user', email: 'reviewer@example.invalid', full_name: 'Alex Sample', role: params.get('page') === 'founder' ? 'admin' : 'user',
  has_seen_onboarding: true, has_seen_upgrades_onboarding: true,
  stripe_onboarding_complete: true, peanut_points: 240, avatar_url: artwork, banner_url: artwork,
};
const event = (id, title, minutes, category, extra = {}) => ({
  id, tm_id: `tm-${id}`, title, category, city: 'Phoenix', state: 'AZ', venue: 'Imaginary Arena',
  venue_timezone: 'America/Phoenix', date: iso(minutes), event_start_utc: iso(minutes),
  event_end_utc: iso(minutes + 240), duration_hours: 4,
  status: minutes < 0 ? 'live' : 'upcoming', latitude: 33.4484, longitude: -112.0740, venue_lat: 33.4484, venue_lng: -112.0740,
  image_url: artwork, hero_image_url: artwork, source: 'pg', created_date: iso(-1440), updated_date: iso(-3),
  search_text_normalized: `${title} imaginary arena phoenix az`.toLowerCase(), ...extra,
});
const events = [
  event('fixture-live', 'The Aurora Waves', -42, 'concert'),
  event('fixture-soon', 'Phoenix Comets vs Desert Foxes', 35, 'sports', { venue: 'Sample Field' }),
  event('fixture-night', 'Neon Orchard: After Hours', 360, 'concert'),
  event('fixture-weekend', 'The Paper Lanterns', 1440 * 3, 'concert', { venue: 'Fictional Garden Theater' }),
  event('fixture-comedy', 'Riley Sample: Just Kidding', 1440 * 5, 'comedy', { venue: 'Imaginary Comedy Hall' }),
];
const eventState = params.get('eventState');
if (['upcoming', 'soon-live', 'stale-live', 'ended'].includes(eventState)) {
  const start = { upcoming: 95, 'soon-live': 0.1, 'stale-live': -42, ended: -300 }[eventState];
  Object.assign(events[0], { date: iso(start), event_start_utc: iso(start), event_end_utc: iso(start + 240), status: 'upcoming' });
}
let watchEnabled = false;
let alertPreferences = { enabled: false, city_label: null, latitude: null, longitude: null, radius_miles: null, location_consent: false };
const serviceActive = params.get('alerts') !== 'paused';
const listing = (id, section, row, price, extra = {}) => ({
  id, event_id: 'fixture-live', event_title: 'The Aurora Waves', section, row, seats: '7–8', quantity: 2,
  asking_price: price, original_price: price + 45, listing_type: 'live_upgrade', tier: 'lower',
  status: 'active', is_verified: true, proof_status: 'approved', is_demo_listing: false, is_instant_ready: false, reservation_state: 'available',
  viewer_is_seller: false, transfer_status: 'transfer_confirmed', seller_email: 'fictional-seller@example.invalid',
  created_date: iso(-80), ...extra,
});
const listings = [
  listing('fixture-upgrade-one', '104', 'B', 38),
  listing('fixture-upgrade-two', 'Floor', 'G', 64, { tier: 'floor', original_price: 125 }),
  listing('fixture-upgrade-three', '116', 'D', 52),
  listing('fixture-owned', '308', 'K', 26, { status: 'sold', listing_type: 'admission_ticket', seller_email: 'earlier-seller@example.invalid' }),
  listing('fixture-seller-active', '210', 'E', 45, { event_id: 'fixture-night', event_title: 'Neon Orchard: After Hours', listing_type: 'resale_ticket', seller_email: fixtureUser.email, viewer_is_seller: true, proof_image_url: 'FICTIONAL_PRIVATE_PROOF_MUST_NOT_APPEAR', transfer_notes: 'FICTIONAL_PRIVATE_TRANSFER_MUST_NOT_APPEAR', ticket_barcode: 'FICTIONAL_PRIVATE_BARCODE_MUST_NOT_APPEAR' }),
  listing('fixture-seller-sold', '114', 'J', 70, { event_id: 'fixture-weekend', event_title: 'The Paper Lanterns', seller_email: fixtureUser.email, viewer_is_seller: true, status: 'sold' }),
  listing('fixture-seller-hidden', '208', 'H', 46, { event_id: 'fixture-night', event_title: 'Neon Orchard: After Hours', seller_email: fixtureUser.email, viewer_is_seller: true, status: 'hidden', hidden_reason: 'seller_paused' }),
];
const purchases = [
  { id: 'fixture-received', event_id: 'fixture-live', listing_id: 'fixture-owned', transfer_status: 'completed', seller_confirmed: true, buyer_confirmed: true, amount: 52, quantity: 2, created_date: iso(-1440) },
  { id: 'fixture-confirm', event_id: 'fixture-night', listing_id: 'fixture-seller-active', transfer_status: 'pending_transfer', seller_confirmed: true, buyer_confirmed: false, amount: 90, quantity: 2, created_date: iso(-150) },
  { id: 'fixture-waiting', event_id: 'fixture-weekend', listing_id: 'fixture-seller-sold', transfer_status: 'pending_transfer', seller_confirmed: false, buyer_confirmed: false, amount: 140, quantity: 2, created_date: iso(-90) },
  { id: 'fixture-disputed', event_id: 'fixture-comedy', listing_id: 'fixture-owned', transfer_status: 'disputed', seller_confirmed: true, buyer_confirmed: false, amount: 35, quantity: 1, created_date: iso(-180) },
];
const sales = [
  { id: 'fixture-sale-send', event_id: 'fixture-night', listing_id: 'fixture-seller-active', transfer_status: 'pending_transfer', seller_confirmed: false, buyer_confirmed: false, amount: 90, seller_payout: 80, quantity: 2, created_date: iso(-20) },
  { id: 'fixture-sale-awaiting', event_id: 'fixture-weekend', listing_id: 'fixture-seller-sold', transfer_status: 'pending_transfer', seller_confirmed: true, buyer_confirmed: false, amount: 140, seller_payout: 125, quantity: 2, created_date: iso(-60), seller_confirmed_at: iso(-55) },
  { id: 'fixture-sale-paid', event_id: 'fixture-live', listing_id: 'fixture-seller-sold', transfer_status: 'completed', seller_confirmed: true, buyer_confirmed: true, payment_captured: true, amount: 60, seller_payout: 54, platform_fee: 6, quantity: 2, created_date: iso(-1440), seller_confirmed_at: iso(-1437), updated_date: iso(-1435) },
  { id: 'fixture-sale-payout', event_id: 'fixture-weekend', listing_id: 'fixture-seller-sold', transfer_status: 'completed', seller_confirmed: true, buyer_confirmed: true, payment_captured: false, amount: 140, seller_payout: 125, platform_fee: 15, quantity: 2, created_date: iso(-180), seller_confirmed_at: iso(-177), updated_date: iso(-170) },
];
const navigationLogs = ['event_not_found', 'navigation_error', 'lookup_fallback_failed', 'success'].map((result, index) => ({
  id: `fixture-nav-${index}`, timestamp: iso(-index - 1), result, source_page: index % 2 ? 'Upgrades' : 'Events', event_id: 'fixture-live', event_title: 'The Aurora Waves', generated_href: '/upgrades/fixture-live', failure_reason: result === 'success' ? null : 'Fictional failure for visual review',
}));
const posts = [
  { id: 'fixture-post-1', author_email: 'morgan@example.invalid', author_name: 'Morgan Sample', event_id: 'fixture-live', event_title: 'The Aurora Waves', event_city: 'Phoenix', text: 'Fictional fan moment: the lights just came up. Who else is here tonight?', post_type: 'post', photo_url: artwork, created_date: iso(-8), updated_date: iso(-3), reactions: { fire: ['sample1@example.invalid','sample2@example.invalid','sample3@example.invalid'], eyes: ['sample4@example.invalid'], peanut: [] } },
  { id: 'fixture-post-2', author_email: 'jamie@example.invalid', author_name: 'Jamie Example', event_id: 'fixture-soon', event_title: 'Phoenix Comets vs Desert Foxes', event_city: 'Phoenix', text: 'Sample seat flex — moved a little closer for the opening pitch.', post_type: 'seat_flex', from_section: '312', from_row: 'M', to_section: '108', to_row: 'D', created_date: iso(-22), updated_date: iso(-5), reactions: { fire: ['sample5@example.invalid'], eyes: [], peanut: ['sample6@example.invalid'] } },
];
const drops = [{ id: 'fixture-drop', event_id: 'fixture-live', status: 'pending', section: '112', row: 'F', quantity: 2, scheduled_label: 'Sample gift at the next intermission' }];
export const fixture = window.ticketDesignFixture = {
  scenario, startedAt: new Date(now).toISOString(), calls: [], blocked: [], unexpected: [],
  events, listings, purchases, sales, posts, drops,
};
const copy = value => structuredClone(value);
const record = (name, params) => fixture.calls.push({ name, params, at: new Date().toISOString() });
const failure = (message, status = 503) => Object.assign(new Error(message), { status, response: { status, data: { error: message } } });
function blocked(name, params) {
  record(name, params); fixture.blocked.push(name);
  throw failure(`Visual review only: ${name} is blocked. No live action was performed.`, 403);
}
function unexpected(name, params) {
  record(name, params); fixture.unexpected.push(name);
  const error = failure(`Unexpected visual-review API: ${name}. Add an explicit fixture stub.`, 500);
  console.error(error.message); throw error;
}
function matches(row, query = {}) {
  return Object.entries(query).every(([key, value]) => {
    if (key === '$or') return value.some(q => matches(row, q));
    if (key === '$and') return value.every(q => matches(row, q));
    const actual = row[key];
    if (!value || typeof value !== 'object' || Array.isArray(value)) return actual === value;
    return Object.entries(value).every(([op, expected]) => {
      if (op === '$options') return true;
      if (op === '$regex') return new RegExp(expected, value.$options || '').test(String(actual || ''));
      if (op === '$gte') return actual >= expected;
      if (op === '$gt') return actual > expected;
      if (op === '$lte') return actual <= expected;
      if (op === '$lt') return actual < expected;
      if (op === '$ne') return actual !== expected;
      if (op === '$in') return expected.includes(actual);
      if (op === '$exists') return expected === (actual != null);
      return unexpected(`query operator ${op}`, value);
    });
  });
}
const rowsByEntity = {
  Event: events, Listing: listings, Purchase: [...purchases, ...sales], FanPost: posts, Notification: [], SeatDonation: [],
  BucketListItem: scenario === 'empty' ? [] : [{ id: 'fixture-bucket', user_email: fixtureUser.email, name: 'The Aurora Waves', type: 'attraction', tm_id: 'fixture-attraction' }],
  Follow: [{ id: 'fixture-follow', follower_email: fixtureUser.email, following_email: 'morgan@example.invalid' }],
  SeatInventory: [], FlashDropEntry: [],
  PointsActivity: [{ id: 'fixture-points', user_email: fixtureUser.email, reference_id: 'fixture-live', points: 100 }],
  EventNavigationLog: navigationLogs,
  AdminAlert: [{ id: 'fixture-alert', resolved: false, priority: 'critical', title: 'Fictional transfer review requires attention', created_date: iso(-25) }],
  TransferOutcome: [
    { id: 'fixture-outcome-ok', transfer_successful: true, minutes_to_transfer: 5, created_date: iso(-60) },
    { id: 'fixture-outcome-failed', transfer_successful: false, created_date: iso(-30) },
  ],
};
function read(entity, query = {}, sort, limit, offset = 0) {
  if (scenario === 'provider-error' && ['FanPost', 'Listing'].includes(entity)) throw failure(`Sample provider failure: ${entity}`);
  // Retain the event itself for an empty live-hub review, while collections are empty.
  const detailLookup = entity === 'Event' && (query.id || query.tm_id);
  let rows = scenario === 'empty' && !detailLookup && entity !== 'BucketListItem' ? [] : rowsByEntity[entity];
  rows = rows.filter(row => matches(row, query));
  if (sort) { const desc = sort.startsWith('-'); const field = desc ? sort.slice(1) : sort; rows = [...rows].sort((a,b) => String(a[field] || '').localeCompare(String(b[field] || '')) * (desc ? -1 : 1)); }
  return copy(rows.slice(offset, limit == null ? undefined : offset + limit));
}
const entities = new Proxy({}, { get(_, entity) {
  if (!(entity in rowsByEntity)) return new Proxy({}, { get: (_, method) => async (...args) => unexpected(`entities.${String(entity)}.${String(method)}`, args) });
  return new Proxy({}, { get(_, method) {
    const name = `entities.${entity}.${String(method)}`;
    if (method === 'filter') return async (query, sort, limit, offset) => { record(name, { query, sort, limit, offset }); return read(entity, query, sort, limit, offset); };
    if (method === 'list') return async (sort, limit, offset) => { record(name, { sort, limit, offset }); return read(entity, {}, sort, limit, offset); };
    if (method === 'subscribe' && entity === 'SeatDonation') return () => { record(name, {}); return () => {}; };
    if (method === 'create' && entity === 'EventNavigationLog') return async payload => { record(name, payload); return { id: 'fixture-log-only', ...payload }; };
    if (method === 'create' && entity === 'BucketListItem') return async payload => { record(name, payload); const saved = { id: `fixture-bucket-${rowsByEntity.BucketListItem.length}`, ...payload }; rowsByEntity.BucketListItem.push(saved); return copy(saved); };
    if (method === 'delete' && entity === 'BucketListItem') return async id => { record(name, id); rowsByEntity.BucketListItem = rowsByEntity.BucketListItem.filter(item => item.id !== id); return {}; };
    if (['create','update','delete','bulkCreate'].includes(method)) return async (...args) => blocked(name, args);
    return async (...args) => unexpected(name, args);
  } });
} });
const functions = { invoke: async (name, args = {}) => {
  record(`functions.${name}`, args);
  if (name === 'getTicketmasterEvents') {
    if (scenario === 'provider-error') throw failure('Sample Ticketmaster provider failure', 429);
    let result = scenario === 'empty' ? [] : events;
    if (args.keyword) result = result.filter(e => e.search_text_normalized.includes(args.keyword.toLowerCase()));
    if (args.city) result = result.filter(e => `${e.city}, ${e.state}`.toLowerCase().includes(args.city.toLowerCase()));
    const coverage = args.discoveryWindow === 'ongoing'
      ? { discoveryWindow: 'ongoing', lookbackHours: 12, limit: 40, startDateTime: iso(-720), endDateTime: iso(0), truncated: false }
      : { truncated: false };
    return { data: { events: copy(result), coverage } };
  }
  if (name === 'suggestCities') return { data: { cities: [{ city: 'Phoenix', state: 'AZ', label: 'Phoenix, AZ' }, { city: 'Boston', state: 'MA', label: 'Boston, MA' }].filter(c => c.label.toLowerCase().includes((args.keyword || '').toLowerCase())) } };
  if (['getPurchaseParticipantView','getListingParticipantView','getFlashDropView'].includes(name) && scenario === 'provider-error') throw failure(`Sample provider failure: ${name}`);
  if (name === 'getPurchaseParticipantView') return { data: { purchases: scenario === 'empty' ? [] : copy(purchases.filter(p => !args.event_id || p.event_id === args.event_id)), sales: scenario === 'empty' ? [] : copy(sales.filter(p => !args.event_id || p.event_id === args.event_id)) } };
  if (name === 'getListingParticipantView') {
    if (scenario === 'auth-denied') throw failure('FICTIONAL_AUTH_RESPONSE_MUST_NOT_APPEAR', 403);
    // Mimic a listing becoming unavailable between the seller list and fresh public read.
    const available = scenario !== 'empty' && scenario !== 'share-unavailable';
    if (args.listing_id) return { data: { listing: available ? copy(listings.find(l => l.id === args.listing_id) || null) : null } };
    if (args.action === 'list_mine') return { data: { listings: scenario === 'empty' ? [] : copy(listings.filter(l => l.seller_email === fixtureUser.email)) } };
    if (args.action === 'list_active_by_event') return { data: { listings: available ? copy(listings.filter(l => l.event_id === args.event_id && l.status === 'active')) : [] } };
    return unexpected(`functions.${name}.${args.action || 'missing-action'}`, args);
  }
  if (name === 'getFlashDropView') return { data: { drops: scenario === 'empty' ? [] : copy(drops), leaders: scenario === 'empty' ? [] : [{ name: 'A fictional fan', drops: 2 }] } };
  if (name === 'checkSellerOnboarding') return { data: { complete: true, details_submitted: true, charges_enabled: true, payouts_enabled: true } };
  if (name === 'tmSuggest') return { data: { attractions: [{ type: 'attraction', tm_id: 'fixture-attraction', name: 'The Aurora Waves', image_url: artwork, genre: 'Alternative' }], venues: [{ type: 'venue', tm_id: 'fixture-venue', name: 'Imaginary Arena', image_url: artwork }] } };
  if (name === 'manageDiscoveryAlerts') {
    if (params.get('alerts') === 'error') throw failure('Fictional alert service unavailable');
    if (args.action === 'get_event') return { data: { enabled: watchEnabled, service_active: serviceActive, supported: true } };
    if (args.action === 'set_event') { watchEnabled = args.enabled; return { data: { enabled: watchEnabled, service_active: serviceActive, supported: true } }; }
    if (args.action === 'get_preferences') return { data: { ...alertPreferences, service_active: serviceActive } };
    if (args.action === 'set_preferences') { const { action, ...prefs } = args; alertPreferences = prefs; return { data: { ...alertPreferences, service_active: serviceActive } }; }
    if (args.action === 'resolve_city') return { data: { city_label: `${args.city}, ${args.state}`, latitude: 33.45, longitude: -112.07, location_source: 'venue_area' } };
  }
  if (name === 'syncTMEvent') return { data: { id: events.find(e => e.tm_id === args.tm_id)?.id || null } };
  if (['getStripeKey','reserveListing','releaseReservation','createCheckout','abortCheckout','confirmCheckoutAuthorized','createDemoUpgrade','flashDrop','seatDonation','submitFeedback','onboardSeller','submitListing','deleteAccount'].includes(name)) return blocked(`functions.${name}`, args);
  return unexpected(`functions.${name}`, args);
} };
export const base44 = {
  entities, functions,
  auth: new Proxy({
    me: async () => { record('auth.me', {}); return fixtureSignedIn ? copy(fixtureUser) : null; },
    isAuthenticated: async () => fixtureSignedIn,
    updateMe: async args => blocked('auth.updateMe', args),
    logout: async () => blocked('auth.logout'),
    redirectToLogin: async () => blocked('auth.redirectToLogin'),
  }, { get: (target, method) => method in target ? target[method] : async (...args) => unexpected(`auth.${String(method)}`, args) }),
  integrations: { Core: new Proxy({}, { get: (_, method) => async (...args) => blocked(`integrations.Core.${String(method)}`, args) }) },
};
