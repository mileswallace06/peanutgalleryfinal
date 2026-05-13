import { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { X, Star, Trash2, Plus } from 'lucide-react';
import BucketListSearch from './BucketListSearch';

export default function BucketListSheet({ user, onClose }) {
  const [following, setFollowing] = useState([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('list'); // 'list' | 'search'

  useEffect(() => {
    if (!user?.email) return;
    base44.entities.BucketListItem.filter({ user_email: user.email })
      .then(setFollowing)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [user]);

  const handleFollow = async (item) => {
    const already = following.find(f => f.tm_id === item.tm_id);
    if (already) return; // already following
    const created = await base44.entities.BucketListItem.create({
      user_email: user.email,
      tm_id: item.tm_id,
      name: item.name,
      type: item.type,
      image_url: item.image_url || null,
      genre: item.genre || null,
    });
    setFollowing(prev => [...prev, created]);
  };

  const handleUnfollow = async (item) => {
    await base44.entities.BucketListItem.delete(item.id);
    setFollowing(prev => prev.filter(f => f.id !== item.id));
  };

  const artists = following.filter(f => f.type === 'attraction');
  const venues = following.filter(f => f.type === 'venue');

  return (
    <div className="relative z-10 rounded-t-3xl flex flex-col"
      style={{
        background: 'hsl(255 12% 9%)',
        border: '1px solid rgba(255,255,255,0.1)',
        maxHeight: '85vh',
      }}>
      {/* Handle */}
      <div className="w-10 h-1 rounded-full mx-auto mt-4 mb-0 flex-shrink-0" style={{ background: 'rgba(255,255,255,0.2)' }} />

      {/* Header */}
      <div className="flex items-center justify-between px-5 pt-4 pb-3 flex-shrink-0">
        <div className="flex items-center gap-2">
          <Star className="w-5 h-5" style={{ color: '#FFE600' }} />
          <h2 className="font-black text-base text-foreground">Bucket List</h2>
          {following.length > 0 && (
            <span className="text-[10px] font-black px-2 py-0.5 rounded-full"
              style={{ background: 'rgba(255,230,0,0.15)', color: '#FFE600', border: '1px solid rgba(255,230,0,0.3)' }}>
              {following.length}
            </span>
          )}
        </div>
        <button onClick={onClose}><X className="w-5 h-5 text-muted-foreground" /></button>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 px-5 pb-3 flex-shrink-0">
        {['list', 'search'].map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className="px-4 py-1.5 rounded-full text-xs font-bold transition-all"
            style={tab === t
              ? { background: 'rgba(255,230,0,0.15)', color: '#FFE600', border: '1px solid rgba(255,230,0,0.35)' }
              : { background: 'rgba(255,255,255,0.05)', color: 'rgba(255,255,255,0.4)', border: '1px solid rgba(255,255,255,0.08)' }
            }
          >
            {t === 'list' ? '⭐ My List' : '+ Add More'}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto px-5 pb-28 min-h-0">
        {tab === 'search' ? (
          <BucketListSearch following={following} onFollow={handleFollow} />
        ) : loading ? (
          <div className="space-y-2 pt-2">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="h-14 rounded-2xl animate-pulse" style={{ background: 'rgba(255,255,255,0.05)' }} />
            ))}
          </div>
        ) : following.length === 0 ? (
          <div className="text-center py-16 space-y-3">
            <p className="text-4xl">⭐</p>
            <p className="font-bold text-foreground">Your bucket list is empty</p>
            <p className="text-sm text-muted-foreground">Follow artists, teams & venues to track posts and get notified about shows near you</p>
            <button
              onClick={() => setTab('search')}
              className="mt-2 flex items-center gap-2 mx-auto px-5 py-2.5 rounded-2xl font-bold text-sm"
              style={{ background: 'rgba(255,230,0,0.15)', color: '#FFE600', border: '1px solid rgba(255,230,0,0.3)' }}
            >
              <Plus className="w-4 h-4" /> Add Artists & Venues
            </button>
          </div>
        ) : (
          <div className="space-y-4 pt-1">
            {artists.length > 0 && (
              <div>
                <p className="text-[10px] font-black tracking-widest uppercase mb-2" style={{ color: '#FF99CC' }}>Artists / Teams</p>
                <div className="space-y-2">
                  {artists.map(item => <FollowingRow key={item.id} item={item} onUnfollow={handleUnfollow} />)}
                </div>
              </div>
            )}
            {venues.length > 0 && (
              <div>
                <p className="text-[10px] font-black tracking-widest uppercase mb-2" style={{ color: '#66FFFF' }}>Venues</p>
                <div className="space-y-2">
                  {venues.map(item => <FollowingRow key={item.id} item={item} onUnfollow={handleUnfollow} />)}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function FollowingRow({ item, onUnfollow }) {
  const isVenue = item.type === 'venue';
  return (
    <div className="flex items-center gap-3 px-3 py-2.5 rounded-2xl"
      style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)' }}>
      {item.image_url
        ? <img src={item.image_url} alt="" className="w-10 h-10 rounded-xl object-cover flex-shrink-0" />
        : <div className="w-10 h-10 rounded-xl flex items-center justify-center text-xl flex-shrink-0"
            style={{ background: 'rgba(255,255,255,0.06)' }}>{isVenue ? '🏟️' : '🎤'}</div>
      }
      <div className="flex-1 min-w-0">
        <p className="text-sm font-bold text-foreground truncate">{item.name}</p>
        <div className="flex items-center gap-1.5 mt-0.5">
          <span className="text-[9px] font-black px-1.5 py-0.5 rounded-full"
            style={{
              background: isVenue ? 'rgba(102,255,255,0.12)' : 'rgba(255,153,204,0.12)',
              color: isVenue ? '#66FFFF' : '#FF99CC',
              border: `1px solid ${isVenue ? 'rgba(102,255,255,0.25)' : 'rgba(255,153,204,0.25)'}`,
            }}>
            {isVenue ? 'VENUE' : 'ARTIST'}
          </span>
          {item.genre && <span className="text-[10px] text-muted-foreground">{item.genre}</span>}
        </div>
      </div>
      <button
        onClick={() => onUnfollow(item)}
        className="w-8 h-8 flex items-center justify-center rounded-xl transition-all"
        style={{ background: 'rgba(255,45,120,0.1)', color: '#FF2D78', border: '1px solid rgba(255,45,120,0.2)' }}
      >
        <Trash2 className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}