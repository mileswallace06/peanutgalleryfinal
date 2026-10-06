import { reliableTime } from './eventTimestamp.js';
import { getEventDateDisplay } from './eventDateDisplay.js';
import { withMatchingProviderTimezone } from './providerVenueTimezone.js';
export { reliableTime } from './eventTimestamp.js';
export const SELLING_LOOKBACK_HOURS = 12;
export const MAX_ESTIMATED_HOURS = 8;
const HOUR = 3600000;
const DEFAULT_HOURS = { concert: 4, sports: 4, theater: 3, comedy: 3, other: 4 };
export function sellingEventTiming(event, now = Date.now()) {
  const start = reliableTime(event.event_start_utc || event.date);
  const rawEnd = event.event_end_utc || event.end_date;
  const end = reliableTime(rawEnd);
  if (event.is_beta_live || event.status === 'ended' || ['cancelled', 'canceled'].includes(event.status) || ['cancelled', 'canceled'].includes(event.provider_status)) return { status: 'ended', start, end };
  if (event.end_time_invalid || event.provider_status === 'postponed' || start === null || event.date_tba || event.time_tba || event.no_specific_time || (rawEnd && (end === null || end <= start))) return { status: 'unknown', start: null, end: null };
  if (now < start) return { status: 'upcoming', start, end };
  if (end !== null) return { status: now < end ? 'live' : 'ended', start, end };
  const configured = Number(event.duration_hours);
  const hours = configured > 0 ? Math.min(MAX_ESTIMATED_HOURS, Math.max(0.5, configured)) : DEFAULT_HOURS[event.category] || 4;
  const estimatedEnd = start + hours * HOUR;
  return { status: now < estimatedEnd ? 'estimated_live' : 'ended', start, end: estimatedEnd, estimatedHours: hours };
}
export function sellingEventList(events, mode = 'all', now = Date.now()) {
  const live = status => status === 'live' || status === 'estimated_live';
  return events.filter(e => !e.is_beta_live).map(event => ({ event, timing: sellingEventTiming(event, now) }))
    .filter(({ timing }) => timing.status !== 'ended' && (mode === 'all' || (mode === 'live' ? live(timing.status) : timing.status === 'upcoming')))
    .sort((a, b) => Number(live(b.timing.status)) - Number(live(a.timing.status)) || (a.timing.start ?? Infinity) - (b.timing.start ?? Infinity));
}
export function sellingEventDate(event, now = Date.now()) {
  const timing = sellingEventTiming(event, now);
  if (timing.start === null) return 'Date and time to be confirmed';
  return getEventDateDisplay(event)?.showtimeLabel || 'Date and time to be confirmed';
}
export const SELLING_STATUS_LABELS = { live: 'Live now', estimated_live: 'Live · estimated window', upcoming: 'Upcoming', unknown: 'Time unconfirmed', ended: 'Ended' };

// Fresh provider timing travels with the selected object. Only venue_timezone
// is also persisted by the sync payload; other timing/status reconciliation stays local.
export function withProviderTiming(event) {
  const fields = ['event_start_utc', 'event_end_utc', 'date', 'venue_timezone', 'date_tba', 'time_tba', 'no_specific_time', 'end_time_invalid', 'provider_status'];
  const timing = Object.fromEntries(fields.filter(key => Object.hasOwn(event, key)).map(key => [key, event[key]]));
  return { ...event, _providerTiming: timing };
}

export function applyProviderTiming(record, timing, provider) {
  if (!timing) return record;
  const sameStart = reliableTime(record.event_start_utc || record.date) === reliableTime(timing.event_start_utc || timing.date);
  return { ...record, ...timing,
    event_end_utc: timing.event_end_utc || (sameStart ? record.event_end_utc : null),
    end_date: sameStart ? record.end_date : null,
    venue_timezone: withMatchingProviderTimezone(record, provider).venue_timezone,
  };
}
