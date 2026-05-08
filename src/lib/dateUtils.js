/**
 * Centralized date/time utilities for Peanut Gallery.
 * ALL date logic in the app must use these helpers to stay consistent and accurate.
 *
 * Key design principle:
 *   Event dates from Ticketmaster are stored as LOCAL datetime strings (venue timezone),
 *   e.g. "2026-05-08T19:30:00" — NOT UTC. We compare them as date strings, never as
 *   epoch milliseconds, so a show at 7pm in Phoenix is always "May 8" regardless of
 *   what timezone the user's browser is in.
 *
 *   For PG events stored in the DB, dates are ISO strings. We compare them using
 *   the browser's local date (the user's device clock) since the user and the venue
 *   are assumed to be in the same timezone (they need to be at the show).
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
 * Does NOT infer live status from the start time — that must be set explicitly on the entity.
 */
export const isEventExplicitlyLive = (event) =>
  event?.status === 'live' || event?.is_beta_live === true;

/**
 * Returns true if an event falls on today's calendar date.
 *
 * Strategy: extract the YYYY-MM-DD portion of the event date string directly
 * (without parsing into a UTC Date object) and compare to the user's local date string.
 * This avoids timezone-shift bugs where a "8pm local" event stored as UTC would
 * appear as the wrong calendar day.
 */
export const isEventToday = (event) => {
  if (!event?.date) return false;
  // Extract date portion: works for both "2026-05-08T19:30:00" and "2026-05-08T02:30:00Z"
  const eventDatePart = String(event.date).slice(0, 10); // "YYYY-MM-DD"
  return eventDatePart === localDateString();
};

/**
 * Returns true if the event's start time is strictly in the future (hasn't started yet).
 * Compares the full datetime string to now; for local strings (no Z suffix) this is
 * interpreted in the browser's local timezone — which is correct since the user
 * is assumed to be co-located with the venue.
 */
export const isEventUpcoming = (event) => {
  if (!event?.date) return true;
  return new Date(event.date).getTime() > now();
};

/**
 * Returns true if the event has already started (start time is in the past).
 * NOTE: This does NOT mean it is "live" — use isEventExplicitlyLive for live gating.
 */
export const hasEventStarted = (event) => {
  if (!event?.date) return false;
  return new Date(event.date).getTime() <= now();
};