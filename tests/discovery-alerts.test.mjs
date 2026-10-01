import test from 'node:test';
import assert from 'node:assert/strict';
import {
  manageDiscoveryAlerts, discoveryWorkerAuthorized, scanDiscoveryRows, validateDiscoveryPreferences,
  confirmedCachedEvent, bucketMatchesCachedEvent, discoveryDistanceMiles, processDiscoveryAlerts,
  deliverDiscoveryNotification, upgradeAlertEligible,
} from '../base44/shared/discoveryAlerts.js';
import { providerDiscoverySnapshot, cacheProviderDiscoveryEvents, resolveDiscoveryCityArea } from '../base44/shared/discoveryEventCache.js';
const NOW = Date.parse('2026-10-01T18:00:00Z');
const iso = delta => new Date(NOW + delta).toISOString();
const user = { id: 'u1', email: 'fan@example.test' };
const cached = () => ({ id: 'c1', tm_id: 'tm1', title: 'Test show', venue: 'Test venue', city: 'Phoenix',
  tm_venue_id: 'v1', attraction_ids: ['a1'], venue_lat: 33.45, venue_lng: -112.07,
  event_start_utc: iso(3600000), provider_status: 'onsale', fetched_at: iso(-1000) });
const event = () => ({ id: 'e1', tm_id: 'tm1', title: 'Test show', status: 'upcoming' });
const listing = () => ({ id: 'l1', event_id: 'e1', status: 'active', listing_type: 'live_upgrade',
  quantity: 2, asking_price: 15, reservation_mirror_state: 'available', reservation_version: 1 });
const privateListing = () => ({ id: 'p1', listing_id: 'l1', event_id: 'e1', seller_email: 'seller@example.test',
  proof_status: 'approved', is_demo_listing: false, reservation_lifecycle_state: 'available', reservation_version: 1, pending_effects_json: '[]' });
