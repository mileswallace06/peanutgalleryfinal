/** Discovery alerts are in-app only. No purchase, payment, push or email effects. */
import { reliableTMTimestamp, coerceCoordinate } from './tmResponseHandler.js';

export const CACHE_FRESH_MS = 6 * 60 * 60 * 1000;
export const ALERT_RADII = [10, 25, 50, 100];
export class DiscoveryAlertError extends Error {
  constructor(code, status = 400) { super(code); this.code = code; this.status = status; }
}
const fail = (code, status) => { throw new DiscoveryAlertError(code, status); };
const validId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,200}$/.test(value);
const instant = value => { const iso = reliableTMTimestamp(value); return iso ? Date.parse(iso) : null; };
const present = value => value !== undefined && value !== null && value !== '';
const canonical = rows => [...rows].sort((a, b) => String(b.preference_updated_at || b.updated_date || '').localeCompare(String(a.preference_updated_at || a.updated_date || '')) || String(a.id).localeCompare(String(b.id)))[0];

/** Stable keyset pagination; a cap or unsupported cursor is an error, never a complete scan. */
export async function scanDiscoveryRows(entity, query = {}, { pageSize = 100, maxRows = 2000 } = {}) {
  const rows = [];
  let cursor = null;
  for (;;) {
    const filter = cursor ? { $and: [query, { id: { $gt: cursor } }] } : query;
    const page = await entity.filter(filter, 'id', pageSize);
    if (!Array.isArray(page) || page.length > pageSize) fail('invalid_scan_response', 503);
    for (const row of page) {
      if (typeof row.id !== 'string' || (cursor !== null && row.id <= cursor)) fail('scan_cursor_not_supported', 503);
      rows.push(row);
      cursor = row.id;
      if (rows.length > maxRows) fail('scan_limit_exceeded', 503);
    }
    if (page.length < pageSize) return rows;
  }
}

export function defaultDiscoveryPreferences() {
  return { enabled: false, city_label: null, latitude: null, longitude: null, radius_miles: null, location_consent: false };
}
function publicPreferences(row) {
  const result = defaultDiscoveryPreferences();
  if (!row) return result;
  for (const key of Object.keys(result)) if (row[key] !== undefined) result[key] = row[key];
  return result;
}
export function validateDiscoveryPreferences(body) {
  if (typeof body.enabled !== 'boolean') fail('enabled_must_be_boolean');
  const result = { ...defaultDiscoveryPreferences(), enabled: body.enabled };
  if (body.location_consent !== true) return result; // Revocation deletes the saved location.
  const lat = coerceCoordinate(body.latitude, -90, 90);
  const lng = coerceCoordinate(body.longitude, -180, 180);
  if (lat === null || lng === null || typeof body.latitude !== 'number' || typeof body.longitude !== 'number'
    || typeof body.city_label !== 'string' || !body.city_label.trim() || body.city_label.length > 120
    || !ALERT_RADII.includes(body.radius_miles)) fail('select_city_and_radius');
  return { enabled: body.enabled, location_consent: true, city_label: body.city_label.trim(),
    // City-level precision only; this feature does not store continuous/device tracking.
    latitude: Math.round(lat * 100) / 100, longitude: Math.round(lng * 100) / 100, radius_miles: body.radius_miles };
}

