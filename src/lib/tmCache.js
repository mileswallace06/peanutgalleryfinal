/**
 * Lightweight client-side cache for Ticketmaster API results.
 * TTL: 3 minutes. Keyed by serialized params.
 * Also deduplicates in-flight requests for the same key.
 */

const CACHE_TTL_MS = 3 * 60 * 1000; // 3 minutes

const cache = new Map();        // key → { data, ts }
const inFlight = new Map();     // key → Promise

function buildKey(params) {
  // Stable key from sorted entries
  return Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join('&');
}

/**
 * Fetch TM events with caching + deduplication.
 * @param {object} base44 - The base44 SDK instance
 * @param {object} params - Params to pass to getTicketmasterEvents
 * @returns {Promise<{ events: array, fromCache: boolean }>}
 */
export async function fetchTMEvents(base44, params) {
  const key = buildKey(params);

  // Return cached result if fresh
  const cached = cache.get(key);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    return { events: cached.data, fromCache: true };
  }

  // Deduplicate: if same request is in-flight, wait for it
  if (inFlight.has(key)) {
    const data = await inFlight.get(key);
    return { events: data, fromCache: false };
  }

  // New request
  const promise = base44.functions
    .invoke('getTicketmasterEvents', params)
    .then(res => {
      const events = res?.data?.events || [];
      // Safety: if an error object slipped through as a 200, don't cache it
      // as an empty successful result — throw so the .catch fires.
      if (res?.data?.error) {
        throw { status: res.data.upstream_status || 500, message: res.data.error };
      }
      cache.set(key, { data: events, ts: Date.now() });
      inFlight.delete(key);
      return events;
    })
    .catch(err => {
      inFlight.delete(key);
      // Do NOT cache error responses — only successful results are cached.
      const status = err?.response?.status || err?.status || err?.status;
      console.error('[tmCache] getTicketmasterEvents failed — status:', status, '| key:', key, '| message:', err?.message);
      throw err;
    });

  inFlight.set(key, promise);
  const events = await promise;
  return { events, fromCache: false };
}

/** Manually bust the cache (e.g. on pull-to-refresh) */
export function bustTMCache(params) {
  if (params) {
    cache.delete(buildKey(params));
  } else {
    cache.clear();
  }
}