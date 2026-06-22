'use client';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Menu } from 'lucide-react';
import { Sidebar } from './Sidebar';
import { ThemeToggle } from '@/components/ui/ThemeToggle';
import { useAuth } from '@/hooks/useAuth';
import type { UserRole } from '@/types';

export function AppShell({ children }: { children: React.ReactNode }) {
  const { appUser, loading, logout } = useAuth();
  const router = useRouter();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  useEffect(() => {
    if (!loading && !appUser) router.replace('/login');
  }, [loading, appUser, router]);

  // Shift auto-logout
  useEffect(() => {
    if (!appUser) return;
    const check = () => {
      const now = new Date();
      const hhmm = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
      // Fetch shift config from localStorage cache (set during login)
      const raw = localStorage.getItem('shift_logout_times');
      if (!raw) return;
      const times: string[] = JSON.parse(raw);
      if (times.includes(hhmm) && appUser.role === 'operator_inbound') {
        logout().then(() => router.replace('/login?reason=shift_change'));
      }
    };
    const interval = setInterval(check, 60_000);
    return () => clearInterval(interval);
  }, [appUser, logout, router]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-[rgb(var(--bg))]">
        <div className="animate-spin rounded-full h-8 w-8 border-2 border-brand-600 border-t-transparent" />
      </div>
    );
  }

  if (!appUser) return null;

  return (
    <div className="flex h-screen overflow-hidden bg-[rgb(var(--bg))]">
      {/* Desktop sidebar */}
      <div className="hidden lg:flex flex-shrink-0">
        <Sidebar role={appUser.role as UserRole} onLogout={logout} />
      </div>

      {/* Mobile sidebar overlay */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={() => setSidebarOpen(false)} />
          <div className="absolute left-0 top-0 h-full z-10">
            <Sidebar role={appUser.role as UserRole} onClose={() => setSidebarOpen(false)} onLogout={logout} />
          </div>
        </div>
      )}

      {/* Main */}
      <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
        {/* Top header */}
        <header className="flex items-center justify-between px-4 py-3 border-b border-[rgb(var(--border))] bg-[rgb(var(--surface))] flex-shrink-0">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setSidebarOpen(true)}
              className="lg:hidden p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700"
            >
              <Menu size={20} />
            </button>
            <span className="text-sm font-medium text-muted hidden sm:block">
              {appUser.name} · <span className="capitalize">{appUser.role.replace('_', ' ')}</span>
            </span>
          </div>
          <ThemeToggle />
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-y-auto p-4 lg:p-6">
          {children}
        </main>
      </div>
    </div>
  );
}
