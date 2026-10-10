import { readOperationalRows } from './operationalReads.js';

export const NAVIGATION_SPIKE_TITLE = '⚠ Event Navigation Failure Spike';
const STORAGE_KEY = 'pg_navigation_spike_alerts_v1';
const isFailure = row => ['lookup_fallback_failed', 'event_not_found', 'navigation_error'].includes(row.result);

/** Same-tab/session dedup only. Cross-client atomic uniqueness requires a backend key/constraint. */
export function createNavigationSpikeCoordinator() {
  let inFlight = null;
  const completed = new Set();
  return async function ensureAlert(entity, logs, storage) {
    const failures = logs.filter(isFailure);
    const rate = logs.length ? Math.round(failures.length / logs.length * 100) : 0;
    if (rate <= 1 || failures.length < 3) return 'not-needed';
    const fingerprint = failures.map(row => [row.id, row.timestamp, row.result, row.source_page, row.event_id].join('|')).sort().join('\n');
    let remembered = [];
    try { remembered = JSON.parse(storage?.getItem(STORAGE_KEY) || '[]'); } catch { /* Storage is optional. */ }
    if (!Array.isArray(remembered)) remembered = [];
    if (completed.has(fingerprint) || remembered.includes(fingerprint)) return 'already-recorded';
    // Share the decision/read/write even across unmounts or simultaneous panels.
    if (inFlight) return inFlight;
    inFlight = (async () => {
      const read = await readOperationalRows(() => entity.filter({ resolved: false, title: NAVIGATION_SPIKE_TITLE }));
      if (read.status !== 'ready') return 'unavailable'; // Never write after an unknown dedup read.
      if (!read.rows.some(row => row.title === NAVIGATION_SPIKE_TITLE && !row.resolved)) {
        try {
          await entity.create({
            alert_type: 'admin_action_required', priority: 'critical', title: NAVIGATION_SPIKE_TITLE,
            description: `Failure rate is ${rate}% (${failures.length}/${logs.length} clicks). Affected pages: ${[...new Set(failures.map(row => row.source_page).filter(Boolean))].join(', ')}. Affected events: ${[...new Set(failures.map(row => row.event_title).filter(Boolean))].slice(0, 3).join(', ')}.`,
            resolved: false,
          });
        } catch { return 'unavailable'; }
      }
      completed.add(fingerprint);
      try { storage?.setItem(STORAGE_KEY, JSON.stringify([...remembered, fingerprint].slice(-30))); } catch { /* In-memory guard remains active. */ }
      return 'recorded';
    })();
    try { return await inFlight; } finally { inFlight = null; }
  };
}
export const ensureNavigationSpikeAlert = createNavigationSpikeCoordinator();
