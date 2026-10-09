import { sellingEventTiming } from './eventLifecycle.js';

export function listingEventEligibility(event, nowMs = Date.now()) {
  if (!event) return { allowed: false, code: 'EVENT_UNAVAILABLE', message: 'We could not find this event. Choose another event or retry.' };
  const timing = sellingEventTiming(event, nowMs);
  if (timing.status === 'ended') return {
    allowed: false, code: 'EVENT_ENDED', timing,
    message: 'This event has ended or is no longer open for listings. Choose a current event to list your seats.',
  };
  return { allowed: true, code: null, timing };
}

/** Fresh authorized read before any frontend submission path. No writes. */
export async function checkListingEvent(client, eventId, now = Date.now) {
  if (typeof eventId !== 'string' || !eventId) throw new Error('Choose an event before listing your seats.');
  let records;
  try { records = await client.entities.Event.filter({ id: eventId }); }
  catch { throw new Error('We could not check whether this event is still open. Retry before saving your listing.'); }
  if (!Array.isArray(records)) throw new Error('We could not check whether this event is still open. Retry before saving your listing.');
  const event = records.find(record => record.id === eventId);
  return { event, ...listingEventEligibility(event, now()) };
}
