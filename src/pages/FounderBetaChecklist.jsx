import { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { CheckCircle2, XCircle, HelpCircle, AlertTriangle, ChevronDown, ChevronUp, Plus, Trash2, User, RefreshCw } from 'lucide-react';
import { useAuth } from '@/lib/AuthContext';
import { useNavigate } from 'react-router-dom';

// ─── Task definitions ──────────────────────────────────────────────────────────
const TASKS = [
  { id: 1, label: 'Open app', desc: 'User lands on the app for the first time. Does the landing page make sense?' },
  { id: 2, label: 'Find an event', desc: 'User locates a real upcoming event via search or location.' },
  { id: 3, label: 'Explain what PG does', desc: 'Without prompting, can the user explain what Peanut Gallery is?' },
  { id: 4, label: 'Find Upgrades tab', desc: 'User navigates to the Upgrades page independently.' },
  { id: 5, label: 'Enter Live Hub', desc: 'User opens a Live Hub for a live or upcoming event.' },
  { id: 6, label: 'Understand Flash Drops', desc: 'User can explain what a Flash Drop is in their own words.' },
  { id: 7, label: 'Join a Flash Drop', desc: 'User successfully enters a Flash Drop.' },
  { id: 8, label: 'Find a listing', desc: 'User locates a ticket listing and understands the price/seat info.' },
  { id: 9, label: 'Understand transfer protection', desc: 'User can explain what happens if a seller doesn\'t transfer.' },
  { id: 10, label: 'Explain how buying works', desc: 'User understands escrow, payment hold, and confirmation flow.' },
  { id: 11, label: 'Explain how selling works', desc: 'User understands how to list, transfer, and get paid.' },
  { id: 12, label: 'Find notifications/watchlists', desc: 'User finds the bell icon and understands notification purpose.' },
];

const OUTCOMES = [
  { key: 'completed', label: 'Completed', color: '#00FF87', Icon: CheckCircle2 },
  { key: 'confused', label: 'Confused', color: '#FFE600', Icon: HelpCircle },
  { key: 'needed_help', label: 'Needed Help', color: '#FF8C00', Icon: AlertTriangle },
  { key: 'failed', label: 'Failed', color: '#FF2D78', Icon: XCircle },
];

const OUTCOME_BG = {
  completed: 'rgba(0,255,135,0.12)',
  confused: 'rgba(255,230,0,0.12)',
  needed_help: 'rgba(255,140,0,0.12)',
  failed: 'rgba(255,45,120,0.12)',
};

const EMPTY_RESULTS = () => Object.fromEntries(TASKS.map(t => [t.id, { outcome: null, note: '' }]));

// ─── Storage key ───────────────────────────────────────────────────────────────
const LS_KEY = 'pg_beta_sessions';

function loadSessions() {
  try { return JSON.parse(localStorage.getItem(LS_KEY) || '[]'); } catch { return []; }
}
function saveSessions(sessions) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(sessions)); } catch {}
}

function newSession(name, device) {
  return {
    id: `s_${Date.now()}`,
    tester_name: name,
    device,
    created_at: new Date().toISOString(),
    results: EMPTY_RESULTS(),
    notes: '',
  };
}

