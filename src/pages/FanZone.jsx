import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { formatDistanceToNow } from 'date-fns';
import { Plus, X, ImagePlus, Star, MapPin, Users, TrendingUp } from 'lucide-react';
import SeatFlexSheet from '@/components/fanzone/SeatFlexSheet';
import BucketListSheet from '@/components/fanzone/BucketListSheet';

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
  const [reactingId, setReactingId] = useState(null);

  // FAB state
  const [fab, setFab] = useState(null);

  // Compose state
  const [text, setText] = useState('');
  const [selectedEventId, setSelectedEventId] = useState('');
  const [photoUrl, setPhotoUrl] = useState('');
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Filter state
  const [feedTab, setFeedTab] = useState('trending'); // 'trending' | 'bucket' | 'nearby' | 'friends'
  const [bucketList, setBucketList] = useState([]);
  const [showBucketList, setShowBucketList] = useState(false);
  const [userLocation, setUserLocation] = useState(null);
  const [followingEmails, setFollowingEmails] = useState([]);

  useEffect(() => {
    base44.auth.me().then(u => {
      setUser(u);
      if (u?.email) {
        base44.entities.BucketListItem.filter({ user_email: u.email })
          .then(setBucketList).catch(() => {});
        base44.entities.Follow.filter({ follower_email: u.email })
          .then(rows => setFollowingEmails(rows.map(r => r.following_email)))
          .catch(() => {});
      }
    }).catch(() => {});
    loadPosts();
    base44.entities.Event.list('date', 50)
      .then(data => setEvents(data.filter(e => e.status !== 'ended')))
      .catch(() => {});
  }, []);

  // Request geolocation when Near Me tab is selected
  useEffect(() => {
    if (feedTab !== 'nearby') return;
    if (userLocation) return;
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      pos => setUserLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => setUserLocation(null)
    );
  }, [feedTab]);

  const loadPosts = async () => {
    setLoading(true);
    const data = await base44.entities.FanPost.list('-created_date', 100);
    setPosts(data);
    setLoading(false);
  };

  const closeAll = () => { setFab(null); setText(''); setSelectedEventId(''); setPhotoUrl(''); };

  const handlePhotoUpload = async (file) => {
    if (!file) return;
    setUploadingPhoto(true);
    const { file_url } = await base44.integrations.Core.UploadFile({ file });
    setPhotoUrl(file_url);
    setUploadingPhoto(false);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!text.trim() && !photoUrl) return;
    setSubmitting(true);
    const event = events.find(ev => ev.id === selectedEventId);
    await base44.entities.FanPost.create({
      author_email: user?.email || '',
      author_name: user?.full_name || user?.email || 'Fan',
      text: text.trim() || '📸',
      post_type: 'post',
      event_id: selectedEventId || null,
      event_title: event?.title || null,
      event_city: event?.city || null,
      photo_url: photoUrl || null,
      reactions: { fire: [], eyes: [], peanut: [] },
    });
    closeAll();
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
      [reactionKey]: already ? arr.filter(e => e !== user.email) : [...arr, user.email],
    };
    await base44.entities.FanPost.update(post.id, { reactions: updated });
    setPosts(prev => prev.map(p => p.id === post.id ? { ...p, reactions: updated } : p));
    setReactingId(null);
  };

  // Bucket list names for matching
  const bucketNames = bucketList.map(b => b.name.toLowerCase());

  // Trending: sort by total reaction count
  const withScore = posts.map(p => {
    const r = p.reactions || {};
    const score = (r.fire?.length || 0) + (r.eyes?.length || 0) + (r.peanut?.length || 0);
    return { ...p, _score: score };
  });

  const filtered = (() => {
    if (feedTab === 'trending') {
      return [...withScore].sort((a, b) => b._score - a._score);
    }
    if (feedTab === 'bucket') {
      if (bucketNames.length === 0) return posts;
      return posts.filter(p => {
        const haystack = [p.event_title, p.text].join(' ').toLowerCase();
        return bucketNames.some(name => haystack.includes(name));
      });
    }
    if (feedTab === 'nearby') {
      if (!userLocation) return posts.filter(p => !!p.event_city);
      // Find events within ~80km of user using event venue lat/lng
      const RADIUS_KM = 80;
      const deg2rad = d => d * Math.PI / 180;
      const haversine = (lat1, lng1, lat2, lng2) => {
        const R = 6371;
        const dLat = deg2rad(lat2 - lat1);
        const dLng = deg2rad(lng2 - lng1);
        const a = Math.sin(dLat/2)**2 + Math.cos(deg2rad(lat1)) * Math.cos(deg2rad(lat2)) * Math.sin(dLng/2)**2;
        return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
      };
      const nearbyEventIds = new Set(
        events
          .filter(e => e.venue_lat && e.venue_lng && haversine(userLocation.lat, userLocation.lng, e.venue_lat, e.venue_lng) <= RADIUS_KM)
          .map(e => e.id)
      );
      // Also match by city name if events don't have lat/lng
      const nearbyCities = new Set(events.filter(e => nearbyEventIds.has(e.id)).map(e => e.city).filter(Boolean));
      return posts.filter(p => nearbyEventIds.has(p.event_id) || (p.event_city && nearbyCities.has(p.event_city)));
    }
    if (feedTab === 'friends') {
      if (!user || followingEmails.length === 0) return [];
      return posts.filter(p => followingEmails.includes(p.author_email));
    }
    return posts;
  })();

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
        </div>
      </div>

      {/* Feed tabs — 2×2 grid, no scroll */}
      <div className="px-4 mt-4 mb-4 space-y-2">
        <div className="grid grid-cols-2 gap-2">
          <FeedTab id="trending" active={feedTab} label="Trending" icon={<TrendingUp className="w-4 h-4" />} onClick={setFeedTab} />
          <FeedTab
            id="bucket"
            active={feedTab}
            label="Bucket List"
            icon={<Star className="w-4 h-4" />}
            badge={bucketList.length > 0 ? bucketList.length : null}
            onClick={setFeedTab}
            onEditClick={() => setShowBucketList(true)}
          />
          <FeedTab id="nearby" active={feedTab} label="Near Me" icon={<MapPin className="w-4 h-4" />} onClick={setFeedTab} />
          <FeedTab id="friends" active={feedTab} label="Friends" icon={<Users className="w-4 h-4" />} onClick={setFeedTab} />
        </div>

        {/* Contextual sub-label */}
        {feedTab === 'bucket' && bucketList.length === 0 && !loading && (
          <p className="text-xs text-muted-foreground px-1">
            Add artists & venues to your Bucket List to filter posts here.{' '}
            <button className="underline" style={{ color: '#FFE600' }} onClick={() => setShowBucketList(true)}>Add now</button>
          </p>
        )}
        {feedTab === 'nearby' && !userLocation && (
          <p className="text-xs text-muted-foreground px-1">Allow location access to see posts near you.</p>
        )}
        {feedTab === 'nearby' && userLocation && (
          <p className="text-xs px-1" style={{ color: '#00FF87' }}>📍 Showing posts within 80 km of your location</p>
        )}
        {feedTab === 'friends' && followingEmails.length === 0 && (
          <p className="text-xs text-muted-foreground px-1">Follow people from your <Link to="/me" className="underline" style={{ color: '#BF5FFF' }}>profile</Link> to see their posts here.</p>
        )}
      </div>

      {/* Feed */}
      <div className="px-4 space-y-3">
        {loading ? (
          [...Array(3)].map((_, i) => (
            <div key={i} className="rounded-2xl h-40 animate-pulse" style={{ background: 'rgba(255,255,255,0.04)' }} />
          ))
        ) : filtered.length === 0 ? (
          <div className="text-center py-24 space-y-3">
            <p className="text-4xl">{feedTab === 'bucket' ? '⭐' : feedTab === 'nearby' ? '📍' : feedTab === 'friends' ? '👥' : '🎤'}</p>
            <p className="font-bold text-foreground">
              {feedTab === 'bucket' ? 'No posts match your Bucket List' :
               feedTab === 'nearby' ? 'No nearby posts yet' :
               feedTab === 'friends' ? 'No posts from people you follow' :
               'No fan posts yet'}
            </p>
            <p className="text-sm text-muted-foreground">
              {feedTab === 'bucket' ? 'Try adding more artists or venues' :
               feedTab === 'friends' ? 'Follow fans from your profile to see their posts here' :
               'Be the first to start the conversation'}
            </p>
          </div>
        ) : (
          filtered.map(post => (
            <PostCard key={post.id} post={post} user={user} onReact={handleReact} reactingId={reactingId} />
          ))
        )}
      </div>

      {/* FAB */}
      <button
        onClick={() => setFab(fab === 'menu' ? null : 'menu')}
        className="fixed bottom-24 right-5 z-40 w-14 h-14 rounded-full flex items-center justify-center shadow-2xl transition-transform active:scale-95"
        style={{
          background: 'linear-gradient(135deg, #FF99CC, #66FFFF)',
          boxShadow: '0 0 24px rgba(0,200,255,0.4), 0 4px 24px rgba(0,0,0,0.5)',
        }}
      >
        <Plus
          className="w-7 h-7 transition-transform duration-200"
          style={{ color: '#0a0510', transform: fab === 'menu' ? 'rotate(45deg)' : 'rotate(0deg)' }}
        />
      </button>

      {/* FAB mini-menu */}
      {fab === 'menu' && (
        <>
          <div className="fixed inset-0 z-30" onClick={closeAll} />
          <div className="fixed bottom-40 right-5 z-40 flex flex-col items-end gap-3"
            style={{ animation: 'fabMenuIn 0.18s cubic-bezier(0.34,1.56,0.64,1) both' }}>
            <FabOption label="Seat Flex" emoji="💺" color="#66FFFF" delay="0s" onClick={() => setFab('flex')} />
            <FabOption label="Create a post" emoji="🎤" color="#FF99CC" delay="0.05s" onClick={() => setFab('post')} />
          </div>
          <style>{`
            @keyframes fabMenuIn { from { opacity:0; transform:translateY(16px) scale(0.92); } to { opacity:1; transform:translateY(0) scale(1); } }
            @keyframes fabItemIn { from { opacity:0; transform:translateX(20px) scale(0.88); } to { opacity:1; transform:translateX(0) scale(1); } }
          `}</style>
        </>
      )}

      {/* Bottom sheet — regular post */}
      {fab === 'post' && (
        <div className="fixed inset-0 z-50 flex flex-col justify-end">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={closeAll} />
          <div className="relative z-10 rounded-t-3xl px-5 pt-5 pb-28 overflow-y-auto max-h-[85vh]"
            style={{ background: 'hsl(255 12% 9%)', border: '1px solid rgba(255,255,255,0.1)' }}>
            <div className="w-10 h-1 rounded-full mx-auto mb-5" style={{ background: 'rgba(255,255,255,0.2)' }} />
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-bold text-base text-foreground">Create a post</h2>
              <button onClick={closeAll}><X className="w-5 h-5 text-muted-foreground" /></button>
            </div>
            <form onSubmit={handleSubmit} className="space-y-4">
              <textarea
                autoFocus
                value={text}
                onChange={e => setText(e.target.value)}
                placeholder="What's happening at the show?"
                maxLength={280}
                rows={3}
                className="w-full bg-transparent text-sm text-foreground placeholder:text-muted-foreground resize-none focus:outline-none leading-relaxed"
              />

              {/* Photo upload */}
              {photoUrl ? (
                <div className="relative rounded-xl overflow-hidden">
                  <img src={photoUrl} alt="post" className="w-full max-h-48 object-cover rounded-xl" />
                  <button type="button" onClick={() => setPhotoUrl('')}
                    className="absolute top-2 right-2 w-7 h-7 rounded-full flex items-center justify-center"
                    style={{ background: 'rgba(0,0,0,0.7)' }}>
                    <X className="w-4 h-4 text-white" />
                  </button>
                </div>
              ) : (
                <label className="flex items-center gap-2 text-xs font-semibold cursor-pointer w-fit"
                  style={{ color: uploadingPhoto ? '#BF5FFF' : 'rgba(255,255,255,0.4)' }}>
                  {uploadingPhoto
                    ? <span className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                    : <ImagePlus className="w-4 h-4" />}
                  <span>{uploadingPhoto ? 'Uploading…' : 'Add photo'}</span>
                  <input type="file" accept="image/*" className="hidden"
                    onChange={e => handlePhotoUpload(e.target.files[0])} disabled={uploadingPhoto} />
                </label>
              )}

              <div className="h-px" style={{ background: 'rgba(255,255,255,0.08)' }} />
              <div className="flex items-center gap-3">
                <select
                  value={selectedEventId}
                  onChange={e => setSelectedEventId(e.target.value)}
                  className="flex-1 text-xs px-3 py-2.5 rounded-xl focus:outline-none"
                  style={{ background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.1)', color: selectedEventId ? 'hsl(var(--foreground))' : 'hsl(var(--muted-foreground))' }}
                >
                  <option value="">🎫 Tag an event (optional)</option>
                  {events.map(ev => <option key={ev.id} value={ev.id}>{ev.title}</option>)}
                </select>
                <span className="text-[10px] text-muted-foreground flex-shrink-0">{280 - text.length}</span>
              </div>
              <button
                type="submit"
                disabled={(!text.trim() && !photoUrl) || submitting || uploadingPhoto}
                className="w-full py-3 rounded-2xl font-bold text-sm disabled:opacity-40 transition-opacity"
                style={{ background: 'linear-gradient(135deg, rgba(0,200,255,0.3), rgba(191,95,255,0.3))', color: '#fff', border: '1px solid rgba(0,200,255,0.3)' }}
              >
                {submitting ? 'Posting…' : 'Post'}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Bottom sheet — seat flex */}
      {fab === 'flex' && (
        <div className="fixed inset-0 z-50 flex flex-col justify-end">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={closeAll} />
          <SeatFlexSheet
            user={user}
            onClose={closeAll}
            onPosted={async () => { closeAll(); await loadPosts(); }}
          />
        </div>
      )}

      {/* Bucket List sheet */}
      {showBucketList && (
        <div className="fixed inset-0 z-50 flex flex-col justify-end">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setShowBucketList(false)} />
          <BucketListSheet
            user={user}
            onClose={() => {
              setShowBucketList(false);
              // Refresh bucket list after editing
              if (user?.email) {
                base44.entities.BucketListItem.filter({ user_email: user.email })
                  .then(setBucketList).catch(() => {});
              }
            }}
          />
        </div>
      )}
    </div>
  );
}

