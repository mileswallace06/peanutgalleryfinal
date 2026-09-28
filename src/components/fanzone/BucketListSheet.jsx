import '@/components/events/detail-ticket.css';
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
    <div className="pg-bucket-sheet pg-detail-surface relative z-10 flex flex-col"
      style={{
        background: 'var(--pg-surface)',
        border: '1px solid var(--pg-line)',
        maxHeight: '85vh',
      }}>
      {/* Handle */}
      <div className="w-10 h-1 rounded-full mx-auto mt-4 mb-0 flex-shrink-0" style={{ background: 'var(--pg-line)' }} />

      {/* Header */}
      <div className="pg-bucket-heading flex items-center justify-between px-5 pt-4 pb-3 flex-shrink-0">
        <div className="flex items-center gap-2">
          <Star className="w-5 h-5" style={{ color: 'var(--neon-yellow)' }} />
          <h2 className="font-black text-base text-foreground">Bucket List</h2>
          {following.length > 0 && (
            <span className="text-[10px] font-black px-2 py-0.5 rounded-full"
              style={{ background: 'color-mix(in srgb, var(--pg-yellow) 15%, transparent)', color: 'var(--neon-yellow)', border: '1px solid color-mix(in srgb, var(--neon-yellow) 30%, transparent)' }}>
              {following.length}
            </span>
          )}
        </div>
        <button onClick={onClose} aria-label="Close bucket list"><X className="w-5 h-5 text-muted-foreground" /></button>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 px-5 pb-3 flex-shrink-0">
        {['list', 'search'].map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className="px-4 py-1.5 rounded-full text-xs font-bold transition-all"
            style={tab === t
              ? { background: 'color-mix(in srgb, var(--pg-yellow) 15%, transparent)', color: 'var(--neon-yellow)', border: '1px solid color-mix(in srgb, var(--neon-yellow) 35%, transparent)' }
              : { background: 'var(--pg-surface-raised)', color: 'var(--pg-muted)', border: '1px solid var(--pg-line)' }
            }
          >
            {t === 'list' ? '⭐ My List' : '+ Add More'}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto px-5 min-h-0" style={{ paddingBottom: 'calc(7rem + env(safe-area-inset-bottom))' }}>
        {tab === 'search' ? (
          <BucketListSearch following={following} onFollow={handleFollow} />
        ) : loading ? (
          <div className="space-y-2 pt-2">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="h-14 rounded-lg animate-pulse" style={{ background: 'var(--pg-surface-raised)' }} />
            ))}
          </div>
        ) : following.length === 0 ? (
          <div className="text-center py-16 space-y-3">
            <p className="text-4xl">⭐</p>
            <p className="font-bold text-foreground">Your bucket list is empty</p>
            <p className="text-sm text-muted-foreground">Follow artists, teams & venues to track posts and get notified about shows near you</p>
            <button
              onClick={() => setTab('search')}
              className="mt-2 flex items-center gap-2 mx-auto px-5 py-2.5 rounded-lg font-bold text-sm"
              style={{ background: 'color-mix(in srgb, var(--pg-yellow) 15%, transparent)', color: 'var(--neon-yellow)', border: '1px solid color-mix(in srgb, var(--neon-yellow) 30%, transparent)' }}
            >
              <Plus className="w-4 h-4" /> Add Artists & Venues
            </button>
          </div>
        ) : (
          <div className="space-y-4 pt-1">
            {artists.length > 0 && (
              <div>
                <p className="text-[10px] font-black tracking-widest uppercase mb-2" style={{ color: 'var(--neon-pink)' }}>Artists / Teams</p>
                <div className="space-y-2">
                  {artists.map(item => <FollowingRow key={item.id} item={item} onUnfollow={handleUnfollow} />)}
                </div>
              </div>
            )}
            {venues.length > 0 && (
              <div>
                <p className="text-[10px] font-black tracking-widest uppercase mb-2" style={{ color: 'var(--neon-cyan)' }}>Venues</p>
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
    <div className="flex items-center gap-3 px-3 py-2.5 rounded-lg"
      style={{ background: 'var(--pg-surface-raised)', border: '1px solid var(--pg-surface-raised)' }}>
      {item.image_url
        ? <img src={item.image_url} alt="" className="w-10 h-10 rounded-lg object-cover flex-shrink-0" />
        : <div className="w-10 h-10 rounded-lg flex items-center justify-center text-xl flex-shrink-0"
            style={{ background: 'var(--pg-surface-raised)' }}>{isVenue ? '🏟️' : '🎤'}</div>
      }
      <div className="flex-1 min-w-0">
        <p className="text-sm font-bold text-foreground truncate">{item.name}</p>
        <div className="flex items-center gap-1.5 mt-0.5">
          <span className="text-[9px] font-black px-1.5 py-0.5 rounded-full"
            style={{
              background: isVenue ? 'color-mix(in srgb, var(--pg-cyan) 12%, transparent)' : 'color-mix(in srgb, var(--pg-pink) 12%, transparent)',
              color: isVenue ? 'var(--neon-cyan)' : 'var(--neon-pink)',
              border: `1px solid ${isVenue ? 'color-mix(in srgb, var(--pg-cyan) 25%, transparent)' : 'color-mix(in srgb, var(--pg-pink) 25%, transparent)'}`,
            }}>
            {isVenue ? 'VENUE' : 'ARTIST'}
          </span>
          {item.genre && <span className="text-[10px] text-muted-foreground">{item.genre}</span>}
        </div>
      </div>
      <button
        aria-label={`Remove ${item.name} from bucket list`}
        onClick={() => onUnfollow(item)}
        className="w-8 h-8 flex items-center justify-center rounded-lg transition-all"
        style={{ background: 'color-mix(in srgb, var(--pg-pink) 10%, transparent)', color: 'var(--neon-pink)', border: '1px solid color-mix(in srgb, var(--neon-pink) 20%, transparent)' }}
      >
        <Trash2 className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}