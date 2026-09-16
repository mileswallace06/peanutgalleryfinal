export const TM_EVENT_SYNC_FIELDS = Object.freeze(['tm_id']);

/** The server re-fetches all provider-owned fields from Ticketmaster. */
export function createTMEventSyncPayload(event = {}) {
  return Object.fromEntries(
    TM_EVENT_SYNC_FIELDS
      .filter(key => Object.prototype.hasOwnProperty.call(event, key) && event[key] !== undefined)
      .map(key => [key, event[key]])
  );
}
