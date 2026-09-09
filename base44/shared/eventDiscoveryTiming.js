// Display/discovery only. Purchase and transfer eligibility retain eventTiming's
// existing getEventLiveStatus policy.
export const CATEGORY_DURATION_HOURS = { concert: 4, sports: 4, theater: 3, comedy: 3, other: 4 };
export const DEFAULT_DURATION_HOURS = 4;
export const SOON_WINDOW_MINUTES = 60;

export function explicitUtcMs(value) {
  if (typeof value !== 'string' || !/T.*(?:Z|[+-]\d{2}:\d{2})$/i.test(value)) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

export function getEventDiscoveryStatus(event, now = Date.now()) {
  const start = event.discovery_time_unconfirmed ? null : explicitUtcMs(event.event_start_utc || event.date);
  const configured = Number(event.duration_hours);
  const duration = Number.isFinite(configured) && configured > 0 ? configured
    : CATEGORY_DURATION_HOURS[event.category || event.discovery_category] ?? DEFAULT_DURATION_HOURS;
  const suppliedEnd = explicitUtcMs(event.event_end_utc);
  const confirmedEnd = start !== null && suppliedEnd !== null && suppliedEnd > start && !event.end_estimated;
  const end = start === null ? null : confirmedEnd ? suppliedEnd : start + duration * 3600000;
  const status = event.status === 'ended' ? 'ended' : event.is_beta_live ? 'live'
    : start === null ? 'upcoming' : now >= end ? 'ended' : now >= start ? 'live'
    : now >= start - SOON_WINDOW_MINUTES * 60000 ? 'soon' : 'upcoming';
  return { status, start_utc_ms: start, end_utc_ms: end, end_estimated: !confirmedEnd,
    minutes_until_start: start === null ? null : (start - now) / 60000 };
}
