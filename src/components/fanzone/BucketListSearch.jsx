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
          className="w-full pl-9 pr-8 py-3 rounded-lg text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
          style={{ background: 'var(--pg-surface-raised)', border: '1px solid var(--pg-line)' }}
        />
        {loading && (
          <span className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        )}
        {!loading && query && (
          <button aria-label="Clear search" onClick={() => setQuery('')} className="absolute right-3 top-1/2 -translate-y-1/2">
            <X className="w-4 h-4 text-muted-foreground" />
          </button>
        )}
      </div>

      {all.length > 0 && (
        <div className="space-y-2">
          {results.attractions?.length > 0 && (
            <p className="text-[10px] font-black tracking-widest uppercase px-1" style={{ color: 'var(--neon-pink)' }}>
              Artists / Teams
            </p>
          )}
          {results.attractions?.map(item => (
            <SuggestRow key={item.tm_id} item={item} followed={followedIds.has(item.tm_id)} onFollow={onFollow} />
          ))}
          {results.venues?.length > 0 && (
            <p className="text-[10px] font-black tracking-widest uppercase px-1 mt-3" style={{ color: 'var(--neon-cyan)' }}>
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
    <div className="flex items-center gap-3 px-3 py-2.5 rounded-lg"
      style={{ background: 'var(--pg-surface-raised)', border: '1px solid var(--pg-surface-raised)' }}>
      {item.image_url
        ? <img src={item.image_url} alt="" className="w-10 h-10 rounded-lg object-cover flex-shrink-0" />
        : <div className="w-10 h-10 rounded-lg flex items-center justify-center text-lg flex-shrink-0"
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
        onClick={() => onFollow(item)}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-bold text-xs flex-shrink-0 transition-all"
        style={followed
          ? { background: 'color-mix(in srgb, var(--pg-mint) 15%, transparent)', color: 'var(--neon-green)', border: '1px solid color-mix(in srgb, var(--neon-green) 30%, transparent)' }
          : { background: 'color-mix(in srgb, var(--pg-violet) 15%, transparent)', color: 'var(--neon-purple)', border: '1px solid color-mix(in srgb, var(--neon-purple) 30%, transparent)' }
        }
      >
        {followed ? <><Check className="w-3.5 h-3.5" /> Following</> : <><Plus className="w-3.5 h-3.5" /> Follow</>}
      </button>
    </div>
  );
}