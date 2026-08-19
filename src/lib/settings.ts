import type { Prisma, PrismaClient } from '@prisma/client';

/**
 * Konfigurasi sistem (ZSET). Disimpan sebagai key-value di tabel system_settings.
 */

export const SETTING_KEYS = {
  /** master switch modul PDT (ZRF). '1' = aktif */
  PDT_ENABLED: 'PDT_ENABLED',
  /** bin interim tujuan MIGO 101 */
  DEFAULT_GR_BIN: 'DEFAULT_GR_BIN',
  /** bin interim tujuan picking sebelum MIGO 201 */
  DEFAULT_GI_BIN: 'DEFAULT_GI_BIN',
  /** '1' = MIGO 101 otomatis memecah qty berdasarkan master pallet */
  AUTO_SPLIT_PALLET: 'AUTO_SPLIT_PALLET',
  /** '1' = izinkan operator memilih bin bebas di PDT; '0' = harus ikut saran FEFO */
  PDT_STRICT_FEFO: 'PDT_STRICT_FEFO',

  /* --- Toggle per T-Code PDT (global, dikelola ADMIN di ZSET) --- */
  PDT_ZRF01: 'PDT_ZRF01',
  PDT_ZRF02: 'PDT_ZRF02',
  PDT_ZRF03: 'PDT_ZRF03',
  PDT_ZRF04: 'PDT_ZRF04',
  PDT_ZRF05: 'PDT_ZRF05',
  PDT_ZRF06: 'PDT_ZRF06',
  PDT_ZRF07: 'PDT_ZRF07',
  PDT_ZRF08: 'PDT_ZRF08',
  PDT_ZRF09: 'PDT_ZRF09',

  /* --- Keep-alive database (TiDB Serverless tidur saat menganggur) --- */
  /** '1' = kirim ping berkala pada jam kerja */
  KEEPALIVE_ENABLED: 'KEEPALIVE_ENABLED',
  /** jam mulai, format HH:MM */
  KEEPALIVE_FROM: 'KEEPALIVE_FROM',
  /** jam selesai, format HH:MM (boleh melewati tengah malam) */
  KEEPALIVE_TO: 'KEEPALIVE_TO',
  /** jarak antar ping dalam menit */
  KEEPALIVE_INTERVAL: 'KEEPALIVE_INTERVAL',
} as const;

export type SettingKey = (typeof SETTING_KEYS)[keyof typeof SETTING_KEYS];

export const SETTING_DEFAULTS: Record<SettingKey, string> = {
  PDT_ENABLED: '1',
  DEFAULT_GR_BIN: 'TRN-IN-01',
  DEFAULT_GI_BIN: 'TRN-OUT-01',
  AUTO_SPLIT_PALLET: '1',
  PDT_STRICT_FEFO: '0',
  PDT_ZRF01: '1',
  PDT_ZRF02: '1',
  PDT_ZRF03: '1',
  PDT_ZRF04: '1',
  PDT_ZRF05: '1',
  PDT_ZRF06: '1',
  PDT_ZRF07: '1',
  PDT_ZRF08: '1',
  PDT_ZRF09: '1',
  KEEPALIVE_ENABLED: '0',
  KEEPALIVE_FROM: '07:00',
  KEEPALIVE_TO: '22:00',
  KEEPALIVE_INTERVAL: '4',
};

/** T-Code PDT -> key setting yang mengontrolnya. */
export const PDT_MODULE_SETTING: Record<string, SettingKey> = {
  ZRF01: 'PDT_ZRF01',
  ZRF02: 'PDT_ZRF02',
  ZRF03: 'PDT_ZRF03',
  ZRF04: 'PDT_ZRF04',
  ZRF05: 'PDT_ZRF05',
  ZRF06: 'PDT_ZRF06',
  ZRF07: 'PDT_ZRF07',
  ZRF08: 'PDT_ZRF08',
  ZRF09: 'PDT_ZRF09',
};

