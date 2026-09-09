import { fetchTMEvents, bustTMCache } from './tmCache.js';
import { eventWithinRadius, normalizeSearch } from './searchNormalize.js';
import { coerceCoordinate } from '../../base44/shared/tmResponseHandler.js';

export function matchesUpgradeLocation(event, { latlong, city, radius = 50 }) {
  if (latlong) {
    const parts = latlong.split(',');
    const lat = coerceCoordinate(parts[0], -90, 90);
    const lng = coerceCoordinate(parts[1], -180, 180);
    const located = { venue_lat: coerceCoordinate(event.venue_lat, -90, 90), venue_lng: coerceCoordinate(event.venue_lng, -180, 180) };
    return parts.length === 2 && lat !== null && lng !== null && eventWithinRadius(located, lat, lng, radius);
  }
  const [wantedCity, wantedState] = (city || '').split(',').map(normalizeSearch);
  return Boolean(wantedCity) && normalizeSearch(event.city) === wantedCity && (!wantedState || normalizeSearch(event.state) === wantedState);
}

export async function loadUpgradeEvents(base44, location, bust = false) {
  const params = { size: 40, includeOngoing: true };
  if (location.latlong) { params.latlong = location.latlong; params.radius = '50'; }
  else params.city = location.city?.split(',')[0].trim();
  if (bust) bustTMCache(params);
  const [local, provider] = await Promise.allSettled([
    base44.entities.Event.list('date', 200), fetchTMEvents(base44, params),
  ]);
  const tm = (provider.status === 'fulfilled' ? provider.value.events : [])
    .filter(e => location.latlong || matchesUpgradeLocation(e, location));
  const tmById = new Map(tm.map(e => [e.tm_id, e]));
  const pg = (local.status === 'fulfilled' ? local.value : [])
    .filter(e => e.status !== 'ended' && matchesUpgradeLocation(e, location)).map(e => {
      const match = tmById.get(e.tm_id);
      // Keep provider end metadata transient; no new Event schema dependency.
      const sameStart = Date.parse(e.event_start_utc || e.date) === Date.parse(match?.event_start_utc || match?.date);
      return { ...e, ...(sameStart && match ? { event_end_utc: e.event_end_utc || match.event_end_utc,
        end_estimated: e.event_end_utc ? e.end_estimated : match.end_estimated } : {}), source: 'pg' };
    });
  const pgIds = new Set(pg.map(e => e.tm_id).filter(Boolean));
  return {
    events: [...pg, ...tm.filter(e => !pgIds.has(e.tm_id)).map(e => ({ ...e, id: `tm_${e.tm_id}`, source: 'ticketmaster' }))],
    partial: local.status === 'rejected' || provider.status === 'rejected' || Boolean(provider.value?.partial),
  };
}
