/**
 * Centralized date/time utilities for Peanut Gallery.
 * ALL date logic in the app must use these helpers to stay consistent and accurate.
 * "Now" is always the real wall-clock time from the browser.
 */

/** Returns the current timestamp in ms (real wall-clock, never cached). */
export const now = () => Date.now();

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
 * Returns true if an event's start time falls within today (local timezone).
 * Safe for use in "Recommended" and "Upgrades" tabs.
 */
export const isEventToday = (event) => {
  if (!event?.date) return false;
  const t = new Date(event.date).getTime();
  return t >= localTodayStart().getTime() && t <= localTodayEnd().getTime();
};

/**
 * Returns true if the event's start time is strictly in the future (hasn't started yet).
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