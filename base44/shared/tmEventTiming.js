import { reliableTMTimestamp } from './tmResponseHandler.js';

const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value || {}, key);

export const TM_EVENT_TIMING_FIELDS = Object.freeze([
  'event_start_local',
  'event_start_utc',
  'event_end_utc',
  'venue_timezone',
  'date_tba',
  'time_tba',
  'no_specific_time',
  'end_time_invalid',
  'provider_status',
]);

export function reliableLocalTimestamp(value) {
  if (typeof value !== 'string') return null;
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/);
  if (!match) return null;
  const [, yearText, monthText, dayText, hourText, minuteText, secondText = '0'] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  if (month < 1 || month > 12 || day < 1 || day > new Date(Date.UTC(year, month, 0)).getUTCDate()) return null;
  if (hour > 23 || minute > 59 || second > 59) return null;
  return value;
}

export function validIanaTimezone(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value }).format(0);
    return value;
  } catch {
    return null;
  }
}

/**
 * Build the provider-owned timing portion of an Event upsert.
 *
 * Missing fields mean "caller has no fresh provider value" and preserve the
 * existing record. Explicit null/false fields are retained so a Ticketmaster
 * refresh can clear stale data after a reschedule or TBA change.
 */
export function buildTMEventTimingPatch(body = {}, existing = {}) {
  const patch = {};
  const startProvided = hasOwn(body, 'event_start_utc');
  const legacyDateProvided = hasOwn(body, 'date');
  const incomingStart = startProvided
    ? reliableTMTimestamp(body.event_start_utc)
    : reliableTMTimestamp(body.date);
  const previousStart = reliableTMTimestamp(existing.event_start_utc)
    || reliableTMTimestamp(existing.date);

  // An offset-bearing legacy date can backfill the canonical field. A naive
  // legacy date is never interpreted in the server or device timezone.
  if (startProvided || (legacyDateProvided && incomingStart)) {
    patch.event_start_utc = incomingStart;
    patch.date = incomingStart;
  }

  if (hasOwn(body, 'event_start_local')) {
    patch.event_start_local = reliableLocalTimestamp(body.event_start_local);
  }

  if (hasOwn(body, 'venue_timezone')) {
    // Provider refreshes may explicitly remove or correct a timezone. Preserve
    // that signal so a reschedule cannot combine fresh timing with a stale zone.
    patch.venue_timezone = validIanaTimezone(body.venue_timezone);
  }

  const effectiveStart = hasOwn(patch, 'event_start_utc')
    ? patch.event_start_utc
    : previousStart;

  for (const key of ['date_tba', 'time_tba', 'no_specific_time', 'end_time_invalid']) {
    if (hasOwn(body, key)) patch[key] = body[key] === true;
  }

  if (hasOwn(body, 'event_end_utc')) {
    const end = reliableTMTimestamp(body.event_end_utc);
    patch.event_end_utc = end && effectiveStart && Date.parse(end) > Date.parse(effectiveStart)
      ? end
      : null;
    if (body.event_end_utc && !patch.event_end_utc) patch.end_time_invalid = true;
  } else if (hasOwn(patch, 'event_start_utc') && patch.event_start_utc !== previousStart) {
    // A changed start cannot retain an end belonging to the old performance.
    patch.event_end_utc = null;
  }

  if (hasOwn(body, 'provider_status')) {
    patch.provider_status = typeof body.provider_status === 'string' && body.provider_status.trim()
      ? body.provider_status.trim().toLowerCase().slice(0, 64)
      : null;
  }

  return patch;
}
