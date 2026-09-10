export function isCanonicalEventId(id) { return typeof id === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(id) && !id.startsWith('tm_'); }
function resolved(candidate, record) {
  if (!record || !isCanonicalEventId(record.id)) throw new Error('Event could not be resolved. Please try again.');
  return { ...candidate, ...record, id: record.id, source: 'pg' };
}
export async function resolveSellingEvent(base44, candidate) {
  if (typeof candidate === 'string') {
    if (!isCanonicalEventId(candidate)) throw new Error('This event link is unavailable. Choose an event below.');
    return resolved({}, await base44.entities.Event.get(candidate));
  }
  if (!candidate) throw new Error('Choose an event to continue.');
  if (isCanonicalEventId(candidate.id) && candidate.source !== 'ticketmaster') {
    return resolved(candidate, await base44.entities.Event.get(candidate.id));
  }
  if (!candidate.tm_id) throw new Error('This event could not be identified. Choose another event.');
  const matches = await base44.entities.Event.filter({ tm_id: candidate.tm_id }, '-updated_date', 20, 0);
  if (!Array.isArray(matches)) throw new Error('Event lookup is unavailable. Please try again.');
  if (matches.length) return resolved(candidate, matches[0]);
  // Selection is the only write boundary. Browsing never syncs or creates events.
  const payload = Object.fromEntries(['tm_id', 'title', 'venue', 'city', 'state', 'date', 'image_url', 'tm_url', 'category', 'tm_venue_id', 'venue_lat', 'venue_lng'].map(key => [key, candidate[key]]));
  const response = await base44.functions.invoke('syncTMEvent', payload);
  if (!isCanonicalEventId(response?.data?.id)) throw new Error('Event setup did not complete. Please try again.');
  return resolved(candidate, await base44.entities.Event.get(response.data.id));
}
