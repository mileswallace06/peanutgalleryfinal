import { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { formatDistanceToNow } from 'date-fns';

const REACTIONS = [
  { key: 'fire', emoji: '🔥' },
  { key: 'eyes', emoji: '👀' },
  { key: 'peanut', emoji: '🥜' },
];

export default function FanZone() {
  const [user, setUser] = useState(null);
  const [posts, setPosts] = useState([]);
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [text, setText] = useState('');
  const [selectedEventId, setSelectedEventId] = useState('');
  const [showCompose, setShowCompose] = useState(false);
  const [reactingId, setReactingId] = useState(null);

  useEffect(() => {
    base44.auth.me().then(setUser).catch(() => {});
    loadPosts();
    base44.entities.Event.list('date', 50)
      .then(data => setEvents(data.filter(e => e.status !== 'ended')))
      .catch(() => {});
  }, []);

  const loadPosts = async () => {
    setLoading(true);
    const data = await base44.entities.FanPost.list('-created_date', 50);
    setPosts(data);
    setLoading(false);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!text.trim()) return;
    setSubmitting(true);
    const event = events.find(ev => ev.id === selectedEventId);
    await base44.entities.FanPost.create({
      author_email: user?.email || '',
      author_name: user?.full_name || user?.email || 'Fan',
      text: text.trim(),
      event_id: selectedEventId || null,
      event_title: event?.title || null,
      reactions: { fire: [], eyes: [], peanut: [] },
    });
    setText('');
    setSelectedEventId('');
    setShowCompose(false);
    await loadPosts();
    setSubmitting(false);
  };

  const handleReact = async (post, reactionKey) => {
    if (!user || reactingId) return;
    setReactingId(post.id + reactionKey);
    const current = post.reactions || { fire: [], eyes: [], peanut: [] };
    const arr = current[reactionKey] || [];
    const already = arr.includes(user.email);
    const updated = {
      ...current,
      [reactionKey]: already
        ? arr.filter(e => e !== user.email)
        : [...arr, user.email],
    };
    await base44.entities.FanPost.update(post.id, { reactions: updated });
    setPosts(prev => prev.map(p => p.id === post.id ? { ...p, reactions: updated } : p));
    setReactingId(null);
  };

  return (
    <div className="pb-32">
      {/* Hero */}
      <div className="relative h-52 overflow-hidden">
        <img
          src="https://images.unsplash.com/photo-1516450360452-9312f5e86fc7?w=900&q=80"
          alt="Fan Zone"
          className="w-full h-full object-cover object-top"
        />
        <div className="absolute inset-0"
          style={{ background: 'linear-gradient(to bottom, rgba(5,3,12,0.4) 0%, rgba(5,3,12,0.15) 40%, rgba(5,3,12,0.95) 100%)' }} />

        <div className="absolute top-5 left-4">
          <span className="text-[10px] font-black tracking-[0.2em] px-3 py-1 rounded-full"
            style={{ background: 'rgba(0,0,0,0.5)', color: '#00C8FF', border: '1px solid #00C8FF55', backdropFilter: 'blur(12px)' }}>
            🎤 FAN ZONE
          </span>
        </div>

        <div className="absolute bottom-5 left-4 right-4">
          <h1 className="font-display mb-2"
            style={{
              fontSize: 'clamp(3.2rem, 15vw, 5rem)',
              letterSpacing: '-0.02em',
              lineHeight: 1.05,
              background: 'linear-gradient(135deg, #FF99CC 0%, #66FFFF 100%)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              backgroundClip: 'text',
              filter: 'drop-shadow(0 6px 24px rgba(0,0,0,0.6))',
            }}>
            Fan Zone
          </h1>
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full"
            style={{ background: 'rgba(0,200,255,0.15)', border: '1px solid rgba(0,200,255,0.35)' }}>
            <span className="text-[11px] font-medium" style={{ color: 'rgba(200,235,255,0.9)' }}>
              Share moments · Connect with fans
            </span>
          </div>
        </div>
      </div>

      {/* Compose trigger */}
      <div className="px-4 mt-5 mb-4">
        {!showCompose ? (
          <button
            onClick={() => setShowCompose(true)}
            className="w-full flex items-center gap-3 px-4 py-3.5 rounded-2xl text-left"
            style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)' }}
          >
            <span className="text-xl">🎤</span>
            <span className="text-sm text-muted-foreground">Share a moment with the crowd…</span>
          </button>
        ) : (
          <form onSubmit={handleSubmit} className="rounded-2xl p-4 space-y-3"
            style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(0,200,255,0.2)' }}>
            <textarea
              autoFocus
              value={text}
              onChange={e => setText(e.target.value)}
              placeholder="What's happening at the show?"
              maxLength={280}
              rows={3}
              className="w-full bg-transparent text-sm text-foreground placeholder:text-muted-foreground resize-none focus:outline-none"
            />
            <div className="flex items-center gap-2 flex-wrap">
              <select
                value={selectedEventId}
                onChange={e => setSelectedEventId(e.target.value)}
                className="flex-1 min-w-0 text-xs px-3 py-2 rounded-xl focus:outline-none"
                style={{ background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.1)', color: selectedEventId ? 'hsl(var(--foreground))' : 'hsl(var(--muted-foreground))' }}
              >
                <option value="">No event (general)</option>
                {events.map(ev => (
                  <option key={ev.id} value={ev.id}>{ev.title}</option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => { setShowCompose(false); setText(''); setSelectedEventId(''); }}
                className="px-3 py-2 rounded-xl text-xs font-semibold"
                style={{ background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.5)' }}
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={!text.trim() || submitting}
                className="px-4 py-2 rounded-xl text-xs font-bold disabled:opacity-40"
                style={{ background: 'rgba(0,200,255,0.2)', color: '#00C8FF', border: '1px solid rgba(0,200,255,0.35)' }}
              >
                {submitting ? 'Posting…' : 'Post'}
              </button>
            </div>
            <div className="text-right text-[10px] text-muted-foreground">{280 - text.length} left</div>
          </form>
        )}
      </div>

      {/* Feed */}
      <div className="px-4 space-y-3">
        {loading ? (
          [...Array(3)].map((_, i) => (
            <div key={i} className="rounded-2xl h-24 animate-pulse" style={{ background: 'rgba(255,255,255,0.04)' }} />
          ))
        ) : posts.length === 0 ? (
          <div className="text-center py-20 space-y-3">
            <p className="text-4xl">🎤</p>
            <p className="font-bold text-foreground">No fan posts yet</p>
            <p className="text-sm text-muted-foreground">Be the first to start the conversation</p>
          </div>
        ) : (
          posts.map(post => <PostCard key={post.id} post={post} user={user} onReact={handleReact} reactingId={reactingId} />)
        )}
      </div>
    </div>
  );
}

function PostCard({ post, user, onReact, reactingId }) {
  const reactions = post.reactions || { fire: [], eyes: [], peanut: [] };

  return (
    <div className="rounded-2xl px-4 py-4 space-y-3"
      style={{
        background: 'linear-gradient(135deg, rgba(255,255,255,0.06) 0%, rgba(255,255,255,0.02) 100%)',
        border: '1px solid rgba(255,255,255,0.08)',
      }}>

      {/* Author row */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 font-bold text-xs"
            style={{ background: 'rgba(0,200,255,0.15)', color: '#00C8FF', border: '1px solid rgba(0,200,255,0.25)' }}>
            {(post.author_name || post.author_email || '?')[0].toUpperCase()}
          </div>
          <div>
            <p className="text-xs font-semibold text-foreground leading-none">{post.author_name || post.author_email}</p>
            {post.event_title && (
              <p className="text-[10px] text-muted-foreground mt-0.5 flex items-center gap-1">
                <span style={{ color: '#BF5FFF' }}>🎫</span> {post.event_title}
              </p>
            )}
          </div>
        </div>
        <span className="text-[10px] text-muted-foreground flex-shrink-0">
          {post.created_date ? formatDistanceToNow(new Date(post.created_date), { addSuffix: true }) : ''}
        </span>
      </div>

      {/* Post text */}
      <p className="text-sm text-foreground leading-relaxed">{post.text}</p>

      {/* Reactions */}
      <div className="flex items-center gap-2 pt-1">
        {REACTIONS.map(({ key, emoji }) => {
          const arr = reactions[key] || [];
          const reacted = user && arr.includes(user.email);
          const busy = reactingId === post.id + key;
          return (
            <button
              key={key}
              onClick={() => onReact(post, key)}
              disabled={!user || busy}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold transition-all disabled:opacity-50"
              style={{
                background: reacted ? 'rgba(0,200,255,0.15)' : 'rgba(255,255,255,0.05)',
                border: reacted ? '1px solid rgba(0,200,255,0.3)' : '1px solid rgba(255,255,255,0.1)',
                color: reacted ? '#00C8FF' : 'rgba(255,255,255,0.6)',
              }}
            >
              <span>{emoji}</span>
              {arr.length > 0 && <span>{arr.length}</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}