import { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { MapPin, LocateFixed, Loader2 } from 'lucide-react';
import { base44 } from '@/api/base44Client';

/**
 * City autocomplete input.
 * Dropdown renders via a portal (fixed position) so it's never clipped by overflow-hidden parents.
 */
export default function LocationAutocomplete({
  value,
  onChange,
  onSelect,
  onSubmit,
  onNearMe,
  nearMeLoading = false,
  placeholder = 'Search city…',
  autoFocus = false,
}) {
  const [suggestions, setSuggestions] = useState([]);
  const [suggestLoading, setSuggestLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [dropdownRect, setDropdownRect] = useState(null);
  const debounceRef = useRef(null);
  const inputRef = useRef(null);
  const inputWrapRef = useRef(null);

  // Auto focus
  useEffect(() => {
    if (autoFocus) {
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [autoFocus]);

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e) => {
      if (inputWrapRef.current && !inputWrapRef.current.contains(e.target)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    document.addEventListener('touchstart', handler, { passive: true });
    return () => {
      document.removeEventListener('mousedown', handler);
      document.removeEventListener('touchstart', handler);
    };
  }, []);

  // Recompute dropdown position whenever it opens
  useEffect(() => {
    if (open && inputWrapRef.current) {
      const rect = inputWrapRef.current.getBoundingClientRect();
      setDropdownRect(rect);
    }
  }, [open]);

  const fetchSuggestions = useCallback(async (keyword) => {
    if (keyword.length < 2) {
      setSuggestions([]);
      setOpen(false);
      console.log('[LocationAutocomplete] too short, clearing suggestions');
      return;
    }
    setSuggestLoading(true);
    console.log('[LocationAutocomplete] fetching suggestions for:', keyword);
    try {
      const res = await base44.functions.invoke('suggestCities', { keyword });
      const cities = res?.data?.cities || [];
      console.log('[LocationAutocomplete] suggestions received:', cities.map(c => c.label));
      setSuggestions(cities);
      setOpen(cities.length > 0);
      console.log('[LocationAutocomplete] dropdown open:', cities.length > 0);
    } catch (err) {
      console.error('[LocationAutocomplete] suggestCities error:', err);
      setSuggestions([]);
      setOpen(false);
    } finally {
      setSuggestLoading(false);
    }
  }, []);

  const handleChange = (e) => {
    const val = e.target.value;
    console.log('[LocationAutocomplete] input value:', val);
    onChange(val);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => fetchSuggestions(val.trim()), 400);
  };

  const handleSelect = (suggestion) => {
    console.log('[LocationAutocomplete] selected city:', suggestion.label);
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
    <div ref={inputWrapRef} className="relative flex-1">
      {/* Input row */}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <MapPin className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 pointer-events-none" style={{ color: '#00C8FF' }} />
          <input
            ref={inputRef}
            type="text"
            placeholder={placeholder}
            value={value}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            onFocus={() => {
              if (suggestions.length > 0) {
                const rect = inputWrapRef.current?.getBoundingClientRect();
                if (rect) setDropdownRect(rect);
                setOpen(true);
              }
            }}
            className="w-full pl-9 pr-10 py-3 rounded-2xl text-sm font-medium text-foreground placeholder:text-muted-foreground focus:outline-none"
            style={{
              background: 'hsl(var(--card))',
              border: '1px solid hsl(var(--border))',
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
            title="Near Me"
            className="flex items-center justify-center w-11 h-11 rounded-2xl flex-shrink-0 transition-all active:scale-95 disabled:opacity-60"
            style={{ background: 'rgba(0,200,255,0.12)', border: '1px solid rgba(0,200,255,0.3)', color: '#00C8FF' }}
          >
            {nearMeLoading
              ? <span className="w-4 h-4 border-2 rounded-full animate-spin" style={{ borderColor: '#00C8FF', borderTopColor: 'transparent' }} />
              : <LocateFixed className="w-4 h-4" />
            }
          </button>
        )}
      </div>

      {/* Dropdown — rendered via portal at body level to escape any overflow:hidden parents */}
      {open && suggestions.length > 0 && dropdownRect && createPortal(
        <div
          style={{
            position: 'fixed',
            top: dropdownRect.bottom + 6,
            left: dropdownRect.left,
            width: dropdownRect.width,
            zIndex: 9999,
            borderRadius: '1rem',
            overflow: 'hidden',
            boxShadow: '0 8px 32px rgba(0,0,0,0.35)',
            background: 'hsl(var(--card))',
            border: '1px solid hsl(var(--border))',
          }}
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
              <div>
                <span className="text-sm font-semibold text-foreground">{s.city}</span>
                {s.state && <span className="text-xs text-muted-foreground ml-1">{s.state}</span>}
              </div>
            </button>
          ))}
        </div>,
        document.body
      )}
    </div>
  );
}