import { dedupeEventIdentities } from '../../lib/eventIdentity.js';
import { eventOccurrenceLabel } from '../../lib/eventChoiceLabel.js';
export const fanEventOccurrence = eventOccurrenceLabel;

export function fanEventHasTicket(event, myEventIds = []) {
  return [event.id, ...(event._eventAliases || [])].some(id => myEventIds.includes(id));
}

export function fanEventChoices(events = [], query = '', myEventIds = []) {
  const keyword = query.trim().toLowerCase();
  return dedupeEventIdentities(events)
    .filter(event => !keyword || [event.title, event.venue, event.city, fanEventOccurrence(event)].some(value => value?.toLowerCase().includes(keyword)))
    .sort((left, right) => Number(fanEventHasTicket(right, myEventIds)) - Number(fanEventHasTicket(left, myEventIds)));
}