const TAB_STYLES = {
  trending: { active: 'rgba(255,153,204,0.12)', border: 'rgba(255,153,204,0.35)', color: '#FF99CC' },
  bucket:   { active: 'rgba(255,230,0,0.12)',   border: 'rgba(255,230,0,0.35)',   color: '#FFE600' },
  nearby:   { active: 'rgba(0,255,135,0.10)',   border: 'rgba(0,255,135,0.35)',   color: '#00FF87' },
  friends:  { active: 'rgba(191,95,255,0.12)',  border: 'rgba(191,95,255,0.35)',  color: '#BF5FFF' },
};

function FeedTab({ id, active, label, icon, badge, onClick, onEditClick }) {
  const isActive = active === id;
  const s = TAB_STYLES[id];
  return (
    <button
      onClick={() => onClick(id)}
      className="relative flex items-center gap-2 px-4 py-3 rounded-2xl text-sm font-bold transition-all w-full"
      style={isActive
        ? { background: s.active, border: `1px solid ${s.border}`, color: s.color }
        : { background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.4)' }
      }
    >
      <span style={{ color: isActive ? s.color : 'rgba(255,255,255,0.35)' }}>{icon}</span>
      <span>{label}</span>
      {badge && (
        <span className="text-[9px] font-black px-1.5 py-0.5 rounded-full ml-auto"
          style={{ background: isActive ? s.border : 'rgba(255,255,255,0.1)', color: isActive ? '#000' : 'rgba(255,255,255,0.5)' }}>
          {badge}
        </span>
      )}
      {onEditClick && isActive && (
        <span
          onClick={e => { e.stopPropagation(); onEditClick(); }}
          className="ml-auto text-[10px] font-black px-2 py-0.5 rounded-full cursor-pointer"
          style={{ background: 'rgba(255,230,0,0.2)', color: '#FFE600' }}
        >
          Edit
        </span>
      )}
    </button>
  );
}

