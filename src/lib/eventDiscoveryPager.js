import { buildDiscoveryStreams, DISCOVERY_PAGE_SIZE } from './eventSearchRequest.js';
import { mergeEventSources } from './eventSourceMerger.js';
import { compareDiscoveryEvents } from './eventIdentity.js';
import { fetchTMEvents, bustTMCache } from './tmCache.js';
import { withProviderTiming, applyProviderTiming } from './sellingEventTiming.js';

const fulfilled = value => ({ status: 'fulfilled', value });
const combine = (...clauses) => ({ $and: clauses });

// SDK sort supports one field. Drain the boundary timestamp ordered by unique
// ID before advancing dates, so a page of simultaneous shows cannot skip rows.
export async function readLocalDiscoveryPage(client, stream, cursor = null, limit = DISCOVERY_PAGE_SIZE) {
  const read = async (query, sort, count) => {
    const rows = await client.entities.Event.filter(query, sort, count, 0);
    if (!Array.isArray(rows)) throw new Error('invalid_pg_response');
    return rows;
  };
  const rows = [];
  const field = stream.field, op = stream.direction === '-' ? '$lt' : '$gt';
  if (cursor) {
    const tail = await read(combine(stream.query, { [field]: cursor.time, id: { $gt: cursor.id } }), 'id', limit);
    rows.push(...tail);
    if (rows.length === limit) return { rows, cursor: { time: cursor.time, id: rows.at(-1).id }, hasMore: true };
  }
  const remaining = limit - rows.length;
  const nextQuery = cursor ? combine(stream.query, { [field]: { [op]: cursor.time } }) : stream.query;
  const next = await read(nextQuery, `${stream.direction}${field}`, remaining);
  const stableSort = (a, b) => (stream.direction === '-' ? -1 : 1) * String(a[field] || '').localeCompare(String(b[field] || '')) || String(a.id).localeCompare(String(b.id));
  if (next.length < remaining) {
    rows.push(...next.sort(stableSort));
    return { rows, cursor: rows.length ? { time: rows.at(-1)[field], id: rows.at(-1).id } : cursor, hasMore: false };
  }
  const boundary = next.at(-1)[field];
  rows.push(...next.filter(event => event[field] !== boundary).sort(stableSort));
  const boundaryRows = await read(combine(stream.query, { [field]: boundary }), 'id', limit - rows.length);
  rows.push(...boundaryRows);
  if (!boundaryRows.length) throw new Error('catalog_changed_retry_page');
  return { rows, cursor: { time: boundary, id: boundaryRows.at(-1).id }, hasMore: true };
}

export function createDiscoveryPager(request, now = Date.now(), selling = false) {
  return { request, now, selling, streams: Object.fromEntries(Object.entries(buildDiscoveryStreams(request, now, selling)).map(([name, spec]) => [name, { ...spec, rows: [], cursor: null, page: 0, pagesLoaded: 0, hasMore: true, error: null, truncated: false }])) };
}

export async function advanceDiscoveryPager(client, previous, { retryFailed = false, refresh = false } = {}) {
  const streams = { ...previous.streams };
  const entries = Object.entries(streams).filter(([, stream]) => retryFailed ? !!stream.error : stream.hasMore && !stream.error);
  await Promise.all(entries.map(async ([name, stream]) => {
    try {
      let page;
      if (stream.kind === 'local') page = await readLocalDiscoveryPage(client, stream, stream.cursor);
      else {
        const params = { ...stream.params, page: stream.page };
        if (refresh || retryFailed) bustTMCache(params);
        const response = await fetchTMEvents(client, params);
        const meta = response.pagination;
        // Old deployed backend must not silently pretend to paginate.
        if (!meta || meta.page !== stream.page || typeof meta.hasMore !== 'boolean' || (meta.hasMore && meta.nextPage !== stream.page + 1)) throw new Error('pagination_contract_unavailable');
        page = { rows: response.events, hasMore: meta.hasMore, nextPage: meta.nextPage, truncated: meta.truncated, coverage: response.coverage };
      }
      const map = new Map(stream.rows.map(row => [row.id || row.tm_id, row]));
      for (const row of page.rows) map.set(row.id || row.tm_id, row);
      streams[name] = { ...stream, pagesLoaded: stream.pagesLoaded + 1, rows: [...map.values()], cursor: page.cursor || stream.cursor, page: page.nextPage ?? stream.page, hasMore: page.hasMore, error: null, truncated: !!page.truncated, coverage: page.coverage };
    } catch (error) {
      streams[name] = { ...stream, error: { message: error?.message || 'source_unavailable', status: error?.response?.status || error?.status || null } };
    }
  }));
  return { ...previous, streams };
}

export function discoveryPagerResult(pager) {
  const entries = Object.entries(pager.streams), local = entries.filter(([, value]) => value.kind === 'local'), provider = entries.filter(([, value]) => value.kind === 'provider');
  let localRows = local.flatMap(([, value]) => value.rows), providerRows = provider.flatMap(([, value]) => value.rows);
  if (pager.selling) {
    providerRows = providerRows.map(withProviderTiming);
    const byId = new Map(providerRows.map(event => [event.tm_id, event]));
    localRows = localRows.map(event => {
      const current = byId.get(event.tm_id);
      return current ? { ...applyProviderTiming(event, current._providerTiming, current), _providerTiming: current._providerTiming } : event;
    });
  }
  const merged = mergeEventSources({ localResult: fulfilled(localRows), tmResult: fulfilled({ events: providerRows }), filters: { ...pager.request, now: pager.now, includePast: pager.request.includePast, includeStarted: pager.selling, tmKeywordApplied: true } });
  const pgError = local.some(([, value]) => value.error), tmError = provider.some(([, value]) => value.error);
  return { events: merged.events.sort((a, b) => compareDiscoveryEvents(a, b, pager.request.sort)), pgError, tmError, hasMore: entries.some(([, value]) => value.hasMore && !value.error),
    limited: entries.some(([, value]) => value.hasMore || value.truncated || value.error), truncated: entries.some(([, value]) => value.truncated),
    exhausted: entries.every(([, value]) => !value.hasMore && !value.error && !value.truncated),
    tmOngoingError: !!pager.streams.providerOngoing?.error, ongoingCoverage: pager.streams.providerOngoing?.coverage || null,
    rateLimited: entries.some(([, value]) => value.error?.status === 429), sources: Object.fromEntries(entries.map(([name, value]) => [name, { loaded: value.rows.length, hasMore: value.hasMore, error: value.error, truncated: value.truncated }])) };
}
