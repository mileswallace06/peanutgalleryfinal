import { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { AlertTriangle, CheckCircle, RefreshCw, Bell } from 'lucide-react';
import { format, formatDistanceToNow } from 'date-fns';

const PRIORITY_CONFIG = {
  critical: { color: '#FF2D78', bg: 'color-mix(in srgb, rgb(255 45 120) 10%, var(--pg-surface))', border: 'rgba(255,45,120,0.35)', dot: 'bg-red-500' },
  high:     { color: '#FF8C00', bg: 'color-mix(in srgb, rgb(255 140 0) 8%, var(--pg-surface))', border: 'rgba(255,140,0,0.3)',  dot: 'bg-orange-500' },
  medium:   { color: '#FFE600', bg: 'color-mix(in srgb, rgb(255 230 0) 7%, var(--pg-surface))', border: 'rgba(255,230,0,0.25)', dot: 'bg-yellow-400' },
  low:      { color: '#00C8FF', bg: 'color-mix(in srgb, rgb(0 200 255) 6%, var(--pg-surface))', border: 'rgba(0,200,255,0.2)',  dot: 'bg-blue-400' },
};

const ALERT_ICONS = {
  failed_transfer_after_payment:   '🚨',
  new_dispute:                     '⚖️',
  expired_verification:            '⏱',
  low_confidence_listing:          '📉',
  conflicting_community_reports:   '⚡',
  transfer_disabled_active_listing:'🚫',
  buyer_waiting_for_transfer:      '⏳',
  seller_missed_deadline:          '❌',
  seller_reliability_drop:         '📊',
  admin_action_required:           '🔔',
};

export default function AdminAlertCenter() {
  const [alerts, setAlerts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [resolving, setResolving] = useState('');
  const [filter, setFilter] = useState('open');

  const load = async () => {
    setLoading(true);
    const all = await base44.entities.AdminAlert.list('-created_date', 100);
    setAlerts(all);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const handleResolve = async (alert, adminEmail) => {
    setResolving(alert.id);
    await base44.entities.AdminAlert.update(alert.id, {
      resolved: true,
      resolved_by: adminEmail || 'admin',
      resolved_at: new Date().toISOString(),
    });
    // Beta log
    base44.entities.BetaTransferLog.create({
      log_type: 'admin_alert_resolved',
      actor_role: 'admin',
      metadata: { alert_id: alert.id, alert_type: alert.alert_type },
    }).catch(() => {});
    await load();
    setResolving('');
  };

  const open = alerts.filter(a => !a.resolved);
  const resolved = alerts.filter(a => a.resolved);
  const shown = filter === 'open' ? open : resolved;

  const criticalCount = open.filter(a => a.priority === 'critical').length;
  const highCount = open.filter(a => a.priority === 'high').length;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-bold text-lg text-foreground flex items-center gap-2">
            <Bell className="pg-operations-status w-5 h-5" style={{ '--pg-status-ink': criticalCount > 0 ? '#FF2D78' : '#BF5FFF' }} />
            Alert Center
            {open.length > 0 && (
              <span className="pg-operations-status text-xs font-black px-2 py-0.5 rounded-full"
                style={{ background: criticalCount > 0 ? 'color-mix(in srgb, rgb(255 45 120) 15%, var(--pg-surface))' : 'color-mix(in srgb, rgb(191 95 255) 15%, var(--pg-surface))', '--pg-status-ink': criticalCount > 0 ? '#FF2D78' : '#BF5FFF' }}>
                {open.length} open
              </span>
            )}
          </h2>
          <p className="text-xs text-muted-foreground">Operational alerts requiring admin attention</p>
        </div>
        <button onClick={load} disabled={loading} className="p-1.5 rounded-lg hover:bg-muted">
          <RefreshCw className={`w-4 h-4 text-muted-foreground ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* Summary pills */}
      <div className="flex gap-2 flex-wrap">
        {criticalCount > 0 && (
          <span className="pg-operations-status flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-full animate-pulse"
            style={{ background: 'color-mix(in srgb, rgb(255 45 120) 12%, var(--pg-surface))', '--pg-status-ink': '#FF2D78', border: '1px solid rgba(255,45,120,0.35)' }}>
            🚨 {criticalCount} Critical
          </span>
        )}
        {highCount > 0 && (
          <span className="pg-operations-status flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-full"
            style={{ background: 'color-mix(in srgb, rgb(255 140 0) 10%, var(--pg-surface))', '--pg-status-ink': '#FF8C00', border: '1px solid rgba(255,140,0,0.3)' }}>
            ⚠️ {highCount} High
          </span>
        )}
      </div>

      {/* Filter */}
      <div className="flex gap-2">
        {[
          { key: 'open', label: `Open (${open.length})` },
          { key: 'resolved', label: `Resolved (${resolved.length})` },
        ].map(tab => (
          <button key={tab.key} onClick={() => setFilter(tab.key)}
            className="pg-operations-status text-xs px-3 py-1.5 rounded-lg transition-all"
            style={filter === tab.key
              ? { background: 'color-mix(in srgb, rgb(191 95 255) 12%, var(--pg-surface))', '--pg-status-ink': '#BF5FFF', border: '1px solid rgba(191,95,255,0.3)' }
              : { background: 'var(--pg-surface)', '--pg-status-ink': 'var(--pg-muted)', border: '1px solid var(--pg-line)' }}>
            {tab.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="space-y-2">{[1,2,3].map(i => <div key={i} className="pg-operations-card h-20 rounded-xl pg-operations-skeleton animate-pulse" />)}</div>
      ) : shown.length === 0 ? (
        <div className="pg-operations-card text-center py-12 rounded-2xl"
          style={{ background: 'color-mix(in srgb, rgb(0 255 135) 4%, var(--pg-surface))', border: '1px solid rgba(0,255,135,0.15)' }}>
          <CheckCircle className="pg-operations-status w-10 h-10 mx-auto mb-2" style={{ '--pg-status-ink': '#00FF87' }} />
          <p className="font-semibold text-foreground text-sm">All clear!</p>
          <p className="text-xs text-muted-foreground mt-1">No {filter} alerts.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {shown.map(alert => {
            const cfg = PRIORITY_CONFIG[alert.priority] || PRIORITY_CONFIG.medium;
            const icon = ALERT_ICONS[alert.alert_type] || '🔔';
            return (
              <div key={alert.id} className="pg-operations-card rounded-2xl p-4 space-y-2"
                style={{ background: cfg.bg, border: `1px solid ${cfg.border}` }}>
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-start gap-2 flex-1 min-w-0">
                    <span className="text-base flex-shrink-0">{icon}</span>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-bold text-sm text-foreground">{alert.title}</span>
                        <span className="pg-operations-status text-[10px] font-black px-2 py-0.5 rounded-full capitalize"
                          style={{ background: cfg.bg, '--pg-status-ink': cfg.color, border: `1px solid ${cfg.border}` }}>
                          {alert.priority}
                        </span>
                      </div>
                      {alert.description && (
                        <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{alert.description}</p>
                      )}
                      <div className="flex flex-wrap gap-3 mt-1 text-[10px] text-muted-foreground">
                        {alert.created_date && (
                          <span>{formatDistanceToNow(new Date(alert.created_date), { addSuffix: true })}</span>
                        )}
                        {alert.seller_email && <span>Seller: {alert.seller_email}</span>}
                        {alert.buyer_email && <span>Buyer: {alert.buyer_email}</span>}
                      </div>
                    </div>
                  </div>
                  {!alert.resolved && (
                    <button
                      onClick={() => handleResolve(alert)}
                      disabled={resolving === alert.id}
                      className="pg-operations-status flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold flex-shrink-0 disabled:opacity-40"
                      style={{ background: 'color-mix(in srgb, rgb(0 255 135) 8%, var(--pg-surface))', '--pg-status-ink': '#00FF87', border: '1px solid rgba(0,255,135,0.25)' }}>
                      {resolving === alert.id
                        ? <span className="w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin" />
                        : <><CheckCircle className="w-3 h-3" /> Resolve</>}
                    </button>
                  )}
                  {alert.resolved && (
                    <span className="text-[10px] text-muted-foreground flex-shrink-0">
                      ✓ {alert.resolved_by} · {alert.resolved_at ? format(new Date(alert.resolved_at), 'MMM d h:mm a') : ''}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}