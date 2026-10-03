const DISCOVERY_TYPES = new Set(['upgrade_available', 'bucket_list_event']);

/** Discovery alerts are visible only after canonical in-app publication. */
export function visibleNotifications(records) {
  const canonical = new Map();
  for (const record of records) {
    if (!DISCOVERY_TYPES.has(record.type) || record.dispatch_status !== 'dispatched'
      || typeof record.idempotency_key !== 'string' || !record.idempotency_key) continue;
    const key = `${record.user_email}:${record.idempotency_key}`;
    const prior = canonical.get(key);
    if (!prior || String(record.id) < String(prior.id)) canonical.set(key, record);
  }
  return records.filter(record => {
    if (!DISCOVERY_TYPES.has(record.type)) return record.dispatch_status !== 'superseded';
    return record.dispatch_status === 'dispatched'
      && canonical.get(`${record.user_email}:${record.idempotency_key}`)?.id === record.id;
  });
}