/** All recipient identity is supplied by auth.me(), never the request body. */
export async function manageDiscoveryAlerts({ entities, user, now = Date.now, resolveCity }, body) {
  if (!user?.id || !user?.email) fail('unauthorized', 401);
  if (!body || typeof body !== 'object' || Array.isArray(body)) fail('invalid_request');
  if (body.action === 'resolve_city') {
    if (typeof body.city !== 'string' || !body.city.trim() || body.city.length > 80
      || typeof body.state !== 'string' || !/^[A-Z]{2}$/.test(body.state)) fail('select_city');
    if (!resolveCity) fail('city_lookup_unavailable', 503);
    return await resolveCity({ city: body.city.trim(), state: body.state });
  }
  if (['get_preferences', 'set_preferences'].includes(body.action)) {
    const rows = await scanDiscoveryRows(entities.DiscoveryAlertPreference, { user_id: user.id }, { maxRows: 20 });
    if (body.action === 'get_preferences') return publicPreferences(canonical(rows));
    const patch = { ...validateDiscoveryPreferences(body), user_id: user.id,
      user_email: user.email, preference_updated_at: new Date(now()).toISOString() };
    if (!rows.length) await entities.DiscoveryAlertPreference.create(patch);
    else for (const row of rows) await entities.DiscoveryAlertPreference.update(row.id, patch);
    return publicPreferences(patch);
  }
  if (!['get_event', 'set_event'].includes(body.action) || !validId(body.event_id)) fail('invalid_event_request');
  const rows = await scanDiscoveryRows(entities.DiscoveryAlertSubscription,
    { user_id: user.id, event_id: body.event_id }, { maxRows: 20 });
  if (body.action === 'get_event') {
    const events = await entities.Event.filter({ id: body.event_id }, 'id', 2);
    const event = events.length === 1 ? events[0] : null;
    const supported = !!event && validId(event.tm_id) && !event.is_beta_live && !event.is_demo
      && !['ended','cancelled','canceled','postponed'].includes(event.status);
    return { enabled: canonical(rows)?.enabled === true, supported };
  }
  if (typeof body.enabled !== 'boolean') fail('enabled_must_be_boolean');
  // Disabling a stale/deleted event watch must always remain possible.
  if (body.enabled) {
    const events = await entities.Event.filter({ id: body.event_id }, 'id', 2);
    const event = events.length === 1 ? events[0] : null;
    if (!event || event.is_beta_live || event.is_demo || ['ended','cancelled','canceled','postponed'].includes(event.status)) fail('event_unavailable', 404);
    if (!validId(event.tm_id)) fail('event_alert_not_supported', 422);
  }
  const patch = { user_id: user.id, user_email: user.email, event_id: body.event_id,
    enabled: body.enabled, preference_updated_at: new Date(now()).toISOString() };
  if (!rows.length) await entities.DiscoveryAlertSubscription.create(patch);
  else for (const row of rows) await entities.DiscoveryAlertSubscription.update(row.id, patch);
  return { enabled: body.enabled };
}

export async function discoveryWorkerAuthorized({ user, providedSecret, configuredSecret }) {
  if (user?.role === 'admin') return true;
  // A logged-in non-admin cannot bypass authorization by adding scheduler headers.
  if (user || typeof configuredSecret !== 'string' || configuredSecret.length < 32
    || typeof providedSecret !== 'string' || providedSecret.length !== configuredSecret.length) return false;
  let difference = 0;
  for (let i = 0; i < configuredSecret.length; i += 1) difference |= configuredSecret.charCodeAt(i) ^ providedSecret.charCodeAt(i);
  return difference === 0;
}