function matches(row, query) {
  return Object.entries(query).every(([key, value]) => {
    if (key === '$and') return value.every(part => matches(row, part));
    if (value && typeof value === 'object') return Object.entries(value).every(([op, v]) => op === '$gt' ? row[key] > v : op === '$gte' ? row[key] >= v : op === '$in' ? v.includes(row[key]) : false);
    return row[key] === value;
  });
}
function entity(seed = []) {
  const rows = structuredClone(seed);
  let count = 0;
  return { rows, async filter(query, _sort, limit = 100) {
    return structuredClone(rows.filter(row => matches(row, query)).sort((a,b) => a.id.localeCompare(b.id)).slice(0, limit));
  }, async create(row) { const result = { ...structuredClone(row), id: `new${String(++count).padStart(5,'0')}` }; rows.push(result); return structuredClone(result); },
  async update(id, patch) { const row = rows.find(row => row.id === id); assert.ok(row); Object.assign(row, structuredClone(patch)); return structuredClone(row); } };
}
function store(overrides = {}) {
  const names = ['DiscoveryAlertSubscription','DiscoveryAlertPreference','BucketListItem','DiscoveryEventCache','User','Event','Listing','ListingPrivate','Notification'];
  return Object.fromEntries(names.map(name => [name, entity(overrides[name] || [])]));
}
function ready() {
  return store({ User: [user], Event: [event()], Listing: [listing()], ListingPrivate: [privateListing()], DiscoveryEventCache: [cached()],
    DiscoveryAlertSubscription: [{ id: 'w1', user_id: user.id, user_email: user.email, event_id: 'e1', enabled: true }],
    DiscoveryAlertPreference: [{ id: 'pref1', user_id: user.id, user_email: user.email, enabled: true, location_consent: true, city_label: 'Phoenix venue area', latitude: 33.45, longitude: -112.07, radius_miles: 25 }],
    BucketListItem: [{ id: 'b1', user_email: user.email, type: 'attraction', tm_id: 'a1' }] });
}
test('authenticated identity controls watches and preferences; body recipients cannot override it', async () => {
  const entities = ready();
  await assert.rejects(manageDiscoveryAlerts({ entities, user: null }, { action: 'set_event', event_id: 'e1', enabled: true }), /unauthorized/);
  await manageDiscoveryAlerts({ entities, user, now: () => NOW }, { action: 'set_event', event_id: 'e1', enabled: true, user_id: 'victim', user_email: 'victim@example.test' });
  assert.equal(entities.DiscoveryAlertSubscription.rows[0].user_id, user.id);
  assert.equal(entities.DiscoveryAlertSubscription.rows[0].user_email, user.email);
  await manageDiscoveryAlerts({ entities, user, now: () => NOW }, { action: 'set_event', event_id: 'e1', enabled: false });
  assert.deepEqual(await manageDiscoveryAlerts({ entities, user }, { action: 'get_event', event_id: 'e1' }), { enabled: false, supported: true });
  await assert.rejects(manageDiscoveryAlerts({ entities, user }, { action: 'set_event', event_id: '../e1', enabled: true }), /invalid_event_request/);
  await assert.rejects(manageDiscoveryAlerts({ entities, user }, { action: 'set_event', event_id: 'missing', enabled: true }), /event_unavailable/);
});
test('venue-only prefs require no location; revocation erases location and precision is coarse', async () => {
  assert.deepEqual(validateDiscoveryPreferences({ enabled: true, location_consent: false, latitude: 12 }),
    { enabled: true, location_consent: false, city_label: null, latitude: null, longitude: null, radius_miles: null });
  const preference = validateDiscoveryPreferences({ enabled: true, location_consent: true, latitude: 33.45111, longitude: -112.07444, city_label: 'Phoenix venue area', radius_miles: 25 });
  assert.equal(preference.latitude, 33.45); assert.equal(preference.longitude, -112.07);
  for (const patch of [{ latitude: null }, { latitude: 91 }, { longitude: Infinity }, { radius_miles: 999 }, { city_label: '' }]) {
    assert.throws(() => validateDiscoveryPreferences({ ...preference, ...patch }), /select_city_and_radius/);
  }
  const entities = ready();
  await manageDiscoveryAlerts({ entities, user }, { action: 'set_preferences', enabled: false, location_consent: false });
  assert.equal(entities.DiscoveryAlertPreference.rows[0].latitude, null);
});
test('worker auth fails closed for anonymous, user, spoofed or missing secrets', async () => {
  const secret = 'x'.repeat(40);
  assert.equal(await discoveryWorkerAuthorized({ user: { role:'admin' } }), true);
  for (const args of [{}, { user }, { providedSecret: secret }, { configuredSecret: secret }, { user, configuredSecret: secret, providedSecret: secret }, { configuredSecret: secret, providedSecret: 'y'.repeat(40) }]) {
    assert.equal(await discoveryWorkerAuthorized(args), false);
  }
  assert.equal(await discoveryWorkerAuthorized({ configuredSecret: secret, providedSecret: secret }), true);
});
test('cached events need fresh onsale provider data and unambiguous future times', () => {
  assert.equal(confirmedCachedEvent(cached(), NOW), true);
  for (const patch of [{event_start_utc: iso(0)}, {event_start_utc: '2026-10-02T12:00:00'}, {event_start_utc:'2026-02-30T12:00:00Z'}, {fetched_at:iso(-6*3600000-1)}, {fetched_at:iso(1)}, {provider_status:'cancelled'}, {provider_status:'postponed'}, {provider_status:'offsale'}, {date_tba:true}, {time_tba:true}, {no_specific_time:true}]) {
    assert.equal(confirmedCachedEvent({ ...cached(), ...patch }, NOW), false, JSON.stringify(patch));
  }
  assert.equal(confirmedCachedEvent({ ...cached(), event_start_utc: iso(-3600000) }, NOW, {futureOnly:false}), true);
  assert.equal(confirmedCachedEvent({ ...cached(), event_start_utc: iso(-5*3600000) }, NOW, {futureOnly:false}), false);
});
test('attractions use selected radius and consent while a stable venue ID needs neither', () => {
  const prefs = { enabled:true, location_consent:true, latitude:33.45, longitude:-112.07, radius_miles:25 };
  const attraction = {type:'attraction',tm_id:'a1'};
  assert.equal(bucketMatchesCachedEvent(attraction, prefs, cached(), NOW), true);
  assert.equal(bucketMatchesCachedEvent(attraction, {...prefs,location_consent:false}, cached(), NOW), false);
  assert.equal(bucketMatchesCachedEvent(attraction, {...prefs,latitude:0,longitude:0}, cached(), NOW), false);
  assert.equal(bucketMatchesCachedEvent(attraction, prefs, {...cached(),venue_lat:null}, NOW), false);
  assert.equal(bucketMatchesCachedEvent({type:'venue',tm_id:'v1'}, {enabled:true}, cached(), NOW), true);
  assert.equal(bucketMatchesCachedEvent({type:'venue',tm_id:'different'}, {enabled:true}, cached(), NOW), false);
  assert.equal(discoveryDistanceMiles(0,0,0,0),0);
  assert.equal(discoveryDistanceMiles(null,0,0,0),Infinity);
});
test('pagination reads beyond first page, fails loudly on cap or ignored cursor', async () => {
  const data = entity(Array.from({length:9}, (_,i) => ({id:`r${i}`})));
  assert.equal((await scanDiscoveryRows(data, {}, {pageSize:3,maxRows:10})).length,9);
  await assert.rejects(scanDiscoveryRows(data, {}, {pageSize:3,maxRows:8}),/scan_limit_exceeded/);
  await assert.rejects(scanDiscoveryRows({ filter:async () => [{id:'a'},{id:'b'}] }, {}, {pageSize:2}),/scan_cursor_not_supported/);
});
test('upgrade safety respects open/close boundaries, private eligibility and quantity', () => {
  const ok = (l = {}, p = {}, e = {}) => upgradeAlertEligible({...listing(),...l},[{...privateListing(),...p}],{...event(),...e},cached(),user.email,NOW);
  assert.equal(ok(),true);
  assert.equal(ok({upgrade_window_opens_at:iso(1)}),false);
  assert.equal(ok({upgrade_window_opens_at:iso(0),upgrade_window_closes_at:iso(1)}),true);
  assert.equal(ok({upgrade_window_closes_at:iso(0)}),false);
  for (const patch of [{quantity:0},{quantity:1.5},{asking_price:0},{status:'sold'},{listing_type:'resale_ticket'},{reservation_mirror_state:'frozen'},{reservation_version:2},{notes:'[TEST]'},{reservation_token:'stale'},{upgrade_window_closes_at:'bad'}]) assert.equal(ok(patch),false,JSON.stringify(patch));
  for (const patch of [{proof_status:'pending_review'},{is_demo_listing:true},{checkout_quarantined:true},{seller_pause_requested_at:iso(0)},{reservation_lifecycle_state:'reserved'},{reserved_by_email:user.email},{pending_effects_json:'[{}]'},{quantity:1},{seller_email:user.email}]) assert.equal(ok({},patch),false,JSON.stringify(patch));
  assert.equal(ok({}, {}, {transfer_window_status:'closed'}),false);
  assert.equal(upgradeAlertEligible(listing(),[],event(),cached(),user.email,NOW),false);
});
test('worker delivers in-app matches once per user/event across retries, preserves read', async () => {
  const entities = ready();
  const result = await processDiscoveryAlerts({ entities, now: () => NOW });
  assert.equal(result.channel,'in_app'); assert.equal(result.matched,2);
  assert.equal(entities.Notification.rows.length,2);
  assert.deepEqual(new Set(entities.Notification.rows.map(row => row.type)),new Set(['upgrade_available','bucket_list_event']));
  entities.Notification.rows[0].read = true;
  await processDiscoveryAlerts({ entities, now: () => NOW + 1000 });
  assert.equal(entities.Notification.rows.length,2); assert.equal(entities.Notification.rows[0].read,true);
  assert.ok(entities.Notification.rows.every(row => row.dispatch_status === 'dispatched' && row.user_email === user.email));
});
test('optouts, removed follows and deleted users create no notifications', async () => {
  const entities = ready();
  entities.DiscoveryAlertSubscription.rows[0].enabled = false;
  entities.DiscoveryAlertPreference.rows[0].enabled = false;
  await processDiscoveryAlerts({ entities, now:() => NOW }); assert.equal(entities.Notification.rows.length,0);
  const absent = ready(); absent.User.rows.length = 0;
  await processDiscoveryAlerts({ entities:absent, now:() => NOW }); assert.equal(absent.Notification.rows.length,0);
  const removed = ready(); removed.BucketListItem.rows.length = 0; removed.User.rows[0].notif_upgrade_alerts = false;
  await processDiscoveryAlerts({ entities:removed, now:() => NOW }); assert.equal(removed.Notification.rows.length,0);
});
test('notification duplicates converge per-user without touching another user', async () => {
  const n = {user_email:user.email,idempotency_key:'same',type:'upgrade_available',title:'Upgrade'};
  const entities = store({Notification:[{id:'a',...n,dispatch_status:'pending'},{id:'b',...n,dispatch_status:'pending'}, {id:'c',...n,user_email:'other@example.test',dispatch_status:'dispatched'}]});
  await deliverDiscoveryNotification(entities,n);
  assert.equal(entities.Notification.rows[0].dispatch_status,'dispatched');
  assert.equal(entities.Notification.rows[1].dispatch_status,'superseded');
  assert.equal(entities.Notification.rows[2].dispatch_status,'dispatched');
});
test('provider cache preserves cancel/TBA metadata; bounded writes tolerate failures', async () => {
  const raw = {id:'tm1',name:'A show',dates:{status:{code:'cancelled'},start:{dateTime:'2026-10-02T18:00:00Z',timeTBA:true}},_embedded:{attractions:[{id:'a1'}],venues:[{id:'v1',name:'Venue',location:{latitude:'33.45',longitude:'-112.07'}}]}};
  const snapshot = providerDiscoverySnapshot(raw,NOW);
  assert.equal(snapshot.provider_status,'cancelled'); assert.equal(snapshot.time_tba,true); assert.deepEqual(snapshot.attraction_ids,['a1']);
  const entities = store();
  const report = await cacheProviderDiscoveryEvents(entities,Array.from({length:12},(_,i) => ({...raw,id:`tm${i}`})),NOW);
  assert.equal(report.cached,8); assert.equal(report.omitted,4); assert.equal(entities.DiscoveryEventCache.rows.length,8);
  const failed = await cacheProviderDiscoveryEvents({DiscoveryEventCache:{filter:async () => {throw Error('offline');}}},[raw],NOW);
  assert.equal(failed.failed,1);
});
test('city area resolves exact city/state US matches only', () => {
  const venue = (city,state,lat,lng) => ({city:{name:city},state:{stateCode:state},country:{countryCode:'US'},location:{latitude:lat,longitude:lng}});
  const result = resolveDiscoveryCityArea([venue('Phoenix','AZ',33.45,-112.07),venue('Phoenix','OR',50,-100)],'Phoenix','AZ');
  assert.deepEqual(result,{city_label:'Phoenix, AZ venue area',latitude:33.45,longitude:-112.07,location_source:'venue_area'});
  assert.equal(resolveDiscoveryCityArea([], 'Nowhere','AZ'),null);
});
test('unsupported native watches are explicit, but existing watches can be disabled', async () => {
  const entities = ready(); delete entities.Event.rows[0].tm_id;
  const state = await manageDiscoveryAlerts({entities,user}, {action:'get_event',event_id:'e1'});
  assert.equal(state.supported,false);
  await assert.rejects(manageDiscoveryAlerts({entities,user},{action:'set_event',event_id:'e1',enabled:true}), /event_alert_not_supported/);
  assert.deepEqual(await manageDiscoveryAlerts({entities,user},{action:'set_event',event_id:'e1',enabled:false}),{enabled:false});
});
test('refresh failure prevents all notification writes instead of falling back to cache', async () => {
  const entities = ready();
  await assert.rejects(processDiscoveryAlerts({ entities, now:() => NOW, refreshWatchedEvents:async () => {throw Error('offline');} }),/watched_event_refresh_failed/);
  assert.equal(entities.Notification.rows.length,0);
});
test('watched refresh invalidates provider-removed events, binds ID and enforces limit', async () => {
  const {refreshWatchedDiscoveryEvents} = await import('../base44/shared/discoveryEventCache.js');
  const entities = ready();
  await refreshWatchedDiscoveryEvents(entities,[event()],async () => null,NOW);
  assert.equal(entities.DiscoveryEventCache.rows[0].provider_status,'unavailable');
  await assert.rejects(refreshWatchedDiscoveryEvents(entities,[event()],async () => ({id:'other'}),NOW),/watched_event_refresh_failed/);
  await assert.rejects(refreshWatchedDiscoveryEvents(entities,Array.from({length:21},(_,i) => ({tm_id:`tm${i}`})),async () => null,NOW),/watch_refresh_limit_exceeded/);
});
test('primary ticket sales ending do not suppress an eligible live upgrade alert', () => {
  const live = {...cached(),provider_status:'offsale',event_start_utc:iso(-3600000),event_end_utc:iso(3600000)};
  assert.equal(upgradeAlertEligible(listing(),[privateListing()],{...event(),provider_status:'offsale'},live,user.email,NOW),true);
  assert.equal(confirmedCachedEvent({...live,event_start_utc:iso(3600000)},NOW),false,'future bucket discovery remains onsale only');
});
test('optout and follow removal during refresh are rechecked before publication', async () => {
  const entities = ready();
  const result = await processDiscoveryAlerts({entities,now:() => NOW,refreshWatchedEvents:async () => {
    entities.DiscoveryAlertSubscription.rows[0].enabled = false;
    entities.BucketListItem.rows.length = 0;
  }});
  assert.equal(result.matched,0); assert.equal(entities.Notification.rows.length,0);
});
test('location revocation, deleted preferences and latest inventory changes suppress stale candidates', async () => {
  for (const mutation of [e => {e.DiscoveryAlertPreference.rows[0].location_consent = false;},e => {e.DiscoveryAlertPreference.rows.length = 0;},e => {e.User.rows.length = 0;}]) {
    const entities=ready();
    await processDiscoveryAlerts({entities,now:() => NOW,refreshWatchedEvents:async () => {
      mutation(entities); entities.Listing.rows[0].status = 'sold';
    }});
    assert.equal(entities.Notification.rows.length,0);
  }
});
test('publication clock rejects a show starting and an upgrade window closing during refresh', async () => {
  const entities=ready();
  entities.DiscoveryEventCache.rows[0].event_start_utc=iso(1000);
  entities.Listing.rows[0].upgrade_window_closes_at=iso(1000);
  let clock=NOW;
  await processDiscoveryAlerts({entities,now:() => clock,refreshWatchedEvents:async () => {clock=NOW+2000;}});
  assert.equal(entities.Notification.rows.length,0);
});
