/**
 * Search normalization and matching utilities.
 *
 * normalizeSearch: case-insensitive, punctuation-insensitive, whitespace-normalized,
 * AND diacritic-insensitive (NFD decomposition + combining-mark stripping).
 * This makes "Beyonce" match "Beyoncé" and "Loteria" match "Lotería".
 *
 * eventMatchesKeyword: checks title, venue, city, artist fields.
 *
 * haversineDistance: great-circle distance in miles between two lat/lng points.
 * eventWithinRadius: geospatial filter for near-me searches.
 */

/**
 * Normalize a string for search matching.
 * - Lowercase
 * - NFD Unicode decomposition (splits base char from diacritic)
 * - Strip combining diacritical marks (U+0300–U+036F)
 * - Strip remaining punctuation → spaces
 * - Collapse whitespace → single space
 * - Trim
 *
 * @param {string} s - The string to normalize (null/undefined → '')
 * @returns {string}
 */
export function normalizeSearch(s) {
  return (s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')       // strip diacritical marks
    .replace(/[^\w\s]/g, ' ')               // punctuation → space
    .replace(/\s+/g, ' ')                   // collapse whitespace
    .trim();
}

/**
 * Check if a keyword matches any of the event's searchable fields.
 * Uses normalizeSearch for diacritic-insensitive, punctuation-insensitive matching.
 *
 * @param {object} event - Event object with title, venue, city, artist fields
 * @param {string} keyword - Raw search keyword
 * @returns {boolean}
 */
export function eventMatchesKeyword(event, keyword) {
  const kwNorm = normalizeSearch(keyword);
  if (!kwNorm) return true; // empty keyword matches all
  return (
    normalizeSearch(event.title).includes(kwNorm) ||
    normalizeSearch(event.venue).includes(kwNorm) ||
    normalizeSearch(event.city).includes(kwNorm) ||
    normalizeSearch(event.artist).includes(kwNorm)
  );
}

/**
 * Great-circle distance between two lat/lng points using the Haversine formula.
 * @param {number} lat1 - Latitude of point 1
 * @param {number} lng1 - Longitude of point 1
 * @param {number} lat2 - Latitude of point 2
 * @param {number} lng2 - Longitude of point 2
 * @returns {number} Distance in miles
 */
export function haversineDistance(lat1, lng1, lat2, lng2) {
  if (lat1 == null || lng1 == null || lat2 == null || lng2 == null) return Infinity;
  const R = 3958.8; // Earth radius in miles
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/**
 * Check if an event is within a given radius of a point.
 * Events missing coordinates are INCLUDED (safe default — don't hide them).
 *
 * @param {object} event - Event with venue_lat, venue_lng
 * @param {number} lat - Center latitude
 * @param {number} lng - Center longitude
 * @param {number} radiusMiles - Radius in miles
 * @returns {boolean}
 */
export function eventWithinRadius(event, lat, lng, radiusMiles) {
  // Safe default: events without coordinates are always included
  if (event.venue_lat == null || event.venue_lng == null) return true;
  const dist = haversineDistance(lat, lng, event.venue_lat, event.venue_lng);
  return dist <= radiusMiles;
}