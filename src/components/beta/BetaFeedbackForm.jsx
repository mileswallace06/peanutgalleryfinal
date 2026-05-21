import { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Star, Send, ChevronDown, ChevronUp } from 'lucide-react';

const QUESTIONS = [
  { key: 'confusing',  label: 'What felt confusing or unclear?', placeholder: 'e.g. The transfer confirmation was hard to find…' },
  { key: 'trust',      label: 'Would you trust this app with real tickets? Why?', placeholder: 'e.g. Yes, because the escrow message made me feel safe…' },
  { key: 'blocker',    label: "What almost stopped you from completing a purchase?", placeholder: "e.g. I wasn't sure if the seat was real…" },
  { key: 'coolest',    label: 'What feature felt the coolest or most exciting?', placeholder: 'e.g. The live upgrade tab during the show was 🔥' },
  { key: 'extra',      label: 'Anything else?', placeholder: 'Other thoughts, bugs, or suggestions…' },
];

const empty = { tester_name: '', device: '', confusing: '', trust: '', blocker: '', coolest: '', extra: '', overall_rating: 0 };

function StarRating({ value, onChange }) {
  const [hover, setHover] = useState(0);
  return (
    <div className="flex gap-1">
      {[1,2,3,4,5].map(n => (
        <button key={n} type="button"
          onMouseEnter={() => setHover(n)} onMouseLeave={() => setHover(0)}
          onClick={() => onChange(n)}
          className="transition-transform active:scale-90">
          <Star className="w-7 h-7" fill={(hover || value) >= n ? '#FFE600' : 'none'}
            style={{ color: (hover || value) >= n ? '#FFE600' : 'rgba(255,255,255,0.2)' }} />
        </button>
      ))}
    </div>
  );
}