export function confirmedCachedEvent(event, now, { futureOnly = true } = {}) {
  const start = instant(event?.event_start_utc);
  const fetched = instant(event?.fetched_at);
  if (!validId(event?.tm_id) || start === null || fetched === null || fetched > now
    || now - fetched > CACHE_FRESH_MS
    || !(futureOnly ? ['onsale'] : ['onsale','offsale']).includes(event.provider_status)
    || event.date_tba || event.time_tba || event.no_specific_time || event.end_time_invalid) return false;
  if (futureOnly) return start > now;
  const explicitEnd = instant(event.event_end_utc);
  if (present(event.event_end_utc) && (explicitEnd === null || explicitEnd <= start)) return false;
  // Missing end is explicitly an estimated four-hour discovery window.
  return (explicitEnd ?? start + 4 * 3600000) > now;
}
export function discoveryDistanceMiles(lat1, lon1, lat2, lon2) {
  const inputs = [[lat1,-90,90],[lon1,-180,180],[lat2,-90,90],[lon2,-180,180]];
  if (inputs.some(([v,min,max]) => typeof v !== 'number' || coerceCoordinate(v,min,max) === null)) return Infinity;
  const rad = degrees => degrees * Math.PI / 180;
  const a = Math.sin(rad(lat2-lat1)/2) ** 2 + Math.cos(rad(lat1))*Math.cos(rad(lat2))*Math.sin(rad(lon2-lon1)/2) ** 2;
  return 3958.7613 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(Math.max(0, 1-a)));
}
export function bucketMatchesCachedEvent(item, preferences, event, now) {
  if (!preferences?.enabled || !confirmedCachedEvent(event, now)) return false;
  if (item.type === 'venue') return validId(item.tm_id) && item.tm_id === event.tm_venue_id;
  return item.type === 'attraction' && validId(item.tm_id) && event.attraction_ids?.includes(item.tm_id)
    && preferences.location_consent === true && ALERT_RADII.includes(preferences.radius_miles)
    && discoveryDistanceMiles(preferences.latitude, preferences.longitude, event.venue_lat, event.venue_lng) <= preferences.radius_miles;
}
function openWindow(value, now, direction) {
  if (!present(value)) return true;
  const time = instant(value);
  return time !== null && (direction === 'opens' ? time <= now : time > now);
}

/** Conservative public eligibility only; never grants checkout rights or reveals private fields. */
export function upgradeAlertEligible(listing, privateRows, event, cached, userEmail, now) {
  if (!event || event.is_beta_live || event.is_demo || ['ended','cancelled','canceled','postponed'].includes(event.status)
    || ['cancelled','canceled','postponed'].includes(event.provider_status)
    || !confirmedCachedEvent(cached, now, { futureOnly: false }) || cached.tm_id !== event.tm_id
    || ['closed','manually_verified_closed'].includes(event.transfer_window_status)
    || event.upgrade_eligibility_status === 'not_eligible'
    || !openWindow(event.transfer_window_closes_at, now, 'closes')) return false;
  if (privateRows.length !== 1) return false;
  const lp = privateRows[0];
  let effects;
  try { effects = JSON.parse(lp.pending_effects_json); } catch { return false; }
  if (!Array.isArray(effects) || effects.length) return false;
  if (lp.listing_id !== listing.id || lp.event_id !== event.id || listing.event_id !== event.id
    || !lp.seller_email || lp.seller_email === userEmail || lp.proof_status !== 'approved'
    || lp.is_demo_listing !== false || listing.is_demo_listing || listing.inventory_source === 'pg_demo'
    || /\[(TEST|DEMO|AUTH_CANARY)\]/i.test(`${listing.notes || ''} ${lp.notes || ''}`)
    || listing.status !== 'active' || !['live_upgrade','venue_upgrade'].includes(listing.listing_type)
    || listing.hidden_reason || lp.checkout_quarantined || lp.recovery_blocked
    || lp.seller_cancel_requested_at || lp.seller_pause_requested_at
    || lp.reservation_lifecycle_state !== 'available'
    || listing.reservation_mirror_state !== 'available'
    || lp.reservation_token || lp.reserved_by_email || lp.reservation_expires_at
    || listing.reservation_token || listing.reserved_by_email || listing.reservation_expires_at
    || !Number.isSafeInteger(lp.reservation_version) || lp.reservation_version < 0
    || listing.reservation_version !== lp.reservation_version
    || !Number.isSafeInteger(listing.quantity) || listing.quantity <= 0
    || (present(lp.quantity) && lp.quantity !== listing.quantity)
    || !Number.isFinite(listing.asking_price) || listing.asking_price <= 0
    || ['transfer_disabled','transfer_expired'].includes(listing.transfer_status)
    || (listing.listing_mode === 'instant' && lp.custody_status !== 'verified')
    || !openWindow(listing.upgrade_window_opens_at, now, 'opens')
    || !openWindow(listing.upgrade_window_closes_at, now, 'closes')) return false;
  return true;
}

