export const TM_EVENT_SYNC_FIELDS = Object.freeze([
  'tm_id',
  'title',
  'venue',
  'city',
  'state',
  'date',
  'event_start_local',
  'event_start_utc',
  'event_end_utc',
  'venue_timezone',
  'date_tba',
  'time_tba',
  'no_specific_time',
  'end_time_invalid',
  'provider_status',
  'image_url',
  'tm_url',
  'category',
  'tm_venue_id',
  'venue_lat',
  'venue_lng',
]);

/** Keep explicit null/false provider values; omit only fields not supplied. */
export function createTMEventSyncPayload(event = {}) {
  return Object.fromEntries(
    TM_EVENT_SYNC_FIELDS
      .filter(key => Object.prototype.hasOwnProperty.call(event, key) && event[key] !== undefined)
      .map(key => [key, event[key]])
  );
}
