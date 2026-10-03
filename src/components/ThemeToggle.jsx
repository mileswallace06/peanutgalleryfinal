import { Moon, Sun } from 'lucide-react';
import { useTheme } from '@/hooks/useTheme';

export default function ThemeToggle() {
  const { theme, toggleTheme, mounted } = useTheme();

  if (!mounted) return null;

  return (
    <button
      onClick={toggleTheme}
      className="pg-theme-toggle w-11 h-11 rounded-xl flex items-center justify-center transition-all font-bold"
      aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
      title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
    >
      {theme === 'dark' ? (
        <Sun className="w-5 h-5" strokeWidth={2.5} />
      ) : (
        <Moon className="w-5 h-5" strokeWidth={2.5} />
      )}
    </button>
  );
}