// ─── Score summary ─────────────────────────────────────────────────────────────
function ScoreSummary({ results }) {
  const counts = { completed: 0, confused: 0, needed_help: 0, failed: 0, untested: 0 };
  TASKS.forEach(t => {
    const o = results[t.id]?.outcome;
    if (o) counts[o]++;
    else counts.untested++;
  });
  const total = TASKS.length;
  const pct = Math.round((counts.completed / total) * 100);

  return (
    <div className="rounded-2xl p-4 space-y-3" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)' }}>
      <div className="flex items-center justify-between">
        <span className="text-xs font-black uppercase tracking-widest text-muted-foreground">Session Score</span>
        <span className="text-2xl font-black" style={{ color: pct >= 80 ? '#00FF87' : pct >= 50 ? '#FFE600' : '#FF2D78' }}>{pct}%</span>
      </div>
      <div className="flex gap-1 h-2 rounded-full overflow-hidden">
        {OUTCOMES.map(o => (
          <div key={o.key} style={{ flex: counts[o.key], background: o.color, opacity: counts[o.key] > 0 ? 1 : 0 }} />
        ))}
        <div style={{ flex: counts.untested, background: 'rgba(255,255,255,0.1)' }} />
      </div>
      <div className="flex flex-wrap gap-3">
        {OUTCOMES.map(o => (
          <div key={o.key} className="flex items-center gap-1 text-[11px]">
            <span className="w-2.5 h-2.5 rounded-full" style={{ background: o.color }} />
            <span className="text-muted-foreground">{o.label}:</span>
            <span className="font-black text-foreground">{counts[o.key]}</span>
          </div>
        ))}
        <div className="flex items-center gap-1 text-[11px]">
          <span className="w-2.5 h-2.5 rounded-full" style={{ background: 'rgba(255,255,255,0.15)' }} />
          <span className="text-muted-foreground">Untested:</span>
          <span className="font-black text-foreground">{counts.untested}</span>
        </div>
      </div>
    </div>
  );
}

// ─── Task row ──────────────────────────────────────────────────────────────────
function TaskRow({ task, result, onChange }) {
  const [expanded, setExpanded] = useState(false);
  const outcome = result?.outcome || null;
  const note = result?.note || '';

  const activeOutcome = OUTCOMES.find(o => o.key === outcome);

  return (
    <div
      className="rounded-2xl overflow-hidden transition-all"
      style={{
        background: outcome ? OUTCOME_BG[outcome] : 'rgba(255,255,255,0.03)',
        border: outcome ? `1px solid ${activeOutcome?.color}40` : '1px solid rgba(255,255,255,0.08)',
      }}
    >
      {/* Header row */}
      <div className="flex items-center gap-3 px-4 py-3.5">
        <span className="w-6 h-6 rounded-full flex-shrink-0 flex items-center justify-center text-[10px] font-black"
          style={{ background: 'rgba(255,255,255,0.08)', color: 'hsl(var(--muted-foreground))' }}>
          {task.id}
        </span>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold text-foreground leading-tight">{task.label}</p>
          {outcome && (
            <p className="text-[10px] font-semibold mt-0.5" style={{ color: activeOutcome?.color }}>
              {activeOutcome?.label}
            </p>
          )}
        </div>
        <button onClick={() => setExpanded(e => !e)} className="text-muted-foreground p-1">
          {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </button>
      </div>

      {/* Expanded */}
      {expanded && (
        <div className="px-4 pb-4 space-y-3 border-t" style={{ borderColor: 'rgba(255,255,255,0.06)' }}>
          <p className="text-[11px] text-muted-foreground pt-3 leading-relaxed">{task.desc}</p>

          {/* Outcome buttons */}
          <div className="grid grid-cols-2 gap-2">
            {OUTCOMES.map(({ key, label, color, Icon }) => (
              <button
                key={key}
                onClick={() => onChange(task.id, 'outcome', outcome === key ? null : key)}
                className="flex items-center gap-2 px-3 py-2.5 rounded-xl text-xs font-bold transition-all active:scale-95"
                style={{
                  background: outcome === key ? `${color}20` : 'rgba(255,255,255,0.04)',
                  border: outcome === key ? `1px solid ${color}60` : '1px solid rgba(255,255,255,0.08)',
                  color: outcome === key ? color : 'hsl(var(--muted-foreground))',
                }}
              >
                <Icon className="w-3.5 h-3.5 flex-shrink-0" />
                {label}
              </button>
            ))}
          </div>

          {/* Note */}
          <textarea
            value={note}
            onChange={e => onChange(task.id, 'note', e.target.value)}
            placeholder="Notes on what happened…"
            rows={2}
            className="w-full px-3 py-2.5 rounded-xl text-xs text-foreground placeholder:text-muted-foreground focus:outline-none resize-none"
            style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)' }}
          />
        </div>
      )}
    </div>
  );
}

