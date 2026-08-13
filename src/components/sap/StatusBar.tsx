'use client';

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import {
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Info,
  Search,
  X,
  Copy,
  Check,
  Trash2,
} from 'lucide-react';
import { copyText, findDocNumbers, shorten } from '@/lib/clipboard';
import { SAP_CLIENT, SAP_SYSTEM, IS_PROD_SYSTEM, SYSTEM_TITLE } from '@/lib/system';

export type MsgType = 'S' | 'E' | 'W' | 'I';

interface StatusMessage {
  text: string;
  type: MsgType;
  at: number;
}

interface StatusCtx {
  message: StatusMessage | null;
  /** riwayat pesan terbaru (maks. 30) — ditampilkan pada popup kaca pembesar */
  history: StatusMessage[];
  setStatus: (text: string, type?: MsgType) => void;
  clearStatus: () => void;
  clearHistory: () => void;
}

const Ctx = createContext<StatusCtx>({
  message: null,
  history: [],
  setStatus: () => {},
  clearStatus: () => {},
  clearHistory: () => {},
});

export function useStatus() {
  return useContext(Ctx);
}

const HISTORY_MAX = 30;

export function StatusProvider({ children }: { children: React.ReactNode }) {
  const [message, setMessage] = useState<StatusMessage | null>(null);
  const [history, setHistory] = useState<StatusMessage[]>([]);

  const setStatus = useCallback((text: string, type: MsgType = 'S') => {
    const msg = { text, type, at: Date.now() };
    setMessage(msg);
    setHistory((h) => {
      // pesan identik beruntun tidak digandakan
      if (h[0] && h[0].text === text && h[0].type === type) return h;
      return [msg, ...h].slice(0, HISTORY_MAX);
    });
  }, []);

  const clearStatus = useCallback(() => setMessage(null), []);
  const clearHistory = useCallback(() => setHistory([]), []);

  const value = useMemo(
    () => ({ message, history, setStatus, clearStatus, clearHistory }),
    [message, history, setStatus, clearStatus, clearHistory]
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

const STYLE: Record<MsgType, { color: string; bg: string; Icon: typeof Info; label: string }> = {
  S: {
    color: 'rgb(var(--sap-oktext-rgb))',
    bg: 'rgb(var(--sap-success-rgb) / 0.14)',
    Icon: CheckCircle2,
    label: 'Success',
  },
  E: {
    color: 'rgb(var(--sap-errtext-rgb))',
    bg: 'rgb(var(--sap-error-rgb) / 0.16)',
    Icon: XCircle,
    label: 'Error',
  },
  W: {
    color: 'rgb(var(--sap-warntext-rgb))',
    bg: 'rgb(var(--sap-warning-rgb) / 0.14)',
    Icon: AlertTriangle,
    label: 'Warning',
  },
  I: {
    color: 'rgb(var(--sap-infotext-rgb))',
    bg: 'rgb(var(--sap-blue-rgb) / 0.14)',
    Icon: Info,
    label: 'Information',
  },
};

function fmtTime(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/** Tombol salin kecil dengan umpan balik centang. */
function CopyBtn({
  value,
  label,
  className = '',
  title,
}: {
  value: string;
  label?: string;
  className?: string;
  title?: string;
}) {
  const [done, setDone] = useState(false);
  useEffect(() => {
    if (!done) return;
    const t = setTimeout(() => setDone(false), 1200);
    return () => clearTimeout(t);
  }, [done]);

  return (
    <button
      type="button"
      title={title ?? 'Salin ke clipboard'}
      onClick={async (e) => {
        e.stopPropagation();
        setDone(await copyText(value));
      }}
      className={`sap-btn !py-[3px] !px-2 ${className}`}
    >
      {done ? <Check size={12} className="text-sap-oktext" /> : <Copy size={12} />}
      {label}
    </button>
  );
}

/** Nomor dokumen — klik ganda menyalin ke clipboard. */
function DocChip({ value, onCopied }: { value: string; onCopied: (ok: boolean) => void }) {
  return (
    <button
      type="button"
      title="Klik ganda untuk menyalin nomor dokumen"
      onDoubleClick={async (e) => {
        e.stopPropagation();
        onCopied(await copyText(value));
      }}
      className="px-1.5 py-[1px] rounded-[2px] border border-sap-border font-mono text-xxs
                 hover:bg-sap-blue/20 select-all"
    >
      {value}
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* POPUP — kaca pembesar                                               */
/* ------------------------------------------------------------------ */

function MessagePopup({
  message,
  history,
  onClose,
  onClear,
}: {
  message: StatusMessage | null;
  history: StatusMessage[];
  onClose: () => void;
  onClear: () => void;
}) {
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(null), 1500);
    return () => clearTimeout(t);
  }, [copied]);

  const s = STYLE[message?.type ?? 'I'];
  const Icon = s.Icon;
  const docs = message ? findDocNumbers(message.text) : [];

  return (
    <div className="fixed inset-0 z-[80] flex items-end sm:items-center justify-center p-2 sm:p-4">
      <button
        type="button"
        aria-label="Tutup"
        onClick={onClose}
        className="absolute inset-0 bg-black/50"
      />

      <div className="relative w-full max-w-[640px] max-h-[85dvh] flex flex-col sap-panel shadow-sap">
        <div className="sap-panel-title">
          <Search size={13} className="text-sap-blue" />
          <span>Pesan Transaksi</span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Tutup"
            className="ml-auto sap-btn sap-btn-ghost !px-1.5 !py-1"
          >
            <X size={14} />
          </button>
        </div>

        <div className="p-3 space-y-3 overflow-auto">
          {/* pesan aktif */}
          {message ? (
            <div
              className="rounded-[3px] border px-3 py-2.5 space-y-2"
              style={{ backgroundColor: s.bg, borderColor: s.color }}
            >
              <div className="flex items-center gap-2 text-2xs font-mono" style={{ color: s.color }}>
                <Icon size={14} className="shrink-0" />
                <span className="font-semibold uppercase tracking-wide">{s.label}</span>
                <span className="text-sap-muted">· {fmtTime(message.at)}</span>
                <CopyBtn value={message.text} label="Salin pesan" className="ml-auto" />
              </div>

              <p
                className="text-2xs leading-relaxed break-words select-text"
                style={{ color: s.color }}
                onDoubleClick={async () => setCopied((await copyText(message.text)) ? message.text : null)}
              >
                {message.text}
              </p>

              {docs.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5 pt-1 border-t border-sap-border/50">
                  <span className="text-xxs text-sap-muted uppercase tracking-wide">Nomor dokumen</span>
                  {docs.map((d) => (
                    <span key={d} className="inline-flex items-center gap-1" style={{ color: s.color }}>
                      <DocChip value={d} onCopied={(ok) => setCopied(ok ? d : null)} />
                      <CopyBtn value={d} title={`Salin ${d}`} />
                    </span>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <p className="text-2xs text-sap-muted">Belum ada pesan pada sesi ini.</p>
          )}

          {copied && (
            <p className="text-xxs text-sap-oktext font-mono">✓ {shorten(copied, 70)} disalin ke clipboard</p>
          )}

          {/* riwayat */}
          <div>
            <div className="flex items-center gap-2 mb-1.5">
              <p className="text-xxs uppercase tracking-wide text-sap-muted">
                Riwayat pesan ({history.length})
              </p>
              {history.length > 0 && (
                <button
                  type="button"
                  onClick={onClear}
                  className="ml-auto sap-btn !py-[3px] !px-2 text-sap-muted"
                  title="Kosongkan riwayat"
                >
                  <Trash2 size={12} /> Bersihkan
                </button>
              )}
            </div>

            <div className="border border-sap-border rounded-[3px] divide-y divide-sap-border max-h-[38dvh] overflow-auto">
              {history.length === 0 && (
                <p className="px-2.5 py-3 text-xxs text-sap-muted text-center">Riwayat masih kosong.</p>
              )}
              {history.map((h) => {
                const hs = STYLE[h.type];
                const HIcon = hs.Icon;
                const hdocs = findDocNumbers(h.text);
                return (
                  <div
                    key={h.at + h.text}
                    className="flex items-start gap-2 px-2.5 py-2 hover:bg-sap-hover"
                    onDoubleClick={async () => {
                      const v = hdocs[0] ?? h.text;
                      setCopied((await copyText(v)) ? v : null);
                    }}
                  >
                    <HIcon size={12} className="shrink-0 mt-[2px]" style={{ color: hs.color }} />
                    <span className="font-mono text-xxs text-sap-muted shrink-0">{fmtTime(h.at)}</span>
                    <span className="text-xxs leading-relaxed break-words min-w-0 flex-1 select-text">
                      {h.text}
                    </span>
                    <CopyBtn value={hdocs[0] ?? h.text} title="Salin" />
                  </div>
                );
              })}
            </div>
            <p className="text-xxs text-sap-muted/70 mt-1.5">
              Klik ganda pada baris riwayat menyalin nomor dokumennya (bila ada).
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* STATUS BAR                                                          */
/* ------------------------------------------------------------------ */

/**
 * Status Bar khas SAP di baris paling bawah layar.
 * System ID & Client diambil dari environment (lihat src/lib/system.ts).
 */
export function StatusBar({
  system = SAP_SYSTEM,
  client = SAP_CLIENT,
}: {
  system?: string;
  client?: string;
}) {
  const { message, history, clearHistory } = useStatus();
  const [open, setOpen] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);

  const s = STYLE[message?.type ?? 'I'];
  const Icon = s.Icon;
  const docs = message ? findDocNumbers(message.text) : [];

  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => setFlash(null), 1500);
    return () => clearTimeout(t);
  }, [flash]);

  /** klik ganda di area pesan: salin nomor dokumen pertama, atau seluruh teks */
  async function copyFromMessage() {
    if (!message) return;
    const v = docs[0] ?? message.text;
    setFlash((await copyText(v)) ? `✓ ${shorten(v, 30)} disalin` : '✗ clipboard ditolak browser');
  }

  return (
    <>
      <footer
        className="relative z-30 flex items-center justify-between h-[26px] shrink-0 border-t border-sap-border
                   bg-sap-sysbar text-2xs select-none pb-[env(safe-area-inset-bottom)]"
      >
        <div
          key={message?.at ?? 'idle'}
          className="sap-flash flex items-center gap-2 px-2 sm:px-3 h-full min-w-0 flex-1"
          style={message ? { backgroundColor: s.bg } : undefined}
          onDoubleClick={copyFromMessage}
          title={message ? 'Klik ganda untuk menyalin nomor dokumen' : undefined}
        >
          {message ? (
            <>
              <Icon size={13} style={{ color: s.color }} className="shrink-0" />
              <span
                className="truncate font-mono min-w-0"
                style={{ color: s.color }}
                title={message.text}
              >
                {message.text}
              </span>

              {/* nomor dokumen: klik ganda = salin */}
              {docs.slice(0, 2).map((d) => (
                <span key={d} className="hidden md:inline-flex shrink-0" style={{ color: s.color }}>
                  <DocChip
                    value={d}
                    onCopied={(ok) => setFlash(ok ? `✓ ${d} disalin` : '✗ clipboard ditolak browser')}
                  />
                </span>
              ))}

              {flash && (
                <span className="shrink-0 font-mono text-xxs text-sap-oktext hidden sm:inline">{flash}</span>
              )}
            </>
          ) : (
            <span className="text-sap-muted/70 font-mono">Ready</span>
          )}

          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setOpen(true);
            }}
            title="Perbesar / lihat detail & riwayat pesan"
            aria-label="Perbesar pesan"
            className="ml-auto shrink-0 sap-btn sap-btn-ghost !px-1.5 !py-[2px] relative"
          >
            <Search size={13} />
            {history.length > 0 && (
              <span className="absolute -top-[3px] -right-[3px] min-w-[13px] h-[13px] px-[3px] rounded-full
                               bg-sap-blue text-white text-[8px] leading-[13px] font-mono">
                {history.length > 99 ? '99+' : history.length}
              </span>
            )}
          </button>
        </div>

        <div
          className="flex items-center h-full divide-x divide-sap-border border-l border-sap-border font-mono text-sap-muted shrink-0"
          title={SYSTEM_TITLE}
        >
          <span className={`px-2 sm:px-3 ${IS_PROD_SYSTEM ? '' : 'text-sap-warntext font-semibold'}`}>
            {system}
          </span>
          <span
            className={`px-2 sm:px-3 hidden xs:inline ${
              IS_PROD_SYSTEM ? '' : 'text-sap-warntext font-semibold'
            }`}
          >
            CLNT {client}
          </span>
          <span className="px-3 hidden sm:inline">OVR</span>
          <span className="px-3 hidden md:inline">WMS-LITE</span>
        </div>
      </footer>

      {open && (
        <MessagePopup
          message={message}
          history={history}
          onClose={() => setOpen(false)}
          onClear={clearHistory}
        />
      )}
    </>
  );
}
