import { useState, useEffect, useRef } from 'react';
import { base44 } from '@/api/base44Client';
import { Search, X } from 'lucide-react';

export default function TMSearchAutocomplete({ value, onChange, placeholder = 'Artist, team, venue, band…' }) {
  const [suggestions, setSuggestions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const debounceRef = useRef(null);
  const containerRef = useRef(null);

  useEffect(() => {
    const q = value.trim();
    if (q.length < 2) { setSuggestions([]); setOpen(false); return; }

    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await base44.functions.invoke('getTicketmasterEvents', { keyword: q, size: 8 });
        const events = res?.data?.events || [];
        // Deduplicate by title to surface unique artists/teams/venues
        const seen = new Set();
        const items = [];
        for (const e of events) {
          if (!seen.has(e.title)) {
            seen.add(e.title);
            items.push(e);
          }
        }
        setSuggestions(items);
        setOpen(items.length > 0);
      } catch {
        setSuggestions([]);
      } finally {
        setLoading(false);
      }
    }, 350);

    return () => clearTimeout(debounceRef.current);
  }, [value]);

  // Close on outside click
  useEffect(() => {
    const handler = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const pick = (suggestion) => {
    onChange(suggestion);
    setOpen(false);
    setSuggestions([]);
  };

  return (
    <div ref={containerRef} className="relative">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
        <input
          type="text"
          placeholder={placeholder}
          value={value}
          onChange={e => { onChange(e.target.value); }}
          onFocus={() => suggestions.length > 0 && setOpen(true)}
          className="w-full pl-8 pr-8 py-2.5 rounded-xl text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
          style={{ background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.1)' }}
        />
        {loading && (
          <span className="absolute right-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        )}
        {!loading && value && (
          <button
            onClick={() => { onChange(''); setSuggestions([]); setOpen(false); }}
            className="absolute right-3 top-1/2 -translate-y-1/2"
          >
            <X className="w-3.5 h-3.5 text-muted-foreground" />
          </button>
        )}
      </div>

      {open && suggestions.length > 0 && (
        <div
          className="absolute left-0 right-0 mt-1.5 rounded-2xl overflow-hidden z-50 shadow-2xl"
          style={{ background: 'hsl(255 12% 11%)', border: '1px solid rgba(255,255,255,0.12)' }}
        >
          {suggestions.map((s, i) => (
            <button
              key={i}
              onMouseDown={() => pick(s.title)}
              className="w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-white/5 transition-colors"
            >
              {s.image_url
                ? <img src={s.image_url} alt="" className="w-8 h-8 rounded-lg object-cover flex-shrink-0" />
                : <div className="w-8 h-8 rounded-lg flex items-center justify-center text-base flex-shrink-0"
                    style={{ background: 'rgba(255,255,255,0.06)' }}>🎫</div>
              }
              <div className="min-w-0">
                <p className="text-sm font-semibold text-foreground truncate">{s.title}</p>
                <p className="text-[10px] text-muted-foreground truncate">
                  {s.venue}{s.city ? `, ${s.city}` : ''}
                </p>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}