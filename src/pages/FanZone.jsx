import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Link, useLocation } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { formatDistanceToNow } from 'date-fns';
import { Plus, X, Star, MapPin, Users, ChevronDown, RefreshCw, ArrowUpDown, Check, Pencil, Ticket, ArrowRight, MessageCircle, AlertCircle } from 'lucide-react';
import { usePullToRefresh } from '@/hooks/usePullToRefresh';
import FanPostComposer from '@/components/fanzone/FanPostComposer';
import BucketListSheet from '@/components/fanzone/BucketListSheet';
import BucketListIntro from '@/components/fanzone/BucketListIntro';
import { filterBucketListPosts } from '@/components/fanzone/bucketListFeed';
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

  // Close the composer when this retained tab is no longer visible.
  useEffect(() => {
    if (!isTabActive) { setFab(null); setShowBucketList(null); setSortSheetOpen(false); }
  }, [isTabActive]);
  const [posts, setPosts] = useState([]);
  const [events, setEvents] = useState([]);
  const [eventsLoading, setEventsLoading] = useState(true);
  const [eventsError, setEventsError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [reactingId, setReactingId] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [postedAt, setPostedAt] = useState(0);

  // FAB state
  const [fab, setFab] = useState(null);

  const createPostButton = useRef(null);

  // Filter state
  const [feedTab, setFeedTab] = useState(() => new URLSearchParams(location.search).get('tab') === 'bucket_list' ? 'bucket' : 'trending'); // 'trending' | 'bucket' | 'nearby' | 'friends'
  // Date sort/filter — Fan Zone supports both upcoming activity AND retrospective posts
  // dateSort: 'upcoming' | 'newest_posted' | 'oldest_event' | 'past'
  // dateFilter: 'all' | 'upcoming' | 'past' | 'recent'
  const [dateSort, setDateSort] = useState('upcoming');
  const [dateFilter, setDateFilter] = useState('all');
  const [sortSheetOpen, setSortSheetOpen] = useState(false);
  const [bucketList, setBucketList] = useState([]);
  const [showBucketList, setShowBucketList] = useState(null);
  const [bucketLoading, setBucketLoading] = useState(true);
  const [bucketError, setBucketError] = useState(false);
  const bucketTrigger = useRef(null);
  const [userLocation, setUserLocation] = useState(null);
  const [followingEmails, setFollowingEmails] = useState([]);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    if (params.get('tab') === 'bucket_list') setFeedTab('bucket');
    if (params.get('bucket') === 'edit' && user?.email) setShowBucketList('list');
  }, [location.search, user?.email]);

  useEffect(() => {
    base44.auth.me().then(u => {
      setUser(u);
      if (u?.email) {
        loadBucketList(u.email);
        base44.entities.Follow.filter({ follower_email: u.email })
          .then(rows => setFollowingEmails(rows.map(r => r.following_email)))
          .catch((err) => console.warn('[FanZone] Follow.filter failed:', err?.message || err));
      } else { setBucketLoading(false); }
    }).catch((err) => {
      setBucketLoading(false);
      console.warn('[FanZone] auth.me failed:', err?.message || err);
    }).finally(() => setAuthLoading(false));
    loadPosts();
    // Load ALL events (including past) so retrospective posts can link to them.
    // Fan Zone is conversation, not just upcoming purchases.
    loadEvents();
  }, []);

  useEffect(() => {
    if (!postedAt) return;
    const timer = window.setTimeout(() => setPostedAt(0), 6000);
    return () => window.clearTimeout(timer);
  }, [postedAt]);

  const handlePosted = () => {
    setFab(null);
    setFeedTab('trending');
    setDateFilter('all');
    setDateSort('newest_posted');
    setPostedAt(Date.now());
    loadPosts();
  };

  const loadEvents = async () => {
    setEventsLoading(true);
    setEventsError(false);
    try {
      const data = await base44.entities.Event.list('date', 100);
      setEvents(Array.isArray(data) ? data : []);
    } catch {
      setEventsError(true);
    } finally {
      setEventsLoading(false);
    }
  };

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

  const loadBucketList = async email => {
    setBucketLoading(true);
    setBucketError(false);
    try {
      const rows = await base44.entities.BucketListItem.filter({ user_email: email });
      setBucketList(Array.isArray(rows) ? rows : []);
    } catch {
      setBucketError(true);
    } finally {
      setBucketLoading(false);
    }
  };

  const openBucketList = (tab = 'search', event) => {
    if (!user?.email) { base44.auth.redirectToLogin(); return; }
    bucketTrigger.current = event?.currentTarget || document.activeElement;
    setShowBucketList(tab);
  };
  const bucketNeedsSetup = !authLoading && !bucketLoading && !bucketError && bucketList.length === 0;

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
      base = filterBucketListPosts(posts, bucketList, events);
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
          ref={createPostButton}
          onClick={() => user?.email ? setFab('post') : base44.auth.redirectToLogin()}
          disabled={authLoading}
          aria-label="Create post"
          aria-haspopup="dialog"
          className="pg-compose-button"
        >
          <Plus aria-hidden="true" /><span>Create</span>
        </button>
      </header>

      <div className="pg-feed-navigation">
        <div className="pg-feed-tabs" aria-label="Post filters">
          <FeedTab id="trending" active={feedTab} label="Trending" onClick={setFeedTab} />
          <FeedTab id="nearby" active={feedTab} label="Near Me" onClick={setFeedTab} />
          <FeedTab id="friends" active={feedTab} label="Friends" onClick={setFeedTab} />
          <FeedTab id="bucket" active={feedTab} label="Bucket List" badge={bucketList.length || null} onClick={setFeedTab} />
        </div>
        {feedTab === 'bucket' && !bucketLoading && !bucketError && bucketList.length > 0 && (
          <div className="pg-feed-context">
            <p>{bucketList.length} saved to your bucket list</p>
            <button onClick={event => openBucketList('list', event)}>Manage list <Pencil size={14} aria-hidden="true" /></button>
          </div>
        )}
        {feedTab === 'nearby' && (
          <p className="pg-feed-hint"><MapPin size={14} aria-hidden="true" />{userLocation ? 'Showing posts within 80 km of your location' : 'Allow location access to see posts near you.'}</p>
        )}
        {feedTab === 'friends' && followingEmails.length === 0 && (
          <p className="pg-feed-hint">Follow people from your <Link to="/me">profile</Link> to see their posts here.</p>
        )}
      </div>

      {feedTab !== 'bucket' && bucketNeedsSetup && <BucketListIntro compact onAdd={event => openBucketList('search', event)} />}

      {!(feedTab === 'bucket' && bucketNeedsSetup) && <details className="pg-feed-filter-menu">
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
      </details>}

      {/* Feed */}
      <div className="pg-feed">
        {postedAt > 0 && <p className="pg-post-shared" role="status"><Check size={16} aria-hidden="true" /> Post shared.</p>}
        {feedTab === 'bucket' && bucketNeedsSetup ? (
          <BucketListIntro onAdd={event => openBucketList('search', event)} />
        ) : feedTab === 'bucket' && bucketError ? (
          <div className="pg-state pg-community-state"><AlertCircle size={30} aria-hidden="true" /><h2>Couldn’t load your bucket list</h2><p>Your saved favorites are still yours. Try loading them again.</p><button className="pg-bucket-primary" onClick={() => loadBucketList(user.email)}>Try again</button></div>
        ) : loadError && !authLoading ? (
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
        ) : (loading || authLoading || (feedTab === 'bucket' && bucketLoading)) ? (
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
              {feedTab === 'bucket' ? 'Posts about your saved artists, teams and venues will show up here. Add more favorites to find more conversations.' :
               feedTab === 'nearby' ? 'Allow location access or try another area' :
               feedTab === 'friends' ? 'Follow fans from your profile to see their posts here' :
               'Be the first to share a moment from an event.'}
            </p>
            {feedTab === 'bucket' ? (
              <button onClick={event => openBucketList('search', event)} className="pg-bucket-primary"><Plus size={17} aria-hidden="true" /> Add artists, teams & venues</button>
            ) : feedTab !== 'friends' && (
              <button
                onClick={() => user?.email ? setFab('post') : base44.auth.redirectToLogin()}
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

      {isTabActive && fab === 'post' && <FanPostComposer
        user={user}
        events={events}
        eventsLoading={eventsLoading}
        eventsError={eventsError}
        onReloadEvents={loadEvents}
        triggerRef={createPostButton}
        onClose={() => setFab(null)}
        onPosted={handlePosted}
      />}
      {createPortal(<div className="pg-community-overlays">
      {/* Sort bottom sheet */}
      {sortSheetOpen && (
        <div className="fixed inset-0 z-50 flex flex-col justify-end">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setSortSheetOpen(false)} />
          <div className="pg-fan-sort-sheet pg-detail-surface relative z-10 px-5 pt-5 overflow-y-auto"
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

      </div>, document.body)}
      {isTabActive && showBucketList && <BucketListSheet user={user} initialTab={showBucketList} initialItems={bucketList} triggerRef={bucketTrigger} onChange={setBucketList} onClose={() => setShowBucketList(null)} />}
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
