/**
 * eventTiming.js
 * ──────────────
 * Single source of truth for all event live/upcoming/ended logic.
 *
 * Rules:
 *  - All comparisons use UTC milliseconds only.
 *  - event_start_utc is the canonical start time (ISO string stored on the Event).
 *  - Falls back to event.date if event_start_utc is absent (migration path).
 *  - Never uses the browser's local timezone for live detection.
 *  - Never compares naive date strings.
 */

/** Category default durations in hours */
const CATEGORY_DURATION_HOURS = {
  concert: 4,
  sports: 4,
  theater: 3,
  comedy: 3,
  other: 4,
};
const DEFAULT_DURATION_HOURS = 4;

/** Minutes before start that the event shows as "Starting Soon" in Upgrades */
export const SOON_WINDOW_MINUTES = 60;

/**
 * Well-known US state → IANA timezone fallback map.
 * Used only when venue_timezone is missing.
 */
const STATE_TZ_FALLBACK = {
  AK: 'America/Anchorage',
  AL: 'America/Chicago',
  AR: 'America/Chicago',
  AZ: 'America/Phoenix',
  CA: 'America/Los_Angeles',
  CO: 'America/Denver',
  CT: 'America/New_York',
  DC: 'America/New_York',
  DE: 'America/New_York',
  FL: 'America/New_York',
  GA: 'America/New_York',
  HI: 'Pacific/Honolulu',
  IA: 'America/Chicago',
  ID: 'America/Denver',
  IL: 'America/Chicago',
  IN: 'America/Indiana/Indianapolis',
  KS: 'America/Chicago',
  KY: 'America/New_York',
  LA: 'America/Chicago',
  MA: 'America/New_York',
  MD: 'America/New_York',
  ME: 'America/New_York',
  MI: 'America/Detroit',
  MN: 'America/Chicago',
  MO: 'America/Chicago',
  MS: 'America/Chicago',
  MT: 'America/Denver',
  NC: 'America/New_York',
  ND: 'America/Chicago',
  NE: 'America/Chicago',
  NH: 'America/New_York',
  NJ: 'America/New_York',
  NM: 'America/Denver',
  NV: 'America/Los_Angeles',
  NY: 'America/New_York',
  OH: 'America/New_York',
  OK: 'America/Chicago',
  OR: 'America/Los_Angeles',
  PA: 'America/New_York',
  RI: 'America/New_York',
  SC: 'America/New_York',
  SD: 'America/Chicago',
  TN: 'America/Chicago',
  TX: 'America/Chicago',
  UT: 'America/Denver',
  VA: 'America/New_York',
  VT: 'America/New_York',
  WA: 'America/Los_Angeles',
  WI: 'America/Chicago',
  WV: 'America/New_York',
  WY: 'America/Denver',
};

/**
 * Resolve the effective UTC start timestamp (ms) for an event.
 * Priority: event_start_utc → event.date (both treated as UTC ISO strings).
 */
function resolveStartUtcMs(event) {
  const raw = event.event_start_utc || event.date;
  if (!raw) return null;
  const ms = new Date(raw).getTime();
  return isNaN(ms) ? null : ms;
}

/**
 * Resolve duration in hours for an event.
 */
function resolveDurationHours(event) {
  if (event.duration_hours && event.duration_hours > 0) return event.duration_hours;
  return CATEGORY_DURATION_HOURS[event.category] ?? DEFAULT_DURATION_HOURS;
}

/**
 * Detect missing/fallback timezone and return a warning if needed.
 * Returns { timezone: string, warning: string|null }
 */
export function resolveTimezone(event) {
  if (event.venue_timezone) {
    return { timezone: event.venue_timezone, warning: null };
  }
  const state = event.state?.trim().toUpperCase();
  const fallback = STATE_TZ_FALLBACK[state];
  if (fallback) {
    return {
      timezone: fallback,
      warning: `No venue_timezone set. Using state fallback: ${fallback} (${state}).`,
    };
  }
  return {
    timezone: 'UTC',
    warning: 'No venue_timezone or state set. Falling back to UTC — times may be wrong!',
  };
}

