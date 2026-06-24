import { Moon, Sun } from 'lucide-react';
import { useTheme } from '@/hooks/useTheme';

export default function ThemeToggle() {
  const { theme, toggleTheme, mounted } = useTheme();

  if (!mounted) return null;

  return (
    <button
      onClick={toggleTheme}
      className="w-11 h-11 rounded-xl flex items-center justify-center transition-all font-bold"
      style={{
        background: theme === 'dark' 
          ? 'rgba(191,95,255,0.3)' 
          : 'rgba(255,255,255,0.95)',
        color: theme === 'dark' 
          ? '#FF99FF' 
          : '#1a1a1a',
        border: theme === 'dark'
          ? '1.5px solid rgba(191,95,255,0.6)'
          : '1.5px solid rgba(255,255,255,0.8)',
        boxShadow: theme === 'dark'
          ? '0 0 16px rgba(191,95,255,0.25)'
          : '0 0 12px rgba(255,255,255,0.5)'
      }}
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