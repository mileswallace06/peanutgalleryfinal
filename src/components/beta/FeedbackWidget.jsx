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

  const handleSend = async () => {
    if (!selected) return;
    setSending(true);
    await base44.entities.BetaFeedbackEvent.create({
      feedback_type: selected,
      page: location.pathname,
      message: message.trim() || null,
      user_email: user?.email || null,
      user_name: user?.full_name || null,
    });
    setSending(false);
    setSent(true);
    setTimeout(() => { setSent(false); setOpen(false); setSelected(null); setMessage(''); }, 1800);
  };

  // Don't show on admin pages
  if (location.pathname.startsWith('/admin') || location.pathname.startsWith('/founder') || location.pathname.startsWith('/beta-')) return null;

  return (
    <>
      {/* FAB */}
      {!open && (
        <button
          onClick={() => setOpen(true)}
          className="fixed bottom-24 left-4 z-40 w-11 h-11 rounded-full flex items-center justify-center shadow-xl transition-all active:scale-95"
          style={{ background: 'rgba(191,95,255,0.15)', border: '1px solid rgba(191,95,255,0.4)', backdropFilter: 'blur(12px)' }}
          aria-label="Send feedback"
        >
          <MessageSquare className="w-4 h-4" style={{ color: '#BF5FFF' }} />
        </button>
      )}

      {/* Sheet */}
      {open && (
        <div className="fixed inset-0 z-50 flex items-end justify-center" style={{ background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)' }}
          onClick={e => { if (e.target === e.currentTarget) setOpen(false); }}>
          <div className="w-full max-w-lg rounded-t-3xl p-5 space-y-4"
            style={{ background: 'hsl(var(--card))', border: '1px solid rgba(255,255,255,0.1)', paddingBottom: 'calc(1.25rem + env(safe-area-inset-bottom))' }}>

            <div className="flex items-center justify-between">
              <div>
                <p className="font-black text-sm text-foreground">Send Feedback</p>
                <p className="text-[10px] text-muted-foreground">{location.pathname}</p>
              </div>
              <button onClick={() => setOpen(false)} className="p-1.5 text-muted-foreground">
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
                      className="flex flex-col items-center gap-1.5 py-3 rounded-2xl transition-all active:scale-95"
                      style={{
                        background: selected === t.key ? `${t.color}18` : 'rgba(255,255,255,0.04)',
                        border: `1px solid ${selected === t.key ? t.color + '55' : 'rgba(255,255,255,0.08)'}`,
                      }}>
                      <span className="text-xl">{t.emoji}</span>
                      <span className="text-[10px] font-bold" style={{ color: selected === t.key ? t.color : 'hsl(var(--muted-foreground))' }}>{t.label}</span>
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
                  style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)' }}
                />

                <button onClick={handleSend} disabled={!selected || sending}
                  className="w-full py-3 rounded-2xl font-black text-sm disabled:opacity-50 transition-all"
                  style={{ background: selected ? `${TYPES.find(t => t.key === selected)?.color}` : 'rgba(255,255,255,0.1)', color: '#000' }}>
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