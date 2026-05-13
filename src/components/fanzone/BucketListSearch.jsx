import { useState, useEffect, useRef } from 'react';
import { base44 } from '@/api/base44Client';
import { Search, X, Plus, Check } from 'lucide-react';

export default function BucketListSearch({ following, onFollow }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState({ attractions: [], venues: [] });
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef(null);
  const followedIds = new Set(following.map(f => f.tm_id));

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) { setResults({ attractions: [], venues: [] }); return; }
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await base44.functions.invoke('tmSuggest', { keyword: q });
        setResults(res?.data || { attractions: [], venues: [] });
      } catch {
        setResults({ attractions: [], venues: [] });
      } finally {
        setLoading(false);
      }
    }, 350);
    return () => clearTimeout(debounceRef.current);
  }, [query]);

  const all = [...(results.attractions || []), ...(results.venues || [])];

  return (
    <div className="space-y-3">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <input
          type="text"
          autoFocus
          placeholder="Search artists, teams, venues, bands…"
          value={query}
          onChange={e => setQuery(e.target.value)}
          className="w-full pl-9 pr-8 py-3 rounded-2xl text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
          style={{ background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.12)' }}
        />
        {loading && (
          <span className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        )}
        {!loading && query && (
          <button onClick={() => setQuery('')} className="absolute right-3 top-1/2 -translate-y-1/2">
            <X className="w-4 h-4 text-muted-foreground" />
          </button>
        )}
      </div>

      {all.length > 0 && (
        <div className="space-y-2">
          {results.attractions?.length > 0 && (
            <p className="text-[10px] font-black tracking-widest uppercase px-1" style={{ color: '#FF99CC' }}>
              Artists / Teams
            </p>
          )}
          {results.attractions?.map(item => (
            <SuggestRow key={item.tm_id} item={item} followed={followedIds.has(item.tm_id)} onFollow={onFollow} />
          ))}
          {results.venues?.length > 0 && (
            <p className="text-[10px] font-black tracking-widest uppercase px-1 mt-3" style={{ color: '#66FFFF' }}>
              Venues
            </p>
          )}
          {results.venues?.map(item => (
            <SuggestRow key={item.tm_id} item={item} followed={followedIds.has(item.tm_id)} onFollow={onFollow} />
          ))}
        </div>
      )}

      {query.length >= 2 && !loading && all.length === 0 && (
        <p className="text-sm text-muted-foreground text-center py-6">No results found for "{query}"</p>
      )}

      {query.length < 2 && (
        <p className="text-xs text-muted-foreground text-center py-4 opacity-60">Type at least 2 characters to search</p>
      )}
    </div>
  );
}

function SuggestRow({ item, followed, onFollow }) {
  const isVenue = item.type === 'venue';
  return (
    <div className="flex items-center gap-3 px-3 py-2.5 rounded-2xl"
      style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)' }}>
      {item.image_url
        ? <img src={item.image_url} alt="" className="w-10 h-10 rounded-xl object-cover flex-shrink-0" />
        : <div className="w-10 h-10 rounded-xl flex items-center justify-center text-lg flex-shrink-0"
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
        onClick={() => onFollow(item)}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl font-bold text-xs flex-shrink-0 transition-all"
        style={followed
          ? { background: 'rgba(0,255,135,0.15)', color: '#00FF87', border: '1px solid rgba(0,255,135,0.3)' }
          : { background: 'rgba(191,95,255,0.15)', color: '#BF5FFF', border: '1px solid rgba(191,95,255,0.3)' }
        }
      >
        {followed ? <><Check className="w-3.5 h-3.5" /> Following</> : <><Plus className="w-3.5 h-3.5" /> Follow</>}
      </button>
    </div>
  );
}