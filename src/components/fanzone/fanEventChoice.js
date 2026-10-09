import { getEventDateDisplay } from '../../lib/eventDateDisplay.js';
import { dedupeEventIdentities, eventVariantLabel } from '../../lib/eventIdentity.js';
import { sellingEventTiming } from '../../lib/sellingEventTiming.js';

export function fanEventOccurrence(event, now = Date.now()) {
  const date = getEventDateDisplay(event)?.showtimeLabel || 'Date and time to be confirmed';
  const timing = sellingEventTiming(event, now);
  const context = ['cancelled', 'canceled'].includes(event.provider_status || event.status) ? 'Cancelled'
    : { upcoming: 'Upcoming', live: 'Current', estimated_live: 'Started · end time unconfirmed', ended: 'Past', unknown: 'Timing unconfirmed' }[timing.status];
  return [date, context, eventVariantLabel(event)].filter(Boolean).join(' · ');
}

export function fanEventHasTicket(event, myEventIds = []) {
  return [event.id, ...(event._eventAliases || [])].some(id => myEventIds.includes(id));
}

export function fanEventChoices(events = [], query = '', myEventIds = []) {
  const keyword = query.trim().toLowerCase();
  return dedupeEventIdentities(events)
    .filter(event => !keyword || [event.title, event.venue, event.city, fanEventOccurrence(event)].some(value => value?.toLowerCase().includes(keyword)))
    .sort((left, right) => Number(fanEventHasTicket(right, myEventIds)) - Number(fanEventHasTicket(left, myEventIds)));
}
