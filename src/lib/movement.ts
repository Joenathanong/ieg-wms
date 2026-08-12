import { MovementType } from '@prisma/client';

/** Label tampilan movement type persis seperti kode SAP. */
export const MOVEMENT_LABEL: Record<MovementType, string> = {
  GR_101: '101 — Goods Receipt',
  GI_201: '201 — Goods Issue',
  TR_301_BIN: '301 — Transfer Posting (Bin to Bin)',
  ADJ_551_MIN: '551 — Scrapping / Adjustment (-)',
  INIT_561: '561 — Initial Stock Entry',
  ADJ_701_PLUS: '701 — Phys. Inv. Difference (+)',
  ADJ_702_MIN: '702 — Phys. Inv. Difference (-)',
  GR_102_CANC: '102 — Cancel Goods Receipt',
  GI_202_CANC: '202 — Cancel Goods Issue',
  ADJ_552_CANC: '552 — Cancel Scrapping (+)',
  INIT_562_CANC: '562 — Cancel Initial Stock (-)',
  PI_711_CANC: '711 — Cancel Phys. Inv. (+) Diff',
  PI_712_CANC: '712 — Cancel Phys. Inv. (-) Diff',
};

/** Deskripsi singkat (tanpa kode) — dipakai kolom "MvT Description" di MB51. */
export const MOVEMENT_DESC: Record<MovementType, string> = {
  GR_101: 'Goods Receipt',
  GI_201: 'Goods Issue',
  TR_301_BIN: 'Transfer Posting (Bin to Bin)',
  ADJ_551_MIN: 'Scrapping / Adjustment (-)',
  INIT_561: 'Initial Stock Entry',
  ADJ_701_PLUS: 'Phys. Inv. Difference (+)',
  ADJ_702_MIN: 'Phys. Inv. Difference (-)',
  GR_102_CANC: 'Cancel Goods Receipt',
  GI_202_CANC: 'Cancel Goods Issue',
  ADJ_552_CANC: 'Cancel Scrapping (+)',
  INIT_562_CANC: 'Cancel Initial Stock (-)',
  PI_711_CANC: 'Cancel Phys. Inv. (+) Diff',
  PI_712_CANC: 'Cancel Phys. Inv. (-) Diff',
};

/** Kode pendek untuk kolom grid. */
export const MOVEMENT_CODE: Record<MovementType, string> = {
  GR_101: '101',
  GI_201: '201',
  TR_301_BIN: '301',
  ADJ_551_MIN: '551',
  INIT_561: '561',
  ADJ_701_PLUS: '701',
  ADJ_702_MIN: '702',
  GR_102_CANC: '102',
  GI_202_CANC: '202',
  ADJ_552_CANC: '552',
  INIT_562_CANC: '562',
  PI_711_CANC: '711',
  PI_712_CANC: '712',
};

/** Arah stok: +1 menambah, -1 mengurangi, 0 netral (transfer). */
export const MOVEMENT_SIGN: Record<MovementType, 1 | -1 | 0> = {
  GR_101: 1,
  GI_201: -1,
  TR_301_BIN: 0,
  ADJ_551_MIN: -1,
  INIT_561: 1,
  ADJ_701_PLUS: 1,
  ADJ_702_MIN: -1,
  // pembatalan = kebalikan arah dokumen asal
  GR_102_CANC: -1,
  GI_202_CANC: 1,
  ADJ_552_CANC: 1,
  INIT_562_CANC: -1,
  PI_711_CANC: -1,
  PI_712_CANC: 1,
};

/** Movement pembatalan -> movement asal yang dibatalkannya. */
export const CANCEL_OF: Partial<Record<MovementType, MovementType>> = {
  GR_102_CANC: MovementType.GR_101,
  GI_202_CANC: MovementType.GI_201,
  ADJ_552_CANC: MovementType.ADJ_551_MIN,
  INIT_562_CANC: MovementType.INIT_561,
  PI_711_CANC: MovementType.ADJ_701_PLUS,
  PI_712_CANC: MovementType.ADJ_702_MIN,
};

/** Movement asal -> movement pembatalannya (kebalikan CANCEL_OF). */
export const CANCELLED_BY: Partial<Record<MovementType, MovementType>> = {
  [MovementType.GR_101]: MovementType.GR_102_CANC,
  [MovementType.GI_201]: MovementType.GI_202_CANC,
  [MovementType.ADJ_551_MIN]: MovementType.ADJ_552_CANC,
  [MovementType.INIT_561]: MovementType.INIT_562_CANC,
  [MovementType.ADJ_701_PLUS]: MovementType.PI_711_CANC,
  [MovementType.ADJ_702_MIN]: MovementType.PI_712_CANC,
};

/** Movement yang boleh dipilih di layar MIGO. */
export const MIGO_MOVEMENTS: MovementType[] = [
  MovementType.GR_101,
  MovementType.GI_201,
  MovementType.ADJ_551_MIN,
  MovementType.ADJ_701_PLUS,
  MovementType.ADJ_702_MIN,
];

/**
 * Movement yang diproses 2-step (level IM di MIGO, level WM di LB10/LB12).
 * 101 -> stok masuk GR-ZONE + TR PUTAWAY
 * 201 -> hanya membuat TR PICK, goods issue diposting saat TR selesai
 */
export const TWO_STEP_MOVEMENTS: MovementType[] = [MovementType.GR_101, MovementType.GI_201];

/** Movement koreksi yang tetap menunjuk bin secara langsung. */
export const DIRECT_BIN_MOVEMENTS: MovementType[] = [
  MovementType.ADJ_551_MIN,
  MovementType.ADJ_701_PLUS,
  MovementType.ADJ_702_MIN,
];

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
