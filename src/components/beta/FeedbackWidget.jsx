import '@/components/admin/operations-theme.css';
import { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { useLocation } from 'react-router-dom';
import { X, MessageSquare } from 'lucide-react';

const TYPES = [
  { key: 'bug', emoji: '🐛', label: 'Bug', color: '#FF2D78' },
  { key: 'confused', emoji: '😕', label: 'Confused', color: '#FFE600' },
  { key: 'love', emoji: '❤️', label: 'Love it', color: '#00FF87' },
  { key: 'idea', emoji: '💡', label: 'Idea', color: '#00C8FF' },
];

export default function FeedbackWidget({ user }) {
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState(null);
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState(null);
  const [cooldownUntil, setCooldownUntil] = useState(0);

  // M0.2 SECURITY: Feedback is submitted via the submitFeedback backend function,
  // which enforces server-side cooldowns (60s per user, 3 per 10 min) and derives
  // user identity from the authenticated session. Client-supplied email/name
  // fields are never sent or trusted.
  // A short client-side 5s cooldown remains for double-tap prevention (UX only).
  const MAX_MESSAGE_LEN = 2000;

  const handleSend = async () => {
    if (!selected || sending) return; // prevent double submission
    if (Date.now() < cooldownUntil) {
      setError('Please wait a few seconds before sending again.');
      return;
    }
    const trimmed = message.slice(0, MAX_MESSAGE_LEN).trim();
    setSending(true);
    setError(null);
    try {
      await base44.functions.invoke('submitFeedback', {
        feedback_type: selected,
        page: location.pathname,
        message: trimmed || null,
      });
      setSent(true);
      setCooldownUntil(Date.now() + 5000); // 5s UX cooldown (server enforces 60s)
      setTimeout(() => { setSent(false); setOpen(false); setSelected(null); setMessage(''); }, 1800);
    } catch (err) {
      // M0.2: Handle server-side cooldown responses
      const status = err?.response?.status || err?.status;
      if (status === 429) {
        const retryAfter = err?.response?.data?.retry_after || err?.data?.retry_after || 60;
        setError(`Please wait ${retryAfter}s before sending again.`);
      } else {
        setError('Could not send. Please try again.');
      }
    } finally {
      setSending(false);
    }
  };

  // Keep browse cards unobstructed. Feedback remains available on Me and other pages.
  if (['/events', '/upgrades'].includes(location.pathname) || location.pathname.startsWith('/admin') || location.pathname.startsWith('/founder') || location.pathname.startsWith('/beta-')) return null;

  return (
    <>
      {/* FAB */}
      {!open && (
        <button
          onClick={() => { setOpen(true); setError(null); }}
          className="pg-operations-widget fixed left-4 z-[60] w-11 h-11 rounded-full flex items-center justify-center shadow-lg transition-all active:scale-95"
          style={{ bottom: 'calc(6.25rem + env(safe-area-inset-bottom))', background: 'var(--pg-surface)', border: '1px solid var(--pg-line)' }}
          aria-label="Send feedback"
        >
          <MessageSquare className="w-4 h-4" style={{ color: 'var(--pg-text)' }} />
        </button>
      )}

      {/* Sheet — z-[70] unmistakably above bottom nav (z-50) */}
      {open && (
        <div className="fixed inset-0 z-[70] flex items-end justify-center" style={{ background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)' }}
          onClick={e => { if (e.target === e.currentTarget) setOpen(false); }}>
          <div className="pg-operations-widget w-full max-w-lg rounded-t-xl p-5 space-y-4"
            style={{ background: 'var(--pg-surface)', border: '1px solid var(--pg-line)', paddingBottom: 'calc(1.25rem + env(safe-area-inset-bottom))', maxHeight: 'calc(100dvh - env(safe-area-inset-top) - 0.75rem)', overflowY: 'auto', overscrollBehavior: 'contain' }}>

            <div className="flex items-center justify-between">
              <div>
                <p className="font-black text-sm text-foreground">Send Feedback</p>
                <p className="text-[10px] text-muted-foreground">{location.pathname}</p>
              </div>
              <button onClick={() => setOpen(false)} className="inline-flex items-center justify-center p-1.5 text-muted-foreground">
                <X className="w-4 h-4" />
              </button>
            </div>

            {sent ? (
              <div className="py-6 text-center">
                <p className="text-3xl mb-2">✅</p>
                <p className="font-black text-foreground text-sm">Got it — thank you!</p>
              </div>
            ) : (
              <>
                {/* Type selector */}
                <div className="grid grid-cols-4 gap-2">
                  {TYPES.map(t => (
                    <button key={t.key} onClick={() => setSelected(t.key)}
                      className="flex flex-col items-center gap-1.5 py-3 rounded-xl transition-all active:scale-95"
                      style={{
                        background: selected === t.key ? `${t.color}18` : 'var(--pg-surface-raised)',
                        border: `1px solid ${selected === t.key ? t.color + '55' : 'var(--pg-line)'}`,
                      }}>
                      <span className="text-xl">{t.emoji}</span>
                      <span className="pg-operations-status text-[10px] font-bold" style={{ '--pg-status-ink': selected === t.key ? t.color : 'var(--pg-muted)' }}>{t.label}</span>
                    </button>
                  ))}
                </div>

                {/* Message */}
                <textarea
                  value={message}
                  onChange={e => setMessage(e.target.value)}
                  placeholder={selected === 'bug' ? 'What went wrong?' : selected === 'confused' ? 'What confused you?' : selected === 'idea' ? "What's your idea?" : 'Tell us more\u2026'}
                  rows={3}
                  className="w-full px-3 py-2.5 rounded-xl text-sm text-foreground placeholder:text-muted-foreground focus:outline-none resize-none"
                  style={{ background: 'var(--pg-surface-raised)', border: '1px solid var(--pg-line)' }}
                />

                {error && (
                  <p className="text-xs font-bold text-center" style={{ color: 'var(--neon-pink)' }}>{error}</p>
                )}
                <button onClick={handleSend} disabled={!selected || sending}
                  className="w-full py-3 rounded-xl font-black text-sm disabled:opacity-50 transition-all"
                  style={{ background: selected ? `${TYPES.find(t => t.key === selected)?.color}` : 'var(--pg-surface-raised)', color: selected ? 'var(--pg-ink)' : 'var(--pg-muted)' }}>
                  {sending ? 'Sending…' : 'Send Feedback'}
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
