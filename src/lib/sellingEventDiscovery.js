import { buildEventSearchParams } from './eventSearchRequest.js';
import { createDiscoveryPager, advanceDiscoveryPager, discoveryPagerResult } from './eventDiscoveryPager.js';
import { SELLING_LOOKBACK_HOURS } from './sellingEventTiming.js';
export function sellingPGQueries(request, now = Date.now()) {
  const { pgQuery, pgLimit } = buildEventSearchParams(request);
  const boundary = new Date(now).toISOString();
  const since = new Date(now - SELLING_LOOKBACK_HOURS * 3600000).toISOString();
  return { limit: pgLimit, future: { ...pgQuery, $or: [{ event_start_utc: { $gte: boundary } }, { date: { $gte: boundary } }] }, ongoing: { ...pgQuery, $or: [
    { event_start_utc: { $gte: since, $lt: boundary } }, { date: { $gte: since, $lt: boundary } },
    { event_end_utc: { $gt: boundary } }, { end_date: { $gt: boundary } }, { status: 'live' },
  ] } };
}
export async function fetchSellingEvents(base44, request, refresh = false, now = Date.now()) {
  const pager = await advanceDiscoveryPager(base44, createDiscoveryPager(request, now, true), { refresh });
  return { ...discoveryPagerResult(pager), pager };
}
