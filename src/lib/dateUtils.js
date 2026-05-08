/**
 * Centralized date/time utilities for Peanut Gallery.
 *
 * IMPORTANT timezone model:
 *   - PG DB events: stored as UTC ISO strings (e.g. "2026-05-08T02:30:00Z")
 *     → parse with `new Date()` which converts to LOCAL time correctly in the browser
 *   - TM events: stored as LOCAL datetime strings without Z (e.g. "2026-05-08T19:30:00")
 *     → `new Date()` treats these as LOCAL time too (no Z = local), so both work the same way
 *
 *   Bottom line: `new Date(event.date)` in the browser always gives the correct local time,
 *   so we compare against the user's local midnight/end-of-day.
 */

/** Returns the current timestamp in ms (real wall-clock, never cached). */
export const now = () => Date.now();

/**
 * Returns today's date as a "YYYY-MM-DD" string in the USER's local timezone.
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
 * Returns true only if the event is CURRENTLY live or beta-live via explicit flag.
 */
export const isEventExplicitlyLive = (event) =>
  event?.status === 'live' || event?.is_beta_live === true;

/**
 * Returns true if an event's start time falls within today (local timezone).
 * Works correctly for both:
 *   - UTC strings ("2026-05-08T02:30:00Z") — browser converts to local time before comparing
 *   - Local strings ("2026-05-08T19:30:00") — browser treats as local time directly
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
 * NOTE: Does NOT mean it is "live" — use isEventExplicitlyLive for live gating.
 */
export const hasEventStarted = (event) => {
  if (!event?.date) return false;
  return new Date(event.date).getTime() <= now();
};