'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import {
  PanelLeft,
  Home,
  ArrowLeft,
  LogOut,
  UserRound,
  HelpCircle,
  RefreshCw,
  X,
} from 'lucide-react';
import { CommandField } from './CommandField';
import { DbStatus } from '@/components/sap/DbStatus';
import { Sidebar } from './Sidebar';
import { StatusBar, StatusProvider, useStatus } from './StatusBar';
import { ThemeToggle } from './ThemeToggle';
import { useTableKeyNav } from './keynav';
import { tcodeByPath } from '@/lib/tcodes';
import { IS_PROD_SYSTEM, SAP_CLIENT, SAP_SYSTEM, SYSTEM_TITLE } from '@/lib/system';
import type { SessionPayload } from '@/lib/session';

function TopBar({ user, onToggle }: { user: SessionPayload; onToggle: () => void }) {
  const router = useRouter();
  const pathname = usePathname();
  const tcode = tcodeByPath(pathname);
  const { setStatus } = useStatus();

  return (
    <header className="shrink-0 bg-sap-sysbar border-b border-sap-border">
      {/* Baris 1 — Command field & identitas sistem */}
      <div className="flex items-center gap-1 sm:gap-2 h-[38px] sm:h-[34px] px-1.5 sm:px-2">
        <button
          type="button"
          onClick={onToggle}
          title="Toggle navigation"
          aria-label="Toggle navigation"
          className="sap-btn sap-btn-ghost !px-2 !py-1.5 sm:!px-1.5 sm:!py-1"
        >
          <PanelLeft size={15} />
        </button>

        <CommandField role={user.role} pdt={user.pdt} tcodes={user.tcodes} />

        {/* tombol navigasi — disembunyikan di layar kecil agar tidak berdesakan */}
        <div className="hidden sm:flex items-center gap-1 ml-1">
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

        <div className="ml-auto flex items-center gap-1 sm:gap-2 lg:gap-3">
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
          {/* Indikator koneksi database — sengaja ditaruh persis di sebelah
              identitas user, tempat operator sudah biasa melihat status sesi. */}
          <DbStatus />
          <ThemeToggle className="!px-2 !py-1.5 sm:!px-1.5 sm:!py-1" />
          <Link
            href="/help"
            title="Help"
            className="sap-btn sap-btn-ghost !px-2 !py-1.5 sm:!px-1.5 sm:!py-1 hidden sm:inline-flex"
          >
            <HelpCircle size={14} />
          </Link>
          <a
            href="/api/auth/logout"
            title="Log off"
            className="sap-btn sap-btn-ghost !px-2 !py-1.5 sm:!px-1.5 sm:!py-1"
          >
            <LogOut size={14} />
          </a>
        </div>
      </div>

      {/* Baris 2 — Judul transaksi aktif */}
      <div className="flex items-center gap-2 h-[26px] sm:h-[28px] px-2 sm:px-3 bg-sap-topbar2 border-t border-sap-border">
        <span className="font-mono text-2xs text-sap-blue shrink-0">{tcode?.code ?? 'SESSION_MANAGER'}</span>
        <span className="text-sap-border shrink-0">|</span>
        <span className="text-2xs text-sap-text truncate">{tcode?.title ?? 'SAP Easy Access'}</span>

        {/* Penanda sistem — mencolok bila BUKAN production, agar operator tidak
            salah memposting ke sistem latihan/pengembangan. */}
        {!IS_PROD_SYSTEM && (
          <span
            title={SYSTEM_TITLE}
            className="ml-auto shrink-0 sap-badge border-sap-warnborder bg-sap-warnbg text-sap-warntext"
          >
            {SAP_SYSTEM} · CLNT {SAP_CLIENT}
          </span>
        )}
        <span
          className={`text-xxs text-sap-muted font-mono hidden md:inline shrink-0 ${
            IS_PROD_SYSTEM ? 'ml-auto' : 'ml-2'
          }`}
        >
          WMS Lightweight — S/4HANA Style
        </span>
      </div>
    </header>
  );
}

export function Shell({ user, children }: { user: SessionPayload; children: React.ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileNav, setMobileNav] = useState(false);
  const pathname = usePathname();

  // Panah atas/bawah = pindah baris tabel (bukan menaikkan angka) — berlaku global.
  useTableKeyNav();

  // Layar PDT: area kerja penuh — sidebar hanya muncul bila dipanggil.
  const isPdt = pathname.startsWith('/zrf');

  // tutup drawer setiap kali pindah halaman
  useEffect(() => {
    setMobileNav(false);
  }, [pathname]);

  return (
    <StatusProvider>
      <div className="app-shell w-full bg-sap-bg">
        <TopBar
          user={user}
          onToggle={() => {
            // < md: buka drawer; >= md: lebarkan / kecilkan sidebar
            if (typeof window !== 'undefined' && window.innerWidth < 768) setMobileNav((v) => !v);
            else setCollapsed((c) => !c);
          }}
        />

        <div className="app-body">
          {/* Sidebar inline — hanya layar >= md dan bukan layar PDT.
              Tinggi mengikuti baris isi sehingga tidak pernah menimpa status bar. */}
          {!isPdt && (
            <div className="hidden md:flex h-full min-h-0">
              <Sidebar role={user.role} pdt={user.pdt} tcodes={user.tcodes} collapsed={collapsed} />
            </div>
          )}

          {/* Drawer navigasi untuk layar kecil (dan layar PDT bila dibuka) */}
          {mobileNav && (
            <>
              <button
                type="button"
                aria-label="Tutup navigasi"
                onClick={() => setMobileNav(false)}
                className="absolute inset-0 z-40 bg-black/50 md:bg-black/20"
              />
              <div className="absolute left-0 top-0 bottom-0 z-50 flex shadow-sap">
                <div className="relative flex h-full min-h-0">
                  <button
                    type="button"
                    onClick={() => setMobileNav(false)}
                    aria-label="Tutup navigasi"
                    className="absolute right-1 top-1 z-10 sap-btn sap-btn-ghost !px-1.5 !py-1 md:hidden"
                  >
                    <X size={14} />
                  </button>
                  <Sidebar role={user.role} pdt={user.pdt} tcodes={user.tcodes} collapsed={false} />
                </div>
              </div>
            </>
          )}

          <main className="flex-1 min-w-0 overflow-auto p-2 sm:p-3">{children}</main>
        </div>

        <StatusBar />
      </div>
    </StatusProvider>
  );
}
