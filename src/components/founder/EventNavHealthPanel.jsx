/**
 * Event Navigation Health Panel
 * Shows on the Founder Dashboard — gives instant visibility into nav failures.
 */
import { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { formatDistanceToNow } from 'date-fns';
import { RefreshCw, AlertTriangle, CheckCircle } from 'lucide-react';
import { useOperationalReads } from '@/hooks/useOperationalReads';
import { operationalValue } from '@/lib/operationalReads';
import { ensureNavigationSpikeAlert } from '@/lib/navigationSpikeAlert';
const READS = { navigation: () => base44.entities.EventNavigationLog.list('-timestamp', 200) };

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

export default function EventNavHealthPanel({ onHealthChange }) {
  const { sources, reload: load, loading } = useOperationalReads(READS);
  const source = sources.navigation;
  const logs = source.rows;
  const [alertStatus, setAlertStatus] = useState(null);
  const metric = value => operationalValue(source, value);

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
  useEffect(() => {
    onHealthChange?.({ status: source.status, spike: source.status === 'ready' && failureRate > 1 && failures.length >= 3 });
  }, [onHealthChange, source.status, failureRate, failures.length]);

  // Keep the existing alert policy, but verify unresolved alerts and share
  // the decision across retries/remounts. An unavailable dedup read cannot write.
  useEffect(() => {
    let active = true;
    if (source.status !== 'ready') { setAlertStatus(null); return; }
    setAlertStatus('checking');
    let storage;
    try { storage = window.sessionStorage; } catch { /* Optional storage. */ }
    ensureNavigationSpikeAlert(base44.entities.AdminAlert, source.rows, storage).then(status => {
      if (active) setAlertStatus(status);
    });
    return () => { active = false; };
  }, [source]);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-base">🧭</span>
          <h2 className="font-bold text-sm text-foreground uppercase tracking-wide">Event Navigation Health</h2>
          <div className="flex-1 h-px" style={{ background: 'var(--pg-line)' }} />
        </div>
        <button type="button" aria-label="Refresh event navigation health" aria-busy={loading} onClick={() => load()} disabled={loading} className="p-1.5 rounded-lg hover:bg-muted">
          <RefreshCw className={`w-3.5 h-3.5 text-muted-foreground ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      <p role="status" className="text-xs text-muted-foreground">{source.status === 'ready' ? 'Latest 200 available navigation logs.' : loading ? 'Loading navigation health…' : 'Navigation health unavailable. Refresh to retry.'}</p>
      {alertStatus === 'unavailable' && <p role="status" className="text-xs text-muted-foreground">Navigation spike alert status unavailable. Refresh to retry verification.</p>}
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
          { label: 'Failure Rate', value: total ? `${failureRate}%` : 'No data', color: failureRate > 1 ? '#FF2D78' : failureRate > 0 ? '#FF8C00' : '#00FF87' },
        ].map(stat => (
          <div key={stat.label} className="pg-operations-card rounded-2xl p-3"
            style={{
              background: stat.urgent ? 'color-mix(in srgb, rgb(255 45 120) 7%, var(--pg-surface))' : 'var(--pg-surface)',
              border: stat.urgent ? '1px solid rgba(255,45,120,0.3)' : '1px solid var(--pg-line)',
            }}>
            <div className="pg-operations-status text-xl font-black" style={{ '--pg-status-ink': source.status === 'ready' ? stat.color : 'var(--pg-muted)' }}>{metric(stat.value)}</div>
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
              ? (successes === total ? `All ${total} loaded navigation clicks resolved successfully.` : `${successes} of ${total} loaded clicks resolved successfully; other results are unconfirmed.`)
              : `${failures.length} of ${total} clicks failed. Goal: <1% failure rate.`
            }
          </span>
        </div>
      )}

      {/* Recent failures table */}
      {recentFailures.length > 0 && (
        <div>
          <p className="text-[10px] font-black text-muted-foreground uppercase tracking-wide mb-2">Recent Failures</p>
          <div className="pg-operations-card rounded-2xl overflow-x-auto" role="region" aria-label="Recent navigation failures" tabIndex={0} style={{ border: '1px solid var(--pg-line)' }}>
            {/* Header */}
            <div className="min-w-[540px] grid grid-cols-[80px_1fr_80px_1fr_90px] gap-2 px-3 py-2 text-[9px] font-bold text-muted-foreground uppercase tracking-wide"
              style={{ background: 'var(--pg-surface)', borderBottom: '1px solid var(--pg-line)' }}>
              <span>Time</span>
              <span>Event</span>
              <span>Page</span>
              <span>URL</span>
              <span>Type</span>
            </div>
            {recentFailures.map((log, i) => (
              <div key={log.id || i}
                className="min-w-[540px] grid grid-cols-[80px_1fr_80px_1fr_90px] gap-2 px-3 py-2.5 text-[10px] items-start"
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

      {total === 0 && source.status === 'ready' && (
        <div className="text-center py-6 text-muted-foreground text-xs">
          No navigation logs yet. Logs appear as users click event cards.
        </div>
      )}
    </div>
  );
}