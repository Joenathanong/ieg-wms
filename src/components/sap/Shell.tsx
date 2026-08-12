'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useState } from 'react';
import {
  PanelLeft,
  Home,
  ArrowLeft,
  LogOut,
  UserRound,
  HelpCircle,
  RefreshCw,
} from 'lucide-react';
import { CommandField } from './CommandField';
import { Sidebar } from './Sidebar';
import { StatusBar, StatusProvider, useStatus } from './StatusBar';
import { tcodeByPath } from '@/lib/tcodes';
import type { SessionPayload } from '@/lib/session';

function TopBar({ user, onToggle }: { user: SessionPayload; onToggle: () => void }) {
  const router = useRouter();
  const pathname = usePathname();
  const tcode = tcodeByPath(pathname);
  const { setStatus } = useStatus();

  return (
    <header className="shrink-0 bg-sap-sysbar border-b border-sap-border">
      {/* Baris 1 — Command field & identitas sistem */}
      <div className="flex items-center gap-2 h-[34px] px-2">
        <button
          type="button"
          onClick={onToggle}
          title="Toggle navigation"
          className="sap-btn sap-btn-ghost !px-1.5 !py-1"
        >
          <PanelLeft size={14} />
        </button>

        <CommandField role={user.role} pdt={user.pdt} />

        <div className="flex items-center gap-1 ml-1">
          <button
            type="button"
            title="Back (F3)"
            onClick={() => router.back()}
            className="sap-btn sap-btn-ghost !px-1.5 !py-1"
          >
            <ArrowLeft size={14} />
          </button>
          <Link href="/" title="SAP Easy Access" className="sap-btn sap-btn-ghost !px-1.5 !py-1">
            <Home size={14} />
          </Link>
          <button
            type="button"
            title="Refresh"
            onClick={() => {
              router.refresh();
              setStatus('Screen refreshed', 'I');
            }}
            className="sap-btn sap-btn-ghost !px-1.5 !py-1"
          >
            <RefreshCw size={14} />
          </button>
        </div>

        <div className="ml-auto flex items-center gap-3">
          <span className="hidden lg:flex items-center gap-1.5 text-2xs text-sap-muted font-mono">
            <UserRound size={13} className="text-sap-blue" />
            {user.username}
            <span className="px-1.5 py-[1px] rounded-[2px] border border-sap-border text-[10px]">
              {user.role}
            </span>
            {user.pdt && (
              <span className="px-1.5 py-[1px] rounded-[2px] border border-sap-blue/60 text-sap-blue text-[10px]">
                PDT
              </span>
            )}
          </span>
          <Link href="/help" title="Help" className="sap-btn sap-btn-ghost !px-1.5 !py-1">
            <HelpCircle size={14} />
          </Link>
          <a href="/api/auth/logout" title="Log off" className="sap-btn sap-btn-ghost !px-1.5 !py-1">
            <LogOut size={14} />
          </a>
        </div>
      </div>

      {/* Baris 2 — Judul transaksi aktif */}
      <div className="flex items-center gap-2 h-[28px] px-3 bg-[#1F242E] border-t border-sap-border">
        <span className="font-mono text-2xs text-sap-blue">{tcode?.code ?? 'SESSION_MANAGER'}</span>
        <span className="text-sap-border">|</span>
        <span className="text-2xs text-sap-text truncate">{tcode?.title ?? 'SAP Easy Access'}</span>
        <span className="ml-auto text-xxs text-sap-muted font-mono hidden md:inline">
          WMS Lightweight — S/4HANA Style
        </span>
      </div>
    </header>
  );
}

export function Shell({ user, children }: { user: SessionPayload; children: React.ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  const [hidden, setHidden] = useState(false);
  const pathname = usePathname();

  // Layar PDT: sembunyikan sidebar agar area kerja penuh di perangkat genggam.
  const isPdt = pathname.startsWith('/zrf');

  return (
    <StatusProvider>
      <div className="flex flex-col h-screen w-screen overflow-hidden bg-sap-bg">
        <TopBar user={user} onToggle={() => (isPdt ? setHidden((h) => !h) : setCollapsed((c) => !c))} />
        <div className="flex flex-1 min-h-0">
          {(!isPdt || hidden) && <Sidebar role={user.role} pdt={user.pdt} collapsed={collapsed} />}
          <main className="flex-1 min-w-0 overflow-auto p-3">{children}</main>
        </div>
        <StatusBar />
      </div>
    </StatusProvider>
  );
}