export const SETTING_META: {
  key: SettingKey;
  label: string;
  hint: string;
  type: 'BOOL' | 'BIN' | 'TIME' | 'NUM';
}[] = [
  {
    key: 'PDT_ENABLED',
    label: 'Modul PDT (ZRF) aktif',
    hint: 'Master switch. Bila dimatikan, seluruh T-Code ZRF ditolak walaupun user punya izin PDT.',
    type: 'BOOL',
  },
  {
    key: 'AUTO_SPLIT_PALLET',
    label: 'Auto-split qty per pallet di MIGO',
    hint: 'Memecah qty penerimaan menjadi beberapa line sesuai master kemasan default material.',
    type: 'BOOL',
  },
  {
    key: 'PDT_STRICT_FEFO',
    label: 'PDT wajib ikut saran FEFO',
    hint: 'Bila aktif, operator PDT hanya boleh mengambil dari batch dengan expired terdekat.',
    type: 'BOOL',
  },
  {
    key: 'PDT_ZRF01',
    label: 'ZRF01 — Goods Receipt (PDT)',
    hint: 'Izinkan operator melakukan penerimaan barang lewat PDT.',
    type: 'BOOL',
  },
  {
    key: 'PDT_ZRF02',
    label: 'ZRF02 — Put-away (PDT)',
    hint: 'Izinkan operator menyimpan barang dari GR zone ke rak lewat PDT.',
    type: 'BOOL',
  },
  {
    key: 'PDT_ZRF03',
    label: 'ZRF03 — Picking (PDT)',
    hint: 'Izinkan operator mengambil barang dari rak lewat PDT.',
    type: 'BOOL',
  },
  {
    key: 'PDT_ZRF04',
    label: 'ZRF04 — Bin Transfer (PDT)',
    hint: 'Izinkan operator memindahkan stok antar rak lewat PDT.',
    type: 'BOOL',
  },
  {
    key: 'PDT_ZRF05',
    label: 'ZRF05 — Stock Count (PDT)',
    hint: 'Izinkan operator menginput hasil stock opname lewat PDT.',
    type: 'BOOL',
  },
  {
    key: 'PDT_ZRF06',
    label: 'ZRF06 — Inquiry (PDT)',
    hint: 'Izinkan operator melihat isi rak / lokasi material lewat PDT.',
    type: 'BOOL',
  },
  {
    key: 'PDT_ZRF07',
    label: 'ZRF07 — Goods Issue (PDT)',
    hint: 'Izinkan operator memposting goods issue dari transit-out lewat PDT.',
    type: 'BOOL',
  },
  {
    key: 'PDT_ZRF08',
    label: 'ZRF08 — Replenishment (PDT)',
    hint: 'Izinkan operator memindahkan stok ke fix bin / pick bin lewat PDT (list FEFO).',
    type: 'BOOL',
  },
  {
    key: 'PDT_ZRF09',
    label: 'ZRF09 — SO Penjualan (PDT)',
    hint: 'Hitung sisa fisik pick bin; selisihnya diposting sebagai goods issue penjualan (601).',
    type: 'BOOL',
  },
  {
    key: 'KEEPALIVE_ENABLED',
    label: 'Jaga database tetap bangun (keep-alive)',
    hint:
      'Database serverless tidur sendiri saat lama menganggur, sehingga transaksi pertama sesudahnya terasa menggantung. ' +
      'Bila aktif, layar yang sedang terbuka mengirim query paling ringan secara berkala — hanya di dalam jam kerja di bawah.',
    type: 'BOOL',
  },
  {
    key: 'KEEPALIVE_FROM',
    label: 'Keep-alive mulai jam',
    hint: 'Format 24 jam, mis. 07:00. Jam mulai sama dengan jam selesai berarti sepanjang hari.',
    type: 'TIME',
  },
  {
    key: 'KEEPALIVE_TO',
    label: 'Keep-alive sampai jam',
    hint: 'Format 24 jam, mis. 22:00. Boleh melewati tengah malam untuk shift malam (mis. 22:00 sampai 06:00).',
    type: 'TIME',
  },
  {
    key: 'KEEPALIVE_INTERVAL',
    label: 'Jarak antar ping (menit)',
    hint:
      'Harus lebih rapat daripada ambang tidur database, kalau tidak cluster tetap sempat tertidur di sela ping. ' +
      'Isian di luar 1–60 menit akan dibulatkan ke batas terdekat.',
    type: 'NUM',
  },
  {
    key: 'DEFAULT_GR_BIN',
    label: 'Bin transit penerimaan (TRANSIT-IN)',
    hint: 'Tujuan otomatis MIGO 101 sebelum putaway lewat LB12.',
    type: 'BIN',
  },
  {
    key: 'DEFAULT_GI_BIN',
    label: 'Bin transit pengeluaran (TRANSIT-OUT)',
    hint: 'Tujuan picking lewat LB12 sebelum goods issue diposting.',
    type: 'BIN',
  },
];

type Db = PrismaClient | Prisma.TransactionClient;

export async function getSetting(db: Db, key: SettingKey): Promise<string> {
  const row = await db.systemSetting.findUnique({ where: { key } });
  return row?.value ?? SETTING_DEFAULTS[key];
}

export async function getSettings(db: Db): Promise<Record<SettingKey, string>> {
  const rows = await db.systemSetting.findMany();
  const map = new Map(rows.map((r) => [r.key, r.value]));
  const out = { ...SETTING_DEFAULTS };
  (Object.keys(SETTING_DEFAULTS) as SettingKey[]).forEach((k) => {
    const v = map.get(k);
    if (v !== undefined) out[k] = v;
  });
  return out;
}

export async function isTrue(db: Db, key: SettingKey): Promise<boolean> {
  return (await getSetting(db, key)) === '1';
}
