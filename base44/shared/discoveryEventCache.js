/** Opportunistic provider-verified cache. Only raw server responses may enter here. */
import { normalizeTMEvent, coerceCoordinate } from './tmResponseHandler.js';

export const MAX_CACHE_WRITES_PER_DISCOVERY = 8;
export function providerDiscoverySnapshot(raw, now = Date.now()) {
  if (!raw || typeof raw.id !== 'string' || !/^[A-Za-z0-9_-]{1,200}$/.test(raw.id)) return null;
  const event = normalizeTMEvent(raw);
  return {
    tm_id: event.tm_id, title: event.title || 'Upcoming event', venue: event.venue,
    city: event.city, state: event.state, tm_venue_id: event.tm_venue_id,
    venue_lat: event.venue_lat, venue_lng: event.venue_lng,
    event_start_utc: event.event_start_utc, event_end_utc: event.event_end_utc,
    provider_status: event.provider_status || 'unknown',
    date_tba: event.date_tba, time_tba: event.time_tba, no_specific_time: event.no_specific_time,
    end_time_invalid: event.end_time_invalid,
    attraction_ids: [...new Set((raw._embedded?.attractions || [])
      .map(item => item.id).filter(id => typeof id === 'string' && /^[A-Za-z0-9_-]{1,200}$/.test(id)))].slice(0, 30),
    fetched_at: new Date(now).toISOString(),
  };
}
export async function cacheProviderDiscoveryEvents(entities, rawEvents, now = Date.now()) {
  const snapshots = rawEvents.slice(0, MAX_CACHE_WRITES_PER_DISCOVERY)
    .map(raw => providerDiscoverySnapshot(raw, now)).filter(Boolean);
  const results = await Promise.allSettled(snapshots.map(async snapshot => {
    // Always replace canceled/TBA metadata too; never preserve a formerly confirmed date.
    const matches = await entities.DiscoveryEventCache.filter({ tm_id: snapshot.tm_id }, 'id', 2);
    if (matches.length) await entities.DiscoveryEventCache.update(matches[0].id, snapshot);
    else await entities.DiscoveryEventCache.create(snapshot);
  }));
  return { cached: results.filter(result => result.status === 'fulfilled').length,
    failed: results.filter(result => result.status === 'rejected').length,
    omitted: Math.max(0, rawEvents.length - MAX_CACHE_WRITES_PER_DISCOVERY) };
}

/** Approximate city event-venue area, never represented as an exact city center. */
export function resolveDiscoveryCityArea(venues, city, state) {
  const exact = venues.filter(venue => venue.city?.name?.toLowerCase() === city.toLowerCase()
    && venue.state?.stateCode === state && venue.country?.countryCode === 'US')
    .map(venue => ({ lat: coerceCoordinate(venue.location?.latitude, -90, 90), lng: coerceCoordinate(venue.location?.longitude, -180, 180) }))
    .filter(point => point.lat !== null && point.lng !== null);
  if (!exact.length) return null;
  const median = key => {
    const points = exact.map(point => point[key]).sort((a,b) => a-b);
    return points[Math.floor(points.length / 2)];
  };
  return { city_label: `${city}, ${state} venue area`, latitude: Math.round(median('lat')*100)/100,
    longitude: Math.round(median('lng')*100)/100, location_source: 'venue_area' };
}

/** Refresh watched TM IDs using a server-held fetch adapter; never trust client event metadata. */
export async function refreshWatchedDiscoveryEvents(entities, events, fetchEvent, now = Date.now()) {
  const ids = [...new Set(events.map(event => event.tm_id).filter(id => typeof id === 'string' && /^[A-Za-z0-9_-]{1,200}$/.test(id)))];
  // A large registry requires sharding or a durable cursor before increasing this bound.
  if (ids.length > 20) throw new Error('watch_refresh_limit_exceeded');
  let refreshed = 0;
  for (let index = 0; index < ids.length; index += 4) {
    const results = await Promise.allSettled(ids.slice(index, index + 4).map(async id => {
      const raw = await fetchEvent(id);
      // A provider 404 is a fresh unavailable tombstone, invalidating earlier cache rows.
      if (raw !== null && raw.id !== id) throw new Error('provider_event_identity_mismatch');
      const report = await cacheProviderDiscoveryEvents(entities,
        [raw || { id, name: 'Unavailable event', dates: { status: { code: 'unavailable' } } }], now);
      if (report.failed || report.cached !== 1) throw new Error('provider_cache_write_failed');
      refreshed += 1;
    }));
    // No alerts are delivered from a partly refreshed registry.
    if (results.some(result => result.status === 'rejected')) throw new Error('watched_event_refresh_failed');
  }
  return { refreshed };
}
