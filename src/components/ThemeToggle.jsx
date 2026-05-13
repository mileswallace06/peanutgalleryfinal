import { Moon, Sun } from 'lucide-react';
import { useTheme } from '@/hooks/useTheme';

export default function ThemeToggle() {
  const { theme, toggleTheme, mounted } = useTheme();

  if (!mounted) return null;

  return (
    <button
      onClick={toggleTheme}
      className="w-10 h-10 rounded-xl flex items-center justify-center transition-all"
      style={{
        background: theme === 'dark' 
          ? 'rgba(191,95,255,0.12)' 
          : 'rgba(0,0,0,0.05)',
        color: theme === 'dark' 
          ? '#BF5FFF' 
          : '#333',
        border: theme === 'dark'
          ? '1px solid rgba(191,95,255,0.3)'
          : '1px solid rgba(0,0,0,0.1)'
      }}
      title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
    >
      {theme === 'dark' ? (
        <Sun className="w-5 h-5" />
      ) : (
        <Moon className="w-5 h-5" />
      )}
    </button>
  );
}