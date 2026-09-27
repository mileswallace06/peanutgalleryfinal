import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Link, useLocation } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { formatDistanceToNow } from 'date-fns';
import { Plus, X, ImagePlus, Star, MapPin, Users, Search, ChevronDown, RefreshCw, ArrowUpDown, Check, Pencil, Armchair, Ticket, ArrowRight, MessageCircle, AlertCircle } from 'lucide-react';
import { usePullToRefresh } from '@/hooks/usePullToRefresh';
import SeatFlexSheet from '@/components/fanzone/SeatFlexSheet';
import BucketListSheet from '@/components/fanzone/BucketListSheet';
import './community-ticket.css';

const REACTIONS = [
  { key: 'fire', emoji: '🔥' },
  { key: 'eyes', emoji: '👀' },
  { key: 'peanut', emoji: '🥜' },
];

// Sort options shown in the Fan Zone sort sheet — only the active one is ever
// surfaced on the page itself (compact "⇅ <label> ▾" button).
const SORT_OPTIONS = [
  { id: 'upcoming', label: 'Upcoming Soonest' },
  { id: 'newest_posted', label: 'Newest Posted' },
  { id: 'recent_activity', label: 'Most Recent Activity' },
  { id: 'most_liked', label: 'Most Liked' },
  { id: 'most_commented', label: 'Most Commented' },
  { id: 'closest', label: 'Closest Distance' },
  { id: 'oldest_event', label: 'Oldest' },
];

