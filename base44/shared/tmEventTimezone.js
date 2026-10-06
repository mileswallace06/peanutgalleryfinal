/** Keep a provider's venue timezone without guessing from the viewer or state. */
export function validVenueTimezone(value) {
  if (typeof value !== 'string') return null;
  const timeZone = value.trim();
  // Named TZ database zones (including UTC/GMT), never a bare numeric offset.
  if (!timeZone || timeZone.length > 100 || /^[+-]/.test(timeZone)) return null;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone }).format(0);
    return timeZone;
  } catch {
    return null;
  }
}

const identityPart = (value) => typeof value === 'string'
  ? value.trim().normalize('NFKC').replace(/\s+/g, ' ').toLowerCase()
  : '';

function sameVenue(saved, incoming) {
  const savedId = typeof saved.tm_venue_id === 'string' ? saved.tm_venue_id.trim() : '';
  const incomingId = typeof incoming.tm_venue_id === 'string' ? incoming.tm_venue_id.trim() : '';
  const keys = ['venue', 'city', 'state'];
  const savedParts = keys.map((key) => identityPart(saved[key]));
  const incomingParts = keys.map((key) => identityPart(incoming[key]));
  const completeIdentity = savedParts.every(Boolean) && incomingParts.every(Boolean);
  const matchingIdentity = completeIdentity && savedParts.every((part, index) => part === incomingParts[index]);
  const conflictingIdentity = savedParts.some((part, index) =>
    part && incomingParts[index] && part !== incomingParts[index]);
  if (savedId && incomingId) {
    // The legacy sync also refreshes tm_venue_id. A repeated payload must not
    // bypass the guard merely because an earlier sync changed that ID while
    // leaving the saved event's venue/city/state unchanged.
    return savedId === incomingId && !conflictingIdentity;
  }

  // Older records may lack the stable provider ID. Require the complete stored
  // venue identity before filling their timezone, never just the event title.
  return matchingIdentity;
}

/**
 * A valid saved timezone is authoritative. Backfill legacy missing/invalid
 * values only from validated metadata for the same venue. New records may
 * accept the validated payload directly because it supplies their venue too.
 */
export function tmEventTimezonePatch(saved, incoming) {
  if (saved && validVenueTimezone(saved.venue_timezone)) return {};
  const venue_timezone = validVenueTimezone(incoming?.venue_timezone);
  if (!venue_timezone || (saved && !sameVenue(saved, incoming))) return {};
  return { venue_timezone };
}
