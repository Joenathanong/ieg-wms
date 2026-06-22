'use client';
import { useTheme } from 'next-themes';
import { Sun, Moon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils/cn';

export function ThemeToggle({ className }: { className?: string }) {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;

  return (
    <button
      onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
      className={cn(
        'flex items-center justify-center w-10 h-10 rounded-lg',
        'bg-[rgb(var(--surface))] border border-[rgb(var(--border))]',
        'hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors',
        className
      )}
      title="Toggle dark/light mode"
    >
      {theme === 'dark'
        ? <Sun size={18} className="text-amber-400" />
        : <Moon size={18} className="text-slate-500" />}
    </button>
  );
}
