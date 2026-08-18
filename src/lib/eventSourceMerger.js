/**
 * Pure event-source merger — extracts the merge/filter logic from Events.jsx
 * into a testable module with safe contract handling.
 *
 * M0.2 FIX: fetchTMEvents returns { events: [...], fromCache: boolean }, NOT an
 * array. The previous inline code treated tmResult.value as an array and called
 * .map() on it, crashing at runtime. This module extracts .events and validates
 * with Array.isArray. Malformed fulfilled results become a classified partial-
 * source failure (defense in depth — fetchTMEvents also throws on non-array).
 */
import { normalizeSearch, eventMatchesKeyword, eventWithinRadius } from './searchNormalize.js';

/**
 * Merge PG and TM event sources with safe contract handling.
 *
 * @param {object} params
 * @param {PromiseSettledResult} params.localResult - Promise.allSettled result for PG fetch
 * @param {PromiseSettledResult} params.tmResult - Promise.allSettled result for TM fetch
 * @param {object} params.filters - { cityOverride, ll, keyword, isAdmin, now }
 * @returns {{ events: array, pgError: boolean, tmError: boolean, partialData: boolean, tmFailed: boolean, tmEventsRaw: array }}
 */
export function mergeEventSources({ localResult, tmResult, filters }) {
  const { cityOverride, ll, keyword, isAdmin, now } = filters;

  // ── PG source ──────────────────────────────────────────────────────────
  const localData = localResult.status === 'fulfilled' ? localResult.value : [];

  // ── TM source — CRASH FIX ───────────────────────────────────────────────
  // fetchTMEvents returns { events: [...], fromCache: boolean }, NOT an array.
  // Extract .events and validate with Array.isArray.
  // Malformed fulfilled result (events is not an array) → classified as TM failure.
  const tmResultValue = tmResult.status === 'fulfilled' ? tmResult.value : null;
  const tmEventsRaw = Array.isArray(tmResultValue?.events) ? tmResultValue.events : [];

  // ── Error classification ─────────────────────────────────────────────────
  const pgError = localResult.status === 'rejected';
  const tmMalformedFulfilled = tmResult.status === 'fulfilled' && !Array.isArray(tmResultValue?.events);
  const tmFailed = tmResult.status === 'rejected' || tmMalformedFulfilled;
  const tmStatusCode = tmResult.reason?.response?.status || tmResult.reason?.status;
  const tmError = tmFailed && tmStatusCode === 429;
  const partialData = tmFailed && !tmError && localResult.status === 'fulfilled';

  // ── Filter PG events ────────────────────────────────────────────────────
  const eligible = localData.filter(e => e.status !== 'ended');
  const pgEvents = isAdmin
    ? eligible
    : eligible.filter(e => !e.date || now < new Date(e.date).getTime());
  let pgFiltered = pgEvents.filter(e => !e.is_beta_live);

  if (cityOverride) {
    const cityNorm = normalizeSearch(cityOverride);
    pgFiltered = pgFiltered.filter(e =>
      normalizeSearch(e.city).includes(cityNorm) ||
      normalizeSearch(e.venue).includes(cityNorm)
    );
  }
  if (ll) {
    const [lat, lng] = ll.split(',').map(Number);
    if (!isNaN(lat) && !isNaN(lng)) {
      pgFiltered = pgFiltered.filter(e => eventWithinRadius(e, lat, lng, 50));
    }
  }
  if (keyword) {
    pgFiltered = pgFiltered.filter(e => eventMatchesKeyword(e, keyword));
  }

  const pgMapped = pgFiltered.map(e => ({ ...e, source: 'pg' }));

  // ── Map TM events ───────────────────────────────────────────────────────
  let tmEvents = tmEventsRaw.map(e => ({ ...e, id: `tm_${e.tm_id}`, source: 'ticketmaster' }));
  if (keyword) {
    tmEvents = tmEvents.filter(e => eventMatchesKeyword(e, keyword));
  }

  return {
    events: [...pgMapped, ...tmEvents],
    pgError,
    tmError,
    partialData,
    tmFailed,
    tmEventsRaw,
  };
}