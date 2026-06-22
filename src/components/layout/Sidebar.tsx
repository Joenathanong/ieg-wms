'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard, FileText, Package, Scan,
  Database, Users, Settings, LogOut, X, Warehouse,
} from 'lucide-react';
import { cn } from '@/lib/utils/cn';
import type { UserRole } from '@/types';

interface NavItem {
  href: string;
  label: string;
  icon: React.ReactNode;
  roles: UserRole[];
}

const NAV: NavItem[] = [
  { href: '/dashboard',    label: 'Dashboard',        icon: <LayoutDashboard size={18} />, roles: ['admin','supervisor','operator_inbound'] },
  { href: '/open-po',      label: 'Open PO',          icon: <FileText size={18} />,        roles: ['admin','supervisor','operator_inbound'] },
  { href: '/stock',        label: 'Stock Monitor',    icon: <Package size={18} />,         roles: ['admin','supervisor'] },
  { href: '/receiving',    label: 'PDA Receiving',    icon: <Scan size={18} />,            roles: ['admin','supervisor','operator_inbound'] },
  { href: '/master-items', label: 'Master Item',      icon: <Database size={18} />,        roles: ['admin'] },
  { href: '/users',        label: 'User Management',  icon: <Users size={18} />,           roles: ['admin'] },
  { href: '/settings',     label: 'Settings',         icon: <Settings size={18} />,        roles: ['admin'] },
];

interface SidebarProps {
  role: UserRole;
  onClose?: () => void;
  onLogout: () => void;
}

export function Sidebar({ role, onClose, onLogout }: SidebarProps) {
  const path = usePathname();

  return (
    <aside className="flex flex-col h-full w-64 bg-[rgb(var(--surface))] border-r border-[rgb(var(--border))]">
      {/* Logo / close */}
      <div className="flex items-center justify-between px-4 py-4 border-b border-[rgb(var(--border))]">
        <div className="flex items-center gap-2">
          <Warehouse size={22} className="text-brand-600" />
          <span className="font-bold text-sm text-[rgb(var(--text))]">WMS IEG</span>
        </div>
        {onClose && (
          <button onClick={onClose} className="lg:hidden text-muted hover:text-[rgb(var(--text))]">
            <X size={18} />
          </button>
        )}
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
        {NAV.filter((n) => n.roles.includes(role)).map((item) => {
          const active = path.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={onClose}
              className={cn(
                'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors',
                active
                  ? 'bg-brand-600 text-white'
                  : 'text-[rgb(var(--text))] hover:bg-slate-100 dark:hover:bg-slate-700/50'
              )}
            >
              {item.icon}
              {item.label}
            </Link>
          );
        })}
      </nav>

      {/* Logout */}
      <div className="p-3 border-t border-[rgb(var(--border))]">
        <button
          onClick={onLogout}
          className="flex items-center gap-3 w-full px-3 py-2.5 rounded-lg text-sm font-medium text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
        >
          <LogOut size={18} />
          Logout
        </button>
      </div>
    </aside>
  );
}
