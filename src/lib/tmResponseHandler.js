/**
 * Pure TM response classification logic — shared between the backend function
 * and the frontend tests. This module contains NO side effects and NO I/O,
 * making it directly testable in Node.js (.mjs) test runners.
 *
 * The backend function (base44/functions/getTicketmasterEvents/entry.ts)
 * mirrors this logic inline because Deno cannot import from src/lib/.
 * Tests import THIS module to verify the production logic.
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
    if (status >= 500) {
      return { error: 'upstream_error', upstream_status: status, events: [], partial: true };
    }
    if (status === 404) {
      // 404 from TM = no events found, not an error
      return { error: null, upstream_status: 404, events: [], partial: false };
    }
    return { error: 'upstream_error', upstream_status: status, events: [], partial: true };
  }

  // Malformed JSON (data is null because .json() threw or returned null)
  if (!data) {
    return { error: 'malformed_response', upstream_status: status, events: [], partial: true };
  }

  // Success — extract events
  const rawEvents = data?._embedded?.events || [];
  return { error: null, upstream_status: status, events: rawEvents, partial: false };
}

/**
 * Normalize a raw TM event into the app's event shape.
 * @param {object} e - Raw Ticketmaster event object
 * @returns {object} Normalized event
 */
export function normalizeTMEvent(e) {
  const venue = e._embedded?.venues?.[0];
  const image = e.images?.find(i => i.ratio === '16_9' && i.width >= 640) || e.images?.[0];
  const dateInfo = e.dates?.start;

  return {
    tm_id: e.id,
    title: e.name,
    tm_venue_id: venue?.id || '',
    date: dateInfo?.dateTime || (dateInfo?.localDate ? `${dateInfo.localDate}T${dateInfo.localTime || '00:00:00'}` : null),
    venue: venue?.name || '',
    city: venue?.city?.name || '',
    state: venue?.state?.stateCode || '',
    image_url: image?.url || '',
    tm_url: e.url || '',
    source: 'ticketmaster',
  };
}