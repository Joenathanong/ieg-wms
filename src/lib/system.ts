/**
 * Identitas sistem — ditampilkan di status bar & layar logon, persis seperti
 * SAP GUI menampilkan System ID dan Client (mandant).
 *
 * Nilai diambil dari environment saat build (Next.js meng-inline variabel
 * berawalan NEXT_PUBLIC_), sehingga satu basis kode yang sama dapat dipakai
 * beberapa lingkungan hanya dengan environment variable berbeda:
 *
 *   Development   NEXT_PUBLIC_SAP_SYSTEM=DEV  NEXT_PUBLIC_SAP_CLIENT=100  NEXT_PUBLIC_SAP_ENV=DEV
 *   Production    NEXT_PUBLIC_SAP_SYSTEM=PRD  NEXT_PUBLIC_SAP_CLIENT=300  NEXT_PUBLIC_SAP_ENV=PROD
 *
 * CATATAN PENTING: pemisahan data antar lingkungan dilakukan lewat DATABASE
 * TERPISAH (DATABASE_URL berbeda), bukan lewat label ini. Label hanya penanda
 * visual agar operator tidak salah memposting ke sistem yang keliru.
 */

export type SapEnvKind = 'PROD' | 'QAS' | 'DEV';

/**
 * WAJIB ditulis sebagai `process.env.NAMA_LENGKAP` secara harfiah.
 *
 * Next.js mengganti variabel NEXT_PUBLIC_* saat build dengan cara mencari
 * teks `process.env.NEXT_PUBLIC_...` di dalam kode. Penggantian itu bersifat
 * tekstual, bukan dijalankan. Akibatnya bentuk dinamis seperti
 * `process.env[name]` TIDAK pernah ikut diganti: di browser `process.env`
 * kosong, sehingga nilai yang terpakai jatuh ke fallback.
 *
 * Dulu file ini memakai helper `env(name, fallback)` dengan `process.env[name]`.
 * Di server nilainya benar (baca .env langsung), di browser jatuh ke fallback —
 * dua hasil berbeda untuk halaman yang sama, dan React menolaknya sebagai
 * hydration mismatch begitu isi .env berbeda dari fallback.
 */
const RAW_SYSTEM = process.env.NEXT_PUBLIC_SAP_SYSTEM;
const RAW_CLIENT = process.env.NEXT_PUBLIC_SAP_CLIENT;
const RAW_ENV = process.env.NEXT_PUBLIC_SAP_ENV;

function pick(value: string | undefined, fallback: string): string {
  return value && value.trim() !== '' ? value.trim() : fallback;
}

/** System ID, mis. PRD / QAS / DEV */
export const SAP_SYSTEM = pick(RAW_SYSTEM, 'PRD').toUpperCase();

/** Nomor client (mandant), mis. 100 = development, 300 = production */
export const SAP_CLIENT = pick(RAW_CLIENT, '100');

/** Jenis lingkungan — menentukan perlu tidaknya penanda peringatan. */
export const SAP_ENV: SapEnvKind = ((): SapEnvKind => {
  const raw = pick(RAW_ENV, 'PROD').toUpperCase();
  if (raw === 'DEV' || raw === 'DEVELOPMENT' || raw === 'TEST') return 'DEV';
  if (raw === 'QAS' || raw === 'QA' || raw === 'STAGING') return 'QAS';
  return 'PROD';
})();

export const IS_PROD_SYSTEM = SAP_ENV === 'PROD';

/** Label pendek untuk badge, mis. "DEV · 100" */
export const SYSTEM_LABEL = `${SAP_SYSTEM} · ${SAP_CLIENT}`;

/** Keterangan panjang untuk tooltip / layar logon. */
export const SYSTEM_TITLE = IS_PROD_SYSTEM
  ? `System ${SAP_SYSTEM} — Client ${SAP_CLIENT} (Production)`
  : `System ${SAP_SYSTEM} — Client ${SAP_CLIENT} (${SAP_ENV === 'QAS' ? 'Quality / Testing' : 'Development'})`;
