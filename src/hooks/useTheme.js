import { useState, useEffect, useCallback } from 'react';

/**
 * Theme hook with automatic dark mode detection via prefers-color-scheme.
 *
 * Priority:
 *   1. localStorage override ('pg_theme' = 'dark' | 'light') — user's explicit choice
 *   2. System preference via matchMedia('(prefers-color-scheme: dark)') — auto
 *
 * When no localStorage override exists, the hook listens for live system
 * preference changes (e.g. user switches OS dark/light mode at sunset) and
 * applies them in real time. toggleTheme sets a localStorage override that
 * takes precedence over the system preference.
 */
export function useTheme() {
  const [theme, setTheme] = useState('dark');       // resolved: 'dark' | 'light'
  const [pref, setPref] = useState('system');       // user pref: 'system' | 'dark' | 'light'
  const [mounted, setMounted] = useState(false);

  const applyTheme = useCallback((newTheme) => {
    if (newTheme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, []);

  const resolveSystemTheme = useCallback(() => {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }, []);

  // Initialise on mount — localStorage override > system preference
  useEffect(() => {
    const saved = localStorage.getItem('pg_theme');
    if (saved === 'dark' || saved === 'light') {
      setPref(saved);
      setTheme(saved);
      applyTheme(saved);
    } else {
      setPref('system');
      const resolved = resolveSystemTheme();
      setTheme(resolved);
      applyTheme(resolved);
    }
    setMounted(true);
  }, [applyTheme, resolveSystemTheme]);

  // Listen for live system preference changes (only when no explicit override)
  useEffect(() => {
    if (pref !== 'system') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = (e) => {
      const resolved = e.matches ? 'dark' : 'light';
      setTheme(resolved);
      applyTheme(resolved);
    };
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, [pref, applyTheme]);

  // User toggle — sets an explicit localStorage override
  const toggleTheme = useCallback(() => {
    const newTheme = theme === 'dark' ? 'light' : 'dark';
    setTheme(newTheme);
    setPref(newTheme);
    localStorage.setItem('pg_theme', newTheme);
    applyTheme(newTheme);
  }, [theme, applyTheme]);

  // Reset to system preference (clears localStorage override)
  const resetToSystem = useCallback(() => {
    localStorage.removeItem('pg_theme');
    setPref('system');
    const resolved = resolveSystemTheme();
    setTheme(resolved);
    applyTheme(resolved);
  }, [applyTheme, resolveSystemTheme]);

  return { theme, toggleTheme, mounted, pref, resetToSystem };
}