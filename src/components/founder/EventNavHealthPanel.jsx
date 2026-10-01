/**
 * Event Navigation Health Panel
 * Shows on the Founder Dashboard — gives instant visibility into nav failures.
 */
import { useState, useEffect, useCallback } from 'react';
import { base44 } from '@/api/base44Client';
import { formatDistanceToNow } from 'date-fns';
import { RefreshCw, AlertTriangle, CheckCircle } from 'lucide-react';

const RESULT_COLORS = {
  success: '#00FF87',
  lookup_fallback_success: '#00C8FF',
  lookup_fallback_failed: '#FF8C00',
  event_not_loaded: '#FFE600',
  event_not_found: '#FF2D78',
  navigation_error: '#FF2D78',
  unknown: 'var(--pg-muted)',
};

const RESULT_LABELS = {
  success: '✅ Success',
  lookup_fallback_success: '🔄 Fallback OK',
  lookup_fallback_failed: '⚠ Fallback Failed',
  event_not_loaded: '⏳ Not Loaded',
  event_not_found: '❌ Not Found',
  navigation_error: '💥 Nav Error',
  unknown: '❓ Unknown',
};

export default function EventNavHealthPanel() {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [spikeFired, setSpikeFired] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const data = await base44.entities.EventNavigationLog.list('-timestamp', 200);
    setLogs(data || []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  // Derived metrics
  const total = logs.length;
  const successes = logs.filter(l => l.result === 'success' || l.result === 'lookup_fallback_success').length;
  const fallbacks = logs.filter(l => l.result === 'lookup_fallback_success').length;
  const failures = logs.filter(l =>
    l.result === 'lookup_fallback_failed' ||
    l.result === 'event_not_found' ||
    l.result === 'navigation_error'
  );
  const failureRate = total > 0 ? Math.round((failures.length / total) * 100) : 0;
  const recentFailures = failures.slice(0, 10);

  // Spike alert: if rate > 1% and >= 3 failures, create an alert (once per session)
  useEffect(() => {
    if (!spikeFired && failureRate > 1 && failures.length >= 3) {
      setSpikeFired(true);
      base44.entities.AdminAlert.create({
        alert_type: 'admin_action_required',
        priority: 'critical',
        title: '⚠ Event Navigation Failure Spike',
        description: `Failure rate is ${failureRate}% (${failures.length}/${total} clicks). Affected pages: ${[...new Set(failures.map(f => f.source_page))].join(', ')}. Affected events: ${[...new Set(failures.map(f => f.event_title).filter(Boolean))].slice(0, 3).join(', ')}.`,
        resolved: false,
      }).catch(() => {});
    }
  }, [failureRate, failures.length, total, spikeFired]);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-base">🧭</span>
          <h2 className="font-bold text-sm text-foreground uppercase tracking-wide">Event Navigation Health</h2>
          <div className="flex-1 h-px" style={{ background: 'var(--pg-line)' }} />
        </div>
        <button onClick={load} disabled={loading} className="p-1.5 rounded-lg hover:bg-muted">
          <RefreshCw className={`w-3.5 h-3.5 text-muted-foreground ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* Spike alert banner */}
      {failureRate > 1 && failures.length >= 3 && (
        <div className="pg-operations-card flex items-start gap-3 rounded-xl px-4 py-3"
          style={{ background: 'color-mix(in srgb, rgb(255 45 120) 10%, var(--pg-surface))', border: '1px solid rgba(255,45,120,0.35)' }}>
          <AlertTriangle className="pg-operations-status w-4 h-4 flex-shrink-0 mt-0.5" style={{ '--pg-status-ink': '#FF2D78' }} />
          <div className="text-sm">
            <span className="font-bold text-foreground">⚠ Navigation Failure Spike — {failureRate}% failure rate</span>
            <p className="text-xs text-muted-foreground mt-0.5">
              {failures.length} failures out of {total} clicks. Pages: {[...new Set(failures.map(f => f.source_page))].join(', ')}
            </p>
          </div>
        </div>
      )}

      {/* Stats grid */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
        {[
          { label: 'Total Clicks', value: total, color: 'var(--pg-text)' },
          { label: 'Successful Opens', value: successes, color: '#00FF87' },
          { label: 'Fallback Resolutions', value: fallbacks, color: '#00C8FF' },
          { label: 'Nav Failures', value: failures.length, color: failures.length > 0 ? '#FF2D78' : '#00FF87', urgent: failures.length > 0 },
          { label: 'Failure Rate', value: `${failureRate}%`, color: failureRate > 1 ? '#FF2D78' : failureRate > 0 ? '#FF8C00' : '#00FF87' },
        ].map(stat => (
          <div key={stat.label} className="pg-operations-card rounded-2xl p-3"
            style={{
              background: stat.urgent ? 'color-mix(in srgb, rgb(255 45 120) 7%, var(--pg-surface))' : 'var(--pg-surface)',
              border: stat.urgent ? '1px solid rgba(255,45,120,0.3)' : '1px solid var(--pg-line)',
            }}>
            <div className="pg-operations-status text-xl font-black" style={{ '--pg-status-ink': stat.color }}>{stat.value}</div>
            <div className="text-[10px] text-muted-foreground mt-0.5 leading-tight">{stat.label}</div>
          </div>
        ))}
      </div>

      {/* Health indicator */}
      {total > 0 && (
        <div className="pg-operations-card flex items-center gap-3 rounded-xl px-4 py-2.5"
          style={{
            background: failureRate === 0 ? 'color-mix(in srgb, rgb(0 255 135) 6%, var(--pg-surface))' : failureRate <= 1 ? 'color-mix(in srgb, rgb(255 140 0) 6%, var(--pg-surface))' : 'color-mix(in srgb, rgb(255 45 120) 8%, var(--pg-surface))',
            border: `1px solid ${failureRate === 0 ? 'rgba(0,255,135,0.2)' : failureRate <= 1 ? 'rgba(255,140,0,0.25)' : 'rgba(255,45,120,0.35)'}`,
          }}>
          {failureRate === 0
            ? <CheckCircle className="pg-operations-status w-4 h-4 flex-shrink-0" style={{ '--pg-status-ink': '#00FF87' }} />
            : <AlertTriangle className="pg-operations-status w-4 h-4 flex-shrink-0" style={{ '--pg-status-ink': failureRate <= 1 ? '#FF8C00' : '#FF2D78' }} />
          }
          <span className="text-xs text-muted-foreground">
            {failureRate === 0
              ? `All ${total} navigation clicks resolved successfully.`
              : `${failures.length} of ${total} clicks failed. Goal: <1% failure rate.`
            }
          </span>
        </div>
      )}

      {/* Recent failures table */}
      {recentFailures.length > 0 && (
        <div>
          <p className="text-[10px] font-black text-muted-foreground uppercase tracking-wide mb-2">Recent Failures</p>
          <div className="pg-operations-card rounded-2xl overflow-hidden" style={{ border: '1px solid var(--pg-line)' }}>
            {/* Header */}
            <div className="grid grid-cols-[80px_1fr_80px_1fr_90px] gap-2 px-3 py-2 text-[9px] font-bold text-muted-foreground uppercase tracking-wide"
              style={{ background: 'var(--pg-surface)', borderBottom: '1px solid var(--pg-line)' }}>
              <span>Time</span>
              <span>Event</span>
              <span>Page</span>
              <span>URL</span>
              <span>Type</span>
            </div>
            {recentFailures.map((log, i) => (
              <div key={log.id || i}
                className="grid grid-cols-[80px_1fr_80px_1fr_90px] gap-2 px-3 py-2.5 text-[10px] items-start"
                style={{ borderBottom: i < recentFailures.length - 1 ? '1px solid var(--pg-line)' : 'none' }}>
                <span className="text-muted-foreground leading-tight">
                  {log.timestamp ? formatDistanceToNow(new Date(log.timestamp), { addSuffix: true }) : '—'}
                </span>
                <span className="text-foreground font-medium leading-tight line-clamp-2">
                  {log.event_title || log.event_id || '—'}
                </span>
                <span className="text-muted-foreground leading-tight">{log.source_page || '—'}</span>
                <span className="font-mono text-[9px] text-muted-foreground leading-tight break-all line-clamp-2">
                  {log.generated_href || 'none'}
                </span>
                <span className="pg-operations-status leading-tight font-semibold" style={{ '--pg-status-ink': RESULT_COLORS[log.result] || 'var(--pg-muted)' }}>
                  {RESULT_LABELS[log.result] || log.result}
                  {log.failure_reason && (
                    <span className="block text-[9px] font-normal text-muted-foreground mt-0.5">{log.failure_reason}</span>
                  )}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {total === 0 && !loading && (
        <div className="text-center py-6 text-muted-foreground text-xs">
          No navigation logs yet. Logs appear as users click event cards.
        </div>
      )}
    </div>
  );
}