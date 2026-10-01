import { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Search, X, Plus, Check, Loader2, MapPin, Mic2 } from 'lucide-react';

export default function BucketListSearch({ following, onFollow, pending }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState({ attractions: [], venues: [] });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const followedIds = new Set(following.map(item => `${item.type}:${item.tm_id}`));

  useEffect(() => {
    let active = true;
    const keyword = query.trim();
    setResults({ attractions: [], venues: [] });
    setError(false);
    setLoading(keyword.length >= 2);
    if (keyword.length < 2) return;
    const timer = setTimeout(async () => {
      try {
        const result = await base44.functions.invoke('tmSuggest', { keyword });
        if (result?.data?.error) throw new Error('Search unavailable');
        if (active) setResults({ attractions: Array.isArray(result?.data?.attractions) ? result.data.attractions : [], venues: Array.isArray(result?.data?.venues) ? result.data.venues : [] });
      } catch { if (active) setError(true); }
      finally { if (active) setLoading(false); }
    }, 350);
    return () => { active = false; clearTimeout(timer); };
  }, [query, attempt]);

  const count = results.attractions.length + results.venues.length;
  return <div>
    <label className="pg-bucket-search-field">
      <Search size={17} aria-hidden="true" />
      <input type="search" aria-label="Search artists, teams and venues" placeholder="Search artists, teams or venues" value={query} onChange={event => setQuery(event.target.value)} autoComplete="off" />
      {loading ? <span className="pg-bucket-search-spinner"><Loader2 size={17} className="animate-spin" aria-label="Searching" /></span> : query ? <button type="button" aria-label="Clear search" onClick={() => setQuery('')}><X size={17} /></button> : <span className="w-3" />}
    </label>
    <p className="pg-bucket-note pg-bucket-search-intro">One favorite is all it takes to start. Add a musician, a team, or a venue you want to experience.</p>
    {error ? <div className="pg-bucket-problem"><p role="alert">Search is unavailable right now.</p><button type="button" onClick={() => setAttempt(value => value + 1)}>Try again</button></div> : <>
      {[{ label: 'Artists & teams', items: results.attractions }, { label: 'Venues', items: results.venues }].map(group => !!group.items.length && <section className="pg-bucket-group" key={group.label}>
        <h3>{group.label}</h3>
        {group.items.map(item => {
          const key = `${item.type}:${item.tm_id}`;
          const followed = followedIds.has(key);
          return <div className="pg-bucket-item" key={key}>
            {item.image_url ? <img src={item.image_url} alt="" className="pg-bucket-item-image" /> : <span className="pg-bucket-item-image">{item.type === 'venue' ? <MapPin size={19} /> : <Mic2 size={19} />}</span>}
            <span className="pg-bucket-item-copy"><strong>{item.name}</strong><small>{item.genre || (item.type === 'venue' ? 'Venue' : 'Artist / team')}</small></span>
            <button type="button" onClick={() => onFollow(item)} disabled={followed || !!pending} aria-label={followed ? `${item.name} is on your bucket list` : `Add ${item.name} to bucket list`} className={`pg-bucket-item-action${followed ? ' is-added' : ''}`}>
              {pending === key ? <Loader2 size={15} className="animate-spin" /> : followed ? <Check size={15} /> : <Plus size={15} />} {pending === key ? 'Saving' : followed ? 'Added' : 'Add'}
            </button>
          </div>;
        })}
      </section>)}
      {!loading && query.trim().length >= 2 && !count && <p className="pg-bucket-search-empty" role="status">No matches for “{query.trim()}”. Try the full artist, team or venue name.</p>}
      {query.trim().length < 2 && <p className="pg-bucket-search-empty">Type at least 2 characters to find your first favorite.</p>}
    </>}
  </div>;
}
