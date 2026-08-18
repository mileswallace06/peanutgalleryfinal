/**
 * Normalize a string for punctuation-insensitive, whitespace-normalized,
 * case-insensitive search matching.
 *
 * @param {string} s - The string to normalize (null/undefined → '')
 * @returns {string} Lowercased, punctuation-stripped, whitespace-collapsed, trimmed.
 */
export function normalizeSearch(s) {
  return (s || '').toLowerCase().replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Check if a keyword matches any of the provided event fields.
 * Uses normalizeSearch for punctuation-insensitive, whitespace-normalized matching.
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