/**
 * Shared search normalization for backend functions.
 *
 * normalizeSearch: case-insensitive, diacritic-insensitive, punctuation-stripped,
 * whitespace-normalized string formatting. Identical semantics to the frontend
 * src/lib/searchNormalize.js — kept in sync so search_text_normalized values
 * generated server-side match what the frontend expects.
 *
 * generateSearchTextNormalized: builds the denormalized search blob from event
 * fields (title, artist, venue, city, state). Stored in Event.search_text_normalized
 * and queried server-side with $regex for bounded keyword search.
 *
 * escapeRegex: escapes user input before constructing a RegExp, preventing
 * regex injection and ReDoS.
 */

/**
 * Normalize a string for search matching.
 * @param {string} s
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
 * Generate the normalized search text blob for an Event.
 * Combines title, artist, venue, city, state — all normalized.
 * @param {object} event - Event-like object with title, artist, venue, city, state
 * @returns {string}
 */
export function generateSearchTextNormalized(event) {
  const parts = [
    event.title || '',
    event.artist || '',
    event.venue || '',
    event.city || '',
    event.state || '',
  ];
  return parts.map(normalizeSearch).filter(Boolean).join(' ');
}

/**
 * Escape a string for safe use in a RegExp.
 * @param {string} s
 * @returns {string}
 */
export function escapeRegex(s) {
  return (s || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}