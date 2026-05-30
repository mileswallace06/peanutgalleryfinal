/**
 * Event Navigation Observability
 * Logs every event navigation attempt to EventNavigationLog for
 * instant diagnosis of future routing failures.
 */
import { base44 } from '@/api/base44Client';

// Stable session ID for the current browser session
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

// Debounce duplicate rapid-fire logs (same event + result within 2s)
const _recentLogs = new Map();
function isDuplicate(key) {
  const now = Date.now();
  const last = _recentLogs.get(key);
  if (last && now - last < 2000) return true;
  _recentLogs.set(key, now);
  return false;
}

/**
 * Log an event navigation attempt.
 * @param {object} opts
 * @param {string} opts.result - One of the EventNavigationLog result enum values
 * @param {object} [opts.event] - The event object (may be partial for failures)
 * @param {string} [opts.sourcePage] - e.g. 'Events', 'EventDetail', 'Upgrades'
 * @param {string} [opts.generatedHref] - The URL that was or would be navigated to
 * @param {string} [opts.lookupMethod] - direct_id | tm_prefix_strip | tm_id_field | none
 * @param {string} [opts.failureReason] - Human-readable description of what went wrong
 * @param {string} [opts.userEmail] - Current user email
 */
export async function logNavEvent({
  result,
  event = {},
  sourcePage = '',
  generatedHref = '',
  lookupMethod = '',
  failureReason = '',
  userEmail = '',
}) {
  const dedupeKey = `${event?.id || event?.tm_id || 'unknown'}-${result}-${sourcePage}`;
  if (isDuplicate(dedupeKey)) return;

  const isAdmin = sessionStorage.getItem('pg_admin_unlocked') === '1';
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
    failure_reason: failureReason,
    user_agent: navigator.userAgent.slice(0, 200),
    is_admin: isAdmin,
    session_id: getSessionId(),
  };

  // Fire-and-forget — never block UI for logging
  base44.entities.EventNavigationLog.create(payload).catch(err => {
    console.warn('[navLogger] Failed to write log:', err?.message);
  });

  // Also alert console on failures
  if (result !== 'success') {
    console.warn(`[navLogger] ${result}`, { event_title: payload.event_title, source_page: sourcePage, generated_href: generatedHref, failure_reason: failureReason, lookup_method: lookupMethod });
  }

  // If this is a failure, also create an AdminAlert if failure rate could be high
  // (Only for non-admin users to avoid noise from testing)
  if (!isAdmin && (result === 'lookup_fallback_failed' || result === 'event_not_found' || result === 'navigation_error')) {
    base44.entities.AdminAlert.create({
      alert_type: 'admin_action_required',
      priority: 'high',
      title: `⚠ Event Navigation Failure: ${event?.title || 'Unknown Event'}`,
      description: `Failure on ${sourcePage} — ${failureReason || result}. Event ID: ${event?.id || '?'}, TM ID: ${event?.tm_id || '?'}, URL: ${generatedHref || 'none'}`,
      event_id: event?.id || '',
      resolved: false,
    }).catch(() => {});
  }
}

/**
 * Check recent failure rate and create a spike alert if > 1%.
 * Call this periodically from the founder dashboard.
 */
export async function checkNavFailureRate() {
  try {
    const recent = await base44.entities.EventNavigationLog.list('-timestamp', 200);
    if (!recent || recent.length < 10) return null;

    const failures = recent.filter(l =>
      l.result === 'lookup_fallback_failed' ||
      l.result === 'event_not_found' ||
      l.result === 'navigation_error'
    );
    const rate = failures.length / recent.length;
    return { total: recent.length, failures: failures.length, rate: Math.round(rate * 100) };
  } catch {
    return null;
  }
}