// ─── Session panel ─────────────────────────────────────────────────────────────
function SessionPanel({ session, onUpdate, onDelete }) {
  const [expanded, setExpanded] = useState(false);

  const handleResultChange = (taskId, field, value) => {
    const updated = {
      ...session,
      results: {
        ...session.results,
        [taskId]: { ...session.results[taskId], [field]: value },
      },
    };
    onUpdate(updated);
  };

  const counts = Object.values(session.results);
  const done = counts.filter(r => r.outcome).length;

  return (
    <div className="rounded-2xl overflow-hidden" style={{ border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.02)' }}>
      {/* Session header */}
      <div className="flex items-center gap-3 px-4 py-3.5">
        <div className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0"
          style={{ background: 'linear-gradient(135deg, #BF5FFF, #FF2D78)' }}>
          <User className="w-4 h-4 text-white" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-bold text-sm text-foreground">{session.tester_name || 'Unnamed Tester'}</p>
          <p className="text-[10px] text-muted-foreground">{session.device || 'Unknown device'} · {done}/{TASKS.length} tasks</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => onDelete(session.id)} className="p-1.5 rounded-lg text-muted-foreground hover:text-destructive transition-colors">
            <Trash2 className="w-3.5 h-3.5" />
          </button>
          <button onClick={() => setExpanded(e => !e)} className="p-1.5 rounded-lg text-muted-foreground transition-colors">
            {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {expanded && (
        <div className="px-3 pb-4 space-y-2 border-t" style={{ borderColor: 'rgba(255,255,255,0.06)' }}>
          <div className="pt-3">
            <ScoreSummary results={session.results} />
          </div>
          <div className="space-y-2 mt-3">
            {TASKS.map(task => (
              <TaskRow
                key={task.id}
                task={task}
                result={session.results[task.id]}
                onChange={handleResultChange}
              />
            ))}
          </div>
          <textarea
            value={session.notes}
            onChange={e => onUpdate({ ...session, notes: e.target.value })}
            placeholder="Overall session notes, big themes, quotes from tester…"
            rows={3}
            className="w-full px-3 py-2.5 rounded-xl text-xs text-foreground placeholder:text-muted-foreground focus:outline-none resize-none mt-2"
            style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)' }}
          />
        </div>
      )}
    </div>
  );
}