const deg2rad = (d) => (d * Math.PI) / 180;
function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = deg2rad(lat2 - lat1);
  const dLng = deg2rad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(deg2rad(lat1)) * Math.cos(deg2rad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export default function FanZone() {
  const location = useLocation();
  const isTabActive = location.pathname === '/fan-zone' || location.pathname.startsWith('/fan-zone/');
  const [user, setUser] = useState(null);

  // Close any open FAB sheets when navigating away from FanZone
  useEffect(() => {
    if (!isTabActive && fab) setFab(null);
  }, [isTabActive]);
  const [posts, setPosts] = useState([]);
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [reactingId, setReactingId] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);

  // FAB state
  const [fab, setFab] = useState(null);

  // Compose state
  const [text, setText] = useState('');
  const [selectedEventId, setSelectedEventId] = useState('');
  const [eventQuery, setEventQuery] = useState('');
  const [showEventPicker, setShowEventPicker] = useState(false);
  const [photoUrl, setPhotoUrl] = useState('');
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const eventPickerRef = useRef(null);

  // Filter state
  const [feedTab, setFeedTab] = useState('trending'); // 'trending' | 'bucket' | 'nearby' | 'friends'
  // Date sort/filter — Fan Zone supports both upcoming activity AND retrospective posts
  // dateSort: 'upcoming' | 'newest_posted' | 'oldest_event' | 'past'
  // dateFilter: 'all' | 'upcoming' | 'past' | 'recent'
  const [dateSort, setDateSort] = useState('upcoming');
  const [dateFilter, setDateFilter] = useState('all');
  const [sortSheetOpen, setSortSheetOpen] = useState(false);
  const [bucketList, setBucketList] = useState([]);
  const [showBucketList, setShowBucketList] = useState(false);
  const [userLocation, setUserLocation] = useState(null);
  const [followingEmails, setFollowingEmails] = useState([]);

  useEffect(() => {
    base44.auth.me().then(u => {
      setUser(u);
      if (u?.email) {
        base44.entities.BucketListItem.filter({ user_email: u.email })
          .then(setBucketList).catch((err) => console.warn('[FanZone] BucketListItem.filter failed:', err?.message || err));
        base44.entities.Follow.filter({ follower_email: u.email })
          .then(rows => setFollowingEmails(rows.map(r => r.following_email)))
          .catch((err) => console.warn('[FanZone] Follow.filter failed:', err?.message || err));
      }
    }).catch((err) => {
      console.warn('[FanZone] auth.me failed:', err?.message || err);
    }).finally(() => setAuthLoading(false));
    loadPosts();
    // Load ALL events (including past) so retrospective posts can link to them.
    // Fan Zone is conversation, not just upcoming purchases.
    base44.entities.Event.list('date', 100)
      .then(data => setEvents(Array.isArray(data) ? data : []))
      .catch((err) => console.warn('[FanZone] Event.list failed:', err?.message || err));
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
    setLoadError(null);
    try {
      const data = await base44.entities.FanPost.list('-created_date', 100);
      setPosts(Array.isArray(data) ? data : []);
    } catch (err) {
      const detail = {
        entity: 'FanPost',
        query: 'list(-created_date, 100)',
        filter: feedTab,
        authState: authLoading ? 'resolving' : user ? 'authenticated' : 'unauthenticated',
        environment: window.location.hostname.includes('base44') ? 'preview' : 'live',
        message: err?.message || String(err),
        status: err?.response?.status || err?.status,
      };
      console.warn('[FanZone] loadPosts failed:', detail);
      setLoadError(detail);
    } finally {
      setLoading(false);
    }
  };

  const closeAll = () => { setFab(null); setText(''); setSelectedEventId(''); setEventQuery(''); setShowEventPicker(false); setPhotoUrl(''); };

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

  // Feed tabs now act as CONTENT FILTERS only (what pool of posts).
  // Date sort/filter is applied uniformly afterward so browsing is chronological.
  const filtered = (() => {
    let base;
    if (feedTab === 'trending') {
      // Trending: pre-sort by reaction score as base, then date sort overrides ordering
      base = [...withScore].sort((a, b) => b._score - a._score);
    } else if (feedTab === 'bucket') {
      base = bucketNames.length === 0 ? posts : posts.filter(p => {
        const haystack = [p.event_title, p.text].join(' ').toLowerCase();
        return bucketNames.some(name => haystack.includes(name));
      });
    } else if (feedTab === 'nearby') {
      if (!userLocation) {
        base = posts.filter(p => !!p.event_city);
      } else {
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
        const nearbyCities = new Set(events.filter(e => nearbyEventIds.has(e.id)).map(e => e.city).filter(Boolean));
        base = posts.filter(p => nearbyEventIds.has(p.event_id) || (p.event_city && nearbyCities.has(p.event_city)));
      }
    } else if (feedTab === 'friends') {
      base = (!user || followingEmails.length === 0) ? [] : posts.filter(p => followingEmails.includes(p.author_email));
    } else {
      base = posts;
    }
    // ── Date filter (applies regardless of feed tab) ──
    // eventDateTime = when the tagged event happens/happened (looked up from Event entity)
    // createdAt = when the post was made
    const getEventDateForPost = (p) => {
      if (!p.event_id) return null;
      const ev = events.find(e => e.id === p.event_id);
      if (!ev) return null;
      const d = ev.event_start_utc || ev.date;
      return d ? new Date(d).getTime() : null;
    };
    const getPostDate = (p) => p.created_date ? new Date(p.created_date).getTime() : null;

    const now = Date.now();
    const ONE_DAY = 24 * 60 * 60 * 1000;

    if (dateFilter === 'upcoming') {
      base = base.filter(p => {
        const t = getEventDateForPost(p);
        return t !== null && t >= now;
      });
    } else if (dateFilter === 'past') {
      base = base.filter(p => {
        const t = getEventDateForPost(p);
        return t !== null && t < now;
      });
    } else if (dateFilter === 'recent') {
      base = base.filter(p => {
        const t = getPostDate(p);
        return t !== null && (now - t) <= ONE_DAY;
      });
    }
    // dateFilter === 'all' → no filtering

    // ── Date sort ──
    if (dateSort === 'upcoming') {
      base.sort((a, b) => {
        const ta = getEventDateForPost(a), tb = getEventDateForPost(b);
        if (ta === null && tb === null) return 0;
        if (ta === null) return 1;
        if (tb === null) return -1;
        return ta - tb; // soonest first
      });
    } else if (dateSort === 'newest_posted') {
      base.sort((a, b) => {
        const ta = getPostDate(a), tb = getPostDate(b);
        if (ta === null && tb === null) return 0;
        if (ta === null) return 1;
        if (tb === null) return -1;
        return tb - ta; // newest post first
      });
    } else if (dateSort === 'oldest_event') {
      base.sort((a, b) => {
        const ta = getEventDateForPost(a), tb = getEventDateForPost(b);
        if (ta === null && tb === null) return 0;
        if (ta === null) return 1;
        if (tb === null) return -1;
        return ta - tb; // oldest event date first
      });
    } else if (dateSort === 'past') {
      base.sort((a, b) => {
        const ta = getEventDateForPost(a), tb = getEventDateForPost(b);
        if (ta === null && tb === null) return 0;
        if (ta === null) return 1;
        if (tb === null) return -1;
        return tb - ta; // most recent past event first (retrospective)
      });
    } else if (dateSort === 'recent_activity') {
      const actTime = (p) => (p.updated_date ? new Date(p.updated_date).getTime() : getPostDate(p));
      base.sort((a, b) => {
        const ta = actTime(a), tb = actTime(b);
        if (ta === null && tb === null) return 0;
        if (ta === null) return 1;
        if (tb === null) return -1;
        return tb - ta; // most recent activity first
      });
    } else if (dateSort === 'most_liked') {
      base.sort((a, b) => b._score - a._score);
    } else if (dateSort === 'most_commented') {
      const commentCount = (p) => (Array.isArray(p.comments) ? p.comments.length : (p.comments_count || 0));
      base.sort((a, b) => commentCount(b) - commentCount(a));
    } else if (dateSort === 'closest') {
      if (userLocation) {
        const postDistance = (p) => {
          const ev = p.event_id ? events.find(e => e.id === p.event_id) : null;
          if (ev && ev.venue_lat && ev.venue_lng) return haversineKm(userLocation.lat, userLocation.lng, ev.venue_lat, ev.venue_lng);
          return null;
        };
        base.sort((a, b) => {
          const da = postDistance(a), db = postDistance(b);
          if (da === null && db === null) return 0;
          if (da === null) return 1;
          if (db === null) return -1;
          return da - db; // closest first
        });
      }
    }

    return base;
  })();

  const { containerRef, innerRef, pulling } = usePullToRefresh(() => {
    loadPosts();
  });

  const currentSortLabel = SORT_OPTIONS.find(o => o.id === dateSort)?.label || 'Sort';
  const currentDateLabel = { all: 'All dates', upcoming: 'Upcoming', past: 'Past', recent: 'Recent' }[dateFilter] || 'All dates';

  return (
    <>
    <div ref={containerRef} className="pg-design-page pg-fanzone-page">
      <div ref={innerRef} className="transition-transform duration-200">
      {pulling && (
        <div className="fixed left-1/2 -translate-x-1/2 z-40 flex items-center gap-2 px-4 py-2 rounded-full"
          style={{ top: 'calc(1rem + var(--app-safe-top))', background: 'rgba(var(--neon-cyan-light-rgb), 0.1)', border: '1px solid rgba(var(--neon-cyan-light-rgb), 0.25)' }}>
          <RefreshCw className="w-3.5 h-3.5 animate-spin" style={{ color: 'var(--neon-cyan-light)' }} />
          <span className="text-xs font-semibold" style={{ color: 'var(--neon-cyan-light)' }}>Refreshing…</span>
        </div>
      )}
      <header className="pg-fan-heading" data-page-hero="fan-zone">
        <div>
          <h1 className="pg-page-title">Fan Zone</h1>
          <p className="pg-community-subtitle">Share the moment.</p>
        </div>
        <button
          onClick={() => user ? setFab(fab === 'menu' ? null : 'menu') : base44.auth.redirectToLogin()}
          aria-label={fab === 'menu' ? 'Close post menu' : 'Create post'}
          aria-expanded={fab === 'menu'}
          className={`pg-compose-button${fab === 'menu' ? ' is-open' : ''}`}
        >
          {fab === 'menu' ? <X aria-hidden="true" /> : <Pencil aria-hidden="true" />}
        </button>
      </header>

      <div className="pg-feed-navigation">
        <div className="pg-feed-tabs" aria-label="Post filters">
          <FeedTab id="trending" active={feedTab} label="Trending" onClick={setFeedTab} />
          <FeedTab id="nearby" active={feedTab} label="Near Me" onClick={setFeedTab} />
          <FeedTab id="friends" active={feedTab} label="Friends" onClick={setFeedTab} />
          <FeedTab id="bucket" active={feedTab} label="Bucket List" badge={bucketList.length || null} onClick={setFeedTab} />
        </div>
        {feedTab === 'bucket' && (
          <div className="pg-feed-context">
            <p>{bucketList.length === 0 && !loading ? 'Add artists and venues to filter your feed.' : `${bucketList.length} saved to your bucket list`}</p>
            <button onClick={() => setShowBucketList(true)}>Edit list <Pencil size={14} aria-hidden="true" /></button>
          </div>
        )}
        {feedTab === 'nearby' && (
          <p className="pg-feed-hint"><MapPin size={14} aria-hidden="true" />{userLocation ? 'Showing posts within 80 km of your location' : 'Allow location access to see posts near you.'}</p>
        )}
        {feedTab === 'friends' && followingEmails.length === 0 && (
          <p className="pg-feed-hint">Follow people from your <Link to="/me">profile</Link> to see their posts here.</p>
        )}
      </div>

      <details className="pg-feed-filter-menu">
        <summary>
          <strong>Filters</strong>
          <span>{currentDateLabel} · {currentSortLabel}</span>
          <ChevronDown size={15} aria-hidden="true" />
        </summary>
        <div className="pg-feed-tools">
          <div className="pg-date-filters" aria-label="Event date filters">
            {[
              { id: 'all', label: 'All' },
              { id: 'upcoming', label: 'Upcoming' },
              { id: 'past', label: 'Past' },
            ].map(opt => (
              <button key={opt.id} onClick={() => setDateFilter(opt.id)}
                aria-pressed={dateFilter === opt.id}
                className={dateFilter === opt.id ? 'is-active' : ''}>
                {opt.label}
              </button>
            ))}
          </div>
          <button onClick={() => setSortSheetOpen(true)} className="pg-sort-control"
            aria-label={`Sort posts. Current: ${currentSortLabel}`}>
            <ArrowUpDown size={16} aria-hidden="true" />
            <span>{currentSortLabel}</span>
            <ChevronDown size={14} aria-hidden="true" />
          </button>
        </div>
      </details>

      {/* Feed */}
      <div className="pg-feed">
        {loadError && !authLoading ? (
          <div className="pg-state pg-community-state">
            <AlertCircle size={32} aria-hidden="true" />
            <p className="font-bold text-foreground">Couldn't load posts</p>
            <p className="text-sm text-muted-foreground">Check your connection and try again.</p>
            <button
              onClick={loadPosts}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full font-bold text-sm"
              style={{ background: 'rgba(var(--neon-cyan-rgb), 0.08)', border: '1px solid rgba(var(--neon-cyan-rgb), 0.2)', color: 'var(--neon-cyan)' }}
            >
              <RefreshCw className="w-4 h-4" /> Retry
            </button>
          </div>
        ) : (loading || authLoading) ? (
          [...Array(3)].map((_, i) => (
            <div key={i} className="pg-post-skeleton animate-pulse" aria-label="Loading posts" />
          ))
        ) : filtered.length === 0 ? (
          <div className="pg-state pg-community-state">
            {feedTab === 'bucket' ? <Star size={32} aria-hidden="true" /> : feedTab === 'nearby' ? <MapPin size={32} aria-hidden="true" /> : feedTab === 'friends' ? <Users size={32} aria-hidden="true" /> : <MessageCircle size={32} aria-hidden="true" />}
            <p className="font-bold text-foreground">
              {feedTab === 'bucket' ? 'No bucket list posts yet' :
               feedTab === 'nearby' ? 'No nearby posts yet' :
               feedTab === 'friends' ? 'No friend posts yet' :
               feedTab === 'trending' ? 'No trending posts yet' :
               'No fan posts yet'}
            </p>
            <p className="text-sm text-muted-foreground">
              {feedTab === 'bucket' ? 'Try adding more artists or venues to your list' :
               feedTab === 'nearby' ? 'Allow location access or try another area' :
               feedTab === 'friends' ? 'Follow fans from your profile to see their posts here' :
               'Be the first to share a moment from an event.'}
            </p>
            {feedTab !== 'friends' && (
              <button
                onClick={() => user ? setFab('post') : base44.auth.redirectToLogin()}
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full font-bold text-sm"
                style={{ background: 'rgba(var(--neon-cyan-rgb), 0.08)', border: '1px solid rgba(var(--neon-cyan-rgb), 0.2)', color: 'var(--neon-cyan)' }}
              >
                <Plus className="w-4 h-4" /> Create Post
              </button>
            )}
          </div>
        ) : (
          filtered.map(post => (
            <PostCard key={post.id} post={post} user={user} onReact={handleReact} reactingId={reactingId} />
          ))
        )}
      </div>

      </div>
    </div>

      {createPortal(<div className="pg-community-overlays">
      {/* FAB mini-menu */}
      {isTabActive && fab === 'menu' && (
        <>
          <div className="fixed inset-0 z-30" onClick={closeAll} />
          <div className="fixed right-5 z-40 flex flex-col items-end gap-3"
            style={{ bottom: 'calc(10rem + env(safe-area-inset-bottom))', animation: 'fabMenuIn 0.18s cubic-bezier(0.34,1.56,0.64,1) both' }}>
            <FabOption label="Seat Flex" icon={<Armchair size={19} aria-hidden="true" />} color="var(--pg-cyan)" delay="0s" onClick={() => setFab('flex')} />
            <FabOption label="Create a post" icon={<Pencil size={19} aria-hidden="true" />} color="var(--pg-violet)" delay="0.05s" onClick={() => setFab('post')} />
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
          <div className="relative z-10 rounded-t-3xl px-5 pt-5 overflow-y-auto max-h-[85vh]"
            style={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', paddingBottom: 'calc(7rem + env(safe-area-inset-bottom))' }}>
            <div className="w-10 h-1 rounded-full mx-auto mb-5" style={{ background: 'hsl(var(--border))' }} />
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-bold text-base text-foreground">Create a post</h2>
              <button onClick={closeAll} aria-label="Close post composer"><X className="w-5 h-5 text-muted-foreground" /></button>
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
                  <button type="button" onClick={() => setPhotoUrl('')} aria-label="Remove photo"
                    className="absolute top-2 right-2 w-7 h-7 rounded-full flex items-center justify-center"
                    style={{ background: 'rgba(0,0,0,0.7)' }}>
                    <X className="w-4 h-4 text-white" />
                  </button>
                </div>
              ) : (
                <label className="flex items-center gap-2 text-xs font-semibold cursor-pointer w-fit"
                  style={{ color: uploadingPhoto ? 'var(--neon-purple)' : 'hsl(var(--muted-foreground))' }}>
                  {uploadingPhoto
                    ? <span className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                    : <ImagePlus className="w-4 h-4" />}
                  <span>{uploadingPhoto ? 'Uploading…' : 'Add photo'}</span>
                  <input type="file" accept="image/*" className="hidden"
                    onChange={e => handlePhotoUpload(e.target.files[0])} disabled={uploadingPhoto} />
                </label>
              )}

              <div className="h-px" style={{ background: 'hsl(var(--border))' }} />

              {/* Searchable event picker */}
              <div className="relative" ref={eventPickerRef}>
                <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setShowEventPicker(v => !v)}
                  className="min-w-0 flex-1 flex items-center gap-2 px-3 py-2.5 rounded-xl text-xs text-left"
                  style={{ background: 'var(--search-bg)', border: '1px solid hsl(var(--border))', color: selectedEventId ? 'hsl(var(--foreground))' : 'hsl(var(--muted-foreground))' }}
                >
                  <Ticket className="w-4 h-4 flex-shrink-0" aria-hidden="true" />
                  <span className="flex-1 truncate">
                    {selectedEventId ? events.find(e => e.id === selectedEventId)?.title : 'Tag an event (optional)'}
                  </span>
                  <ChevronDown className="w-3.5 h-3.5 flex-shrink-0 opacity-50" />
                </button>
                {selectedEventId && (
                  <button type="button" aria-label="Clear tagged event"
                    onClick={() => { setSelectedEventId(''); setEventQuery(''); setShowEventPicker(false); }}>
                    <X className="w-4 h-4 text-muted-foreground" />
                  </button>
                )}
                </div>

                {showEventPicker && (
                  <div className="absolute bottom-full left-0 right-0 mb-1 rounded-2xl overflow-hidden z-10"
                    style={{ background: 'hsl(var(--popover))', border: '1px solid hsl(var(--border))', maxHeight: '220px', display: 'flex', flexDirection: 'column' }}>
                    <div className="p-2 flex-shrink-0">
                      <div className="relative">
                        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                        <input
                          autoFocus
                          type="text"
                          placeholder="Search events…"
                          value={eventQuery}
                          onChange={e => setEventQuery(e.target.value)}
                          className="w-full pl-8 pr-3 py-2 rounded-xl text-xs text-foreground placeholder:text-muted-foreground focus:outline-none"
                          style={{ background: 'var(--search-bg)', border: '1px solid hsl(var(--border))' }}
                        />
                      </div>
                    </div>
                    <div className="overflow-y-auto flex-1">
                      {events
                        .filter(ev => !eventQuery || ev.title?.toLowerCase().includes(eventQuery.toLowerCase()) || ev.venue?.toLowerCase().includes(eventQuery.toLowerCase()))
                        .map(ev => (
                          <button
                            key={ev.id}
                            type="button"
                            onClick={() => { setSelectedEventId(ev.id); setShowEventPicker(false); setEventQuery(''); }}
                            className="w-full flex items-center gap-2.5 px-3 py-2.5 text-left transition-all"
                            style={{ background: selectedEventId === ev.id ? 'rgba(var(--neon-cyan-rgb), 0.08)' : 'transparent', borderBottom: '1px solid hsl(var(--border))' }}
                          >
                            {ev.image_url
                              ? <img src={ev.image_url} alt="" className="w-7 h-7 rounded-lg object-cover flex-shrink-0" />
                              : <span className="w-7 h-7 flex items-center justify-center text-sm flex-shrink-0 rounded-lg" style={{ background: 'rgba(255,255,255,0.06)' }}><Ticket size={16} aria-hidden="true" /></span>
                            }
                            <div className="min-w-0 flex-1">
                              <p className="text-xs font-semibold text-foreground truncate">{ev.title}</p>
                              {ev.city && <p className="text-[10px] text-muted-foreground">{ev.city}</p>}
                            </div>
                          </button>
                        ))
                      }
                    </div>
                  </div>
                )}
              </div>

              <div className="flex items-center justify-end">
                <span className="text-[10px] text-muted-foreground">{280 - text.length}</span>
              </div>
              <button
                type="submit"
                disabled={(!text.trim() && !photoUrl) || submitting || uploadingPhoto}
                className="w-full py-3 rounded-2xl font-bold text-sm disabled:opacity-40 transition-opacity"
                style={{ background: 'linear-gradient(135deg, rgba(var(--neon-cyan-rgb), 0.2), rgba(var(--neon-purple-rgb), 0.2))', color: 'var(--gradient-btn-text)', border: '1px solid rgba(var(--neon-cyan-rgb), 0.25)' }}
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

      {/* Sort bottom sheet */}
      {sortSheetOpen && (
        <div className="fixed inset-0 z-50 flex flex-col justify-end">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setSortSheetOpen(false)} />
          <div className="relative z-10 rounded-t-3xl px-5 pt-5 overflow-y-auto"
            style={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', paddingBottom: 'calc(7rem + env(safe-area-inset-bottom))' }}>
            <div className="w-10 h-1 rounded-full mx-auto mb-5" style={{ background: 'hsl(var(--border))' }} />
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-bold text-base text-foreground">Sort by</h2>
              <button onClick={() => setSortSheetOpen(false)} aria-label="Close sort sheet"><X className="w-5 h-5 text-muted-foreground" /></button>
            </div>
            <div className="space-y-1">
              {SORT_OPTIONS.map(opt => {
                if (opt.id === 'closest' && !(feedTab === 'nearby' && userLocation)) return null;
                const active = dateSort === opt.id;
                return (
                  <button key={opt.id} onClick={() => { setDateSort(opt.id); setSortSheetOpen(false); }}
                    className="w-full flex items-center justify-between px-3 py-3 rounded-xl text-left transition-all"
                    style={{ background: active ? 'rgba(var(--neon-cyan-rgb),0.1)' : 'transparent' }}>
                    <span className="text-sm font-semibold" style={{ color: active ? 'var(--neon-cyan)' : 'hsl(var(--foreground))' }}>{opt.label}</span>
                    {active && <Check className="w-4 h-4" style={{ color: 'var(--neon-cyan)' }} />}
                  </button>
                );
              })}
            </div>
          </div>
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
      </div>, document.body)}
    </>
  );
}

function FeedTab({ id, active, label, badge, onClick }) {
  return (
    <button
      onClick={() => onClick(id)}
      className={`pg-feed-tab${active === id ? ' is-active' : ''}${id === 'bucket' ? ' pg-bucket-tab' : ''}`}
      aria-pressed={active === id}
      aria-label={badge ? `${label}, ${badge} saved` : label}
    >
      <span>{label}</span>
      {badge && <span className="pg-feed-count">{badge}</span>}
    </button>
  );
}

function FabOption({ label, icon, color, delay = '0s', onClick }) {
  return (
    <button onClick={onClick} className="pg-compose-option"
      style={{ background: color, animation: `fabItemIn 0.22s cubic-bezier(0.34,1.56,0.64,1) ${delay} both` }}>
      {icon}<span>{label}</span>
    </button>
  );
}

const AVATAR_GRADIENTS = [
  'linear-gradient(135deg, var(--neon-pink-light), var(--neon-purple))',
  'linear-gradient(135deg, var(--neon-cyan-light), var(--neon-cyan))',
  'linear-gradient(135deg, var(--neon-yellow), var(--neon-orange))',
  'linear-gradient(135deg, var(--neon-green), var(--neon-cyan))',
  'linear-gradient(135deg, var(--neon-pink), var(--neon-pink-light))',
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
    <article className={`pg-fan-post${isSeatFlex ? ' pg-seat-flex-post' : ''}`}>
      <div className="pg-post-author-row">
        <div className="pg-post-avatar" style={{ background: avatarGradient(authorKey) }} aria-hidden="true">{initials}</div>
        <div className="pg-post-author">
          <p>{post.author_name || post.author_email}</p>
          <div>
            {post.created_date && <time dateTime={post.created_date}>{formatDistanceToNow(new Date(post.created_date), { addSuffix: true })}</time>}
            {post.event_city && <span>{post.created_date ? ' · ' : ''}{post.event_city}</span>}
          </div>
        </div>
        {isSeatFlex && <span className="pg-seat-flex-label">Seat Flex</span>}
      </div>

      {post.event_title && (
        <p className="pg-post-event"><Ticket size={14} aria-hidden="true" /><span>{post.event_title}</span></p>
      )}

      {isSeatFlex && hasSeatMove && (
        <div className="pg-ticket pg-seat-move">
          <div className="pg-seat-origin">
            <span className="pg-seat-direction">From</span>
            <strong>{post.from_section ? `Section ${post.from_section}` : 'Section not shared'}</strong>
            {post.from_row && <span>Row {post.from_row}</span>}
          </div>
          <ArrowRight className="pg-seat-arrow" size={24} aria-label="to" />
          <div className="pg-ticket-end pg-seat-destination">
            <span className="pg-seat-direction">To</span>
            <strong>{post.to_section ? `Section ${post.to_section}` : 'Section not shared'}</strong>
            {post.to_row && <span>Row {post.to_row}</span>}
          </div>
        </div>
      )}

      {isSeatFlex && (post.before_photo_url || post.after_photo_url) && (
        <div className={`pg-seat-photos${!(post.before_photo_url && post.after_photo_url) ? ' pg-single-photo' : ''}`}>
          {post.before_photo_url && (
            <figure>
              <img src={post.before_photo_url} alt="View before the seat upgrade" loading="lazy" />
              <figcaption>Before</figcaption>
            </figure>
          )}
          {post.after_photo_url && (
            <figure>
              <img src={post.after_photo_url} alt="View after the seat upgrade" loading="lazy" />
              <figcaption>After</figcaption>
            </figure>
          )}
        </div>
      )}

      <p className="pg-post-text">{post.text}</p>

      {!isSeatFlex && post.photo_url && (
        <div className="pg-post-photo"><img src={post.photo_url} alt="Photo shared by the fan" loading="lazy" /></div>
      )}

      <div className="pg-post-reactions" aria-label="Reactions">
        {REACTIONS.map(({ key, emoji }) => {
          const arr = reactions[key] || [];
          const reacted = !!user && arr.includes(user.email);
          return (
            <button key={key} onClick={() => onReact(post, key)} disabled={!user || !!reactingId}
              className={reacted ? 'is-reacted' : ''} aria-pressed={reacted}
              aria-label={`${key} reaction, ${arr.length}${reacted ? ', selected' : ''}`}>
              <span aria-hidden="true">{emoji}</span><span>{arr.length}</span>
            </button>
          );
        })}
      </div>
    </article>
  );
}
