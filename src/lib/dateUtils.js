/**
 * Centralized date/time utilities for Peanut Gallery.
 *
 * TIMEZONE MODEL:
 *   - PG DB events: stored as UTC ISO strings (e.g. "2026-05-08T02:30:00Z")
 *     → new Date() converts to LOCAL time correctly in the browser
 *   - TM events: stored as LOCAL datetime strings WITHOUT Z (e.g. "2026-05-08T19:30:00")
 *     → new Date() treats these as LOCAL time directly (no Z = local)
 *
 *   Bottom line: new Date(event.date) in the browser always gives the correct local wall-clock time.
 *   We compare against the user's local clock (Date.now()).
 *
 * LIVE WINDOW:
 *   An event is "live now" if:
 *     startTime <= now  AND  now <= startTime + eventDuration
 *
 *   Default durations (ms):
 *     concert / sports: 4 hours
 *     theater / comedy: 3 hours
 *     fallback:         4 hours
 */

/** Returns the current timestamp in ms. */
export const now = () => Date.now();

/**
 * Returns today's date as "YYYY-MM-DD" in the user's local timezone.
 * Used to pass to the backend so TM queries filter by the correct calendar day.
 */
export const localDateString = () => {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

/** Returns a Date for the start of today in the user's LOCAL timezone (midnight). */
export const localTodayStart = () => {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
};

/** Returns a Date for the end of today in the user's LOCAL timezone (23:59:59.999). */
export const localTodayEnd = () => {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
};

/**
 * Returns the expected duration of an event in milliseconds based on category.
 */
export const eventDurationMs = (event) => {
  const hours = (() => {
    switch (event?.category) {
      case 'concert': return 4;
      case 'sports':  return 4;
      case 'theater': return 3;
      case 'comedy':  return 3;
      default:        return 4;
    }
  })();
  return hours * 60 * 60 * 1000;
};

/**
 * Returns true if the event is currently live based on its start time + duration window.
 * An event is live if: startTime <= now <= startTime + duration
 *
 * This is timezone-safe because new Date(event.date) returns the correct absolute timestamp
 * whether the date string is UTC ("...Z") or local (no Z suffix).
 */
export const isEventLiveNow = (event) => {
  if (!event?.date) return false;
  const startMs = new Date(event.date).getTime();
  const n = now();
  return n >= startMs && n <= startMs + eventDurationMs(event);
};

/**
 * Returns true only if the event is CURRENTLY live via explicit flag (status or is_beta_live).
 */
export const isEventExplicitlyLive = (event) =>
  event?.status === 'live' || event?.is_beta_live === true;

/**
 * Returns true if an event should show in the Upgrades tab:
 * - explicitly flagged live, OR
 * - currently within its live window (started but not yet ended by duration estimate)
 */
export const isEventUpgradeEligible = (event) =>
  isEventExplicitlyLive(event) || isEventLiveNow(event);

/**
 * Returns true if an event's start time falls within today (local timezone).
 */
export const isEventToday = (event) => {
  if (!event?.date) return false;
  const t = new Date(event.date).getTime();
  return t >= localTodayStart().getTime() && t <= localTodayEnd().getTime();
};

/**
 * Returns true if the event's start time is strictly in the future.
 */
export const isEventUpcoming = (event) => {
  if (!event?.date) return true;
  return new Date(event.date).getTime() > now();
};

/**
 * Returns true if the event has already started (start time is in the past).
 */
export const hasEventStarted = (event) => {
  if (!event?.date) return false;
  return new Date(event.date).getTime() <= now();
};