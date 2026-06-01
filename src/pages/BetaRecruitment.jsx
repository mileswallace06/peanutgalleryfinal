import { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { useAuth } from '@/lib/AuthContext';
import { useNavigate, Link } from 'react-router-dom';
import { Plus, User, ChevronDown, ChevronUp, Trash2, CheckCircle2, Clock, XCircle, ArrowLeft } from 'lucide-react';

const PHASE_TARGETS = { phase_1: 10, phase_2: 25, phase_3: 50 };
const PHASE_LABELS = { phase_1: 'Phase 1 — 10 testers', phase_2: 'Phase 2 — 25 testers', phase_3: 'Phase 3 — 50 testers' };
const STATUS_COLORS = { invited: '#FFE600', active: '#00FF87', completed: '#00C8FF', dropped: '#FF2D78' };
const FAN_TYPE_LABELS = { sports: '🏈 Sports fan', concert: '🎵 Concert fan', both: '🎭 Both' };

const EMPTY_FORM = { name: '', email: '', fan_type: 'sports', favorite_teams: '', favorite_venues: '', device: '', notes: '' };

function TesterCard({ tester, onUpdate, onDelete }) {
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState(tester);
  const statusColor = STATUS_COLORS[tester.status] || '#888';

  const handleSave = async () => {
    await base44.entities.BetaTester.update(tester.id, form);
    onUpdate({ ...tester, ...form });
    setEditing(false);
  };

  const handleStatus = async (status) => {
    await base44.entities.BetaTester.update(tester.id, { status });
    onUpdate({ ...tester, status });
  };

  return (
    <div className="rounded-2xl overflow-hidden" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.08)' }}>
      <div className="flex items-center gap-3 px-4 py-3.5">
        <div className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 text-sm font-black"
          style={{ background: `${statusColor}20`, border: `1px solid ${statusColor}50`, color: statusColor }}>
          {tester.name?.[0]?.toUpperCase() || '?'}
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-bold text-sm text-foreground leading-tight">{tester.name}</p>
          <p className="text-[10px] text-muted-foreground truncate">
            {FAN_TYPE_LABELS[tester.fan_type] || '—'} · <span style={{ color: statusColor }}>{tester.status}</span>
            {tester.sessions_completed > 0 && ` · ${tester.sessions_completed} session${tester.sessions_completed !== 1 ? 's' : ''}`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => onDelete(tester.id)} className="p-1.5 text-muted-foreground hover:text-destructive transition-colors">
            <Trash2 className="w-3.5 h-3.5" />
          </button>
          <button onClick={() => setExpanded(e => !e)} className="p-1.5 text-muted-foreground">
            {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {expanded && (
        <div className="border-t px-4 pb-4 pt-3 space-y-3" style={{ borderColor: 'rgba(255,255,255,0.06)' }}>
          {/* Status buttons */}
          <div className="flex gap-2 flex-wrap">
            {Object.entries(STATUS_COLORS).map(([s, c]) => (
              <button key={s} onClick={() => handleStatus(s)}
                className="px-3 py-1.5 rounded-full text-[10px] font-black transition-all"
                style={{
                  background: tester.status === s ? `${c}20` : 'rgba(255,255,255,0.04)',
                  border: `1px solid ${tester.status === s ? c + '60' : 'rgba(255,255,255,0.08)'}`,
                  color: tester.status === s ? c : 'hsl(var(--muted-foreground))',
                }}>
                {s.charAt(0).toUpperCase() + s.slice(1)}
              </button>
            ))}
          </div>

          {/* Retention checkboxes */}
          <div className="flex gap-4">
            {['day1_returned', 'day3_returned', 'day7_returned'].map((key, i) => (
              <label key={key} className="flex items-center gap-1.5 cursor-pointer">
                <input type="checkbox" checked={!!tester[key]}
                  onChange={async e => {
                    await base44.entities.BetaTester.update(tester.id, { [key]: e.target.checked });
                    onUpdate({ ...tester, [key]: e.target.checked });
                  }}
                  className="w-3.5 h-3.5 accent-green-400"
                />
                <span className="text-[10px] text-muted-foreground">Day {[1,3,7][i]}</span>
              </label>
            ))}
          </div>

          {/* "What user thinks PG is" */}
          {tester.what_user_thinks_pg_is && (
            <div className="px-3 py-2.5 rounded-xl" style={{ background: 'rgba(0,200,255,0.07)', border: '1px solid rgba(0,200,255,0.2)' }}>
              <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground mb-1">Their description of PG</p>
              <p className="text-xs text-foreground italic">"{tester.what_user_thinks_pg_is}"</p>
            </div>
          )}

          {editing ? (
            <div className="space-y-2">
              {[
                { key: 'name', placeholder: 'Name' },
                { key: 'email', placeholder: 'Email' },
                { key: 'favorite_teams', placeholder: 'Favorite teams' },
                { key: 'favorite_venues', placeholder: 'Favorite venues' },
                { key: 'device', placeholder: 'Device' },
                { key: 'what_user_thinks_pg_is', placeholder: 'What they said PG does (Test 1 quote)' },
                { key: 'notes', placeholder: 'Notes', textarea: true },
              ].map(f => f.textarea ? (
                <textarea key={f.key} value={form[f.key] || ''} onChange={e => setForm(p => ({...p, [f.key]: e.target.value}))}
                  placeholder={f.placeholder} rows={2}
                  className="w-full px-3 py-2 rounded-xl text-xs text-foreground placeholder:text-muted-foreground focus:outline-none resize-none"
                  style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)' }} />
              ) : (
                <input key={f.key} value={form[f.key] || ''} onChange={e => setForm(p => ({...p, [f.key]: e.target.value}))}
                  placeholder={f.placeholder}
                  className="w-full px-3 py-2 rounded-xl text-xs text-foreground placeholder:text-muted-foreground focus:outline-none"
                  style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)' }} />
              ))}
              <div className="flex gap-2">
                <button onClick={handleSave} className="flex-1 py-2 rounded-xl font-black text-xs" style={{ background: 'linear-gradient(135deg,#00FF87,#00C8FF)', color: '#0D0B14' }}>Save</button>
                <button onClick={() => { setEditing(false); setForm(tester); }} className="flex-1 py-2 rounded-xl font-black text-xs text-muted-foreground" style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)' }}>Cancel</button>
              </div>
            </div>
          ) : (
            <div className="space-y-1 text-[11px] text-muted-foreground">
              {tester.email && <p>📧 {tester.email}</p>}
              {tester.device && <p>📱 {tester.device}</p>}
              {tester.favorite_teams && <p>🏈 {tester.favorite_teams}</p>}
              {tester.favorite_venues && <p>🏟 {tester.favorite_venues}</p>}
              {tester.notes && <p className="italic opacity-70">{tester.notes}</p>}
              <button onClick={() => setEditing(true)} className="mt-2 text-[10px] font-bold underline" style={{ color: '#BF5FFF' }}>Edit</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function BetaRecruitment() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [testers, setTesters] = useState([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    base44.entities.BetaTester.list('-created_date', 100)
      .then(setTesters).finally(() => setLoading(false));
  }, []);

  if (user && user.role !== 'admin') {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen gap-4 px-6 text-center">
        <p className="text-5xl">🔒</p>
        <p className="font-bold text-foreground">Admin only</p>
        <button onClick={() => navigate(-1)} className="text-sm text-muted-foreground underline">Go back</button>
      </div>
    );
  }

  const handleAdd = async () => {
    if (!form.name.trim() || !form.email.trim()) return;
    setSaving(true);
    const created = await base44.entities.BetaTester.create({ ...form, status: 'invited' });
    setTesters(t => [created, ...t]);
    setForm(EMPTY_FORM);
    setAdding(false);
    setSaving(false);
  };

  const handleUpdate = (updated) => setTesters(t => t.map(x => x.id === updated.id ? updated : x));
  const handleDelete = async (id) => {
    await base44.entities.BetaTester.delete(id);
    setTesters(t => t.filter(x => x.id !== id));
  };

  // Aggregate stats
  const sports = testers.filter(t => t.fan_type === 'sports' || t.fan_type === 'both');
  const concert = testers.filter(t => t.fan_type === 'concert' || t.fan_type === 'both');
  const active = testers.filter(t => t.status === 'active');
  const phase1Target = PHASE_TARGETS.phase_1;
  const phase1Pct = Math.min(100, Math.round((testers.length / phase1Target) * 100));

  // Quotes from Test 1
  const pgDescriptions = testers.filter(t => t.what_user_thinks_pg_is).map(t => t.what_user_thinks_pg_is);

  return (
    <div className="min-h-screen pb-32" style={{ paddingTop: 'env(safe-area-inset-top)' }}>
      {/* Header */}
      <div className="sticky top-0 z-20 frosted-bar border-b border-white/5 px-4 py-4"
        style={{ paddingTop: 'calc(env(safe-area-inset-top) + 16px)' }}>
        <div className="flex items-center justify-between max-w-2xl mx-auto">
          <div className="flex items-center gap-3">
            <Link to="/beta-checklist" className="text-muted-foreground">
              <ArrowLeft className="w-5 h-5" />
            </Link>
            <div>
              <h1 className="font-display text-2xl text-foreground leading-none">Beta Testers</h1>
              <p className="text-[10px] text-muted-foreground mt-0.5">{testers.length} / {phase1Target} Phase 1 goal</p>
            </div>
          </div>
          <button onClick={() => setAdding(true)}
            className="flex items-center gap-2 px-4 py-2 rounded-xl font-black text-sm"
            style={{ background: 'linear-gradient(135deg,#BF5FFF,#FF2D78)', color: '#fff' }}>
            <Plus className="w-4 h-4" /> Add Tester
          </button>
        </div>
      </div>

      <div className="px-4 pt-5 max-w-2xl mx-auto space-y-5">

        {/* Phase 1 progress */}
        <div className="rounded-2xl p-4 space-y-3" style={{ background: 'rgba(191,95,255,0.08)', border: '1px solid rgba(191,95,255,0.25)' }}>
          <div className="flex items-center justify-between">
            <p className="text-xs font-black text-foreground">Phase 1 Recruitment</p>
            <p className="text-xs font-black" style={{ color: '#BF5FFF' }}>{testers.length}/{phase1Target}</p>
          </div>
          <div className="h-2 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.08)' }}>
            <div className="h-full rounded-full transition-all" style={{ width: `${phase1Pct}%`, background: 'linear-gradient(90deg,#BF5FFF,#FF2D78)' }} />
          </div>
          <div className="grid grid-cols-3 gap-2 pt-1">
            {[
              { label: 'Total', value: testers.length, color: '#BF5FFF' },
              { label: 'Sports', value: sports.length, color: '#00C8FF' },
              { label: 'Concert', value: concert.length, color: '#FF2D78' },
            ].map(s => (
              <div key={s.label} className="text-center">
                <p className="text-xl font-black" style={{ color: s.color }}>{s.value}</p>
                <p className="text-[10px] text-muted-foreground">{s.label}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Retention tracker */}
        <div className="rounded-2xl p-4 space-y-2" style={{ background: 'rgba(0,255,135,0.05)', border: '1px solid rgba(0,255,135,0.2)' }}>
          <p className="text-[10px] font-black uppercase tracking-widest" style={{ color: '#00FF87' }}>Retention</p>
          {[
            { label: 'Day 1 returned', key: 'day1_returned' },
            { label: 'Day 3 returned', key: 'day3_returned' },
            { label: 'Day 7 returned', key: 'day7_returned' },
          ].map(r => {
            const count = testers.filter(t => t[r.key]).length;
            const pct = testers.length > 0 ? Math.round((count / testers.length) * 100) : 0;
            return (
              <div key={r.key} className="flex items-center gap-3">
                <span className="text-xs text-muted-foreground flex-1">{r.label}</span>
                <span className="text-xs font-black" style={{ color: pct >= 50 ? '#00FF87' : pct >= 30 ? '#FFE600' : '#FF2D78' }}>{count}/{testers.length} ({pct}%)</span>
              </div>
            );
          })}
        </div>

        {/* What users think PG is */}
        {pgDescriptions.length > 0 && (
          <div className="rounded-2xl p-4 space-y-3" style={{ background: 'rgba(0,200,255,0.06)', border: '1px solid rgba(0,200,255,0.2)' }}>
            <p className="text-[10px] font-black uppercase tracking-widest" style={{ color: '#00C8FF' }}>What Users Think PG Is</p>
            <p className="text-[11px] text-muted-foreground">Verbatim from Test 1 — 30 Second Test</p>
            {pgDescriptions.map((q, i) => (
              <div key={i} className="flex gap-2 items-start">
                <span className="text-[10px] font-black text-muted-foreground w-4 flex-shrink-0 mt-0.5">{i + 1}</span>
                <p className="text-xs text-foreground italic leading-relaxed">"{q}"</p>
              </div>
            ))}
          </div>
        )}

        {/* Add form */}
        {adding && (
          <div className="rounded-2xl p-4 space-y-3" style={{ background: 'rgba(191,95,255,0.08)', border: '1px solid rgba(191,95,255,0.3)' }}>
            <p className="text-sm font-black text-foreground">New Beta Tester</p>
            <div className="grid grid-cols-2 gap-2">
              {[
                { key: 'name', placeholder: 'Name *' },
                { key: 'email', placeholder: 'Email *' },
                { key: 'favorite_teams', placeholder: 'Favorite teams' },
                { key: 'favorite_venues', placeholder: 'Favorite venues' },
                { key: 'device', placeholder: 'Device' },
              ].map(f => (
                <input key={f.key} value={form[f.key]} onChange={e => setForm(p => ({...p, [f.key]: e.target.value}))}
                  placeholder={f.placeholder}
                  className="px-3 py-2.5 rounded-xl text-sm text-foreground placeholder:text-muted-foreground focus:outline-none col-span-1"
                  style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)' }} />
              ))}
            </div>
            {/* Fan type */}
            <div className="flex gap-2">
              {['sports', 'concert', 'both'].map(ft => (
                <button key={ft} onClick={() => setForm(p => ({...p, fan_type: ft}))}
                  className="flex-1 py-2 rounded-xl text-xs font-black transition-all"
                  style={{
                    background: form.fan_type === ft ? 'rgba(191,95,255,0.2)' : 'rgba(255,255,255,0.04)',
                    border: `1px solid ${form.fan_type === ft ? 'rgba(191,95,255,0.5)' : 'rgba(255,255,255,0.08)'}`,
                    color: form.fan_type === ft ? '#BF5FFF' : 'hsl(var(--muted-foreground))',
                  }}>
                  {FAN_TYPE_LABELS[ft]}
                </button>
              ))}
            </div>
            <textarea value={form.notes} onChange={e => setForm(p => ({...p, notes: e.target.value}))}
              placeholder="Notes"
              rows={2}
              className="w-full px-3 py-2.5 rounded-xl text-sm text-foreground placeholder:text-muted-foreground focus:outline-none resize-none"
              style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)' }} />
            <div className="flex gap-2">
              <button onClick={handleAdd} disabled={saving}
                className="flex-1 py-2.5 rounded-xl font-black text-sm disabled:opacity-60"
                style={{ background: 'linear-gradient(135deg,#BF5FFF,#FF2D78)', color: '#fff' }}>
                {saving ? 'Saving…' : 'Add Tester'}
              </button>
              <button onClick={() => { setAdding(false); setForm(EMPTY_FORM); }}
                className="flex-1 py-2.5 rounded-xl font-black text-sm text-muted-foreground"
                style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)' }}>
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Testers list */}
        {loading ? (
          <div className="space-y-3">{[...Array(3)].map((_, i) => <div key={i} className="h-16 rounded-2xl animate-pulse bg-muted" />)}</div>
        ) : testers.length === 0 ? (
          <div className="rounded-2xl p-8 text-center space-y-2" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.07)' }}>
            <p className="text-4xl">🧪</p>
            <p className="font-bold text-foreground">No testers yet</p>
            <p className="text-xs text-muted-foreground">Recruit 5 sports fans + 5 concert fans to start.</p>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Testers ({testers.length})</p>
            {testers.map(t => (
              <TesterCard key={t.id} tester={t} onUpdate={handleUpdate} onDelete={handleDelete} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}