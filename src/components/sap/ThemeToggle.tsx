'use client';

import { useEffect, useState } from 'react';
import { Moon, Sun } from 'lucide-react';

export const THEME_KEY = 'wms-theme';
export type ThemeName = 'dark' | 'light';

/**
 * Toggle tema Dark (Quartz Dark) <-> Light (SAP Morning Horizon).
 * Preferensi disimpan per browser di localStorage sehingga PDT / desktop
 * masing-masing bisa memakai tema berbeda. Atribut html[data-theme]
 * di-set sebelum paint oleh script inline di app/layout.tsx (anti-flash).
 */
export function ThemeToggle({ className = '' }: { className?: string }) {
  const [theme, setTheme] = useState<ThemeName>('dark');

  useEffect(() => {
    const t = document.documentElement.getAttribute('data-theme');
    setTheme(t === 'light' ? 'light' : 'dark');
  }, []);

  function toggle() {
    const next: ThemeName = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    document.documentElement.setAttribute('data-theme', next);
    try {
      localStorage.setItem(THEME_KEY, next);
    } catch {
      /* private mode — abaikan */
    }
  }

  return (
    <button
      type="button"
      onClick={toggle}
      title={theme === 'dark' ? 'Ganti ke tema terang (SAP Morning Horizon)' : 'Ganti ke tema gelap (Quartz Dark)'}
      className={`sap-btn sap-btn-ghost !px-1.5 !py-1 ${className}`}
    >
      {theme === 'dark' ? <Sun size={14} /> : <Moon size={14} />}
    </button>
  );
}
