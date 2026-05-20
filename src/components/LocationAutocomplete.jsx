import { useState, useRef, useEffect, useCallback } from 'react';
import { MapPin, LocateFixed, Loader2 } from 'lucide-react';
import { base44 } from '@/api/base44Client';

/**
 * Shared city autocomplete input.
 *
 * Props:
 *   value          – controlled input value
 *   onChange       – called with new string as user types
 *   onSelect       – called with { city, state, label } when suggestion tapped
 *   onSubmit       – called with raw string when Enter pressed or Go tapped
 *   onNearMe       – optional: show a "Near Me" GPS button
 *   nearMeLoading  – show spinner on Near Me button
 *   placeholder    – input placeholder
 *   autoFocus      – boolean
 */
export default function LocationAutocomplete({
  value,
  onChange,
  onSelect,
  onSubmit,
  onNearMe,
  nearMeLoading = false,
  placeholder = 'City, e.g. Phoenix…',
  autoFocus = false,
}) {
  const [suggestions, setSuggestions] = useState([]);
  const [suggestLoading, setSuggestLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const debounceRef = useRef(null);
  const inputRef = useRef(null);
  const containerRef = useRef(null);

  // Auto focus
  useEffect(() => {
    if (autoFocus) inputRef.current?.focus();
  }, [autoFocus]);

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    document.addEventListener('touchstart', handler);
    return () => {
      document.removeEventListener('mousedown', handler);
      document.removeEventListener('touchstart', handler);
    };
  }, []);

  const fetchSuggestions = useCallback(async (keyword) => {
    if (keyword.length < 2) {
      setSuggestions([]);
      setOpen(false);
      return;
    }
    setSuggestLoading(true);
    try {
      const res = await base44.functions.invoke('suggestCities', { keyword });
      const cities = res?.data?.cities || [];
      setSuggestions(cities);
      setOpen(cities.length > 0);
    } catch {
      setSuggestions([]);
      setOpen(false);
    } finally {
      setSuggestLoading(false);
    }
  }, []);

  const handleChange = (e) => {
    const val = e.target.value;
    onChange(val);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => fetchSuggestions(val.trim()), 350);
  };

  const handleSelect = (suggestion) => {
    setOpen(false);
    setSuggestions([]);
    onChange(suggestion.label);
    onSelect(suggestion);
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      setOpen(false);
      if (value.trim()) onSubmit(value.trim());
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  };

  return (
    <div ref={containerRef} className="relative flex-1">
      {/* Input row */}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <MapPin className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 pointer-events-none" style={{ color: '#00FF87' }} />
          <input
            ref={inputRef}
            type="text"
            placeholder={placeholder}
            value={value}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            onFocus={() => suggestions.length > 0 && setOpen(true)}
            className="w-full pl-9 pr-3 py-3 rounded-2xl text-sm font-medium text-foreground placeholder:text-muted-foreground focus:outline-none"
            style={{
              background: 'hsl(var(--card))',
              border: '1px solid rgba(0,255,135,0.35)',
              boxShadow: '0 0 0 3px rgba(0,255,135,0.08)',
            }}
          />
          {suggestLoading && (
            <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 animate-spin text-muted-foreground" />
          )}
        </div>

        {onNearMe && (
          <button
            type="button"
            onClick={onNearMe}
            disabled={nearMeLoading}
            title="Use my location"
            className="flex items-center justify-center w-11 h-11 rounded-2xl flex-shrink-0 transition-all active:scale-95 disabled:opacity-60"
            style={{ background: 'rgba(0,200,255,0.12)', border: '1px solid rgba(0,200,255,0.3)', color: '#00C8FF' }}
          >
            {nearMeLoading
              ? <span className="w-4 h-4 border-2 rounded-full animate-spin" style={{ borderColor: '#00C8FF', borderTopColor: 'transparent' }} />
              : <LocateFixed className="w-4 h-4" />
            }
          </button>
        )}

        <button
          type="button"
          onClick={() => { setOpen(false); if (value.trim()) onSubmit(value.trim()); }}
          className="px-4 py-3 rounded-2xl font-black text-sm flex-shrink-0 transition-all active:scale-95"
          style={{ background: 'linear-gradient(135deg, #00FF87, #00C8FF)', color: '#0a0510' }}
        >
          Go
        </button>
      </div>

      {/* Suggestions dropdown */}
      {open && suggestions.length > 0 && (
        <div
          className="absolute top-full left-0 right-0 mt-1.5 rounded-2xl overflow-hidden z-50 shadow-xl"
          style={{ background: 'hsl(var(--card))', border: '1px solid rgba(0,255,135,0.25)' }}
        >
          {suggestions.map((s, i) => (
            <button
              key={i}
              type="button"
              onMouseDown={(e) => { e.preventDefault(); handleSelect(s); }}
              onTouchEnd={(e) => { e.preventDefault(); handleSelect(s); }}
              className="w-full flex items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-white/5 active:bg-white/10"
              style={{ borderBottom: i < suggestions.length - 1 ? '1px solid hsl(var(--border))' : 'none' }}
            >
              <MapPin className="w-3.5 h-3.5 flex-shrink-0 text-muted-foreground" />
              <span className="text-sm font-medium text-foreground">{s.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}