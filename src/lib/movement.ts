import { MovementType } from '@prisma/client';

/** Label tampilan movement type persis seperti kode SAP. */
export const MOVEMENT_LABEL: Record<MovementType, string> = {
  GR_101: '101 — Goods Receipt',
  GI_201: '201 — Goods Issue (Cost Center)',
  GI_601_SALES: '601 — Goods Issue (Penjualan)',
  GR_501_OTHER: '501 — Goods Receipt Lain-lain',
  RET_122_VEND: '122 — Retur ke Vendor',
  RET_123_CANC: '123 — Cancel Retur ke Vendor',
  GR_502_CANC: '502 — Cancel GR Lain-lain',
  TR_301_BIN: '301 — Transfer Posting (Bin to Bin)',
  ADJ_551_MIN: '551 — Scrapping / Adjustment (-)',
  INIT_561: '561 — Initial Stock Entry',
  ADJ_701_PLUS: '701 — Phys. Inv. Difference (+)',
  ADJ_702_MIN: '702 — Phys. Inv. Difference (-)',
  TRM_309_OUT: '309 — Transfer Material ke Material (keluar)',
  TRM_309_IN: '309 — Transfer Material ke Material (masuk)',
  GR_102_CANC: '102 — Cancel Goods Receipt',
  GI_202_CANC: '202 — Cancel Goods Issue',
  ADJ_552_CANC: '552 — Cancel Scrapping (+)',
  INIT_562_CANC: '562 — Cancel Initial Stock (-)',
  PI_711_CANC: '711 — Cancel Phys. Inv. (+) Diff',
  PI_712_CANC: '712 — Cancel Phys. Inv. (-) Diff',
  GI_602_CANC: '602 — Cancel Goods Issue (Penjualan)',
};

/** Deskripsi singkat (tanpa kode) — dipakai kolom "MvT Description" di MB51. */
export const MOVEMENT_DESC: Record<MovementType, string> = {
  GR_101: 'Goods Receipt',
  GI_201: 'Goods Issue to Cost Center',
  GI_601_SALES: 'Goods Issue — Penjualan',
  GR_501_OTHER: 'Goods Receipt — Retur & penerimaan lain',
  RET_122_VEND: 'Retur ke Vendor',
  RET_123_CANC: 'Pembatalan Retur ke Vendor',
  GR_502_CANC: 'Pembatalan GR Lain-lain',
  TR_301_BIN: 'Transfer Posting (Bin to Bin)',
  ADJ_551_MIN: 'Scrapping / Adjustment (-)',
  INIT_561: 'Initial Stock Entry',
  ADJ_701_PLUS: 'Phys. Inv. Difference (+)',
  ADJ_702_MIN: 'Phys. Inv. Difference (-)',
  TRM_309_OUT: 'Transfer Material ke Material — sisi keluar',
  TRM_309_IN: 'Transfer Material ke Material — sisi masuk',
  GR_102_CANC: 'Cancel Goods Receipt',
  GI_202_CANC: 'Cancel Goods Issue',
  ADJ_552_CANC: 'Cancel Scrapping (+)',
  INIT_562_CANC: 'Cancel Initial Stock (-)',
  PI_711_CANC: 'Cancel Phys. Inv. (+) Diff',
  PI_712_CANC: 'Cancel Phys. Inv. (-) Diff',
  GI_602_CANC: 'Cancel Goods Issue — Penjualan',
};

/** Kode pendek untuk kolom grid. */
export const MOVEMENT_CODE: Record<MovementType, string> = {
  GR_101: '101',
  GI_201: '201',
  GI_601_SALES: '601',
  GR_501_OTHER: '501',
  RET_122_VEND: '122',
  RET_123_CANC: '123',
  GR_502_CANC: '502',
  TR_301_BIN: '301',
  ADJ_551_MIN: '551',
  INIT_561: '561',
  ADJ_701_PLUS: '701',
  ADJ_702_MIN: '702',
  // Kedua sisi memakai kode yang sama, persis seperti SAP — yang membedakan
  // adalah kolom bin (source vs target). Akibatnya parseMovement('309') tidak
  // bisa menentukan sisi mana yang dimaksud, jadi 309 sengaja DILARANG masuk
  // lewat MIGO; satu-satunya jalurnya adalah penggabungan SKU (ZMATDUP).
  TRM_309_OUT: '309',
  TRM_309_IN: '309',
  GR_102_CANC: '102',
  GI_202_CANC: '202',
  ADJ_552_CANC: '552',
  INIT_562_CANC: '562',
  PI_711_CANC: '711',
  PI_712_CANC: '712',
  GI_602_CANC: '602',
};