function FabOption({ label, emoji, color, delay = '0s', onClick }) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-2.5 pl-3.5 pr-4 py-2.5 rounded-2xl"
      style={{
        background: color,
        boxShadow: `0 0 20px ${color}88, 0 4px 20px rgba(0,0,0,0.6)`,
        animation: `fabItemIn 0.22s cubic-bezier(0.34,1.56,0.64,1) ${delay} both`,
      }}
    >
      <span className="text-lg leading-none">{emoji}</span>
      <span className="text-sm font-black tracking-tight" style={{ color: '#0a0510' }}>{label}</span>
    </button>
  );
}

const AVATAR_GRADIENTS = [
  'linear-gradient(135deg, #FF99CC, #BF5FFF)',
  'linear-gradient(135deg, #66FFFF, #00C8FF)',
  'linear-gradient(135deg, #FFE600, #FF7A00)',
  'linear-gradient(135deg, #00FF87, #00C8FF)',
  'linear-gradient(135deg, #FF2D78, #FF99CC)',
];
function avatarGradient(str) {
  let h = 0;
  for (let i = 0; i < (str || '').length; i++) h = (h * 31 + str.charCodeAt(i)) & 0xffff;
  return AVATAR_GRADIENTS[h % AVATAR_GRADIENTS.length];
}

