import { Prisma, BinStatus, MovementType } from '@prisma/client';
import { HttpError } from './auth';
import { nextDocNumber } from './docnum';
import { MOVEMENT_SIGN, MOVEMENT_CODE } from './movement';

/* =====================================================================
 *  CORE WMS ENGINE
 *  Semua fungsi di file ini WAJIB dipanggil di dalam prisma.$transaction()
 *  agar perubahan Stock IM, Stock WM, Bin Status, dan Log bersifat ACID.
 * ===================================================================== */

export interface MovementInput {
  movement_type: MovementType;
  material_code: string;
  qty: number;
  batch_number?: string | null;
  mfg_date?: Date | null;
  exp_date?: Date | null;
  source_bin?: string | null;
  target_bin?: string | null;
  doc_date?: Date | null;
  reference?: string | null;
  remarks?: string | null;
  user_id: string;
}

/* ------------------------------------------------------------------ */
/* Master data guards                                                  */
/* ------------------------------------------------------------------ */

export async function getMaterialOrThrow(tx: Prisma.TransactionClient, code: string) {
  const m = await tx.material.findUnique({ where: { material_code: code } });
  if (!m) throw new HttpError(400, `Material ${code} does not exist in master data (MM01).`);
  return m;
}

export async function getBinOrThrow(
  tx: Prisma.TransactionClient,
  code: string,
  allowBlocked = false
) {
  const b = await tx.storageBin.findUnique({ where: { bin_code: code } });
  if (!b) throw new HttpError(400, `Storage bin ${code} does not exist (LS01N).`);
  if (!allowBlocked && b.status === BinStatus.BLOCKED)
    throw new HttpError(400, `Storage bin ${code} is BLOCKED. Movement not allowed.`);
  return b;
}

/* ------------------------------------------------------------------ */
/* Stock IM (global)                                                   */
/* ------------------------------------------------------------------ */

export async function applyStockIM(
  tx: Prisma.TransactionClient,
  material_code: string,
  delta: number
) {
  if (delta === 0) return;
  const current = await tx.stockIM.findUnique({ where: { material_code } });
  const newQty = (current?.total_qty ?? 0) + delta;
  if (newQty < 0)
    throw new HttpError(
      400,
      `Deficiency of stock (IM): material ${material_code} only has ${current?.total_qty ?? 0} available.`
    );
  await tx.stockIM.upsert({
    where: { material_code },
    create: { material_code, total_qty: newQty },
    update: { total_qty: newQty },
  });
}

/* ------------------------------------------------------------------ */
/* Stock WM (bin + batch level quant)                                  */
/* ------------------------------------------------------------------ */

export interface QuantKey {
  material_code: string;
  bin_code: string;
  batch_number: string | null;
}

export async function applyStockWM(
  tx: Prisma.TransactionClient,
  key: QuantKey,
  delta: number,
  dates?: { mfg_date?: Date | null; exp_date?: Date | null }
) {
  if (delta === 0) return;

  const existing = await tx.stockWM.findFirst({
    where: {
      material_code: key.material_code,
      bin_code: key.bin_code,
      batch_number: key.batch_number,
    },
  });

  const newQty = (existing?.qty ?? 0) + delta;

  if (newQty < 0) {
    throw new HttpError(
      400,
      `Deficiency of stock in bin ${key.bin_code}` +
        (key.batch_number ? ` / batch ${key.batch_number}` : '') +
        `: available ${existing?.qty ?? 0}, requested ${Math.abs(delta)}.`
    );
  }

  if (!existing) {
    await tx.stockWM.create({
      data: {
        material_code: key.material_code,
        bin_code: key.bin_code,
        batch_number: key.batch_number,
        mfg_date: dates?.mfg_date ?? null,
        exp_date: dates?.exp_date ?? null,
        qty: newQty,
      },
    });
  } else if (newQty === 0) {
    // quant habis -> hapus (sesuai perilaku SAP: quant di-delete saat nol)
    await tx.stockWM.delete({ where: { id: existing.id } });
  } else {
    await tx.stockWM.update({
      where: { id: existing.id },
      data: {
        qty: newQty,
        mfg_date: dates?.mfg_date ?? existing.mfg_date,
        exp_date: dates?.exp_date ?? existing.exp_date,
      },
    });
  }
}

/** Set status bin ke EMPTY / OCCUPIED berdasarkan sisa quant. Bin BLOCKED tidak diubah. */
export async function refreshBinStatus(tx: Prisma.TransactionClient, bin_code: string) {
  const bin = await tx.storageBin.findUnique({ where: { bin_code } });
  if (!bin || bin.status === BinStatus.BLOCKED) return;

  const agg = await tx.stockWM.aggregate({
    where: { bin_code },
    _sum: { qty: true },
  });
  const total = agg._sum.qty ?? 0;
  const next = total > 0 ? BinStatus.OCCUPIED : BinStatus.EMPTY;
  if (next !== bin.status) {
    await tx.storageBin.update({ where: { bin_code }, data: { status: next } });
  }
}

/* ------------------------------------------------------------------ */
/* Validasi batch                                                      */
/* ------------------------------------------------------------------ */