function FeedbackRow({ feedback, expanded, onToggle }) {
  return (
    <div className="rounded-2xl overflow-hidden" style={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))' }}>
      <button onClick={onToggle} className="w-full flex items-center gap-3 px-4 py-3 text-left">
        <div className="flex-1">
          <span className="text-sm font-bold text-foreground">{feedback.tester_name || 'Anonymous'}</span>
          {feedback.device && <span className="ml-2 text-xs text-muted-foreground">· {feedback.device}</span>}
        </div>
        {feedback.overall_rating > 0 && (
          <div className="flex gap-0.5">
            {[1,2,3,4,5].map(n => (
              <Star key={n} className="w-3 h-3" fill={feedback.overall_rating >= n ? '#FFE600' : 'none'}
                style={{ color: feedback.overall_rating >= n ? '#FFE600' : 'rgba(255,255,255,0.15)' }} />
            ))}
          </div>
        )}
        <span className="text-[10px] text-muted-foreground">{new Date(feedback.created_date).toLocaleDateString()}</span>
        {expanded ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
      </button>
      {expanded && (
        <div className="px-4 pb-4 border-t border-border space-y-3 pt-3">
          {QUESTIONS.filter(q => feedback[q.key]).map(q => (
            <div key={q.key}>
              <p className="text-[10px] font-black text-muted-foreground uppercase tracking-wider mb-1">{q.label}</p>
              <p className="text-sm text-foreground">{feedback[q.key]}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function BetaFeedbackForm() {
  const [form, setForm] = useState(empty);
  const [submitted, setSubmitted] = useState(false);
  const [allFeedback, setAllFeedback] = useState([]);
  const [expandedId, setExpandedId] = useState(null);
  const [showHistory, setShowHistory] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    base44.entities.BetaFeedback.list('-created_date', 50).then(setAllFeedback).catch(() => {});
  }, []);

  const handleSubmit = async () => {
    if (!form.tester_name.trim()) return;
    setSaving(true);
    await base44.entities.BetaFeedback.create(form);
    setSubmitted(true);
    base44.entities.BetaFeedback.list('-created_date', 50).then(setAllFeedback).catch(() => {});
    setSaving(false);
  };

  if (submitted) {
    return (
      <div className="space-y-4">
        <div className="rounded-2xl px-6 py-10 text-center" style={{ background: 'hsl(var(--card))', border: '1px solid rgba(0,255,135,0.25)' }}>
          <p className="text-4xl mb-3">🥜</p>
          <p className="font-display text-2xl text-foreground mb-2">Thanks for the feedback!</p>
          <p className="text-sm text-muted-foreground">Your input helps make Peanut Gallery better for everyone.</p>
          <button onClick={() => { setForm(empty); setSubmitted(false); }}
            className="mt-5 px-6 py-2.5 rounded-full text-sm font-black"
            style={{ background: 'rgba(0,255,135,0.12)', color: '#00FF87', border: '1px solid rgba(0,255,135,0.3)' }}>
            Submit Another
          </button>
        </div>
        <FeedbackHistory allFeedback={allFeedback} expandedId={expandedId} setExpandedId={setExpandedId} />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="rounded-2xl p-5 space-y-4" style={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))' }}>
        <p className="text-xs font-black tracking-widest uppercase text-muted-foreground">Beta Tester Feedback</p>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-[10px] font-bold text-muted-foreground uppercase mb-1 block">Your Name *</label>
            <input value={form.tester_name} onChange={e => setForm(f => ({ ...f, tester_name: e.target.value }))}
              placeholder="Tester name"
              className="w-full px-3 py-2.5 rounded-xl text-sm focus:outline-none"
              style={{ background: 'hsl(var(--input))', border: '1px solid hsl(var(--border))', color: 'hsl(var(--foreground))' }} />
          </div>
          <div>
            <label className="text-[10px] font-bold text-muted-foreground uppercase mb-1 block">Device</label>
            <input value={form.device} onChange={e => setForm(f => ({ ...f, device: e.target.value }))}
              placeholder="iPhone 15 / Android…"
              className="w-full px-3 py-2.5 rounded-xl text-sm focus:outline-none"
              style={{ background: 'hsl(var(--input))', border: '1px solid hsl(var(--border))', color: 'hsl(var(--foreground))' }} />
          </div>
        </div>

        <div>
          <label className="text-[10px] font-bold text-muted-foreground uppercase mb-2 block">Overall Rating</label>
          <StarRating value={form.overall_rating} onChange={v => setForm(f => ({ ...f, overall_rating: v }))} />
        </div>

        {QUESTIONS.map(q => (
          <div key={q.key}>
            <label className="text-xs font-bold text-foreground mb-1.5 block">{q.label}</label>
            <textarea value={form[q.key]} onChange={e => setForm(f => ({ ...f, [q.key]: e.target.value }))}
              placeholder={q.placeholder} rows={2}
              className="w-full px-3 py-2.5 rounded-xl text-sm focus:outline-none resize-none"
              style={{ background: 'hsl(var(--input))', border: '1px solid hsl(var(--border))', color: 'hsl(var(--foreground))' }} />
          </div>
        ))}

        <button onClick={handleSubmit} disabled={saving || !form.tester_name.trim()}
          className="w-full flex items-center justify-center gap-2 py-3 rounded-2xl text-sm font-black disabled:opacity-60"
          style={{ background: 'linear-gradient(135deg, #BF5FFF, #FF2D78)', color: '#fff' }}>
          <Send className="w-4 h-4" /> {saving ? 'Submitting…' : 'Submit Feedback'}
        </button>
      </div>

      <FeedbackHistory allFeedback={allFeedback} expandedId={expandedId} setExpandedId={setExpandedId} />
    </div>
  );
}

function FeedbackHistory({ allFeedback, expandedId, setExpandedId }) {
  const [open, setOpen] = useState(false);
  if (allFeedback.length === 0) return null;
  return (
    <div>
      <button onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between px-4 py-3 rounded-2xl mb-3"
        style={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))' }}>
        <span className="text-xs font-black text-muted-foreground uppercase tracking-widest">Previous Feedback ({allFeedback.length})</span>
        {open ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
      </button>
      {open && (
        <div className="space-y-2">
          {allFeedback.map(fb => (
            <FeedbackRow key={fb.id} feedback={fb}
              expanded={expandedId === fb.id}
              onToggle={() => setExpandedId(v => v === fb.id ? null : fb.id)} />
          ))}
        </div>
      )}
    </div>
  );
}