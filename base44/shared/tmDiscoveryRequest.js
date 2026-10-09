/* global URLSearchParams */
export const ONGOING_LOOKBACK_HOURS = 12;
export const ONGOING_RESULT_LIMIT = 40;
const numeric = value => (typeof value === 'number' || (typeof value === 'string' && value.trim() !== '')) && Number.isFinite(Number(value));

// Validated, bounded public discovery inputs. Ongoing keeps its fixed lookback.
export function buildTMDiscoveryRequest(body, now = Date.now()) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { error: 'invalid_body' };
  const mode = body.discoveryWindow === undefined ? 'future' : body.discoveryWindow;
  if (!['future', 'ongoing'].includes(mode)) return { error: 'invalid_discovery_window' };
  if (['startDateTime', 'endDateTime', 'startEndDateTime', 'localStartDateTime', 'localStartEndDateTime', 'lookback', 'lookbackHours'].some(key => key in body)) return { error: 'unsupported_time_window' };
  const keyword = body.keyword ?? '', city = body.city ?? '', latlong = body.latlong ?? '';
  const radius = body.radius ?? '50', size = body.size ?? 20;
  if (typeof keyword !== 'string' || keyword.length > 100) return { error: 'invalid_keyword' };
  if (typeof city !== 'string' || city.length > 100) return { error: 'invalid_city' };
  if (typeof latlong !== 'string') return { error: 'invalid_latlong' };
  if (latlong) {
    const parts = latlong.split(',');
    if (parts.length !== 2 || !parts.every(numeric) || Math.abs(Number(parts[0])) > 90 || Math.abs(Number(parts[1])) > 180) return { error: 'invalid_latlong' };
  }
  if (!numeric(radius) || Number(radius) < 1 || Number(radius) > 500) return { error: 'invalid_radius' };
  if (!numeric(size) || !Number.isInteger(Number(size)) || Number(size) < 1 || Number(size) > 200) return { error: 'invalid_size' };
  const page = body.page ?? 0;
  if (!Number.isInteger(page) || page < 0) return { error: 'invalid_page' };
  if (body.sort !== undefined && !['soonest', 'latest'].includes(body.sort)) return { error: 'invalid_sort' };
  if (body.includePast !== undefined && typeof body.includePast !== 'boolean') return { error: 'invalid_include_past' };
  if (body.stateCode !== undefined && (typeof body.stateCode !== 'string' || !/^[A-Z]{2}$/.test(body.stateCode))) return { error: 'invalid_state' };
  if (body.asOf !== undefined && (typeof body.asOf !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(body.asOf) || !Number.isFinite(Date.parse(body.asOf)))) return { error: 'invalid_as_of' };
  const snapshot = body.asOf === undefined ? now : Date.parse(body.asOf);
  const limit = mode === 'ongoing' ? Math.min(Number(size), ONGOING_RESULT_LIMIT) : Number(size);
  if (page * limit >= 1000) return { error: 'provider_page_limit' };
  const format = time => new Date(time).toISOString().split('.')[0] + 'Z';
  const boundary = format(snapshot), since = format(snapshot - ONGOING_LOOKBACK_HOURS * 3600000);
  const params = new URLSearchParams({ size: String(limit), sort: mode === 'ongoing' || body.sort === 'latest' ? 'date,desc' : 'date,asc', startDateTime: mode === 'ongoing' ? since : boundary, countryCode: 'US' });
  if (mode === 'ongoing') params.set('endDateTime', boundary);
  if (body.includePast === true && mode !== 'ongoing') params.delete('startDateTime');
  if (body.page !== undefined) params.set('page', String(page));
  if (body.stateCode) params.set('stateCode', body.stateCode);
  if (keyword) params.set('keyword', keyword);
  if (latlong) { params.set('latlong', latlong); params.set('radius', String(Number(radius))); params.set('unit', 'miles'); }
  else if (city) params.set('city', city);
  return { params, mode, limit, since, boundary, page, paginated: body.page !== undefined };
}

export function ongoingCoverage(query, data, count) {
  if (query.mode !== 'ongoing') return undefined;
  const total = data?.page?.totalElements;
  const validTotal = Number.isInteger(total) && total >= count;
  return { discoveryWindow: 'ongoing', lookbackHours: ONGOING_LOOKBACK_HOURS, startDateTime: query.since, endDateTime: query.boundary,
    limit: query.limit, returned: count, totalCandidates: validTotal ? total : null,
    truncated: validTotal ? total > count : count >= query.limit, paginationKnown: validTotal };
}

// Keep provider progress explicit; absent metadata never means a verified total.
export function discoveryPagination(query, data, count) {
  const total = data?.page?.totalElements;
  const pages = data?.page?.totalPages;
  const known = Number.isInteger(total) && total >= 0 && Number.isInteger(pages) && pages >= 0;
  const more = known ? query.page + 1 < pages : count >= query.limit;
  const capped = more && (query.page + 1) * query.limit >= 1000;
  return { page: query.page, size: query.limit, total: known ? total : null,
    hasMore: more && !capped, nextPage: more && !capped ? query.page + 1 : null,
    truncated: capped, metadataKnown: known };
}