// ─── Main Page ─────────────────────────────────────────────────────────────────
export default function FounderBetaChecklist() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [sessions, setSessions] = useState(loadSessions);
  const [newName, setNewName] = useState('');
  const [newDevice, setNewDevice] = useState('');
  const [adding, setAdding] = useState(false);

  // Only admins
  if (user && user.role !== 'admin') {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen gap-4 px-6 text-center">
        <p className="text-5xl">🔒</p>
        <p className="font-bold text-foreground">Admin only</p>
        <button onClick={() => navigate(-1)} className="text-sm text-muted-foreground underline">Go back</button>
      </div>
    );
  }

  const persist = (updated) => {
    setSessions(updated);
    saveSessions(updated);
  };

  const handleAdd = () => {
    if (!newName.trim()) return;
    const s = newSession(newName.trim(), newDevice.trim() || 'Unknown');
    persist([s, ...sessions]);
    setNewName('');
    setNewDevice('');
    setAdding(false);
  };

  const handleUpdate = (updated) => {
    persist(sessions.map(s => s.id === updated.id ? updated : s));
  };

  const handleDelete = (id) => {
    persist(sessions.filter(s => s.id !== id));
  };

  // Aggregate stats across all sessions
  const totalSessions = sessions.length;
  const taskStats = TASKS.map(task => {
    const counts = { completed: 0, confused: 0, needed_help: 0, failed: 0, total: 0 };
    sessions.forEach(s => {
      const o = s.results[task.id]?.outcome;
      if (o) { counts[o]++; counts.total++; }
    });
    return { ...task, ...counts };
  });

  return (
    <div className="min-h-screen pb-32 dark:rave-bg" style={{ paddingTop: 'env(safe-area-inset-top)' }}>
      {/* Header */}
      <div className="sticky top-0 z-20 frosted-bar border-b border-white/5 px-4 py-4"
        style={{ paddingTop: 'calc(env(safe-area-inset-top) + 16px)' }}>
        <div className="flex items-center justify-between max-w-2xl mx-auto">
          <div>
            <h1 className="font-display text-2xl text-foreground leading-none">Beta Checklist</h1>
            <p className="text-[10px] text-muted-foreground mt-0.5">{totalSessions} session{totalSessions !== 1 ? 's' : ''} recorded</p>
          </div>
          <button
            onClick={() => setAdding(true)}
            className="flex items-center gap-2 px-4 py-2 rounded-xl font-black text-sm"
            style={{ background: 'linear-gradient(135deg, #00FF87, #00C8FF)', color: '#0D0B14' }}>
            <Plus className="w-4 h-4" /> Add Tester
          </button>
        </div>
      </div>

      <div className="px-4 pt-5 max-w-2xl mx-auto space-y-6">

        {/* Add tester form */}
        {adding && (
          <div className="rounded-2xl p-4 space-y-3" style={{ background: 'rgba(0,255,135,0.07)', border: '1px solid rgba(0,255,135,0.25)' }}>
            <p className="text-sm font-black text-foreground">New Beta Session</p>
            <input
              value={newName}
              onChange={e => setNewName(e.target.value)}
              placeholder="Tester name *"
              className="w-full px-3 py-2.5 rounded-xl text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
              style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)' }}
              autoFocus
            />
            <input
              value={newDevice}
              onChange={e => setNewDevice(e.target.value)}
              placeholder="Device (e.g. iPhone 15, Android S24)"
              className="w-full px-3 py-2.5 rounded-xl text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
              style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)' }}
            />
            <div className="flex gap-2">
              <button onClick={handleAdd}
                className="flex-1 py-2.5 rounded-xl font-black text-sm"
                style={{ background: 'linear-gradient(135deg, #00FF87, #00C8FF)', color: '#0D0B14' }}>
                Start Session
              </button>
              <button onClick={() => setAdding(false)}
                className="flex-1 py-2.5 rounded-xl font-black text-sm"
                style={{ background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.12)', color: 'hsl(var(--muted-foreground))' }}>
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Aggregate heatmap */}
        {totalSessions > 0 && (
          <div className="rounded-2xl p-4 space-y-3" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }}>
            <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Aggregate Results — {totalSessions} session{totalSessions !== 1 ? 's' : ''}</p>
            <div className="space-y-1.5">
              {taskStats.map(task => {
                const pct = task.total > 0 ? Math.round((task.completed / task.total) * 100) : null;
                const worstKey = task.failed > task.confused ? 'failed' : task.confused > 0 ? 'confused' : task.needed_help > 0 ? 'needed_help' : null;
                return (
                  <div key={task.id} className="flex items-center gap-3">
                    <span className="text-[10px] text-muted-foreground w-4 text-right flex-shrink-0">{task.id}</span>
                    <span className="text-[11px] text-foreground flex-1 truncate">{task.label}</span>
                    {task.total === 0 ? (
                      <span className="text-[10px] text-muted-foreground opacity-40 flex-shrink-0">—</span>
                    ) : (
                      <div className="flex items-center gap-1.5 flex-shrink-0">
                        {OUTCOMES.filter(o => task[o.key] > 0).map(o => (
                          <span key={o.key} className="text-[10px] font-bold" style={{ color: o.color }}>{task[o.key]}</span>
                        ))}
                        <span className="text-[10px] text-muted-foreground">({pct}%)</span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            <div className="flex gap-3 pt-1">
              {OUTCOMES.map(o => (
                <div key={o.key} className="flex items-center gap-1 text-[10px]">
                  <span className="w-2 h-2 rounded-full" style={{ background: o.color }} />
                  <span className="text-muted-foreground">{o.label[0]}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Sessions list */}
        {sessions.length === 0 ? (
          <div className="rounded-2xl p-8 text-center space-y-3" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }}>
            <p className="text-4xl">🧪</p>
            <p className="font-bold text-foreground">No sessions yet</p>
            <p className="text-xs text-muted-foreground">Add a tester to start tracking their journey through the app.</p>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Sessions</p>
            {sessions.map(session => (
              <SessionPanel
                key={session.id}
                session={session}
                onUpdate={handleUpdate}
                onDelete={handleDelete}
              />
            ))}
          </div>
        )}

        {/* ── FULL AUDIT REPORT ── */}
        <AuditReport />
      </div>
    </div>
  );
}

// ─── Static Audit Report ──────────────────────────────────────────────────────
function AuditSection({ title, color, icon, items }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-2xl overflow-hidden" style={{ border: `1px solid ${color}30` }}>
      <button onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-3 px-4 py-4 text-left"
        style={{ background: `${color}08` }}>
        <span className="text-xl flex-shrink-0">{icon}</span>
        <span className="font-black text-sm text-foreground flex-1">{title}</span>
        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full flex-shrink-0" style={{ background: `${color}18`, color }}>{items.length}</span>
        {open ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
      </button>
      {open && (
        <div className="divide-y" style={{ borderColor: `${color}15` }}>
          {items.map((item, i) => (
            <div key={i} className="px-4 py-3 flex gap-3">
              <span className="text-[10px] font-black w-5 flex-shrink-0 mt-0.5" style={{ color }}>{i + 1}</span>
              <div>
                <p className="text-xs font-bold text-foreground leading-snug">{item.title}</p>
                {item.fix && <p className="text-[11px] text-muted-foreground mt-0.5 leading-relaxed">→ {item.fix}</p>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const AUDIT_DATA = {
  confusion: [
    { title: '"Upgrades" tab — users don\'t know this means seat upgrades at a live show', fix: 'Rename to "Live Upgrades" or add a one-line subtext under the tab label on first visit' },
    { title: '"Flash Drops" — completely alien term to new users', fix: 'Show a one-time tooltip: "Free seats dropped by fans at the venue. Enter to win!"' },
    { title: 'Landing page CTA is "Create Account" — user hasn\'t seen the value yet', fix: 'Add a 3-second auto-scroll of social proof before the CTA, or add a "See how it works" link above the buttons' },
    { title: 'Event page shows listings but no explanation of the buying process', fix: 'Add a sticky "How it works" pill that opens a 3-step explainer sheet' },
    { title: '"Transfer verified" badge — what does this mean?', fix: 'Add a tap-to-expand tooltip: "Seller confirmed tickets are transferable on Ticketmaster/SeatGeek"' },
    { title: 'Fan Karma tab in Live Hub — users don\'t know what it\'s for or why it matters', fix: 'Add a one-line hook at the top: "Top donors get VIP perks at future events"' },
    { title: 'Upgrades page asks for location immediately — no context on why', fix: 'Add one sentence before the location prompt: "We show upgrades for events happening near you tonight"' },
    { title: 'Bottom nav: "Sell" tab takes you to a separate Sell page — not intuitive', fix: 'Consider merging into "Me" tab or adding "Sell Tickets" as a FAB on the Events page' },
    { title: '"Escrow protection" — legal-sounding, confusing to average fan', fix: 'Rephrase to: "Your money is held safely — released to seller only after you confirm you got the tickets"' },
    { title: '"Instant Transfer" badge on listings — what\'s different?', fix: 'Add: "PG already holds these tickets — guaranteed immediate delivery"' },
    { title: 'No visible price breakdown before checkout — fee surprise', fix: 'Show "Ticket $X + Platform fee $Y = Total $Z" on the listing card, not just in checkout' },
    { title: 'Notifications bell with no notifications — empty state has no explanation', fix: 'Add: "You\'ll get alerts when Flash Drops open for events you\'ve watched"' },
    { title: '"Peanut Points" — what are they? What do they unlock?', fix: 'Add a "Points unlock early Flash Drop access" line near the points balance' },
    { title: 'Seller flow: "Proof of ownership" upload — why? What\'s accepted?', fix: 'Add: "Upload a screenshot showing your tickets in the app (Ticketmaster, SeatGeek, etc.)"' },
    { title: 'After joining a Flash Drop, no clear feedback on what happens next', fix: 'Add: "You\'re in! Results in [X] minutes. We\'ll notify you instantly."' },
    { title: '"Transfer window" terminology — users don\'t understand this concept', fix: 'Simplify to "Transfer available until [time]" or "Can transfer: Yes/No"' },
    { title: 'Live Hub tabs (Drops / Upgrades / Karma) — too many options, no clear starting point', fix: 'Default to "Drops" tab and add a pulsing indicator when there are active drops' },
    { title: 'No global "what is PG?" explainer accessible from home screen', fix: 'Add "How PG works" card on the Events home page for first-time users (dismiss after seen)' },
    { title: 'Error states are generic ("Event not found") with no recovery guidance', fix: 'Add specific next steps: "Try searching by city" or "Check Ticketmaster directly →"' },
    { title: 'Creating a listing requires Stripe onboarding — blocked at the last step', fix: 'Surface Stripe setup requirement BEFORE user fills in all listing details' },
  ],
  trust: [
    { title: 'No visible "money-back guarantee" statement anywhere in the buying flow', fix: 'Add: "100% refund if tickets don\'t transfer" as a persistent badge on listing cards' },
    { title: 'Platform fee charged but no explanation of what it covers', fix: 'Add: "Platform fee covers buyer protection, escrow, and support"' },
    { title: 'Seller\'s identity is just an email — no trust signals', fix: 'Show: verified seller badge, completed transaction count, and response time average' },
    { title: '"AI Verified" badge with no explanation of what AI checked', fix: 'Add tap-to-expand: "AI compared seller\'s screenshot against event details and confirmed it looks valid"' },
    { title: 'No explanation of dispute process upfront', fix: 'Add: "If anything goes wrong, open a dispute within 24h and we investigate within 2 hours"' },
    { title: 'Refund policy not visible without digging into settings', fix: 'Surface: "Full refund if seller doesn\'t transfer within [X] hours" on every listing card' },
    { title: 'Transfer window status is shown but not explained', fix: 'Add: "Transfers are only possible while this window is open. We monitor it for you."' },
    { title: 'No visible support contact or response time commitment', fix: 'Add a "Need help? Chat with us" button on purchase confirmation and dispute screens' },
    { title: 'Flash Drop winner selection feels like a black box', fix: 'Show: "Winner selected randomly and fairly from all entries" with a timestamp' },
    { title: 'No social proof — no completed transaction count, no reviews, no success stories', fix: 'Add to landing and event pages: "X tickets transferred successfully this month"' },
  ],
  conversion: [
    { title: 'Flash Drop loser sees a generic "no luck" message with no clear next step', fix: 'Show: "You didn\'t win, but these 3 upgrades are available right now for this event →"' },
    { title: 'Listing cards don\'t show urgency — no "X people viewing this"', fix: 'Add: "3 people viewing" or "Last 2 tickets" scarcity signal on high-demand listings' },
    { title: 'Checkout requires too many steps — name, phone, payment all on separate interactions', fix: 'Collapse to a single screen with auto-filled name from profile' },
    { title: 'No "Buy it now" fast path for users who already trust the platform', fix: 'Add 1-tap purchase for returning buyers with saved payment method' },
    { title: 'Upgrades page requires location — blocks discovery before user commits', fix: 'Show 3-5 featured events without location, then prompt for location to see more' },
    { title: 'Live activity bar data doesn\'t feel real enough to create urgency', fix: 'Show actual real-time data: "2 listings added in the last 10 minutes"' },
    { title: 'No email/push nudge when a Flash Drop opens for a saved event', fix: 'Send push: "⚡ Flash Drop just opened at [Event]! Enter now — 60 seconds"' },
    { title: 'Sell flow is buried in "Me" tab — sellers don\'t find it', fix: 'Add "Got extra tickets? Sell them →" banner on Events page for users with 0 listings' },
    { title: 'No price comparison to face value shown prominently', fix: 'On every listing: "Save $X vs original price" in green if below face value' },
    { title: 'No post-purchase engagement — users leave after buying', fix: 'After purchase, show: "While you wait, check out Flash Drops at this event →"' },
  ],
  liveHub: [
    { title: 'Live Hub feels empty without active drops — no ambient content', fix: 'Show Fan Zone posts from this event in the Drops tab when there are no drops' },
    { title: 'No real-time participant count on Flash Drops', fix: 'Show: "12 fans entered so far" updating live' },
    { title: 'Countdown timer on drops isn\'t prominent enough', fix: 'Make countdown full-width and pulsing red when under 10 seconds' },
    { title: 'Fan Karma leaderboard isn\'t compelling without community', fix: 'Add: "You\'re #3 tonight — drop seats to take the lead" contextual prompt' },
    { title: 'No ambient activity to show "people are here"', fix: 'Add a "X fans checked in tonight" counter with an animated pulse' },
    { title: '"Drop Your Seats" FAB only shows when on non-drops tab', fix: 'Show it on the Drops tab too when there are no active drops' },
    { title: 'No way to watch an event and get notified when drops start', fix: 'Add "🔔 Watch this event" button that triggers push when drops go live' },
    { title: 'Live status badge disappears between poll cycles — flickers', fix: 'Keep the last known live status until definitively ended' },
    { title: 'No sharing mechanism — users can\'t tell friends about a live drop', fix: 'Add "Share this drop" button that generates a deep link' },
    { title: 'Upgrade listings in Live Hub have no proximity context', fix: 'Show: "Section 118 is 3 sections from your current seats" if user shared location' },
  ],
  onboarding: [
    { title: 'Onboarding carousel skips too fast — users tap through without reading', fix: 'Gate "Next" behind a 1-second delay or require a tap on a specific element' },
    { title: 'No onboarding for sellers — they discover Stripe requirement too late', fix: 'Add a "Seller setup" step in onboarding for users who indicate they have tickets to sell' },
    { title: 'App name "Peanut Gallery" doesn\'t communicate function — users confused by brand', fix: 'Add a persistent tagline under the logo: "Fan-to-fan ticket upgrades"' },
    { title: 'First screen after login is the Events page — no welcome or orientation', fix: 'Show a one-time "Welcome" sheet with 3 things to try first' },
    { title: 'No empty state guidance on Events page before location is set', fix: 'Show 3 featured upcoming events as examples before user sets location' },
    { title: 'Sell tab shows a form immediately — no context on what PG selling means', fix: 'Add a "How selling works" explainer before the listing form' },
    { title: 'Fan Zone has no explanation of what it\'s for', fix: 'Add: "Post concert photos, flex your seats, and connect with fans at the same show"' },
    { title: 'Profile page ("Me") shows points and karma with no explanation', fix: 'Add a "What are Peanut Points?" expandable section at the top' },
    { title: 'No progressive disclosure — advanced features (custody, instant listings) appear immediately', fix: 'Hide advanced listing options behind a "More options" toggle' },
    { title: 'App doesn\'t remember what event a new user was looking at before signing up', fix: 'Pass the event ID through the auth flow so returning users land on the right event' },
  ],
};

const WHAT_USERS_SAY = [
  '"Wait, what is this? Is this legal?"',
  '"So I can buy tickets… but only at the event? I\'m confused."',
  '"What\'s a Flash Drop? Is that like a sale?"',
  '"How do I know the tickets are real?"',
  '"What happens if the seller just disappears?"',
  '"This looks cool but I don\'t know where to start."',
  '"The upgrade thing is actually sick — I just found floor seats for $40!"',
  '"I joined a Flash Drop but I don\'t know what happens now."',
  '"Where do I find my tickets after I buy them?"',
  '"Why does it need my location just to see events?"',
];

function AuditReport() {
  const [open, setOpen] = useState(false);
  return (
    <div className="space-y-4">
      <button onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-5 py-4 rounded-2xl font-black text-sm"
        style={{ background: 'rgba(191,95,255,0.1)', border: '1px solid rgba(191,95,255,0.3)', color: '#BF5FFF' }}>
        📋 Full Beta Audit Report
        {open ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
      </button>

      {open && (
        <div className="space-y-4">
          {/* Score */}
          <div className="rounded-2xl p-5 text-center space-y-2" style={{ background: 'linear-gradient(135deg, rgba(191,95,255,0.12), rgba(0,200,255,0.08))', border: '1px solid rgba(191,95,255,0.3)' }}>
            <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Beta Readiness Score</p>
            <p className="font-display text-6xl" style={{ color: '#FFE600' }}>6.5<span className="text-2xl text-muted-foreground">/10</span></p>
            <p className="text-xs text-muted-foreground max-w-xs mx-auto leading-relaxed">
              Core mechanics work. Trust and clarity are the blockers. Users can transact but don't yet understand why they should trust it or where to start.
            </p>
          </div>

          <AuditSection title="Top 20 User Confusion Points" color="#FFE600" icon="😵" items={AUDIT_DATA.confusion} />
          <AuditSection title="Top 10 Trust Issues" color="#FF2D78" icon="🔒" items={AUDIT_DATA.trust} />
          <AuditSection title="Top 10 Conversion Improvements" color="#00FF87" icon="💸" items={AUDIT_DATA.conversion} />
          <AuditSection title="Top 10 Live Hub Improvements" color="#FF8C00" icon="⚡" items={AUDIT_DATA.liveHub} />
          <AuditSection title="Top 10 Onboarding Improvements" color="#00C8FF" icon="🚀" items={AUDIT_DATA.onboarding} />

          {/* What users say */}
          <div className="rounded-2xl p-4 space-y-3" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }}>
            <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">If 10 real users used PG tonight, the first 10 things they'd say:</p>
            <div className="space-y-2">
              {WHAT_USERS_SAY.map((q, i) => (
                <div key={i} className="flex gap-3 items-start">
                  <span className="text-[10px] font-black text-muted-foreground w-4 flex-shrink-0 mt-1">{i + 1}</span>
                  <p className="text-xs text-foreground italic leading-relaxed">{q}</p>
                </div>
              ))}
            </div>
          </div>

          {/* First-time user audit */}
          <div className="rounded-2xl p-4 space-y-3" style={{ background: 'rgba(0,200,255,0.06)', border: '1px solid rgba(0,200,255,0.2)' }}>
            <p className="text-[10px] font-black uppercase tracking-widest" style={{ color: '#00C8FF' }}>First-Time User Audit — As a stranger</p>
            {[
              { q: 'What is this app?', a: 'Unclear. "Peanut Gallery" sounds like a social app or a comedy show, not a ticket marketplace.' },
              { q: 'What makes it different?', a: 'Location-based live upgrades and Flash Drops are genuinely novel — but buried behind login.' },
              { q: 'Why would I install it?', a: 'Not obvious until I\'m AT a show. Pre-show value proposition needs to be stronger.' },
              { q: 'What do I do first?', a: 'Unclear. The Events tab feels like Ticketmaster — not different enough.' },
              { q: 'How do I get better seats?', a: 'The Upgrades tab makes sense once found, but the path there is non-obvious.' },
              { q: 'How do Flash Drops work?', a: 'Zero context on first open. Requires going to a Live Hub to even see them.' },
              { q: 'How do I trust it?', a: 'Escrow is mentioned but not explained. No reviews. No completed transaction counts.' },
              { q: 'How do I know I\'m protected?', a: '"Transfer Verified" and "Escrow" badges are present but unexplained. Needs 1-tap education.' },
            ].map(({ q, a }) => (
              <div key={q} className="space-y-0.5">
                <p className="text-xs font-black text-foreground">{q}</p>
                <p className="text-[11px] text-muted-foreground leading-relaxed">{a}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}