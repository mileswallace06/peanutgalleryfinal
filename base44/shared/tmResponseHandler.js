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
  const rawEvents = data?._embedded?.events ?? [];
  if (!Array.isArray(rawEvents)) return { error: 'malformed_response', upstream_status: 502, events: [], partial: true };
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

// Accept only unambiguous timestamps. Date.parse alone normalizes impossible dates.
export function reliableTMTimestamp(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return null;
  const [year, month, day, hour, minute] = value.slice(0, 16).split(/[-T:]/).map(Number);
  if (month < 1 || month > 12 || day < 1 || day > new Date(Date.UTC(year, month, 0)).getUTCDate() || hour > 23 || minute > 59) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}
function validTimezone(value) {
  if (typeof value !== 'string') return null;
  try { new Intl.DateTimeFormat('en-US', { timeZone: value }).format(); return value; } catch { return null; }
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
  const start = reliableTMTimestamp(dateInfo?.dateTime);
  const end = reliableTMTimestamp(e.dates?.end?.dateTime);
  const invalidEnd = !!e.dates?.end?.dateTime && (!end || (start && Date.parse(end) <= Date.parse(start)));
  const local = dateInfo?.localDate && dateInfo?.localTime ? `${dateInfo.localDate}T${dateInfo.localTime}` : null;

  return {
    tm_id: e.id,
    title: e.name,
    tm_venue_id: venue?.id || '',
    date: start ? dateInfo.dateTime : local,
    event_start_utc: start,
    event_end_utc: invalidEnd ? null : end,
    end_time_invalid: !!invalidEnd,
    venue_timezone: validTimezone(e.dates?.timezone) || validTimezone(venue?.timezone),
    date_tba: dateInfo?.dateTBA === true || dateInfo?.dateTBD === true,
    time_tba: dateInfo?.timeTBA === true,
    no_specific_time: dateInfo?.noSpecificTime === true,
    provider_status: e.dates?.status?.code || null,
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
