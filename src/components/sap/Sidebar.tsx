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
  ListTodo,
  PackageCheck,
  Smartphone,
  Settings,
  ShieldCheck,
  Wallet,
} from 'lucide-react';

interface Item {
  code: string;
  label: string;
  href: string;
  Icon: typeof Boxes;
  adminOnly?: boolean;
  pdtOnly?: boolean;
}

const GROUPS: { title: string; items: Item[] }[] = [
  {
    title: 'Transactions (IM)',
    items: [
      { code: 'MIGO', label: 'Goods Movement', href: '/migo', Icon: PackagePlus },
      { code: 'LI01N', label: 'Create Phys. Inv. Doc', href: '/li01n', Icon: ScanBarcode },
      { code: 'LI11N', label: 'Enter Count / Post Diff', href: '/li11n', Icon: ClipboardList },
      { code: 'ZSO01', label: 'Opname Terkelola', href: '/zso01', Icon: ClipboardList, adminOnly: true },
    ],
  },
  {
    title: 'Warehouse (WM)',
    items: [
      { code: 'LB10', label: 'TR Work Queue', href: '/lb10', Icon: ListTodo },
      { code: 'LB12', label: 'Put-away / Picking', href: '/lb12', Icon: PackageCheck },
      { code: 'LT01', label: 'Transfer Bin (Single)', href: '/lt01', Icon: ArrowLeftRight },
      { code: 'LT10', label: 'Mass Bin Transfer', href: '/lt10', Icon: Layers3 },
      { code: 'ZREPL', label: 'Mass Replenishment', href: '/zrepl', Icon: PackageCheck, adminOnly: true },
    ],
  },
  {
    title: 'Reports',
    items: [
      { code: 'MB52', label: 'Global Stock (IM)', href: '/mb52', Icon: BarChart3 },
      { code: 'LX02', label: 'Stock per Bin (WM)', href: '/lx02', Icon: Grid3x3 },
      { code: 'MB51', label: 'Material Documents', href: '/mb51', Icon: FileClock },
      { code: 'LT22', label: 'Transfer Orders (301)', href: '/lt22', Icon: ArrowLeftRight },
      { code: 'LS04', label: 'Empty Bin List', href: '/ls04', Icon: SquareStack },
    ],
  },
  {
    title: 'Master Data',
    items: [
      { code: 'MM01', label: 'Material & Pallet', href: '/mm01', Icon: Boxes },
      { code: 'LS01N', label: 'Storage Bin', href: '/ls01n', Icon: Folder },
      { code: 'ZZONE', label: 'Zone / Storage Section', href: '/zzone', Icon: Layers3, adminOnly: true },
      { code: 'KS01', label: 'Cost Center', href: '/ks01', Icon: Wallet, adminOnly: true },
      { code: 'ZUPLOAD', label: 'Upload Center', href: '/zupload', Icon: Upload },
    ],
  },
  {
    title: 'PDT Terminal',
    items: [{ code: 'ZRF', label: 'RF Menu (Operator)', href: '/zrf', Icon: Smartphone, pdtOnly: true }],
  },
  {
    title: 'Administration',
    items: [
      { code: 'SU01', label: 'User Maintenance', href: '/su01', Icon: Users, adminOnly: true },
      { code: 'PFCG', label: 'Role T-Code', href: '/pfcg', Icon: ShieldCheck, adminOnly: true },
      { code: 'ZSET', label: 'System Configuration', href: '/zset', Icon: Settings, adminOnly: true },
    ],
  },
];

export function Sidebar({
  role,
  pdt,
  tcodes,
  collapsed,
}: {
  role: string;
  pdt: boolean;
  /** daftar T-Code yang diizinkan role otorisasi (PFCG); null = tidak dibatasi */
  tcodes?: string[] | null;
  collapsed: boolean;
}) {
  const pathname = usePathname();
  const [closed, setClosed] = useState<Record<string, boolean>>({});

  const allowedItem = (i: Item) => {
    if (i.adminOnly && role !== 'ADMIN') return false;
    if (i.pdtOnly && !pdt) return false;
    if (!tcodes || role === 'ADMIN') return true;
    if (tcodes.includes(i.code)) return true;
    if (i.code === 'ZRF') return tcodes.some((c) => c.startsWith('ZRF') && c !== 'ZRF');
    if (i.code === 'MM01') return tcodes.includes('MM02') || tcodes.includes('MM03');
    if (i.code === 'LS01N') return tcodes.includes('LS02N') || tcodes.includes('LS06');
    return false;
  };

  return (
    <nav
      /* h-full + min-h-0 + overflow-y-auto: daftar menu bergulir di dalam sidebar
         sehingga tidak pernah memanjang menimpa status bar di bawah layar.
         pb-2 memberi ruang agar item terakhir tidak menempel garis bawah. */
      className={`shrink-0 h-full min-h-0 border-r border-sap-border bg-sap-nav
                  overflow-y-auto overflow-x-hidden overscroll-contain pb-2
                  transition-[width] duration-150 ${collapsed ? 'w-[46px]' : 'w-[218px]'}`}
    >
      {GROUPS.map((g) => {
        const items = g.items.filter(allowedItem);
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
                  const active = pathname === it.href || pathname.startsWith(it.href + '/');
                  return (
                    <li key={it.code}>
                      <Link
                        href={it.href}
                        title={`${it.code} — ${it.label}`}
                        className={`group flex items-center gap-2 px-3 py-[6px] border-l-2 text-2xs
                                    ${
                                      active
                                        ? 'border-sap-blue bg-sap-blue/15 text-sap-text'
                                        : 'border-transparent text-sap-muted hover:bg-sap-hover hover:text-sap-text'
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
