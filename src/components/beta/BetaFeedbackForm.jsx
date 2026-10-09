import { useState, useEffect, useRef, useId } from 'react';
import './beta-accessibility.css';
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

export function StarRating({ value, onChange }) {
  const groupId = useId();
  return (
    <fieldset className="pg-feedback-rating" role="radiogroup" aria-labelledby={`${groupId}-label`}>
      <legend id={`${groupId}-label`} className="text-[10px] font-bold text-muted-foreground uppercase mb-2">Overall rating</legend>
      <div className="pg-feedback-stars">
        {[1, 2, 3, 4, 5].map(n => (
          <label key={n} className="pg-feedback-star">
            <input type="radio" name={`${groupId}-rating`} value={n}
              checked={value === n} onChange={() => onChange(n)}
              aria-label={`${n} ${n === 1 ? 'star' : 'stars'} out of 5`} />
            <Star aria-hidden="true" className={`w-7 h-7 ${value >= n ? 'is-filled' : ''}`} />
          </label>
        ))}
      </div>
      <p className="text-xs text-muted-foreground mt-1" aria-live="polite">{value ? `${value} of 5 stars selected` : 'No rating selected'}</p>
    </fieldset>
  );
}

function FeedbackRow({ feedback, expanded, onToggle }) {
  const detailsId = useId();
  return (
    <div className="pg-operations-card rounded-xl overflow-hidden" style={{ background: 'var(--pg-surface)', border: '1px solid var(--pg-line)' }}>
      <button type="button" onClick={onToggle} aria-expanded={expanded} aria-controls={detailsId} className="w-full flex items-center gap-3 px-4 py-3 text-left">
        <div className="flex-1">
          <span className="text-sm font-bold text-foreground">{feedback.tester_name || 'Anonymous'}</span>
          {feedback.device && <span className="ml-2 text-xs text-muted-foreground">· {feedback.device}</span>}
        </div>
        {feedback.overall_rating > 0 && (
          <div className="pg-feedback-history-rating flex gap-0.5" role="img" aria-label={`${feedback.overall_rating} out of 5 stars`}>
            {[1,2,3,4,5].map(n => (
              <Star key={n} aria-hidden="true" className={`w-3 h-3 ${feedback.overall_rating >= n ? 'is-filled' : ''}`} />
            ))}
          </div>
        )}
        <span className="text-[10px] text-muted-foreground">{new Date(feedback.created_date).toLocaleDateString()}</span>
        {expanded ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
      </button>
      {(
        <div id={detailsId} hidden={!expanded} className="px-4 pb-4 border-t border-border space-y-3 pt-3">
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
  const formId = useId();
  const [form, setForm] = useState(empty);
  const [submitted, setSubmitted] = useState(false);
  const [allFeedback, setAllFeedback] = useState([]);
  const [expandedId, setExpandedId] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const saveInFlight = useRef(false);

  useEffect(() => {
    base44.entities.BetaFeedback.list('-created_date', 50).then(setAllFeedback).catch(() => {});
  }, []);

  const handleSubmit = async () => {
    if (saveInFlight.current || !form.tester_name.trim()) return;
    saveInFlight.current = true;
    setSaving(true);
    setSaveError('');
    try {
      await base44.entities.BetaFeedback.create(form);
      setSubmitted(true);
      base44.entities.BetaFeedback.list('-created_date', 50).then(setAllFeedback).catch(() => {});
    } catch {
      setSaveError('Couldn’t save feedback. Your answers are still here. Try again.');
    } finally {
      saveInFlight.current = false;
      setSaving(false);
    }
  };

  if (submitted) {
    return (
      <div className="pg-beta-feedback space-y-4">
        <div className="pg-operations-card rounded-xl px-6 py-10 text-center" style={{ background: 'var(--pg-surface)', border: '1px solid rgba(0,255,135,0.25)' }}>
          <p className="text-4xl mb-3">🥜</p>
          <p className="font-display text-2xl text-foreground mb-2">Thanks for the feedback!</p>
          <p className="text-sm text-muted-foreground">Your input helps make Peanut Gallery better for everyone.</p>
          <button onClick={() => { setForm(empty); setSubmitted(false); }}
            className="mt-5 px-6 py-2.5 rounded-lg text-sm font-black"
            style={{ background: 'var(--pg-surface-raised)', color: 'var(--pg-text)', border: '1px solid var(--pg-line)' }}>
            Submit Another
          </button>
        </div>
        <FeedbackHistory allFeedback={allFeedback} expandedId={expandedId} setExpandedId={setExpandedId} />
      </div>
    );
  }

  return (
    <div className="pg-beta-feedback space-y-4">
      <div className="pg-operations-card rounded-xl p-5 space-y-4" style={{ background: 'var(--pg-surface)', border: '1px solid var(--pg-line)' }}>
        <p className="text-xs font-black tracking-widest uppercase text-muted-foreground">Beta Tester Feedback</p>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor={`${formId}-name`} className="text-[10px] font-bold text-muted-foreground uppercase mb-1 block">Your Name *</label>
            <input id={`${formId}-name`} required value={form.tester_name} onChange={e => setForm(f => ({ ...f, tester_name: e.target.value }))}
              placeholder="Tester name"
              className="w-full px-3 py-2.5 rounded-xl text-sm focus:outline-none"
              style={{ background: 'var(--pg-surface-raised)', border: '1px solid var(--pg-line)', color: 'var(--pg-text)' }} />
          </div>
          <div>
            <label htmlFor={`${formId}-device`} className="text-[10px] font-bold text-muted-foreground uppercase mb-1 block">Device</label>
            <input id={`${formId}-device`} value={form.device} onChange={e => setForm(f => ({ ...f, device: e.target.value }))}
              placeholder="iPhone 15 / Android…"
              className="w-full px-3 py-2.5 rounded-xl text-sm focus:outline-none"
              style={{ background: 'var(--pg-surface-raised)', border: '1px solid var(--pg-line)', color: 'var(--pg-text)' }} />
          </div>
        </div>

        <div>
          <StarRating value={form.overall_rating} onChange={v => setForm(f => ({ ...f, overall_rating: v }))} />
        </div>

        {QUESTIONS.map(q => (
          <div key={q.key}>
            <label htmlFor={`${formId}-${q.key}`} className="text-xs font-bold text-foreground mb-1.5 block">{q.label}</label>
            <textarea id={`${formId}-${q.key}`} value={form[q.key]} onChange={e => setForm(f => ({ ...f, [q.key]: e.target.value }))}
              placeholder={q.placeholder} rows={2}
              className="w-full px-3 py-2.5 rounded-xl text-sm focus:outline-none resize-none"
              style={{ background: 'var(--pg-surface-raised)', border: '1px solid var(--pg-line)', color: 'var(--pg-text)' }} />
          </div>
        ))}

        {saveError && <p role="alert" className="text-sm text-destructive">{saveError}</p>}
        <button onClick={handleSubmit} disabled={saving || !form.tester_name.trim()}
          className="w-full flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-black disabled:opacity-60"
          style={{ background: 'var(--pg-violet)', color: 'var(--pg-ink)' }}>
          <Send className="w-4 h-4" /> {saving ? 'Submitting…' : 'Submit Feedback'}
        </button>
      </div>

      <FeedbackHistory allFeedback={allFeedback} expandedId={expandedId} setExpandedId={setExpandedId} />
    </div>
  );
}

function FeedbackHistory({ allFeedback, expandedId, setExpandedId }) {
  const [open, setOpen] = useState(false);
  const historyId = useId();
  if (allFeedback.length === 0) return null;
  return (
    <div>
      <button type="button" onClick={() => setOpen(v => !v)} aria-expanded={open} aria-controls={historyId}
        className="w-full flex items-center justify-between px-4 py-3 rounded-xl mb-3"
        style={{ background: 'var(--pg-surface)', border: '1px solid var(--pg-line)' }}>
        <span className="text-xs font-black text-muted-foreground uppercase tracking-widest">Previous Feedback ({allFeedback.length})</span>
        {open ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
      </button>
      {(
        <div id={historyId} hidden={!open} className="space-y-2">
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