/* global URLSearchParams */
export const ONGOING_LOOKBACK_HOURS = 12;
export const ONGOING_RESULT_LIMIT = 40;
const numeric = value => (typeof value === 'number' || (typeof value === 'string' && value.trim() !== '')) && Number.isFinite(Number(value));

// Server-owned windows only. No caller-controlled pagination or historical dates.
export function buildTMDiscoveryRequest(body, now = Date.now()) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { error: 'invalid_body' };
  const mode = body.discoveryWindow === undefined ? 'future' : body.discoveryWindow;
  if (!['future', 'ongoing'].includes(mode)) return { error: 'invalid_discovery_window' };
  if (['startDateTime', 'endDateTime', 'startEndDateTime', 'localStartDateTime', 'localStartEndDateTime', 'lookback', 'lookbackHours', 'page'].some(key => key in body)) return { error: 'unsupported_time_window' };
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
  const limit = mode === 'ongoing' ? Math.min(Number(size), ONGOING_RESULT_LIMIT) : Number(size);
  const format = time => new Date(time).toISOString().split('.')[0] + 'Z';
  const boundary = format(now), since = format(now - ONGOING_LOOKBACK_HOURS * 3600000);
  const params = new URLSearchParams({ size: String(limit), sort: mode === 'ongoing' ? 'date,desc' : 'date,asc', startDateTime: mode === 'ongoing' ? since : boundary, countryCode: 'US' });
  if (mode === 'ongoing') params.set('endDateTime', boundary);
  if (keyword) params.set('keyword', keyword);
  if (latlong) { params.set('latlong', latlong); params.set('radius', String(Number(radius))); params.set('unit', 'miles'); }
  else if (city) params.set('city', city);
  return { params, mode, limit, since, boundary };
}

export function ongoingCoverage(query, data, count) {
  if (query.mode !== 'ongoing') return undefined;
  const total = data?.page?.totalElements;
  const validTotal = Number.isInteger(total) && total >= count;
  return { discoveryWindow: 'ongoing', lookbackHours: ONGOING_LOOKBACK_HOURS, startDateTime: query.since, endDateTime: query.boundary,
    limit: query.limit, returned: count, totalCandidates: validTotal ? total : null,
    truncated: validTotal ? total > count : count >= query.limit, paginationKnown: validTotal };
}
