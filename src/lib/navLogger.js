/**
 * Event Navigation Observability
 * Logs every event navigation attempt to EventNavigationLog.
 * Captures full lookup trace + failure classification for root cause analysis.
 */
import { base44 } from '@/api/base44Client';

// ── Session ID ──────────────────────────────────────────────────────────────
let _sessionId = null;
function getSessionId() {
  if (!_sessionId) {
    _sessionId = sessionStorage.getItem('pg_nav_session_id');
    if (!_sessionId) {
      _sessionId = Math.random().toString(36).slice(2, 10);
      sessionStorage.setItem('pg_nav_session_id', _sessionId);
    }
  }
  return _sessionId;
}

// ── Dedupe: suppress same event+result within 2s ───────────────────────────
const _recentLogs = new Map();
function isDuplicate(key) {
  const now = Date.now();
  const last = _recentLogs.get(key);
  if (last && now - last < 2000) return true;
  _recentLogs.set(key, now);
  return false;
}

// ── Failure category classifier ────────────────────────────────────────────
/**
 * Given a lookup trace, classify which failure path occurred.
 *
 * Categories:
 *   A - duplicate_event      : multiple records returned for the same id/tm_id
 *   B - unsynced_tm_event    : route param is tm_ prefix or bare tm_id, DB has no record (never synced)
 *   C - invalid_route        : route param is empty, malformed, or missing
 *   D - missing_event        : internal DB id used but record genuinely doesn't exist
 *   E - sync_failure         : syncTMEvent was called but returned no id or errored
 *   F - unknown              : none of the above patterns matched
 */
export function classifyFailure(routeId, lookupTrace) {
  if (!routeId) return { category: 'C', label: 'Invalid Route', detail: 'Route param is empty or missing.' };

  const steps = lookupTrace?.steps || [];
  const finalCount = lookupTrace?.finalCount ?? 0;

  // A: duplicates found (>1 result at any step)
  const dupStep = steps.find(s => s.count > 1);
  if (dupStep) {
    return {
      category: 'A',
      label: 'Duplicate Event',
      detail: `Step "${dupStep.method}" returned ${dupStep.count} records for this id. Multiple DB records share the same identifier.`,
    };
  }

  // If we found exactly 1 — not a failure (shouldn't be classified here, but guard)
  if (finalCount === 1) {
    return { category: null, label: 'Success', detail: 'Event found.' };
  }

  // B: unsynced TM event — param looks like a TM id, all lookups returned 0
  const isTMParam = String(routeId).startsWith('tm_') || /^[A-Za-z0-9_\-]{10,}$/.test(routeId);
  const allMissed = steps.every(s => s.count === 0);
  const hasTMPrefixStep = steps.some(s => s.method === 'tm_prefix_strip' || s.method === 'tm_id_field');
  if (allMissed && isTMParam && hasTMPrefixStep) {
    return {
      category: 'B',
      label: 'Unsynced TM Event',
      detail: `Route param "${routeId}" looks like a TM id. All lookup methods returned 0. Event was never synced to DB, or sync is still in-flight.`,
    };
  }

  // D: internal DB id format used, all lookups returned 0 (genuine missing record)
  const looksLikeInternalId = /^[0-9a-f]{24}$/.test(routeId);
  if (allMissed && looksLikeInternalId) {
    return {
      category: 'D',
      label: 'Missing Event',
      detail: `Route param "${routeId}" is a 24-char hex internal ID, but no DB record was found. Record may have been deleted or is from a different environment.`,
    };
  }

  // E: sync failure — syncTMEvent was triggered but failed
  if (lookupTrace?.syncTriggered && !lookupTrace?.syncResult) {
    return {
      category: 'E',
      label: 'Sync Failure',
      detail: 'syncTMEvent was triggered but returned no id or errored.',
    };
  }

  // C: empty or clearly invalid param
  if (!routeId || routeId.length < 3) {
    return { category: 'C', label: 'Invalid Route', detail: `Route param "${routeId}" is too short to be valid.` };
  }

  return {
    category: 'F',
    label: 'Unknown',
    detail: `No pattern matched. Steps: ${steps.map(s => `${s.method}=${s.count}`).join(', ') || 'none'}`,
  };
}

// ── Main log function ───────────────────────────────────────────────────────
/**
 * Log an event navigation attempt.
 * @param {object} opts
 * @param {string} opts.result            - EventNavigationLog result enum value
 * @param {object} [opts.event]           - Event object (may be partial on failure)
 * @param {string} [opts.sourcePage]      - 'Events' | 'EventDetail' | 'EventDetailUpgrade' | 'Upgrades'
 * @param {string} [opts.generatedHref]   - The URL navigated to
 * @param {string} [opts.lookupMethod]    - Final method that succeeded (or 'none')
 * @param {string} [opts.failureReason]   - Human-readable description
 * @param {string} [opts.userEmail]       - Current user email
 * @param {object} [opts.lookupTrace]     - Full trace object from EventDetail/EventDetailUpgrade
 */
