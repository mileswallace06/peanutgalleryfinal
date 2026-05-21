import { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { AlertTriangle, Plus, ChevronDown, ChevronUp, Upload } from 'lucide-react';

const SEVERITIES = [
  { value: 'critical', label: 'Critical', color: '#FF2D78' },
  { value: 'high',     label: 'High',     color: '#FF8C00' },
  { value: 'medium',   label: 'Medium',   color: '#FFE600' },
  { value: 'low',      label: 'Low',      color: '#00C8FF' },
];

const STATUSES = [
  { value: 'open',          label: 'Open',          color: '#FF2D78' },
  { value: 'investigating', label: 'Investigating',  color: '#FF8C00' },
  { value: 'fixed',         label: 'Fixed',          color: '#BF5FFF' },
  { value: 'verified',      label: 'Verified',       color: '#00FF87' },
];

const PAGES = [
  'Events', 'Upgrades', 'Sell / Create Listing', 'Fan Zone', 'Me / Profile',
  'Account Settings', 'Event Detail', 'Purchase Flow', 'My Tickets', 'My Sales',
  'Admin', 'Auth / Login', 'Navigation', 'Other'
];

const empty = { title: '', description: '', severity: 'medium', status: 'open', affected_page: '', reporter_name: '', device: '', screenshot_url: '', notes: '' };

function SeverityDot({ severity }) {
  const s = SEVERITIES.find(s => s.value === severity);
  return <span className="w-2 h-2 rounded-full flex-shrink-0 inline-block" style={{ background: s?.color || '#BF5FFF' }} />;
}

function StatusBadge({ status }) {
  const s = STATUSES.find(s => s.value === status);
  return (
    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full"
      style={{ background: `${s?.color || '#BF5FFF'}18`, color: s?.color || '#BF5FFF', border: `1px solid ${s?.color || '#BF5FFF'}33` }}>
      {s?.label || status}
    </span>
  );
}

export default function BugTracker() {
  const [bugs, setBugs] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(empty);
  const [saving, setSaving] = useState(false);
  const [expandedId, setExpandedId] = useState(null);
  const [filterStatus, setFilterStatus] = useState('all');
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    load();
  }, []);

  const load = () => {
    base44.entities.BugReport.list('-created_date', 100).then(setBugs).catch(() => {});
  };

  const handleSubmit = async () => {
    if (!form.title.trim()) return;
    setSaving(true);
    await base44.entities.BugReport.create(form);
    setForm(empty);
    setShowForm(false);
    load();
    setSaving(false);
  };

  const updateStatus = async (id, status) => {
    await base44.entities.BugReport.update(id, { status });
    setBugs(prev => prev.map(b => b.id === id ? { ...b, status } : b));
  };

  const handleScreenshot = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setUploading(true);
    const { file_url } = await base44.integrations.Core.UploadFile({ file });
    setForm(f => ({ ...f, screenshot_url: file_url }));
    setUploading(false);
  };

  const filtered = filterStatus === 'all' ? bugs : bugs.filter(b => b.status === filterStatus);
  const openCount = bugs.filter(b => b.status === 'open').length;
  const critCount = bugs.filter(b => b.severity === 'critical' && b.status !== 'verified').length;

  return (
    <div className="space-y-4">
      {/* Header stats */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: 'Open', value: openCount, color: '#FF2D78' },
          { label: 'Critical', value: critCount, color: '#FF2D78' },
          { label: 'Total', value: bugs.length, color: '#BF5FFF' },
        ].map(({ label, value, color }) => (
          <div key={label} className="rounded-2xl px-4 py-3 text-center" style={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))' }}>
            <p className="text-2xl font-black" style={{ color }}>{value}</p>
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mt-0.5">{label}</p>
          </div>
        ))}
      </div>

      {/* Filters + Add button */}
      <div className="flex items-center gap-2 flex-wrap">
        {['all', ...STATUSES.map(s => s.value)].map(s => (
          <button key={s} onClick={() => setFilterStatus(s)}
            className="px-3 py-1.5 rounded-full text-xs font-bold capitalize transition-all"
            style={filterStatus === s
              ? { background: 'rgba(191,95,255,0.15)', color: '#BF5FFF', border: '1px solid rgba(191,95,255,0.35)' }
              : { background: 'hsl(var(--muted))', color: 'hsl(var(--muted-foreground))', border: '1px solid hsl(var(--border))' }
            }>
            {s === 'all' ? `All (${bugs.length})` : s}
          </button>
        ))}
        <button onClick={() => setShowForm(v => !v)}
          className="ml-auto flex items-center gap-1.5 px-4 py-1.5 rounded-full text-xs font-black"
          style={{ background: 'rgba(255,45,120,0.12)', color: '#FF2D78', border: '1px solid rgba(255,45,120,0.3)' }}>
          <Plus className="w-3.5 h-3.5" /> Report Bug
        </button>
      </div>

      {/* New bug form */}
      {showForm && (
        <div className="rounded-2xl p-4 space-y-3" style={{ background: 'hsl(var(--card))', border: '1px solid rgba(255,45,120,0.25)' }}>
          <p className="text-xs font-black tracking-widest uppercase text-muted-foreground">New Bug Report</p>
          <input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
            placeholder="Bug title *"
            className="w-full px-3 py-2.5 rounded-xl text-sm focus:outline-none"
            style={{ background: 'hsl(var(--input))', border: '1px solid hsl(var(--border))', color: 'hsl(var(--foreground))' }} />
          <textarea value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
            placeholder="Describe what happened, steps to reproduce…"
            rows={3}
            className="w-full px-3 py-2.5 rounded-xl text-sm focus:outline-none resize-none"
            style={{ background: 'hsl(var(--input))', border: '1px solid hsl(var(--border))', color: 'hsl(var(--foreground))' }} />
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[10px] font-bold text-muted-foreground uppercase mb-1 block">Severity</label>
              <select value={form.severity} onChange={e => setForm(f => ({ ...f, severity: e.target.value }))}
                className="w-full px-3 py-2 rounded-xl text-sm focus:outline-none"
                style={{ background: 'hsl(var(--input))', border: '1px solid hsl(var(--border))', color: 'hsl(var(--foreground))' }}>
                {SEVERITIES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[10px] font-bold text-muted-foreground uppercase mb-1 block">Affected Page</label>
              <select value={form.affected_page} onChange={e => setForm(f => ({ ...f, affected_page: e.target.value }))}
                className="w-full px-3 py-2 rounded-xl text-sm focus:outline-none"
                style={{ background: 'hsl(var(--input))', border: '1px solid hsl(var(--border))', color: 'hsl(var(--foreground))' }}>
                <option value="">Select page…</option>
                {PAGES.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <input value={form.reporter_name} onChange={e => setForm(f => ({ ...f, reporter_name: e.target.value }))}
              placeholder="Your name"
              className="px-3 py-2 rounded-xl text-sm focus:outline-none"
              style={{ background: 'hsl(var(--input))', border: '1px solid hsl(var(--border))', color: 'hsl(var(--foreground))' }} />
            <input value={form.device} onChange={e => setForm(f => ({ ...f, device: e.target.value }))}
              placeholder="Device / browser"
              className="px-3 py-2 rounded-xl text-sm focus:outline-none"
              style={{ background: 'hsl(var(--input))', border: '1px solid hsl(var(--border))', color: 'hsl(var(--foreground))' }} />
          </div>
          {/* Screenshot upload */}
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-bold cursor-pointer transition-all"
              style={{ background: 'rgba(0,200,255,0.1)', color: '#00C8FF', border: '1px solid rgba(0,200,255,0.25)' }}>
              <Upload className="w-3.5 h-3.5" />
              {uploading ? 'Uploading…' : form.screenshot_url ? 'Screenshot attached ✓' : 'Attach screenshot'}
              <input type="file" accept="image/*" className="hidden" onChange={handleScreenshot} />
            </label>
          </div>
          <div className="flex gap-2 pt-1">
            <button onClick={handleSubmit} disabled={saving || !form.title.trim()}
              className="flex-1 py-2.5 rounded-xl text-sm font-black transition-all disabled:opacity-60"
              style={{ background: '#FF2D78', color: '#fff' }}>
              {saving ? 'Saving…' : 'Submit Bug'}
            </button>
            <button onClick={() => setShowForm(false)}
              className="px-5 py-2.5 rounded-xl text-sm font-bold"
              style={{ background: 'hsl(var(--muted))', color: 'hsl(var(--muted-foreground))', border: '1px solid hsl(var(--border))' }}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Bug list */}
      {filtered.length === 0 ? (
        <div className="text-center py-10" style={{ color: 'hsl(var(--muted-foreground))' }}>
          <p className="text-3xl mb-2">🐛</p>
          <p className="text-sm font-medium">No bugs reported{filterStatus !== 'all' ? ` with status "${filterStatus}"` : ' yet'}</p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map(bug => (
            <div key={bug.id} className="rounded-2xl overflow-hidden" style={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))' }}>
              <button onClick={() => setExpandedId(v => v === bug.id ? null : bug.id)}
                className="w-full flex items-center gap-3 px-4 py-3 text-left">
                <SeverityDot severity={bug.severity} />
                <span className="flex-1 text-sm font-medium text-foreground truncate">{bug.title}</span>
                {bug.affected_page && <span className="text-[10px] text-muted-foreground hidden sm:block">{bug.affected_page}</span>}
                <StatusBadge status={bug.status} />
                {expandedId === bug.id ? <ChevronUp className="w-4 h-4 text-muted-foreground flex-shrink-0" /> : <ChevronDown className="w-4 h-4 text-muted-foreground flex-shrink-0" />}
              </button>
              {expandedId === bug.id && (
                <div className="px-4 pb-4 border-t border-border space-y-3 pt-3">
                  {bug.description && <p className="text-sm text-muted-foreground">{bug.description}</p>}
                  <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                    {bug.reporter_name && <span>👤 {bug.reporter_name}</span>}
                    {bug.device && <span>📱 {bug.device}</span>}
                    {bug.affected_page && <span>📄 {bug.affected_page}</span>}
                    {bug.created_date && <span>🕐 {new Date(bug.created_date).toLocaleDateString()}</span>}
                  </div>
                  {bug.screenshot_url && (
                    <img src={bug.screenshot_url} alt="screenshot" className="rounded-xl max-h-48 object-contain border border-border" />
                  )}
                  <div>
                    <p className="text-[10px] font-black text-muted-foreground uppercase mb-2">Update Status</p>
                    <div className="flex flex-wrap gap-1.5">
                      {STATUSES.map(s => (
                        <button key={s.value} onClick={() => updateStatus(bug.id, s.value)}
                          className="px-3 py-1 rounded-lg text-xs font-bold transition-all"
                          style={bug.status === s.value
                            ? { background: `${s.color}22`, color: s.color, border: `1px solid ${s.color}55` }
                            : { background: 'hsl(var(--muted))', color: 'hsl(var(--muted-foreground))', border: '1px solid hsl(var(--border))' }
                          }>
                          {s.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}