function PostCard({ post, user, onReact, reactingId }) {
  const reactions = post.reactions || { fire: [], eyes: [], peanut: [] };
  const isSeatFlex = post.post_type === 'seat_flex';
  const authorKey = post.author_email || post.author_name || '?';
  const initials = (post.author_name || post.author_email || '?')[0].toUpperCase();
  const hasSeatMove = post.from_section || post.to_section;

  return (
    <div className="rounded-2xl overflow-hidden"
      style={{
        background: 'linear-gradient(160deg, rgba(255,255,255,0.07) 0%, rgba(255,255,255,0.02) 100%)',
        border: isSeatFlex ? '1px solid rgba(102,255,255,0.2)' : '1px solid rgba(255,255,255,0.09)',
        boxShadow: isSeatFlex ? '0 0 20px rgba(102,255,255,0.06)' : 'none',
      }}>

      {/* Seat Flex accent bar */}
      {isSeatFlex && (
        <div className="h-0.5 w-full" style={{ background: 'linear-gradient(90deg, #66FFFF, #BF5FFF)' }} />
      )}

      <div className="px-4 py-4 space-y-3">
        {/* Author row */}
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 font-black text-sm"
              style={{ background: avatarGradient(authorKey), color: '#0a0510', boxShadow: '0 0 10px rgba(0,0,0,0.4)' }}>
              {initials}
            </div>
            <div>
              <p className="text-sm font-bold text-foreground leading-none">{post.author_name || post.author_email}</p>
              <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                {isSeatFlex && (
                  <span className="text-[9px] font-black tracking-widest px-1.5 py-0.5 rounded-full"
                    style={{ background: 'rgba(102,255,255,0.15)', color: '#66FFFF', border: '1px solid rgba(102,255,255,0.3)' }}>
                    💺 SEAT FLEX
                  </span>
                )}
              </div>
            </div>
          </div>
          <span className="text-[10px] text-muted-foreground flex-shrink-0 mt-0.5 whitespace-nowrap">
            {post.created_date ? formatDistanceToNow(new Date(post.created_date), { addSuffix: true }) : ''}
          </span>
        </div>

        {/* Event tag — always show if present */}
        {post.event_title && (
          <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl w-fit"
            style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.09)' }}>
            <span className="text-[10px]">🎫</span>
            <span className="text-[11px] font-semibold text-muted-foreground">{post.event_title}</span>
            {post.event_city && <span className="text-[10px] text-muted-foreground opacity-60">· {post.event_city}</span>}
          </div>
        )}

        {/* Seat move badge */}
        {isSeatFlex && hasSeatMove && (
          <div className="flex items-center gap-2 px-3 py-2 rounded-xl"
            style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)' }}>
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] font-black" style={{ color: '#FF99CC' }}>
                Sec {post.from_section || '?'}{post.from_row ? ` Row ${post.from_row}` : ''}
              </span>
              <span className="text-xs text-muted-foreground">→</span>
              <span className="text-[10px] font-black" style={{ color: '#66FFFF' }}>
                Sec {post.to_section || '?'}{post.to_row ? ` Row ${post.to_row}` : ''}
              </span>
            </div>
            <span className="text-sm ml-auto">🚀</span>
          </div>
        )}

        {/* Seat Flex before/after photos */}
        {isSeatFlex && (post.before_photo_url || post.after_photo_url) && (
          <div className="grid grid-cols-2 gap-2">
            {post.before_photo_url && (
              <div className="relative rounded-xl overflow-hidden aspect-[4/3]">
                <img src={post.before_photo_url} alt="Before" className="w-full h-full object-cover" />
                <span className="absolute bottom-1.5 left-1.5 text-[9px] font-black px-1.5 py-0.5 rounded-full"
                  style={{ background: 'rgba(0,0,0,0.75)', color: '#FF99CC' }}>BEFORE</span>
              </div>
            )}
            {post.after_photo_url && (
              <div className="relative rounded-xl overflow-hidden aspect-[4/3]">
                <img src={post.after_photo_url} alt="After" className="w-full h-full object-cover" />
                <span className="absolute bottom-1.5 left-1.5 text-[9px] font-black px-1.5 py-0.5 rounded-full"
                  style={{ background: 'rgba(0,0,0,0.75)', color: '#66FFFF' }}>AFTER</span>
              </div>
            )}
          </div>
        )}

        {/* Regular post photo */}
        {!isSeatFlex && post.photo_url && (
          <div className="rounded-xl overflow-hidden">
            <img src={post.photo_url} alt="post" className="w-full max-h-72 object-cover" />
          </div>
        )}

        {/* Post text */}
        <p className="text-sm text-foreground leading-relaxed">{post.text}</p>

        {/* Divider */}
        <div className="h-px" style={{ background: 'rgba(255,255,255,0.06)' }} />

        {/* Reactions */}
        <div className="flex items-center gap-2">
          {REACTIONS.map(({ key, emoji }) => {
            const arr = reactions[key] || [];
            const reacted = user && arr.includes(user.email);
            return (
              <button
                key={key}
                onClick={() => onReact(post, key)}
                disabled={!user || !!reactingId}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold transition-all active:scale-95 disabled:opacity-50"
                style={{
                  background: reacted ? 'rgba(255,153,204,0.18)' : 'rgba(255,255,255,0.05)',
                  border: reacted ? '1px solid rgba(255,153,204,0.4)' : '1px solid rgba(255,255,255,0.08)',
                  color: reacted ? '#FF99CC' : 'rgba(255,255,255,0.55)',
                  boxShadow: reacted ? '0 0 10px rgba(255,153,204,0.15)' : 'none',
                }}
              >
                <span className="text-sm">{emoji}</span>
                {arr.length > 0 && <span>{arr.length}</span>}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}