export async function logNavEvent({
  result,
  event = {},
  sourcePage = '',
  generatedHref = '',
  lookupMethod = '',
  failureReason = '',
  userEmail = '',
  lookupTrace = null,
}) {
  const routeId = event?.id || event?.tm_id || '';
  const dedupeKey = `${routeId}-${result}-${sourcePage}`;
  if (isDuplicate(dedupeKey)) return;

  const isAdmin = sessionStorage.getItem('pg_admin_unlocked') === '1';

  // Classify failure if trace is present
  let failureCategory = null;
  let failureCategoryLabel = null;
  if (result !== 'success' && lookupTrace) {
    const classified = classifyFailure(generatedHref?.split('/').pop() || routeId, lookupTrace);
    failureCategory = classified.category;
    failureCategoryLabel = classified.label;
    // Enrich failureReason with classification if not already set
    if (!failureReason && classified.detail) failureReason = classified.detail;
  }

  const payload = {
    timestamp: new Date().toISOString(),
    user_email: userEmail || '',
    event_title: event?.title || '',
    event_id: event?.id || '',
    tm_id: event?.tm_id || '',
    source: event?.source || 'unknown',
    source_page: sourcePage,
    generated_href: generatedHref,
    lookup_method: lookupMethod,
    result,
    failure_reason: failureCategory
      ? `[${failureCategory}] ${failureCategoryLabel}: ${failureReason}`
      : failureReason,
    user_agent: navigator.userAgent.slice(0, 200),
    is_admin: isAdmin,
    session_id: getSessionId(),
  };

  // Fire-and-forget
  base44.entities.EventNavigationLog.create(payload).catch(err => {
    console.warn('[navLogger] Failed to write log:', err?.message);
  });

  // Console warning on any failure
  if (result !== 'success') {
    console.warn(`[navLogger] ${result} [${failureCategory || '?'}:${failureCategoryLabel || 'unclassified'}]`, {
      event_title: payload.event_title,
      source_page: sourcePage,
      generated_href: generatedHref,
      failure_reason: payload.failure_reason,
      lookup_trace: lookupTrace,
    });
  }

  // AdminAlert for non-admin failures only
  if (!isAdmin && (result === 'lookup_fallback_failed' || result === 'event_not_found' || result === 'navigation_error')) {
    base44.entities.AdminAlert.create({
      alert_type: 'admin_action_required',
      priority: 'high',
      title: `⚠ Event Not Found [${failureCategory || 'F'}:${failureCategoryLabel || 'Unknown'}]: ${event?.title || 'Unknown Event'}`,
      description: `${sourcePage} — ${payload.failure_reason}. Route: ${generatedHref || 'none'}`,
      event_id: event?.id || '',
      resolved: false,
    }).catch(() => {});
  }
}

// ── Failure rate summary ────────────────────────────────────────────────────
/**
 * Returns failure metrics from the last 200 navigation logs.
 * Used by FounderDashboard / EventNavHealthPanel.
 */
export async function checkNavFailureRate() {
  try {
    const recent = await base44.entities.EventNavigationLog.list('-timestamp', 200);
    if (!recent || recent.length < 5) return null;

    const failures = recent.filter(l =>
      l.result === 'lookup_fallback_failed' ||
      l.result === 'event_not_found' ||
      l.result === 'navigation_error'
    );

    // Tally by category
    const byCategory = {};
    failures.forEach(l => {
      // Extract category from failure_reason prefix "[A] ..."
      const match = l.failure_reason?.match(/^\[([A-F])\]/);
      const cat = match ? match[1] : 'F';
      byCategory[cat] = (byCategory[cat] || 0) + 1;
    });

    // Top failing tm_ids
    const tmCount = {};
    failures.forEach(l => { if (l.tm_id) tmCount[l.tm_id] = (tmCount[l.tm_id] || 0) + 1; });
    const topTmIds = Object.entries(tmCount).sort((a, b) => b[1] - a[1]).slice(0, 5);

    // Top failing routes
    const routeCount = {};
    failures.forEach(l => { if (l.generated_href) routeCount[l.generated_href] = (routeCount[l.generated_href] || 0) + 1; });
    const topRoutes = Object.entries(routeCount).sort((a, b) => b[1] - a[1]).slice(0, 5);

    const rate = failures.length / recent.length;
    return {
      total: recent.length,
      failures: failures.length,
      rate: Math.round(rate * 100),
      byCategory,
      topTmIds,
      topRoutes,
    };
  } catch {
    return null;
  }
}