function canonicalBy(rows, key) {
  const groups = new Map();
  for (const row of rows) { const k = key(row); groups.set(k, [...(groups.get(k) || []), row]); }
  return [...groups.values()].map(canonical);
}

/** Deduplicate only this user's logical delivery. No external channels or strict atomic claim. */
export async function deliverDiscoveryNotification(entities, notification) {
  const query = { user_email: notification.user_email, idempotency_key: notification.idempotency_key };
  let records = await scanDiscoveryRows(entities.Notification, query, { maxRows: 50 });
  if (!records.length) {
    await entities.Notification.create({ ...notification, read: false, dispatch_status: 'pending' });
    records = await scanDiscoveryRows(entities.Notification, query, { maxRows: 50 });
  }
  if (!records.length) fail('notification_not_persisted', 503);
  // Stable oldest-id canonicalization is convergent across overlapping workers.
  records.sort((a,b) => String(a.id).localeCompare(String(b.id)));
  for (const duplicate of records.slice(1)) if (duplicate.dispatch_status !== 'superseded') {
    await entities.Notification.update(duplicate.id, { dispatch_status: 'superseded' });
  }
  if (records[0].dispatch_status !== 'dispatched') await entities.Notification.update(records[0].id, { dispatch_status: 'dispatched' });
  return records.length;
}

