import { Moon, Sun } from 'lucide-react';
import { useTheme } from '@/hooks/useTheme';

export default function ThemeToggle() {
  const { theme, toggleTheme, mounted } = useTheme();

  if (!mounted) return null;

  return (
    <button
      onClick={toggleTheme}
      className="w-10 h-10 rounded-xl flex items-center justify-center transition-all font-bold"
      style={{
        background: theme === 'dark' 
          ? 'rgba(191,95,255,0.3)' 
          : 'rgba(0,0,0,0.12)',
        color: theme === 'dark' 
          ? '#FF99FF' 
          : '#000',
        border: theme === 'dark'
          ? '1.5px solid rgba(191,95,255,0.6)'
          : '1.5px solid rgba(0,0,0,0.3)',
        boxShadow: theme === 'dark'
          ? '0 0 16px rgba(191,95,255,0.25)'
          : '0 0 12px rgba(0,0,0,0.1)'
      }}
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