/**
 * Core status calculator.
 *
 * @param {object} event  - Event entity record
 * @param {number} [nowMs] - Override for current UTC ms (for testing). Defaults to Date.now().
 * @returns {{
 *   status: 'upcoming'|'soon'|'live'|'ended',
 *   is_beta_live: boolean,
 *   start_utc_ms: number|null,
 *   end_utc_ms: number|null,
 *   duration_hours: number,
 *   minutes_until_start: number|null,
 *   minutes_since_start: number|null,
 *   minutes_until_end: number|null,
 *   timezone_warning: string|null,
 * }}
 */
export function getEventLiveStatus(event, nowMs) {
  const now = nowMs ?? Date.now();

  // Beta override — admin-forced live
  if (event.is_beta_live) {
    return {
      status: 'live',
      is_beta_live: true,
      start_utc_ms: null,
      end_utc_ms: null,
      duration_hours: resolveDurationHours(event),
      minutes_until_start: 0,
      minutes_since_start: 0,
      minutes_until_end: 999,
      timezone_warning: null,
    };
  }

  const startMs = resolveStartUtcMs(event);
  const { warning } = resolveTimezone(event);

  if (startMs === null) {
    return {
      status: 'upcoming',
      is_beta_live: false,
      start_utc_ms: null,
      end_utc_ms: null,
      duration_hours: resolveDurationHours(event),
      minutes_until_start: null,
      minutes_since_start: null,
      minutes_until_end: null,
      timezone_warning: warning ?? 'No start time set.',
    };
  }

  const durationHours = resolveDurationHours(event);
  const endMs = startMs + durationHours * 60 * 60 * 1000;
  const minutesUntilStart = (startMs - now) / 60000;
  const minutesSinceStart = (now - startMs) / 60000;
  const minutesUntilEnd = (endMs - now) / 60000;

  let status;
  if (now < startMs - SOON_WINDOW_MINUTES * 60000) {
    status = 'upcoming';
  } else if (now < startMs) {
    status = 'soon';          // within 60 min of start
  } else if (now <= endMs) {
    status = 'live';
  } else {
    status = 'ended';
  }

  return {
    status,
    is_beta_live: false,
    start_utc_ms: startMs,
    end_utc_ms: endMs,
    duration_hours: durationHours,
    minutes_until_start: minutesUntilStart,
    minutes_since_start: minutesSinceStart,
    minutes_until_end: minutesUntilEnd,
    timezone_warning: warning,
  };
}

/**
 * Convenience booleans built on top of getEventLiveStatus.
 */
export function isEventLive(event, nowMs) {
  const s = getEventLiveStatus(event, nowMs).status;
  return s === 'live';
}

export function isEventSoonOrLive(event, nowMs) {
  const s = getEventLiveStatus(event, nowMs).status;
  return s === 'live' || s === 'soon';
}

export function isEventUpcoming(event, nowMs) {
  const s = getEventLiveStatus(event, nowMs).status;
  return s === 'upcoming' || s === 'soon';
}

export function isEventEnded(event, nowMs) {
  return getEventLiveStatus(event, nowMs).status === 'ended';
}

/**
 * Format a UTC ms timestamp as a local time string in the event's venue timezone.
 * Falls back gracefully if the timezone is invalid.
 */
export function formatInVenueTimezone(utcMs, timezone, fmt = 'short') {
  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      dateStyle: fmt === 'date' ? 'medium' : undefined,
      timeStyle: fmt === 'time' ? 'short' : undefined,
      year: fmt === 'short' ? 'numeric' : undefined,
      month: fmt === 'short' ? 'short' : undefined,
      day: fmt === 'short' ? 'numeric' : undefined,
      hour: fmt === 'short' ? 'numeric' : undefined,
      minute: fmt === 'short' ? '2-digit' : undefined,
      timeZoneName: fmt === 'short' ? 'short' : undefined,
    }).format(new Date(utcMs));
  } catch {
    return new Date(utcMs).toISOString();
  }
}