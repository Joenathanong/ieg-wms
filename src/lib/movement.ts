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
};

/** Movement yang boleh dipilih di layar MIGO. */
export const MIGO_MOVEMENTS: MovementType[] = [
  MovementType.GR_101,
  MovementType.GI_201,
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
