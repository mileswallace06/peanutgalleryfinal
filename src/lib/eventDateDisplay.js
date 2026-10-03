import { reliableTime } from './sellingEventTiming.js';

/** Display one confirmed instant in the venue's zone, independent of the viewer. */
export function getEventDateDisplay(event) {
  if (!event || event.date_tba || event.time_tba || event.no_specific_time) return null;
  const start = reliableTime(event.event_start_utc || event.date);
  if (start === null) return null;

  const options = {
    weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
  };
  let timeZone = typeof event.venue_timezone === 'string' ? event.venue_timezone.trim() : '';
  let venueConfirmed = !!timeZone;
  let formatter;
  try {
    formatter = new Intl.DateTimeFormat('en-US', { ...options, timeZone: timeZone || 'UTC' });
  } catch {
    venueConfirmed = false;
    timeZone = 'UTC';
    formatter = new Intl.DateTimeFormat('en-US', { ...options, timeZone });
  }
  const parts = Object.fromEntries(formatter.formatToParts(start).map(part => [part.type, part.value]));
  const detailParts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    ...options, weekday: 'long', month: 'long', timeZone: timeZone || 'UTC',
  }).formatToParts(start).map(part => [part.type, part.value]));
  const time = `${parts.hour}:${parts.minute} ${parts.dayPeriod} ${parts.timeZoneName}`;
  const uncertainty = venueConfirmed ? '' : ' · venue time unconfirmed';
  return {
    month: parts.month,
    day: parts.day,
    time,
    label: `${parts.weekday}, ${parts.month} ${parts.day} · ${time}${uncertainty}`,
    detailLabel: `${detailParts.weekday}, ${detailParts.month} ${detailParts.day}, ${detailParts.year} · ${time}${uncertainty}`,
  };
}