/** The scheduler must serialize calls. Every scan is bounded and fails loudly on incomplete data. */
export async function processDiscoveryAlerts({ entities, now = Date.now, refreshWatchedEvents }) {
  const nowMs = now();
  // Read the complete bounded input set BEFORE delivering anything.
  const [watchRows, preferenceRows, buckets] = await Promise.all([
    scanDiscoveryRows(entities.DiscoveryAlertSubscription),
    scanDiscoveryRows(entities.DiscoveryAlertPreference),
    scanDiscoveryRows(entities.BucketListItem),
  ]);
  const watches = canonicalBy(watchRows, row => `${row.user_id}:${row.event_id}`).filter(row => row.enabled === true);
  const preferences = canonicalBy(preferenceRows, row => row.user_id).filter(row => row.enabled === true);
  const userIds = [...new Set([...watches, ...preferences].map(row => row.user_id))];
  if (userIds.length > 100 || new Set(watches.map(row => row.event_id)).size > 20) fail('registry_capacity_exceeded', 503);
  const users = new Map();
  for (const id of userIds) {
    const rows = await entities.User.filter({ id }, 'id', 2);
    if (rows.length === 1 && rows[0].email) users.set(id, rows[0]);
  }
  const eventData = new Map();
  for (const id of [...new Set(watches.map(row => row.event_id))]) {
    const events = await entities.Event.filter({ id }, 'id', 2);
    const event = events.length === 1 ? events[0] : null;
    if (!event) continue;
    eventData.set(id, { event });
  }
  if (refreshWatchedEvents) {
    try { await refreshWatchedEvents([...eventData.values()].map(data => data.event), nowMs); }
    catch { fail('watched_event_refresh_failed_or_limit_exceeded', 503); }
  }
  const cacheRows = await scanDiscoveryRows(entities.DiscoveryEventCache, { fetched_at: { $gte: new Date(nowMs - CACHE_FRESH_MS).toISOString() } });
  const caches = canonicalBy(cacheRows.map(row => ({ ...row, preference_updated_at: row.fetched_at })), row => row.tm_id);
  for (const data of eventData.values()) {
    data.cached = caches.find(row => row.tm_id === data.event.tm_id);
    [data.listings, data.privates] = await Promise.all([
      scanDiscoveryRows(entities.Listing, { event_id: data.event.id, status: 'active' }),
      scanDiscoveryRows(entities.ListingPrivate, { event_id: data.event.id }),
    ]);
  }
  const notifications = [];
  for (const watch of watches) {
    const user = users.get(watch.user_id), data = eventData.get(watch.event_id);
    if (!user || user.notif_upgrade_alerts === false || !data) continue;
    const { event, listings, privates, cached } = data;
    if (!listings.some(listing => upgradeAlertEligible(listing, privates.filter(row => row.listing_id === listing.id), event, cached, user.email, nowMs))) continue;
    notifications.push({ kind: 'upgrade', user_id: user.id, event_id: event.id, cached, notification: {
      user_email: user.email, type: 'upgrade_available', title: 'Upgrades are available',
      body: `Check available upgrades for ${event.title || 'your event'}. Availability can change.`,
      reference_id: event.id, reference_type: 'event', action_url: `/upgrades/${encodeURIComponent(event.id)}`,
      icon: '🔔', idempotency_key: `discovery:upgrade:${user.id}:${event.id}`,
    } });
  }
  for (const preference of preferences) {
    const user = users.get(preference.user_id);
    // This explicit Bucket List opt-in is separate from the unused generic nearby-events toggle.
    if (!user) continue;
    const mine = buckets.filter(row => row.user_email === user.email);
    for (const cached of caches) {
      const item = mine.find(row => bucketMatchesCachedEvent(row, preference, cached, nowMs));
      if (!item) continue;
      notifications.push({ kind: 'bucket', user_id: user.id, cached, notification: {
        user_email: user.email, type: 'bucket_list_event', title: 'A show matches your Bucket List',
        body: `${cached.title || 'An upcoming event'} at ${cached.venue || 'a saved venue'}${cached.city ? ` in ${cached.city}` : ''}.`,
        reference_id: cached.tm_id, reference_type: 'event', action_url: `/events/tm/${encodeURIComponent(cached.tm_id)}`,
        icon: '⭐', idempotency_key: `discovery:bucket:${user.id}:${cached.tm_id}:${cached.event_start_utc}`,
      } });
    }
  }
  if (notifications.length > 200) fail('notification_batch_capacity_exceeded', 503);
  let published = 0;
  for (const candidate of notifications) {
    // Provider I/O can take time. Re-read consent and inventory after that work,
    // then evaluate against the publication time, not the run's initial clock.
    const currentUsers = await entities.User.filter({ id: candidate.user_id }, 'id', 2);
    const user = currentUsers.length === 1 ? currentUsers[0] : null;
    if (!user?.email) continue;
    if (candidate.kind === 'bucket') {
      const currentPrefs = await scanDiscoveryRows(entities.DiscoveryAlertPreference, { user_id: user.id }, { maxRows: 20 });
      const currentItems = await scanDiscoveryRows(entities.BucketListItem, { user_email: user.email });
      if (!currentItems.some(item => bucketMatchesCachedEvent(item, canonical(currentPrefs), candidate.cached, now()))) continue;
    } else {
      const currentWatches = await scanDiscoveryRows(entities.DiscoveryAlertSubscription,
        { user_id: user.id, event_id: candidate.event_id }, { maxRows: 20 });
      if (canonical(currentWatches)?.enabled !== true || user.notif_upgrade_alerts === false) continue;
      const currentEvents = await entities.Event.filter({ id: candidate.event_id }, 'id', 2);
      const currentEvent = currentEvents.length === 1 ? currentEvents[0] : null;
      if (!currentEvent) continue;
      const [currentListings, currentPrivates] = await Promise.all([
        scanDiscoveryRows(entities.Listing, { event_id: candidate.event_id, status: 'active' }),
        scanDiscoveryRows(entities.ListingPrivate, { event_id: candidate.event_id }),
      ]);
      if (!currentListings.some(listing => upgradeAlertEligible(listing,
        currentPrivates.filter(row => row.listing_id === listing.id), currentEvent, candidate.cached, user.email, now()))) continue;
    }
    await deliverDiscoveryNotification(entities, { ...candidate.notification, user_email: user.email });
    published += 1;
  }
  return { ok: true, matched: published, cache_events: caches.length, watched_events: watches.length,
    coverage: 'recent_cached_events_only', channel: 'in_app' };
}