export function validateBatch(isBatchManaged: boolean, batch: string | null, material: string) {
  if (isBatchManaged && !batch)
    throw new HttpError(400, `Material ${material} is batch managed. Batch number is mandatory.`);
  if (!isBatchManaged && batch)
    throw new HttpError(400, `Material ${material} is not batch managed. Batch must be empty.`);
}

/* ------------------------------------------------------------------ */
/* MIGO — Goods Movement (101 / 201 / 551 / 561 / 701 / 702)            */
/* ------------------------------------------------------------------ */

export async function postGoodsMovement(
  tx: Prisma.TransactionClient,
  input: MovementInput
): Promise<{ document_number: string }> {
  const qty = Math.trunc(input.qty);
  if (qty <= 0) throw new HttpError(400, 'Quantity must be greater than zero.');

  const sign = MOVEMENT_SIGN[input.movement_type];
  if (sign === 0)
    throw new HttpError(400, 'Movement 301 must be posted via transfer function (LT01/LT10).');

  const material = await getMaterialOrThrow(tx, input.material_code);
  const batch = material.is_batch_managed ? (input.batch_number ?? null) : null;
  validateBatch(material.is_batch_managed, input.batch_number ?? null, material.material_code);

  // tentukan bin yang terpengaruh
  const bin_code = sign > 0 ? input.target_bin : input.source_bin;
  if (!bin_code)
    throw new HttpError(
      400,
      sign > 0
        ? `Target storage bin is mandatory for movement ${MOVEMENT_CODE[input.movement_type]}.`
        : `Source storage bin is mandatory for movement ${MOVEMENT_CODE[input.movement_type]}.`
    );

  await getBinOrThrow(tx, bin_code);

  // 1) update Stock WM (bin + batch)
  await applyStockWM(
    tx,
    { material_code: material.material_code, bin_code, batch_number: batch },
    sign * qty,
    { mfg_date: input.mfg_date ?? null, exp_date: input.exp_date ?? null }
  );

  // 2) update Stock IM (global)
  await applyStockIM(tx, material.material_code, sign * qty);

  // 3) refresh status bin
  await refreshBinStatus(tx, bin_code);

  // 4) audit trail
  const document_number = await nextDocNumber(tx, 'MATDOC');
  await tx.migoLog.create({
    data: {
      document_number,
      movement_type: input.movement_type,
      material_code: material.material_code,
      source_bin: sign > 0 ? null : bin_code,
      target_bin: sign > 0 ? bin_code : null,
      batch_number: batch,
      qty,
      uom: material.uom,
      reference: input.reference ?? null,
      remarks: input.remarks ?? null,
      doc_date: input.doc_date ?? new Date(),
      user_id: input.user_id,
    },
  });

  return { document_number };
}

/* ------------------------------------------------------------------ */
/* LT01 / LT10 — Bin to Bin Transfer (301). Stock IM TIDAK berubah.     */
/* ------------------------------------------------------------------ */

export interface TransferInput {
  material_code: string;
  qty: number;
  batch_number?: string | null;
  source_bin: string;
  target_bin: string;
  user_id: string;
  doc_date?: Date | null;
  remarks?: string | null;
}

export async function postBinTransfer(
  tx: Prisma.TransactionClient,
  input: TransferInput
): Promise<{ document_number: string }> {
  const qty = Math.trunc(input.qty);
  if (qty <= 0) throw new HttpError(400, 'Quantity must be greater than zero.');
  if (input.source_bin === input.target_bin)
    throw new HttpError(400, 'Source and target storage bin must be different.');

  const material = await getMaterialOrThrow(tx, input.material_code);
  const batch = material.is_batch_managed ? (input.batch_number ?? null) : null;
  validateBatch(material.is_batch_managed, input.batch_number ?? null, material.material_code);

  await getBinOrThrow(tx, input.source_bin);
  await getBinOrThrow(tx, input.target_bin);

  // ambil quant sumber untuk mewarisi mfg/exp date
  const src = await tx.stockWM.findFirst({
    where: {
      material_code: material.material_code,
      bin_code: input.source_bin,
      batch_number: batch,
    },
  });
  if (!src || src.qty < qty)
    throw new HttpError(
      400,
      `Deficiency of stock in source bin ${input.source_bin}: available ${src?.qty ?? 0}, requested ${qty}.`
    );

  // 1) kurangi source
  await applyStockWM(
    tx,
    { material_code: material.material_code, bin_code: input.source_bin, batch_number: batch },
    -qty
  );
  // 2) tambah target (bawa mfg/exp date)
  await applyStockWM(
    tx,
    { material_code: material.material_code, bin_code: input.target_bin, batch_number: batch },
    qty,
    { mfg_date: src.mfg_date, exp_date: src.exp_date }
  );

  // 3) Stock IM global TIDAK berubah — hanya status bin yang di-refresh
  await refreshBinStatus(tx, input.source_bin);
  await refreshBinStatus(tx, input.target_bin);

  // 4) log 301
  const document_number = await nextDocNumber(tx, 'TRDOC');
  await tx.migoLog.create({
    data: {
      document_number,
      movement_type: MovementType.TR_301_BIN,
      material_code: material.material_code,
      source_bin: input.source_bin,
      target_bin: input.target_bin,
      batch_number: batch,
      qty,
      uom: material.uom,
      remarks: input.remarks ?? null,
      doc_date: input.doc_date ?? new Date(),
      user_id: input.user_id,
    },
  });

  return { document_number };
}
