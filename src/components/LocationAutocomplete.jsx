import { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { MapPin, LocateFixed, Loader2, Clock } from 'lucide-react';
import { base44 } from '@/api/base44Client';

const RECENT_KEY = 'pg_recent_cities';
const MAX_RECENT = 5;

function getRecentCities() {
  try { return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]'); } catch { return []; }
}

function saveRecentCity(suggestion) {
  try {
    const existing = getRecentCities().filter(c => c.label !== suggestion.label);
    localStorage.setItem(RECENT_KEY, JSON.stringify([suggestion, ...existing].slice(0, MAX_RECENT)));
  } catch { /* ignore */ }
}

/** Highlights the matching prefix/substring in bold */
function HighlightMatch({ text, query }) {
  if (!query) return <span>{text}</span>;
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return <span>{text}</span>;
  return (
    <span>
      {text.slice(0, idx)}
      <span className="font-black text-foreground">{text.slice(idx, idx + query.length)}</span>
      {text.slice(idx + query.length)}
    </span>
  );
}

/**
 * City autocomplete input with:
 * - Arrow key navigation + Enter selection
 * - Highlighted match text
 * - Loading spinner
 * - Recent cities (localStorage)
 * - Max-height scrollable dropdown via portal
 * - Tap/click outside closes
 * - Scroll/resize tracking keeps dropdown attached
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
  const [activeIndex, setActiveIndex] = useState(-1);
  const [dropdownRect, setDropdownRect] = useState(null);
  const [showRecent, setShowRecent] = useState(false);

  const debounceRef = useRef(null);
  const inputRef = useRef(null);
  const inputWrapRef = useRef(null);
  const listRef = useRef(null);

  useEffect(() => {
    if (autoFocus) setTimeout(() => inputRef.current?.focus(), 50);
  }, [autoFocus]);

  // Close on outside click/touch
  useEffect(() => {
    const handler = (e) => {
      if (inputWrapRef.current && !inputWrapRef.current.contains(e.target)) {
        // also check portal dropdown
        const portal = document.getElementById('pg-city-dropdown');
        if (portal && portal.contains(e.target)) return;
        closeDropdown();
      }
    };
    document.addEventListener('mousedown', handler);
    document.addEventListener('touchstart', handler, { passive: true });
    return () => {
      document.removeEventListener('mousedown', handler);
      document.removeEventListener('touchstart', handler);
    };
  }, []);

  // Recompute dropdown anchor on scroll/resize
  const updateRect = useCallback(() => {
    if (inputWrapRef.current) {
      setDropdownRect(inputWrapRef.current.getBoundingClientRect());
    }
  }, []);

  useEffect(() => {
    if (!open && !showRecent) return;
    updateRect();
    window.addEventListener('scroll', updateRect, true);
    window.addEventListener('resize', updateRect);
    return () => {
      window.removeEventListener('scroll', updateRect, true);
      window.removeEventListener('resize', updateRect);
    };
  }, [open, showRecent, updateRect]);

  // Scroll active item into view
  useEffect(() => {
    if (activeIndex >= 0 && listRef.current) {
      const item = listRef.current.children[activeIndex];
      item?.scrollIntoView({ block: 'nearest' });
    }
  }, [activeIndex]);

  const closeDropdown = () => {
    setOpen(false);
    setShowRecent(false);
    setActiveIndex(-1);
  };

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
      setActiveIndex(-1);
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
    setShowRecent(false);
    setActiveIndex(-1);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => fetchSuggestions(val.trim()), 300);
  };

  const handleSelect = (suggestion) => {
    saveRecentCity(suggestion);
    closeDropdown();
    setSuggestions([]);
    onChange(suggestion.label);
    onSelect(suggestion);
  };

  const handleKeyDown = (e) => {
    const items = open ? suggestions : showRecent ? getRecentCities() : [];
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex(i => Math.min(i + 1, items.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex(i => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (activeIndex >= 0 && items[activeIndex]) {
        handleSelect(items[activeIndex]);
      } else if (value.trim()) {
        closeDropdown();
        onSubmit(value.trim());
      }
    } else if (e.key === 'Escape') {
      closeDropdown();
    }
  };

  const handleFocus = () => {
    updateRect();
    if (suggestions.length > 0) {
      setOpen(true);
    } else if (!value.trim()) {
      const recent = getRecentCities();
      if (recent.length > 0) setShowRecent(true);
    }
  };

  const displayItems = open ? suggestions : showRecent ? getRecentCities() : [];
  const isDropdownVisible = (open || showRecent) && displayItems.length > 0 && dropdownRect;

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
            onFocus={handleFocus}
            className="w-full pl-9 pr-10 py-3 rounded-2xl text-sm font-medium text-foreground placeholder:text-muted-foreground focus:outline-none"
            style={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))' }}
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

      {/* Dropdown via portal */}
      {isDropdownVisible && createPortal(
        <div
          id="pg-city-dropdown"
          ref={listRef}
          style={{
            position: 'fixed',
            top: dropdownRect.bottom + 6,
            left: dropdownRect.left,
            width: dropdownRect.width,
            zIndex: 9999,
            borderRadius: '1rem',
            overflow: 'hidden auto',
            maxHeight: '240px',
            boxShadow: '0 8px 32px rgba(0,0,0,0.35)',
            background: 'hsl(var(--card))',
            border: '1px solid hsl(var(--border))',
          }}
        >
          {showRecent && (
            <div className="px-4 pt-2.5 pb-1 text-[10px] font-black tracking-widest uppercase text-muted-foreground">
              Recent
            </div>
          )}
          {displayItems.map((s, i) => {
            const isActive = i === activeIndex;
            return (
              <button
                key={i}
                type="button"
                onMouseDown={(e) => { e.preventDefault(); handleSelect(s); }}
                onTouchEnd={(e) => { e.preventDefault(); handleSelect(s); }}
                onMouseEnter={() => setActiveIndex(i)}
                className="w-full flex items-center gap-3 px-4 py-3 text-left transition-colors"
                style={{
                  background: isActive ? 'rgba(255,255,255,0.07)' : 'transparent',
                  borderBottom: i < displayItems.length - 1 ? '1px solid hsl(var(--border))' : 'none',
                }}
              >
                {showRecent
                  ? <Clock className="w-3.5 h-3.5 flex-shrink-0 text-muted-foreground" />
                  : <MapPin className="w-3.5 h-3.5 flex-shrink-0 text-muted-foreground" />
                }
                <div className="text-sm text-muted-foreground">
                  <HighlightMatch text={s.city} query={value.trim()} />
                  {s.state && <span className="ml-1 text-xs opacity-60">{s.state}</span>}
                </div>
              </button>
            );
          })}
        </div>,
        document.body
      )}
    </div>
  );
}