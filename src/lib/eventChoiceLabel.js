import { getEventDateDisplay } from './eventDateDisplay.js';
import { eventIdentityLabel } from './eventIdentity.js';
import { sellingEventTiming } from './sellingEventTiming.js';

export function eventOccurrenceLabel(event, now = Date.now(), options = {}) {
  const date = getEventDateDisplay(event)?.showtimeLabel || 'Date and time to be confirmed';
  const timing = sellingEventTiming(event, now);
  const context = ['cancelled', 'canceled'].includes(event?.provider_status || event?.status) ? 'Cancelled'
    : { upcoming: 'Upcoming', live: 'Current', estimated_live: 'Started · end time unconfirmed', ended: 'Past', unknown: 'Timing unconfirmed' }[timing.status];
  return [date, context, eventIdentityLabel(event, options)].filter(Boolean).join(' · ');
}

export function eventChoiceLabel(event, now = Date.now(), options = {}) {
  return [event?.title || 'Untitled event', [event?.venue, event?.city, event?.state].filter(Boolean).join(', ') || 'Venue unconfirmed', eventOccurrenceLabel(event, now, options)].join(' · ');
}
