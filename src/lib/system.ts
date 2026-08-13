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

function env(name: string, fallback: string): string {
  const v = process.env[name];
  return v && v.trim() !== '' ? v.trim() : fallback;
}

/** System ID, mis. PRD / QAS / DEV */
export const SAP_SYSTEM = env('NEXT_PUBLIC_SAP_SYSTEM', 'PRD').toUpperCase();

/** Nomor client (mandant), mis. 100 = development, 300 = production */
export const SAP_CLIENT = env('NEXT_PUBLIC_SAP_CLIENT', '100');

/** Jenis lingkungan — menentukan perlu tidaknya penanda peringatan. */
export const SAP_ENV: SapEnvKind = ((): SapEnvKind => {
  const raw = env('NEXT_PUBLIC_SAP_ENV', 'PROD').toUpperCase();
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
