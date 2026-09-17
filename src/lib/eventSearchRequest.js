import { escapeRegex, normalizeSearch } from './searchNormalize.js';

// The selected local area is retained by the caller when nationwide is requested.
export function createEventSearchRequest(keyword = '', location = null, scope = 'local') {
  const cityOverride = scope === 'nationwide' ? null : location?.city?.trim() || null;
  const ll = scope === 'nationwide' || cityOverride ? null : location?.ll || null;
  return {
    keyword: keyword.trim().slice(0, 100),
    scope,
    cityOverride,
    stateOverride: cityOverride ? location?.state || null : null,
    ll,
    locationLabel: scope === 'nationwide' ? 'Nationwide' : cityOverride ? location.label || cityOverride : ll ? 'your location · 50 miles' : 'Choose location',
  };
}

export function buildEventSearchParams({ keyword, cityOverride, stateOverride, ll }) {
  const tmParams = { size: 40 };
  const pgQuery = {};
  if (keyword) {
    tmParams.keyword = keyword;
    const escaped = escapeRegex(normalizeSearch(keyword));
    if (escaped) pgQuery.search_text_normalized = { $regex: escaped, $options: 'i' };
  }
  if (cityOverride) {
    tmParams.city = cityOverride;
    pgQuery.city = { $regex: `^${escapeRegex(cityOverride)}$`, $options: 'i' };
    if (stateOverride) pgQuery.state = { $regex: `^${escapeRegex(stateOverride)}$`, $options: 'i' };
  } else if (ll) {
    tmParams.latlong = ll;
    tmParams.radius = '50';
    const [lat, lng] = ll.split(',').map(Number);
    if (Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180) {
      const radiusKm = 50 * 1.609344;
      const latDelta = radiusKm / 111.32;
      const cosLat = Math.max(0.01, Math.cos((lat * Math.PI) / 180));
      const lngDelta = radiusKm / (111.32 * cosLat);
      pgQuery.venue_lat = { $gte: Math.max(-90, lat - latDelta), $lte: Math.min(90, lat + latDelta) };
      if (lng - lngDelta >= -180 && lng + lngDelta <= 180) {
        pgQuery.venue_lng = { $gte: lng - lngDelta, $lte: lng + lngDelta };
      } else {
        // Dateline-crossing searches still narrow latitude and use the exact
        // client-side haversine check rather than excluding valid longitudes.
        pgQuery.venue_lng = { $ne: null };
      }
    }
  }
  return { tmParams, pgQuery, pgLimit: ll ? 500 : keyword ? 100 : 200 };
}
