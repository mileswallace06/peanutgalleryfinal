import { explicitUtcMs } from './eventDiscoveryTiming.js';

/**
 * Shared TM response classification and event normalization.
 *
 * Genuinely shared between the deployed backend (getTicketmasterEvents) and
 * test suites — NOT a copied implementation. The backend imports this module
 * directly; tests import the same module to verify production logic.
 *
 * This module contains NO side effects and NO I/O, making it directly testable
 * in Node.js (.mjs) test runners.
 */

/**
 * Classify a raw fetch Response from the Ticketmaster API.
 *
 * @param {object} params
 * @param {boolean} params.ok - Whether res.ok was true
 * @param {number} params.status - HTTP status code
 * @param {object|null} params.data - Parsed JSON body (null if parse failed)
 * @returns {{ error: string|null, upstream_status: number, events: array, partial: boolean }}
 */
export function classifyTMResponse({ ok, status, data }) {
  // Non-2xx response
  if (!ok) {
    if (status === 429) {
      return { error: 'rate_limited', upstream_status: 429, events: [], partial: true };
    }
    if (status === 404) {
      // 404 from TM = no events found, not an error
      return { error: null, upstream_status: 404, events: [], partial: false };
    }
    if (status >= 500) {
      return { error: 'upstream_error', upstream_status: status, events: [], partial: true };
    }
    return { error: 'upstream_error', upstream_status: status, events: [], partial: true };
  }

  // data can be null (valid JSON null response from TM) — the backend
  // function handles truly malformed JSON (.json() throw) separately and
  // returns 502 before this function is ever called.
  // Extract events safely with optional chaining.
  const rawEvents = data?._embedded?.events || [];
  return { error: null, upstream_status: status, events: rawEvents, partial: false };
}

/**
 * Coerce a value to a finite number within [min, max], or null.
 *
 * M0.3: Ticketmaster coordinates must be converted to finite numbers.
 * Invalid, missing, or non-finite values become null. Latitude must be
 * -90..90, longitude must be -180..180.
 *
 * @param {*} v - Raw value from TM API
 * @param {number} min - Minimum valid value (inclusive)
 * @param {number} max - Maximum valid value (inclusive)
 * @returns {number|null}
 */
export function coerceCoordinate(v, min, max) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  if (n < min || n > max) return null;
  return n;
}

/**
 * Normalize a raw TM event into the app's event shape.
 *
 * M0.3: venue_lat/venue_lng are now coerced to finite numbers within valid
 * ranges (lat -90..90, lng -180..180). Invalid/missing/non-finite → null.
 *
 * @param {object} e - Raw Ticketmaster event object
 * @returns {object} Normalized event
 */
export function normalizeTMEvent(e) {
  const venue = e._embedded?.venues?.[0];
  const image = e.images?.find(i => i.ratio === '16_9' && i.width >= 640) || e.images?.[0];
  const dateInfo = e.dates?.start;

  const endInfo = e.dates?.end;
  const startMs = explicitUtcMs(dateInfo?.dateTime);
  const endMs = explicitUtcMs(endInfo?.dateTime);
  const timedStart = !dateInfo?.dateTBA && !dateInfo?.dateTBD && !dateInfo?.timeTBA && !dateInfo?.noSpecificTime;
  const validEnd = timedStart && startMs !== null && endMs !== null && endMs > startMs;
  const segment = e.classifications?.[0]?.segment?.name?.toLowerCase();
  const genre = e.classifications?.[0]?.genre?.name?.toLowerCase();
  const discoveryCategory = genre === 'comedy' ? 'comedy' : genre === 'theatre' || genre === 'theater' ? 'theater'
    : segment === 'music' ? 'concert' : segment === 'sports' ? 'sports' : 'other';

  return {
    // Response-only discovery metadata; sync/purchase policy is unchanged.
    discovery_time_unconfirmed: !timedStart,
    event_start_utc: timedStart && startMs !== null ? dateInfo.dateTime : null,
    event_end_utc: validEnd ? endInfo.dateTime : null,
    end_estimated: !validEnd || Boolean(endInfo?.approximate || endInfo?.noSpecificTime),
    discovery_category: discoveryCategory,
    venue_timezone: e.dates?.timezone || venue?.timezone || null,
    tm_id: e.id,
    title: e.name,
    tm_venue_id: venue?.id || '',
    date: dateInfo?.dateTime || (dateInfo?.localDate ? `${dateInfo.localDate}T${dateInfo.localTime || '00:00:00'}` : null),
    venue: venue?.name || '',
    city: venue?.city?.name || '',
    state: venue?.state?.stateCode || '',
    venue_lat: coerceCoordinate(venue?.location?.latitude, -90, 90),
    venue_lng: coerceCoordinate(venue?.location?.longitude, -180, 180),
    image_url: image?.url || '',
    tm_url: e.url || '',
    source: 'ticketmaster',
  };
}