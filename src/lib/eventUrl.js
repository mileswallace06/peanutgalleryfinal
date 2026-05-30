/**
 * getEventUrl(event) — canonical event URL helper.
 *
 * Rules:
 * - PG events (have a real DB id that doesn't start with tm_) → /events/:id
 * - TM-only events (id is fake tm_xxx OR source is ticketmaster) → /events/tm/:tmId
 *   BUT only if we have a valid tm_id. If we don't, return null (suppress the link).
 *
 * NEVER route users to /events/tm_xxx — that route doesn't exist.
 * NEVER route users to /upgrades/tm_xxx — that route doesn't exist.
 *
 * For upgrade links, use getUpgradeUrl(event) which mirrors this logic.
 */

export function getEventUrl(event) {
  if (!event) return null;

  const id = event.id ? String(event.id) : null;
  const isFakeTmId = id && id.startsWith('tm_');
  const isTMSource = event.source === 'ticketmaster';

  // Real PG DB record
  if (id && !isFakeTmId) {
    return `/events/${id}`;
  }

  // TM-only: route to TM detail page
  const tmId = event.tm_id || (isFakeTmId ? id.replace('tm_', '') : null);
  if (tmId && tmId !== 'undefined' && tmId !== 'null') {
    return `/events/tm/${tmId}`;
  }

  // No valid ID at all — suppress link
  return null;
}

export function getUpgradeUrl(event) {
  if (!event) return null;

  const id = event.id ? String(event.id) : null;
  const isFakeTmId = id && id.startsWith('tm_');

  // Real PG DB record
  if (id && !isFakeTmId) {
    return `/upgrades/${id}`;
  }

  // TM-only events don't have an upgrade detail page; fall back to TM detail
  const tmId = event.tm_id || (isFakeTmId ? id.replace('tm_', '') : null);
  if (tmId && tmId !== 'undefined' && tmId !== 'null') {
    return `/events/tm/${tmId}`;
  }

  return null;
}