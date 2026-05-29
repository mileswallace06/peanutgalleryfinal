import { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { getTransferWindowInfo } from '@/lib/transferWindow';
import { RefreshCw, Clock, CheckCircle, XCircle, AlertTriangle, ShieldCheck } from 'lucide-react';

const STATUS_OPTIONS = [
  { value: 'unknown',                  label: '❓ Unknown',              color: '#BF5FFF' },
  { value: 'open',                     label: '✅ Open',                 color: '#00FF87' },
  { value: 'closing_soon',             label: '⚠️ Closing Soon',         color: '#FF8C00' },
  { value: 'closed',                   label: '🚫 Closed',               color: '#FF2D78' },
  { value: 'manually_verified_open',   label: '✅ Manually Verified Open', color: '#00FF87' },
  { value: 'manually_verified_closed', label: '🔒 Manually Verified Closed', color: '#FF2D78' },
];

const SOURCE_OPTIONS = [
  'ticketmaster', 'seatgeek', 'axs', 'mlb', 'manual_admin', 'user_reported', 'inferred'
];

function EventTransferCard({ event, onUpdate }) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    transfer_window_status: event.transfer_window_status || 'unknown',
    transfer_window_closes_at: event.transfer_window_closes_at
      ? new Date(event.transfer_window_closes_at).toISOString().slice(0, 16)
      : '',
    transfer_window_source: event.transfer_window_source || 'manual_admin',
    transfer_window_confidence: event.transfer_window_confidence ?? 80,
    upgrade_eligibility_status: event.upgrade_eligibility_status || 'unknown',
    admin_transfer_notes: event.admin_transfer_notes || '',
  });

  const info = getTransferWindowInfo(event);

  const handleSave = async () => {
    setSaving(true);
    const update = {
      transfer_window_status: form.transfer_window_status,
      transfer_window_source: form.transfer_window_source,
      transfer_window_confidence: parseInt(form.transfer_window_confidence) || 80,
      upgrade_eligibility_status: form.upgrade_eligibility_status,
      admin_transfer_notes: form.admin_transfer_notes || null,
      last_transfer_check_at: new Date().toISOString(),
    };
    if (form.transfer_window_closes_at) {
      update.transfer_window_closes_at = new Date(form.transfer_window_closes_at).toISOString();
    } else {
      update.transfer_window_closes_at = null;
    }
    await base44.entities.Event.update(event.id, update);
    setSaving(false);
    setEditing(false);
    onUpdate();
  };

  return (
    <div className="rounded-xl text-sm"
      style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.1)' }}>
      {/* Header */}
      <div className="px-4 py-3 flex items-start justify-between gap-3"
        style={{ borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-foreground truncate">{event.title}</div>
          <div className="text-xs text-muted-foreground mt-0.5">
            {event.venue}{event.city ? `, ${event.city}` : ''}
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <span className="text-xs px-2 py-0.5 rounded-full font-bold"
            style={{ background: info.bg, color: info.color, border: `1px solid ${info.border}` }}>
            {info.badgeIcon} {info.badge}
          </span>
          <button
            onClick={() => setEditing(e => !e)}
            className="text-xs px-3 py-1 rounded-lg font-semibold transition-all"
            style={{ background: editing ? 'rgba(191,95,255,0.15)' : 'rgba(255,255,255,0.06)', color: editing ? '#BF5FFF' : 'hsl(var(--muted-foreground))', border: `1px solid ${editing ? 'rgba(191,95,255,0.3)' : 'rgba(255,255,255,0.1)'}` }}>
            {editing ? 'Cancel' : 'Edit'}
          </button>
        </div>
      </div>

      {/* Current status */}
      {!editing && (
        <div className="px-4 py-3 space-y-1.5 text-xs text-muted-foreground">
          <div className="flex gap-4 flex-wrap">
            <span>Status: <strong className="text-foreground">{event.transfer_window_status || 'unknown'}</strong></span>
            <span>Source: <strong className="text-foreground">{event.transfer_window_source || '—'}</strong></span>
            <span>Confidence: <strong className="text-foreground">{event.transfer_window_confidence ?? '—'}%</strong></span>
          </div>
          {event.transfer_window_closes_at && (
            <div>Closes: <strong className="text-foreground">
              {new Date(event.transfer_window_closes_at).toLocaleString()}
            </strong></div>
          )}
          {event.admin_transfer_notes && (
            <div className="italic">"{event.admin_transfer_notes}"</div>
          )}
          {event.last_transfer_check_at && (
            <div className="opacity-50">Last checked: {new Date(event.last_transfer_check_at).toLocaleString()}</div>
          )}
        </div>
      )}

      {/* Edit form */}
      {editing && (
        <div className="px-4 py-4 space-y-4">
          {/* Status */}
          <div>
            <label className="block text-xs text-muted-foreground mb-2 font-semibold">Transfer Window Status</label>
            <div className="grid grid-cols-2 gap-2">
              {STATUS_OPTIONS.map(opt => (
                <button key={opt.value} type="button"
                  onClick={() => setForm(f => ({ ...f, transfer_window_status: opt.value }))}
                  className="text-left px-3 py-2 rounded-lg text-xs font-semibold transition-all"
                  style={{
                    background: form.transfer_window_status === opt.value ? `${opt.color}18` : 'rgba(255,255,255,0.04)',
                    border: form.transfer_window_status === opt.value ? `1px solid ${opt.color}60` : '1px solid rgba(255,255,255,0.08)',
                    color: form.transfer_window_status === opt.value ? opt.color : 'hsl(var(--muted-foreground))',
                  }}>
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Close time */}
          <div>
            <label className="block text-xs text-muted-foreground mb-1.5 font-semibold">
              Expected close time <span className="font-normal opacity-60">(optional)</span>
            </label>
            <input
              type="datetime-local"
              value={form.transfer_window_closes_at}
              onChange={e => setForm(f => ({ ...f, transfer_window_closes_at: e.target.value }))}
              className="w-full px-3 py-2.5 rounded-xl text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
              style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)' }}
            />
          </div>

          {/* Source */}
          <div>
            <label className="block text-xs text-muted-foreground mb-1.5 font-semibold">Source</label>
            <select
              value={form.transfer_window_source}
              onChange={e => setForm(f => ({ ...f, transfer_window_source: e.target.value }))}
              className="w-full px-3 py-2.5 rounded-xl text-xs text-foreground focus:outline-none"
              style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)' }}>
              {SOURCE_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>

          {/* Confidence */}
          <div>
            <label className="block text-xs text-muted-foreground mb-1.5 font-semibold">
              Confidence: {form.transfer_window_confidence}%
            </label>
            <input type="range" min="0" max="100" step="5"
              value={form.transfer_window_confidence}
              onChange={e => setForm(f => ({ ...f, transfer_window_confidence: e.target.value }))}
              className="w-full" />
          </div>

          {/* Eligibility */}
          <div>
            <label className="block text-xs text-muted-foreground mb-1.5 font-semibold">Upgrade Eligibility</label>
            <div className="flex gap-2 flex-wrap">
              {['eligible','limited','unknown','not_eligible'].map(e => (
                <button key={e} type="button"
                  onClick={() => setForm(f => ({ ...f, upgrade_eligibility_status: e }))}
                  className="px-3 py-1.5 rounded-lg text-xs font-semibold transition-all"
                  style={{
                    background: form.upgrade_eligibility_status === e ? 'rgba(191,95,255,0.12)' : 'rgba(255,255,255,0.04)',
                    border: form.upgrade_eligibility_status === e ? '1px solid rgba(191,95,255,0.4)' : '1px solid rgba(255,255,255,0.08)',
                    color: form.upgrade_eligibility_status === e ? '#BF5FFF' : 'hsl(var(--muted-foreground))',
                  }}>
                  {e}
                </button>
              ))}
            </div>
          </div>

          {/* Notes */}
          <div>
            <label className="block text-xs text-muted-foreground mb-1.5 font-semibold">Admin Notes</label>
            <textarea
              value={form.admin_transfer_notes}
              onChange={e => setForm(f => ({ ...f, admin_transfer_notes: e.target.value }))}
              placeholder="e.g. Ticketmaster confirmed transfers close at halftime"
              rows={2}
              className="w-full px-3 py-2 rounded-xl text-xs text-foreground placeholder:text-muted-foreground resize-none focus:outline-none"
              style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)' }}
            />
          </div>

          <button onClick={handleSave} disabled={saving}
            className="w-full py-2.5 rounded-xl text-xs font-black flex items-center justify-center gap-2 disabled:opacity-40"
            style={{ background: 'linear-gradient(135deg, #BF5FFF, #FF2D78)', color: '#fff' }}>
            {saving ? <><span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" /> Saving…</> : <><ShieldCheck className="w-3.5 h-3.5" /> Save Transfer Status</>}
          </button>
        </div>
      )}
    </div>
  );
}

export default function TransferWindowAdminPanel({ onRefresh }) {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');

  const loadEvents = async () => {
    setLoading(true);
    const all = await base44.entities.Event.list('-created_date', 100);
    // Show upcoming + live events
    setEvents(all.filter(e => e.status !== 'ended'));
    setLoading(false);
  };

  useEffect(() => { loadEvents(); }, []);

  const handleUpdate = () => { loadEvents(); onRefresh?.(); };

  const filtered = filter === 'all'
    ? events
    : events.filter(e => (e.transfer_window_status || 'unknown') === filter);

  // Stats
  const stats = {
    unknown: events.filter(e => !e.transfer_window_status || e.transfer_window_status === 'unknown').length,
    open: events.filter(e => e.transfer_window_status === 'open' || e.transfer_window_status === 'manually_verified_open').length,
    closing: events.filter(e => e.transfer_window_status === 'closing_soon').length,
    closed: events.filter(e => e.transfer_window_status === 'closed' || e.transfer_window_status === 'manually_verified_closed').length,
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="font-bold text-lg text-foreground">Transfer Window Manager</h2>
          <p className="text-xs text-muted-foreground">Set transfer status per event — controls buyer eligibility and warnings</p>
        </div>
        <button onClick={loadEvents} disabled={loading}
          className="p-1.5 rounded-lg hover:bg-muted transition-colors">
          <RefreshCw className={`w-4 h-4 text-muted-foreground ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-4 gap-2 mb-4">
        {[
          { label: 'Unknown', value: stats.unknown, color: '#BF5FFF' },
          { label: 'Open', value: stats.open, color: '#00FF87' },
          { label: 'Closing', value: stats.closing, color: '#FF8C00' },
          { label: 'Closed', value: stats.closed, color: '#FF2D78' },
        ].map(s => (
          <div key={s.label} className="rounded-xl p-3 text-center"
            style={{ background: 'rgba(255,255,255,0.04)', border: `1px solid ${s.color}25` }}>
            <div className="text-xl font-black" style={{ color: s.color }}>{s.value}</div>
            <div className="text-[10px] text-muted-foreground">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Filter tabs */}
      <div className="flex gap-2 flex-wrap mb-4">
        {[
          { key: 'all', label: `All (${events.length})` },
          { key: 'unknown', label: `Unknown (${stats.unknown})` },
          { key: 'open', label: `Open (${stats.open})` },
          { key: 'closing_soon', label: `Closing (${stats.closing})` },
          { key: 'closed', label: `Closed (${stats.closed})` },
        ].map(tab => (
          <button key={tab.key} onClick={() => setFilter(tab.key)}
            className="text-xs px-2.5 py-1 rounded-lg transition-all"
            style={filter === tab.key
              ? { background: 'rgba(191,95,255,0.12)', color: '#BF5FFF', border: '1px solid rgba(191,95,255,0.3)' }
              : { background: 'rgba(255,255,255,0.04)', color: 'hsl(var(--muted-foreground))', border: '1px solid rgba(255,255,255,0.08)' }}>
            {tab.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="space-y-3">
          {[1,2,3].map(i => <div key={i} className="h-16 rounded-xl bg-white/5 animate-pulse" />)}
        </div>
      ) : filtered.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-8">No events in this category.</p>
      ) : (
        <div className="space-y-3">
          {filtered.map(event => (
            <EventTransferCard key={event.id} event={event} onUpdate={handleUpdate} />
          ))}
        </div>
      )}
    </div>
  );
}