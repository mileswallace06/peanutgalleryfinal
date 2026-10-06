import { tmEventTimezonePatch } from '../../base44/shared/tmEventTimezone.js';

/** Enrich a displayed PG record only from the matching provider event/venue. */
export function withMatchingProviderTimezone(record, provider) {
  if (!record?.tm_id || record.tm_id !== provider?.tm_id) return record;
  const patch = tmEventTimezonePatch(record, provider);
  return patch.venue_timezone ? { ...record, ...patch } : record;
}
