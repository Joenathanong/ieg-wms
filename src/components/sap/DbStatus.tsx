'use client';

/**
 * Indikator koneksi database + tombol ping manual, dipasang di top bar.
 *
 * Ada dua alasan komponen ini ada:
 *
 *  1. TiDB Serverless menidurkan cluster setelah lama menganggur. Transaksi
 *     pertama sesudahnya harus menunggu cluster bangun, dan tanpa penanda
 *     apa pun operator hanya melihat layar diam — mudah disangka aplikasi
 *     hang, lalu tombol Post ditekan berkali-kali.
 *  2. Sebelum memposting dokumen penting, operator bisa menekan Ping dulu
 *     untuk memastikan sambungan hidup, persis seperti mengecek koneksi
 *     sebelum menjalankan transaksi di SAP GUI.
 *
 * Keep-alive-nya berjalan DARI LAYAR yang sedang terbuka, bukan dari proses
 * terjadwal di server. Konsekuensinya jujur: kalau tidak ada satu pun layar
 * terbuka, database tetap akan tidur. Itu justru diinginkan — tidak ada
 * gunanya membayar cluster tetap bangun saat gudang tutup. Bila suatu saat
 * database perlu dijaga tanpa bergantung layar, endpoint /api/health bisa
 * dipanggil penjadwal luar (cron / uptime monitor) dengan efek yang sama.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Database, Loader2 } from 'lucide-react';
import { api } from '@/lib/client';
import { withinWindow, clampInterval } from '@/lib/keepalive';

type DbState = 'UNKNOWN' | 'CHECKING' | 'UP' | 'DOWN';

/** Di atas ambang ini sambungan dianggap sedang "bangun tidur", bukan normal. */
const SLOW_MS = 1500;

/** Seberapa sering konfigurasi ZSET dibaca ulang supaya perubahan ikut terpakai. */
const CONFIG_REFRESH_MS = 10 * 60 * 1000;

interface KeepAliveCfg {
  enabled: boolean;
  from: string;
  to: string;
  intervalMin: number;
}

export function DbStatus({ className = '' }: { className?: string }) {
  const [state, setState] = useState<DbState>('UNKNOWN');
  const [latency, setLatency] = useState<number | null>(null);
  const [checkedAt, setCheckedAt] = useState<string>('');
  const [cfg, setCfg] = useState<KeepAliveCfg | null>(null);

  // Mencegah dua ping berjalan bersamaan (mis. keep-alive tepat saat diklik).
  const inFlight = useRef(false);

  /**
   * Sengaja TIDAK bergantung pada state apa pun: fungsi ini dipakai sebagai
   * dependensi useEffect keep-alive, dan kalau identitasnya berubah setiap
   * ping, interval-nya ikut dibuat ulang terus sehingga jadwalnya tidak
   * pernah stabil.
   */
  const ping = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setState('CHECKING');

    const t0 = Date.now();
    const r = await api<{ db: string }>('/api/health');
    const ms = Date.now() - t0;

    inFlight.current = false;
    setLatency(ms);
    setState(r.ok ? 'UP' : 'DOWN');
    // Jam baru dihitung di sini, bukan saat render pertama, supaya hasil render
    // di server dan di browser tetap sama persis.
    setCheckedAt(new Date().toLocaleTimeString('id-ID', { hour12: false }));
  }, []);

  // Baca konfigurasi keep-alive, lalu perbarui berkala.
  useEffect(() => {
    let alive = true;
    async function load() {
      const r = await api<Record<string, string>>('/api/settings');
      if (!alive || !r.ok || !r.data) return;
      setCfg({
        enabled: r.data.KEEPALIVE_ENABLED === '1',
        from: r.data.KEEPALIVE_FROM ?? '',
        to: r.data.KEEPALIVE_TO ?? '',
        intervalMin: clampInterval(r.data.KEEPALIVE_INTERVAL),
      });
    }
    void load();
    const id = setInterval(load, CONFIG_REFRESH_MS);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  // Satu kali saat layar dibuka, supaya indikatornya tidak lama-lama abu-abu.
  useEffect(() => {
    void ping();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep-alive.
  useEffect(() => {
    if (!cfg?.enabled) return;
    const id = setInterval(() => {
      // Jendela jam kerja diperiksa SETIAP kali, bukan sekali di awal, supaya
      // ping berhenti sendiri begitu jam kerja lewat tanpa perlu reload.
      if (!withinWindow(new Date(), cfg.from, cfg.to)) return;
      if (document.hidden) return; // tab di latar belakang: tidak perlu ikut
      void ping();
    }, cfg.intervalMin * 60_000);
    return () => clearInterval(id);
  }, [cfg, ping]);

  const dot =
    state === 'UP'
      ? latency !== null && latency > SLOW_MS
        ? 'bg-sap-warntext'
        : 'bg-sap-oktext'
      : state === 'DOWN'
        ? 'bg-sap-errtext'
        : 'bg-sap-muted';

  const label =
    state === 'CHECKING'
      ? 'cek…'
      : state === 'UP'
        ? latency !== null && latency > SLOW_MS
          ? `${latency} ms`
          : `${latency ?? '—'} ms`
        : state === 'DOWN'
          ? 'putus'
          : '—';

  const title = [
    state === 'UP'
      ? 'Database terhubung'
      : state === 'DOWN'
        ? 'Database tidak terjangkau'
        : state === 'CHECKING'
          ? 'Sedang memeriksa sambungan'
          : 'Sambungan belum diperiksa',
    checkedAt ? `Terakhir dicek ${checkedAt}` : '',
    latency !== null && latency > SLOW_MS ? 'Lambat — cluster kemungkinan baru bangun dari tidur' : '',
    cfg?.enabled
      ? `Keep-alive aktif ${cfg.from}–${cfg.to}, tiap ${cfg.intervalMin} menit`
      : 'Keep-alive nonaktif (atur di ZSET)',
    'Klik untuk ping ulang',
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <button
      type="button"
      onClick={() => void ping()}
      title={title}
      aria-label={title}
      className={`sap-btn sap-btn-ghost !px-2 !py-1.5 sm:!px-1.5 sm:!py-1 flex items-center gap-1.5 ${className}`}
    >
      {state === 'CHECKING' ? (
        <Loader2 size={13} className="animate-spin text-sap-blue" />
      ) : (
        <Database size={13} className="text-sap-blue" />
      )}
      <span className={`w-[7px] h-[7px] rounded-full shrink-0 ${dot}`} />
      <span className="hidden md:inline text-2xs font-mono text-sap-muted">{label}</span>
    </button>
  );
}
