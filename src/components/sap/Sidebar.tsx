'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import {
  PackagePlus,
  ArrowLeftRight,
  Layers3,
  ClipboardList,
  BarChart3,
  Boxes,
  Grid3x3,
  FileClock,
  Upload,
  Users,
  ChevronDown,
  Folder,
  ScanBarcode,
  SquareStack,
} from 'lucide-react';

interface Item {
  code: string;
  label: string;
  href: string;
  Icon: typeof Boxes;
  adminOnly?: boolean;
}

const GROUPS: { title: string; items: Item[] }[] = [
  {
    title: 'Transactions',
    items: [
      { code: 'MIGO', label: 'Goods Movement', href: '/migo', Icon: PackagePlus },
      { code: 'LT01', label: 'Transfer Bin (Single)', href: '/lt01', Icon: ArrowLeftRight },
      { code: 'LT10', label: 'Mass Bin Transfer', href: '/lt10', Icon: Layers3 },
      { code: 'LI01N', label: 'Create Phys. Inv. Doc', href: '/li01n', Icon: ScanBarcode },
      { code: 'LI11N', label: 'Enter Count / Post Diff', href: '/li11n', Icon: ClipboardList },
    ],
  },
  {
    title: 'Reports',
    items: [
      { code: 'MB52', label: 'Global Stock (IM)', href: '/mb52', Icon: BarChart3 },
      { code: 'LX02', label: 'Stock per Bin (WM)', href: '/lx02', Icon: Grid3x3 },
      { code: 'MB51', label: 'Material Documents', href: '/mb51', Icon: FileClock },
      { code: 'LS04', label: 'Empty Bin List', href: '/ls04', Icon: SquareStack },
    ],
  },
  {
    title: 'Master Data',
    items: [
      { code: 'MM01', label: 'Material Master', href: '/mm01', Icon: Boxes },
      { code: 'LS01N', label: 'Storage Bin', href: '/ls01n', Icon: Folder },
      { code: 'ZUPLOAD', label: 'Upload Center', href: '/zupload', Icon: Upload },
    ],
  },
  {
    title: 'Administration',
    items: [{ code: 'SU01', label: 'User Maintenance', href: '/su01', Icon: Users, adminOnly: true }],
  },
];

export function Sidebar({ role, collapsed }: { role: string; collapsed: boolean }) {
  const pathname = usePathname();
  const [closed, setClosed] = useState<Record<string, boolean>>({});

  return (
    <nav
      className={`shrink-0 border-r border-sap-border bg-[#20242d] overflow-y-auto overflow-x-hidden
                  transition-all duration-150 ${collapsed ? 'w-[46px]' : 'w-[218px]'}`}
    >
      {GROUPS.map((g) => {
        const items = g.items.filter((i) => !i.adminOnly || role === 'ADMIN');
        if (items.length === 0) return null;
        const isClosed = closed[g.title];
        return (
          <div key={g.title} className="py-1">
            {!collapsed && (
              <button
                type="button"
                onClick={() => setClosed((c) => ({ ...c, [g.title]: !c[g.title] }))}
                className="w-full flex items-center gap-1 px-3 py-1.5 text-xxs uppercase tracking-[0.12em]
                           text-sap-muted/80 hover:text-sap-text"
              >
                <ChevronDown
                  size={11}
                  className={`transition-transform ${isClosed ? '-rotate-90' : ''}`}
                />
                {g.title}
              </button>
            )}
            {!isClosed && (
              <ul>
                {items.map((it) => {
                  const active = pathname === it.href;
                  return (
                    <li key={it.code}>
                      <Link
                        href={it.href}
                        title={`${it.code} — ${it.label}`}
                        className={`group flex items-center gap-2 px-3 py-[6px] border-l-2 text-2xs
                                    ${
                                      active
                                        ? 'border-sap-blue bg-sap-blue/15 text-sap-text'
                                        : 'border-transparent text-sap-muted hover:bg-white/5 hover:text-sap-text'
                                    }`}
                      >
                        <it.Icon
                          size={14}
                          className={`shrink-0 ${active ? 'text-sap-blue' : 'text-sap-muted group-hover:text-sap-blue'}`}
                        />
                        {!collapsed && (
                          <span className="flex-1 min-w-0 truncate">
                            <span className="font-mono text-[10px] text-sap-blue/80 mr-1.5">
                              {it.code}
                            </span>
                            {it.label}
                          </span>
                        )}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        );
      })}
    </nav>
  );
}