/** Arah stok: +1 menambah, -1 mengurangi, 0 netral (transfer). */
export const MOVEMENT_SIGN: Record<MovementType, 1 | -1 | 0> = {
  GR_101: 1,
  GI_201: -1,
  GI_601_SALES: -1,
  GR_501_OTHER: 1,
  RET_122_VEND: -1,
  RET_123_CANC: 1,
  GR_502_CANC: -1,
  TR_301_BIN: 0,
  ADJ_551_MIN: -1,
  INIT_561: 1,
  ADJ_701_PLUS: 1,
  ADJ_702_MIN: -1,
  TRM_309_OUT: -1,
  TRM_309_IN: 1,
  // pembatalan = kebalikan arah dokumen asal
  GR_102_CANC: -1,
  GI_202_CANC: 1,
  ADJ_552_CANC: 1,
  INIT_562_CANC: -1,
  PI_711_CANC: -1,
  PI_712_CANC: 1,
  GI_602_CANC: 1,
};

/** Movement pembatalan -> movement asal yang dibatalkannya. */
export const CANCEL_OF: Partial<Record<MovementType, MovementType>> = {
  GR_102_CANC: MovementType.GR_101,
  GI_202_CANC: MovementType.GI_201,
  ADJ_552_CANC: MovementType.ADJ_551_MIN,
  INIT_562_CANC: MovementType.INIT_561,
  PI_711_CANC: MovementType.ADJ_701_PLUS,
  PI_712_CANC: MovementType.ADJ_702_MIN,
  GI_602_CANC: MovementType.GI_601_SALES,
  GR_502_CANC: MovementType.GR_501_OTHER,
  RET_123_CANC: MovementType.RET_122_VEND,
};

/** Movement asal -> movement pembatalannya (kebalikan CANCEL_OF). */
export const CANCELLED_BY: Partial<Record<MovementType, MovementType>> = {
  [MovementType.GR_101]: MovementType.GR_102_CANC,
  [MovementType.GI_201]: MovementType.GI_202_CANC,
  [MovementType.ADJ_551_MIN]: MovementType.ADJ_552_CANC,
  [MovementType.INIT_561]: MovementType.INIT_562_CANC,
  [MovementType.ADJ_701_PLUS]: MovementType.PI_711_CANC,
  [MovementType.ADJ_702_MIN]: MovementType.PI_712_CANC,
  [MovementType.GI_601_SALES]: MovementType.GI_602_CANC,
  [MovementType.GR_501_OTHER]: MovementType.GR_502_CANC,
  [MovementType.RET_122_VEND]: MovementType.RET_123_CANC,
};

/**
 * Transfer posting material ke material (309).
 *
 * Sengaja TIDAK punya pasangan pembatalan di CANCELLED_BY: membatalkan separuh
 * penggabungan akan meninggalkan stok menggantung di kode yang sudah berstatus
 * alias. Kalau penggabungan perlu dibalik, jalankan penggabungan ke arah
 * sebaliknya supaya kedua sisinya tetap seimbang.
 */
export const MATERIAL_TRANSFER_MOVEMENTS: MovementType[] = [
  MovementType.TRM_309_OUT,
  MovementType.TRM_309_IN,
];

export function isMaterialTransfer(m: MovementType): boolean {
  return MATERIAL_TRANSFER_MOVEMENTS.includes(m);
}

/** Movement yang boleh dipilih di layar MIGO. */
export const MIGO_MOVEMENTS: MovementType[] = [
  MovementType.GR_101,
  MovementType.GR_501_OTHER,
  MovementType.GI_201,
  MovementType.GI_601_SALES,
  MovementType.RET_122_VEND,
  MovementType.ADJ_551_MIN,
  MovementType.ADJ_701_PLUS,
  MovementType.ADJ_702_MIN,
];

