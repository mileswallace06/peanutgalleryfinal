import { useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '@/lib/AuthContext';
import { adminAccess } from '@/lib/adminAccess';
import { ChevronLeft, ClipboardList, Bug, Zap, MessageSquare, AlertTriangle } from 'lucide-react';
import QAChecklist from '@/components/beta/QAChecklist';
import BugTracker from '@/components/beta/BugTracker';
import LiveEventChecklist from '@/components/beta/LiveEventChecklist';
import BetaFeedbackForm from '@/components/beta/BetaFeedbackForm';
import OperationalRiskChecklist from '@/components/beta/OperationalRiskChecklist';

const TABS = [
  { key: 'checklist',  label: 'QA Checklist', Icon: ClipboardList, color: '#BF5FFF' },
  { key: 'bugs',       label: 'Bugs',          Icon: Bug,           color: '#FF2D78' },
  { key: 'live',       label: 'Live Event',    Icon: Zap,           color: '#00FF87' },
  { key: 'feedback',   label: 'Feedback',      Icon: MessageSquare, color: '#00C8FF' },
  { key: 'risks',      label: 'Risks',         Icon: AlertTriangle, color: '#FF8C00' },
];

export default function BetaQA() {
  const access = adminAccess(useAuth());

  if (access === 'checking') {
    return (
      <div className="min-h-screen dark:rave-bg flex flex-col items-center justify-center px-6 pb-20">
        <div role="status" className="flex items-center gap-3 text-sm text-muted-foreground">
          <span className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          Checking admin access…
        </div>
      </div>
    );
  }

  if (access !== 'admin') return <Navigate to="/events" replace />;
  return <BetaQAWorkspace />;
}

function BetaQAWorkspace() {
  const navigate = useNavigate();
  const [tab, setTab] = useState('checklist');

  // Session / tester identity stored locally
  const [testerName, setTesterName] = useState(localStorage.getItem('pg_tester_name') || '');
  const [device, setDevice] = useState(localStorage.getItem('pg_tester_device') || '');
  const [sessionId] = useState(() => {
    const existing = sessionStorage.getItem('pg_qa_session');
    if (existing) return existing;
    const id = `session_${Date.now()}`;
    sessionStorage.setItem('pg_qa_session', id);
    return id;
  });

  const saveTesterName = (v) => { setTesterName(v); localStorage.setItem('pg_tester_name', v); };
  const saveDevice = (v) => { setDevice(v); localStorage.setItem('pg_tester_device', v); };

  return (
    <div className="min-h-screen dark:rave-bg" style={{ paddingTop: 'env(safe-area-inset-top)' }}>
      {/* Header */}
      <div className="sticky top-0 z-20 frosted-bar border-b border-white/5"
        style={{ paddingTop: 'calc(env(safe-area-inset-top) + 10px)' }}>
        <div className="flex items-center gap-3 px-4 pb-3">
          <button onClick={() => navigate(-1)}
            className="w-9 h-9 rounded-xl flex items-center justify-center"
            style={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))' }}>
            <ChevronLeft className="w-5 h-5" />
          </button>
          <div>
            <h1 className="font-display text-xl text-foreground leading-none">Beta QA</h1>
            <p className="text-[10px] text-muted-foreground mt-0.5">Internal testing · Admin only</p>
          </div>
          <span className="ml-auto text-[10px] font-black px-2.5 py-1 rounded-full"
            style={{ background: 'rgba(255,45,120,0.12)', color: '#FF2D78', border: '1px solid rgba(255,45,120,0.25)' }}>
            🧪 INTERNAL
          </span>
        </div>

        {/* Tester identity */}
        <div className="flex gap-2 px-4 pb-3">
          <input value={testerName} onChange={e => saveTesterName(e.target.value)}
            placeholder="Your name"
            className="flex-1 px-3 py-1.5 rounded-xl text-xs focus:outline-none"
            style={{ background: 'hsl(var(--input))', border: '1px solid hsl(var(--border))', color: 'hsl(var(--foreground))' }} />
          <input value={device} onChange={e => saveDevice(e.target.value)}
            placeholder="Device"
            className="flex-1 px-3 py-1.5 rounded-xl text-xs focus:outline-none"
            style={{ background: 'hsl(var(--input))', border: '1px solid hsl(var(--border))', color: 'hsl(var(--foreground))' }} />
        </div>

        {/* Tab bar */}
        <div className="flex overflow-x-auto scrollbar-hide px-4 pb-2 gap-2" style={{ WebkitOverflowScrolling: 'touch' }}>
          {TABS.map(({ key, label, Icon, color }) => (
            <button key={key} onClick={() => setTab(key)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold whitespace-nowrap flex-shrink-0 transition-all"
              style={tab === key
                ? { background: `${color}18`, color, border: `1px solid ${color}40` }
                : { background: 'hsl(var(--muted))', color: 'hsl(var(--muted-foreground))', border: '1px solid hsl(var(--border))' }
              }>
              <Icon className="w-3.5 h-3.5" /> {label}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="px-4 pt-5 pb-32">
        {tab === 'checklist' && <QAChecklist sessionId={sessionId} testerName={testerName} device={device} />}
        {tab === 'bugs' && <BugTracker />}
        {tab === 'live' && <LiveEventChecklist />}
        {tab === 'feedback' && <BetaFeedbackForm />}
        {tab === 'risks' && <OperationalRiskChecklist />}
      </div>
    </div>
  );
}
