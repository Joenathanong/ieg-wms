/**
 * Zona / Storage Section BAWAAN.
 *
 * PENTING: sejak T-Code **ZZONE** ada, sumber kebenaran zona adalah tabel
 * `zones` di database. File ini tinggal berperan sebagai:
 *   - daftar seed saat tabel masih kosong (lihat `src/lib/zonemaster.ts`), dan
 *   - cadangan bila `npm run db:upgrade` belum dijalankan.
 * Untuk logika runtime di server gunakan `listZones()` / `resolveZone()`,
 * dan di client ambil dari endpoint `/api/zones`.
 *
 * Skema penamaan: prefix gudang + tipe penyimpanan, sehingga kode bin sendiri
 * sudah menjelaskan lokasi fisiknya tanpa perlu melihat kolom zona.
 *   GB = Gudang Besar (Heavy Duty Racking)
 *   GK = Gudang Kecil (Bin Box)
 */

/** Kelompok gudang — dipakai untuk memilih palletization yang tepat. */
export type ZoneGroup = 'BESAR' | 'KECIL' | 'TRANSIT' | 'LAIN';

export interface ZoneDef {
  code: string;
  label: string;
  /** contoh format bin yang disarankan untuk zona ini */
  binPattern: string;
  group: ZoneGroup;
  /** bin interim (transit in/out) — bukan lokasi penyimpanan final */
  interim?: boolean;
  /** zona pick face — sumber pengambilan eceran */
  pick?: boolean;
  /** zona lama, tetap didukung agar data existing tidak rusak */
  legacy?: boolean;
}

export const ZONES: ZoneDef[] = [
  /* ---------------- Gudang Besar — Heavy Duty Racking ---------------- */
  {
    code: 'GB-HDR',
    label: 'Gudang Besar — Heavy Duty Racking',
    binPattern: 'GB-A-01-02-1',
    group: 'BESAR',
  },
  {
    code: 'GB-PICK',
    label: 'Gudang Besar — Pick Bin',
    binPattern: 'GB-PICK-A-01',
    group: 'BESAR',
    pick: true,
  },

  /* ---------------- Gudang Kecil — Bin Box ---------------- */
  {
    code: 'GK-BIN',
    label: 'Gudang Kecil — Bin Box',
    binPattern: 'GK-B-03-01-2',
    group: 'KECIL',
  },
  {
    code: 'GK-PICK',
    label: 'Gudang Kecil — Pick Bin',
    binPattern: 'GK-PICK-B-03',
    group: 'KECIL',
    pick: true,
  },

  /* ---------------- Penampung selisih penjualan ---------------- */
  {
    code: 'GK-GI',
    label: 'Gudang Kecil — Penampung GI Penjualan',
    binPattern: 'GI-PENJUALAN',
    group: 'KECIL',
  },

  /* ---------------- Transit / interim (alur 2-step) ---------------- */
  {
    code: 'TRANSIT-IN',
    label: 'Transit penerimaan — hasil MIGO 101, menunggu put-away',
    binPattern: 'TRN-IN-01',
    group: 'TRANSIT',
    interim: true,
  },
  {
    code: 'TRANSIT-OUT',
    label: 'Transit pengeluaran — hasil picking, siap goods issue',
    binPattern: 'TRN-OUT-01',
    group: 'TRANSIT',
    interim: true,
  },

  /* ---------------- Zona lama (tetap didukung) ---------------- */
  { code: 'RACK-FAST', label: 'Racking fast moving (lama)', binPattern: 'A-01-02-1', group: 'LAIN', legacy: true },
  { code: 'RACK-SLOW', label: 'Racking slow moving (lama)', binPattern: 'B-01-02-1', group: 'LAIN', legacy: true },
  { code: 'RACK-BULK', label: 'Racking bulk / floor stack (lama)', binPattern: 'C-01-01-1', group: 'LAIN', legacy: true },
  { code: 'STAGING', label: 'Staging area', binPattern: 'STG-01', group: 'LAIN' },
  { code: 'REJECT', label: 'Barang reject', binPattern: 'RJ-01', group: 'LAIN' },
  { code: 'QUARANTINE', label: 'Karantina / hold QC', binPattern: 'QC-01', group: 'LAIN' },
];

/**
 * Bin penampung GI penjualan untuk material yang BELUM punya Fix Bin di MM01.
 *
 * Semua kekurangannya dikumpulkan di satu tempat, bukan disebar ke rak acak:
 * saldo minus di rak yang salah jauh lebih sulit ditelusuri daripada saldo
 * minus di satu bin yang memang bernama apa adanya. Isinya juga langsung
 * menjadi daftar kerja — setiap material yang muncul di sini berarti Fix
 * Bin-nya belum diisi di MM01.
 */
export const SALES_GI_ZONE = 'GK-GI';
export const SALES_GI_BIN = 'GI-PENJUALAN';

export const ZONE_CODES = ZONES.map((z) => z.code);
export const INTERIM_ZONES = ZONES.filter((z) => z.interim).map((z) => z.code);
export const PICK_ZONES = ZONES.filter((z) => z.pick).map((z) => z.code);

/** Kelompok gudang yang bisa dipilih untuk palletization. */
export const ZONE_GROUPS: { code: ZoneGroup; label: string }[] = [
  { code: 'BESAR', label: 'Gudang Besar (Heavy Duty Racking)' },
  { code: 'KECIL', label: 'Gudang Kecil (Bin Box)' },
];

/**
 * Gudang tujuan bawaan untuk penerimaan (MIGO 101).
 *
 * Hampir seluruh barang masuk ke Heavy Duty Racking di Gudang Besar, jadi
 * pilihan ini yang dipasang lebih dulu — operator tinggal menggantinya ke
 * Gudang Kecil pada kasus yang jarang. Bin fisiknya sendiri tetap ditentukan
 * saat put-away (LB12 / ZRF02); pilihan di sini menentukan baris palletization
 * mana yang dipakai saat memecah qty.
 */
export const DEFAULT_GR_ZONE_GROUP: ZoneGroup = 'BESAR';

/** Semua kelompok yang sah untuk master zone (ZZONE), termasuk TRANSIT & LAIN. */
export const ZONE_GROUP_CODES: string[] = ['BESAR', 'KECIL', 'TRANSIT', 'LAIN'];

/** Label lengkap kelompok zona — dipakai di layar ZZONE. */
export const ZONE_GROUP_LABEL: Record<string, string> = {
  BESAR: 'Gudang Besar (Heavy Duty Racking)',
  KECIL: 'Gudang Kecil (Bin Box)',
  TRANSIT: 'Transit / interim (GR & GI zone)',
  LAIN: 'Lain-lain (staging, reject, karantina)',
};

/**
 * @deprecated Hanya untuk zona bawaan. Di server pakai `resolveZone()` dari
 * `src/lib/zonemaster.ts` supaya zona buatan user di ZZONE ikut terbaca.
 */
export function isInterimZone(zone: string): boolean {
  return INTERIM_ZONES.includes(String(zone ?? '').toUpperCase());
}

export function zoneLabel(code: string): string {
  return ZONES.find((z) => z.code === code)?.label ?? code;
}

export function zoneGroupOf(code: string): ZoneGroup {
  return ZONES.find((z) => z.code === String(code ?? '').toUpperCase())?.group ?? 'LAIN';
}
