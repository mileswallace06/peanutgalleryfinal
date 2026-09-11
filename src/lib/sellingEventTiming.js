import { formatInVenueTimezone, resolveTimezone } from './eventTiming.js';
export const SELLING_LOOKBACK_HOURS = 12;
export const MAX_ESTIMATED_HOURS = 8;
const HOUR = 3600000;
const DEFAULT_HOURS = { concert: 4, sports: 4, theater: 3, comedy: 3, other: 4 };
export function reliableTime(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return null;
  const [year, month, day, hour, minute] = value.slice(0, 16).split(/[-T:]/).map(Number);
  const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (month < 1 || month > 12 || day < 1 || day > days || hour > 23 || minute > 59) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}
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
  return formatInVenueTimezone(timing.start, resolveTimezone(event).timezone);
}
export const SELLING_STATUS_LABELS = { live: 'Live now', estimated_live: 'Live · estimated window', upcoming: 'Upcoming', unknown: 'Time unconfirmed', ended: 'Ended' };

// Fresh provider timing travels with the selected object, never in the sync payload.
export function withProviderTiming(event) {
  const fields = ['event_start_utc', 'event_end_utc', 'date', 'venue_timezone', 'date_tba', 'time_tba', 'no_specific_time', 'end_time_invalid', 'provider_status'];
  const timing = Object.fromEntries(fields.filter(key => Object.hasOwn(event, key)).map(key => [key, event[key]]));
  return { ...event, _providerTiming: timing };
}

export function applyProviderTiming(record, timing) {
  if (!timing) return record;
  const sameStart = reliableTime(record.event_start_utc || record.date) === reliableTime(timing.event_start_utc || timing.date);
  return { ...record, ...timing,
    event_end_utc: timing.event_end_utc || (sameStart ? record.event_end_utc : null),
    end_date: sameStart ? record.end_date : null,
    venue_timezone: timing.venue_timezone || record.venue_timezone,
  };
}