/**
 * Movement yang diproses 2-step (level IM di MIGO, level WM di LB10/LB12).
 * 101 -> stok masuk GR-ZONE + TR PUTAWAY
 * 201 -> hanya membuat TR PICK, goods issue diposting saat TR selesai
 */
export const TWO_STEP_MOVEMENTS: MovementType[] = [
  MovementType.GR_101,
  MovementType.GR_501_OTHER,
  MovementType.GI_201,
];

/**
 * Penerimaan barang — masuk ke bin transit lalu menunggu put-away.
 *
 * Dikelompokkan supaya penambahan jenis penerimaan berikutnya tidak perlu
 * menyebar `if` baru ke seluruh kode: yang membedakan 501 dari 101 hanyalah
 * asal barangnya, bukan cara memprosesnya.
 */
export const GOODS_RECEIPT_MOVEMENTS: MovementType[] = [
  MovementType.GR_101,
  MovementType.GR_501_OTHER,
];

export function isGoodsReceipt(m: MovementType): boolean {
  return GOODS_RECEIPT_MOVEMENTS.includes(m);
}

/**
 * Penerimaan yang raknya disarankan dari Fix Bin material (MM01).
 *
 * Hanya retur (501). Penerimaan pembelian (101) masuk ke Heavy Duty Racking dan
 * raknya ditentukan menurut ruang kosong, bukan menurut rak tetap material —
 * memaksakan Fix Bin di sana akan menumpuk seluruh kedatangan ke satu rak pick
 * face yang kapasitasnya memang kecil.
 *
 * Retur berbeda sifatnya: jumlahnya sedikit, satuannya eceran, dan tujuannya
 * memang mengembalikan barang ke rak asalnya di Gudang Kecil.
 */
export const FIX_BIN_PUTAWAY_MOVEMENTS: MovementType[] = [MovementType.GR_501_OTHER];

export function suggestsFixBin(m: MovementType): boolean {
  return FIX_BIN_PUTAWAY_MOVEMENTS.includes(m);
}

/** Movement koreksi yang tetap menunjuk bin secara langsung. */
export const DIRECT_BIN_MOVEMENTS: MovementType[] = [
  MovementType.GI_601_SALES,
  MovementType.RET_122_VEND,
  MovementType.ADJ_551_MIN,
  MovementType.ADJ_701_PLUS,
  MovementType.ADJ_702_MIN,
];

/**
 * Movement yang WAJIB menyebut cost center pembebanan.
 * 201 = pemakaian internal, biayanya harus dibebankan ke satu cost center.
 * 601 (penjualan) tidak termasuk — pembebanannya lewat dokumen penjualan.
 */
export const COST_CENTER_MOVEMENTS: MovementType[] = [
  MovementType.GI_201,
  MovementType.GI_202_CANC,
];

export function needsCostCenter(m: MovementType): boolean {
  return COST_CENTER_MOVEMENTS.includes(m);
}

/**
 * Movement yang WAJIB menyebut referensi dokumen.
 *
 * Retur ke vendor tanpa keterangan vendor atau nomor returnya tidak bisa
 * dicocokkan dengan apa pun di kemudian hari — stoknya berkurang, tetapi tidak
 * ada yang tahu ke siapa barangnya pergi. Karena aplikasi ini belum punya
 * master vendor, kolom Reference-lah yang memikul keterangan itu, jadi ia tidak
 * boleh kosong.
 */
export const REFERENCE_REQUIRED_MOVEMENTS: MovementType[] = [MovementType.RET_122_VEND];

export function needsReference(m: MovementType): boolean {
  return REFERENCE_REQUIRED_MOVEMENTS.includes(m);
}

/** Terima "101", "101_GR", "GR_101" -> MovementType */
export function parseMovement(input: string): MovementType | null {
  const v = String(input ?? '').trim().toUpperCase();
  if (!v) return null;
  const direct = (Object.values(MovementType) as string[]).find((m) => m === v);
  if (direct) return direct as MovementType;
  const byCode = (Object.keys(MOVEMENT_CODE) as MovementType[]).find(
    (m) => MOVEMENT_CODE[m] === v.replace(/[^0-9]/g, '')
  );
  return byCode ?? null;
}
