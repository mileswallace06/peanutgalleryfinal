import '@/components/admin/operations-theme.css';
import { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { useAuth } from '@/lib/AuthContext';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { ArrowLeft, RefreshCw } from 'lucide-react';
import FeedbackInbox from '@/components/beta/FeedbackInbox';
import { feedbackAccess } from '@/lib/feedbackInbox';

function Stat({ label, value, color = 'var(--neon-purple)', sub }) {
  return (
    <div className="pg-operations-card rounded-xl px-4 py-4 space-y-1" style={{ background: 'var(--pg-surface)', border: '1px solid var(--pg-line)' }}>
      <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">{label}</p>
      <p className="text-3xl font-black leading-none" style={{ color }}>{value}</p>
      {sub && <p className="text-[11px] text-muted-foreground">{sub}</p>}
    </div>
  );
}

export default function BetaDashboard() {
  const auth = useAuth();
  const { user } = auth;
  const access = feedbackAccess(auth);
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  if (access !== 'admin') return (
    <div className="pg-operations-page min-h-screen flex flex-col items-center justify-center gap-4 px-6 text-center">
      <p role="status" className="font-bold text-foreground">{access === 'checking' ? 'Checking admin access…' : 'Admin access required'}</p>
      <button onClick={() => navigate('/me')} className="text-sm text-muted-foreground underline">Back to Me</button>
    </div>
  );
  const inbox = params.get('view') === 'feedback';
  return <div className="pg-operations-page min-h-screen pb-32 max-w-3xl mx-auto">
    <div className="px-4 pt-4 pb-3"><Link to="/me" className="inline-flex items-center gap-2 min-h-11 text-sm text-muted-foreground"><ArrowLeft className="w-4 h-4" /> Back to Me</Link></div>
    <nav aria-label="Beta dashboard sections" className="pg-operations-tabs flex flex-wrap gap-3 px-4 pb-2">
      <button onClick={() => setParams({ view: 'feedback' })} aria-pressed={inbox} className="rounded-lg border border-border px-4 py-2 text-sm font-bold text-muted-foreground">Feedback</button>
      <button onClick={() => setParams({ view: 'metrics' })} aria-pressed={!inbox} className="rounded-lg border border-border px-4 py-2 text-sm font-bold text-muted-foreground">Beta metrics</button>
    </nav>
    {inbox ? <FeedbackInbox key={user.id} user={user} /> : <BetaMetrics />}
  </div>;
}

function BetaMetrics() {
  const [loading, setLoading] = useState(true);
  const [testers, setTesters] = useState([]);
  const [feedback, setFeedback] = useState([]);
  const [refreshing, setRefreshing] = useState(false);

  const load = async () => {
    const [t, f] = await Promise.all([
      base44.entities.BetaTester.list('-created_date', 200),
      base44.entities.BetaFeedbackEvent.list('-created_date', 500),
    ]);
    setTesters(t);
    setFeedback(f);
    setLoading(false);
    setRefreshing(false);
  };

  useEffect(() => { load(); }, []);

  // Derived metrics
  const active = testers.filter(t => t.status === 'active').length;
  const completed = testers.filter(t => t.status === 'completed').length;
  const sports = testers.filter(t => t.fan_type === 'sports' || t.fan_type === 'both').length;
  const concert = testers.filter(t => t.fan_type === 'concert' || t.fan_type === 'both').length;

  const day1Ret = testers.length > 0 ? Math.round((testers.filter(t => t.day1_returned).length / testers.length) * 100) : 0;
  const day3Ret = testers.length > 0 ? Math.round((testers.filter(t => t.day3_returned).length / testers.length) * 100) : 0;
  const day7Ret = testers.length > 0 ? Math.round((testers.filter(t => t.day7_returned).length / testers.length) * 100) : 0;

  const bugs = feedback.filter(f => f.feedback_type === 'bug').length;
  const confused = feedback.filter(f => f.feedback_type === 'confused').length;
  const loves = feedback.filter(f => f.feedback_type === 'love').length;
  const ideas = feedback.filter(f => f.feedback_type === 'idea').length;

  // What users think PG is
  const pgDescriptions = testers.filter(t => t.what_user_thinks_pg_is).map(t => t.what_user_thinks_pg_is);

  // Feedback by page
  const pageMap = {};
  feedback.forEach(f => {
    if (!f.page) return;
    pageMap[f.page] = (pageMap[f.page] || 0) + 1;
  });
  const topPages = Object.entries(pageMap).sort((a, b) => b[1] - a[1]).slice(0, 5);

  // Recent confused reports
  const confusedFeedback = feedback.filter(f => f.feedback_type === 'confused').slice(0, 10);

  return (
    <div>
      {/* Header */}
      <div className="pg-operations-header sticky top-0 z-20 border-b px-4 py-4"
        style={{ paddingTop: '16px' }}>
        <div className="flex items-center justify-between max-w-2xl mx-auto">
          <div className="flex items-center gap-3">
            <Link to="/founder" className="inline-flex min-h-11 min-w-11 items-center justify-center text-muted-foreground"><ArrowLeft className="w-5 h-5" /></Link>
            <div>
              <h1 className="font-display text-2xl text-foreground leading-none">Beta Dashboard</h1>
              <p className="text-[10px] text-muted-foreground mt-0.5">Real user validation metrics</p>
            </div>
          </div>
          <button onClick={() => { setRefreshing(true); load(); }}
            className="inline-flex items-center justify-center p-2 rounded-lg text-muted-foreground transition-all"
            style={{ background: 'var(--pg-surface-raised)', border: '1px solid var(--pg-line)' }}>
            <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {loading ? (
        <div className="px-4 pt-6 grid grid-cols-2 gap-3 max-w-2xl mx-auto">
          {[...Array(8)].map((_, i) => <div key={i} className="h-20 rounded-xl animate-pulse bg-muted" />)}
        </div>
      ) : (
        <div className="px-4 pt-5 max-w-2xl mx-auto space-y-6">

          {/* Tester overview */}
          <div>
            <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground mb-3">Beta Testers</p>
            <div className="grid grid-cols-2 gap-3">
              <Stat label="Total Testers" value={testers.length} sub={`${testers.length}/10 Phase 1`} />
              <Stat label="Active Now" value={active} color="var(--neon-green)" />
              <Stat label="Sports Fans" value={sports} color="var(--neon-cyan)" />
              <Stat label="Concert Fans" value={concert} color="var(--neon-pink)" />
            </div>
          </div>

          {/* Retention */}
          <div>
            <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground mb-3">Retention</p>
            <div className="pg-operations-card rounded-xl p-4 space-y-3" style={{ background: 'var(--pg-surface)', border: '1px solid var(--pg-line)' }}>
              {[
                { label: 'Day 1 Retention', pct: day1Ret },
                { label: 'Day 3 Retention', pct: day3Ret },
                { label: 'Day 7 Retention', pct: day7Ret },
              ].map(r => (
                <div key={r.label} className="space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-foreground">{r.label}</span>
                    <span className="text-xs font-black" style={{ color: r.pct >= 50 ? 'var(--neon-green)' : r.pct >= 25 ? 'var(--neon-yellow)' : 'var(--neon-pink)' }}>{r.pct}%</span>
                  </div>
                  <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--pg-surface-raised)' }}>
                    <div className="h-full rounded-full" style={{ width: `${r.pct}%`, background: r.pct >= 50 ? '#00FF87' : r.pct >= 25 ? '#FFE600' : '#FF2D78' }} />
                  </div>
                </div>
              ))}
              <p className="text-[10px] text-muted-foreground pt-1">Target: 50%+ Day 1, 30%+ Day 7</p>
            </div>
          </div>

          {/* Feedback breakdown */}
          <div>
            <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground mb-3">Feedback — {feedback.length} total</p>
            <div className="grid grid-cols-2 gap-3">
              <Stat label="🐛 Bugs" value={bugs} color="var(--neon-pink)" />
              <Stat label="😕 Confused" value={confused} color="var(--neon-yellow)" />
              <Stat label="❤️ Love it" value={loves} color="var(--neon-green)" />
              <Stat label="💡 Ideas" value={ideas} color="var(--neon-cyan)" />
            </div>
          </div>

          {/* Most confusing pages */}
          {topPages.length > 0 && (
            <div>
              <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground mb-3">Most Feedback By Page</p>
              <div className="pg-operations-card rounded-xl p-4 space-y-2" style={{ background: 'var(--pg-surface)', border: '1px solid var(--pg-line)' }}>
                {topPages.map(([page, count]) => (
                  <div key={page} className="flex items-center justify-between">
                    <span className="text-xs text-foreground font-mono">{page}</span>
                    <span className="text-xs font-black text-muted-foreground">{count}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Recent confused reports */}
          {confusedFeedback.length > 0 && (
            <div>
              <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground mb-3">😕 Recent Confusion Reports</p>
              <div className="space-y-2">
                {confusedFeedback.map(f => (
                  <div key={f.id} className="pg-operations-card rounded-xl px-4 py-3 space-y-1" style={{ background: 'rgba(255,230,0,0.05)', border: '1px solid rgba(255,230,0,0.15)' }}>
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-[10px] font-black text-muted-foreground">{f.page || 'Unknown page'}</p>
                      <p className="text-[10px] text-muted-foreground">{f.user_name || 'Anon'}</p>
                    </div>
                    {f.message && <p className="text-xs text-foreground leading-relaxed">"{f.message}"</p>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Most important metric: What users think PG is */}
          <div>
            <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground mb-1">🎯 Most Important Metric</p>
            <p className="text-[11px] text-muted-foreground mb-3">What users say PG does — verbatim from Test 1</p>
            {pgDescriptions.length === 0 ? (
              <div className="pg-operations-card rounded-xl p-6 text-center" style={{ background: 'var(--pg-surface)', border: '1px solid var(--pg-line)' }}>
                <p className="text-sm text-muted-foreground">No descriptions yet. Add them from <Link to="/beta-testers" className="underline" style={{ color: 'var(--pg-text)' }}>Beta Testers</Link>.</p>
              </div>
            ) : (
              <div className="pg-operations-card rounded-xl p-4 space-y-3" style={{ background: 'var(--pg-surface)', border: '1px solid var(--pg-line)' }}>
                {pgDescriptions.map((q, i) => (
                  <div key={i} className="flex gap-2 items-start">
                    <span className="text-[10px] font-black text-muted-foreground w-4 flex-shrink-0 mt-1">{i + 1}</span>
                    <p className="text-xs text-foreground italic leading-relaxed">"{q}"</p>
                  </div>
                ))}
                {/* Sprint success check */}
                <div className="pt-2 border-t" style={{ borderColor: 'var(--pg-line)' }}>
                  <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground mb-1">Sprint Success Check</p>
                  <p className="text-[11px] text-muted-foreground">Goal: 70%+ describe PG as "better seats after the event starts" or equivalent.</p>
                </div>
              </div>
            )}
          </div>

          {/* Nav links */}
          <div className="grid grid-cols-2 gap-3">
            <Link to="/beta-testers" className="flex items-center justify-center py-3 rounded-xl font-black text-sm"
              style={{ background: 'var(--pg-surface-raised)', border: '1px solid var(--pg-line)', color: 'var(--pg-text)' }}>
              🧪 Manage Testers
            </Link>
            <Link to="/beta-checklist" className="flex items-center justify-center py-3 rounded-xl font-black text-sm"
              style={{ background: 'var(--pg-surface-raised)', border: '1px solid var(--pg-line)', color: 'var(--pg-text)' }}>
              ✅ Run Tests
            </Link>
          </div>

        </div>
      )}
    </div>
  );
}
