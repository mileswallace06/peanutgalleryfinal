import { reliableTime } from './eventTimestamp.js';

// Shared lifecycle: explicit provider ends win; bounded estimates are labeled.
// Missing, naive, TBA, postponed or inconsistent timing stays unknown.
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
