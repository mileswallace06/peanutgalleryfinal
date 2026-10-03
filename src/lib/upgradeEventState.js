import { formatInVenueTimezone, resolveTimezone } from './eventTiming.js';
import { getUpgradeEventTiming } from './upgradeDiscovery.js';

/** Display-only state: purchase and listing eligibility remain authoritative elsewhere. */
export function getUpgradeEventState(event, nowMs = Date.now()) {
  // The explicit beta preview remains local to the detail screen; discovery excludes it.
  const timing = event?.is_beta_live ? { status: 'live', start: null, end: null }
    : getUpgradeEventTiming(event || {}, nowMs);
  const beforeShowtime = ['upcoming', 'soon'].includes(timing.status)
    && timing.start !== null && timing.start > nowMs;
  const seconds = beforeShowtime ? Math.ceil((timing.start - nowMs) / 1000) : 0;

  return {
    ...timing,
    start_utc_ms: timing.start,
    end_utc_ms: timing.end,
    is_beta_live: event?.is_beta_live === true,
    isLive: ['live', 'estimated_live'].includes(timing.status),
    beforeShowtime,
    countdown: beforeShowtime ? {
      days: Math.floor(seconds / 86400),
      hours: Math.floor((seconds % 86400) / 3600),
      minutes: Math.floor((seconds % 3600) / 60),
      seconds: seconds % 60,
    } : null,
  };
}

export function getUpgradeShowtimeLabel(event) {
  if (!event) return null;
  // A beta override changes live presentation, not the advertised venue time.
  const { start: startMs } = getUpgradeEventTiming({ ...event, is_beta_live: false });
  if (startMs === null) return null;
  return formatInVenueTimezone(startMs, resolveTimezone(event).timezone);
}

/** Date/stub parts share the canonical timestamp and venue timezone, never the viewer's. */
export function getUpgradeVenueDateParts(event, startMs) {
  if (!Number.isFinite(startMs)) return null;
  const options = { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' };
  let formatter;
  try {
    formatter = new Intl.DateTimeFormat('en-US', { ...options, timeZone: resolveTimezone(event).timezone });
  } catch {
    formatter = new Intl.DateTimeFormat('en-US', { ...options, timeZone: 'UTC' });
  }
  const parts = Object.fromEntries(formatter.formatToParts(startMs).map(part => [part.type, part.value]));
  return { month: parts.month, day: parts.day,
    label: `${parts.month} ${parts.day} · ${parts.hour}:${parts.minute} ${parts.dayPeriod} ${parts.timeZoneName}` };
}

/** Compact label for a fixed-height browse ticket; never claims inventory availability. */
export function formatUpgradeStartsIn(startMs, nowMs = Date.now()) {
  if (!Number.isFinite(startMs) || startMs <= nowMs) return null;
  const seconds = Math.ceil((startMs - nowMs) / 1000);
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (days) return `Starts in ${days}d ${hours}h`;
  if (hours) return `Starts in ${hours}h ${minutes}m`;
  if (minutes) return `Starts in ${minutes}m ${seconds % 60}s`;
  return `Starts in ${seconds}s`;
}
