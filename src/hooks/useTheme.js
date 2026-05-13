import { useState, useEffect } from 'react';

export function useTheme() {
  const [theme, setTheme] = useState('dark');
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    // Get saved theme or system preference
    const saved = localStorage.getItem('pg_theme');
    if (saved) {
      setTheme(saved);
      applyTheme(saved);
    } else {
      // Check system preference
      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      const detected = prefersDark ? 'dark' : 'light';
      setTheme(detected);
      applyTheme(detected);
    }
    setMounted(true);
  }, []);

  const applyTheme = (newTheme) => {
    if (newTheme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  };

  const toggleTheme = () => {
    const newTheme = theme === 'dark' ? 'light' : 'dark';
    setTheme(newTheme);
    localStorage.setItem('pg_theme', newTheme);
    applyTheme(newTheme);
  };

  return { theme, toggleTheme, mounted };
}