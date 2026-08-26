import { Prisma, BinStatus, MovementType, TrStatus, TrType, type PrismaClient } from '@prisma/client';
import { HttpError } from './auth';
import { nextDocNumber } from './docnum';
import { MOVEMENT_SIGN, MOVEMENT_CODE, CANCELLED_BY, isGoodsReceipt } from './movement';
import { getSetting, isTrue } from './settings';

/* =====================================================================
 *  CORE WMS ENGINE
 *  Semua fungsi di file ini WAJIB dipanggil di dalam prisma.$transaction()
 *  agar perubahan Stock IM, Stock WM, Bin Status, dan Log bersifat ACID.
 *
 *  ALUR 2-STEP
 *    MIGO 101  -> IM+ / WM+ di TRANSIT-IN  -> Transfer Requirement PUTAWAY
 *    LB12      -> konfirmasi 301 TRANSIT-IN -> rak final
 *    MIGO 201  -> Transfer Requirement PICK (belum ada posting stok)
 *    LB12      -> konfirmasi 301 rak -> TRANSIT-OUT, lalu 201 otomatis diposting
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
  /// cost center pembebanan — wajib untuk 201 (GI Cost Center)
  cost_center?: string | null;
  tr_number?: string | null;
  via_pdt?: boolean;
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

/** Ambil bin interim dari konfigurasi sistem, pastikan ada di master. */
export async function getInterimBin(
  tx: Prisma.TransactionClient,
  which: 'DEFAULT_GR_BIN' | 'DEFAULT_GI_BIN'
) {
  const code = (await getSetting(tx, which)).toUpperCase();
  const bin = await tx.storageBin.findUnique({ where: { bin_code: code } });
  if (!bin)
    throw new HttpError(
      400,
      `Interim bin ${code} is not defined in master data. Maintain it in LS01N or change the setting in ZSET.`
    );
  return bin;
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
  dates?: { mfg_date?: Date | null; exp_date?: Date | null; gr_date?: Date | null }
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
        gr_date: dates?.gr_date ?? null,
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
        // GR date quant dipertahankan (tanggal penerimaan pertama);
        // hanya diisi bila sebelumnya kosong.
        gr_date: existing.gr_date ?? dates?.gr_date ?? null,
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
/* SPLIT PER PALLET (master kemasan)                                   */
/* ------------------------------------------------------------------ */

export interface SplitLine {
  qty: number;
  pack_code: string | null;
}

/**
 * Memecah qty menjadi beberapa line sesuai tabel palletization.
 * 2500 PC dengan pallet 1000 -> [1000, 1000, 500] (sisa jadi line sendiri).
 *
 * Pemilihan baris palletization:
 *   1. pack_code eksplisit bila diisi
 *   2. baris yang zone_group-nya sama dengan gudang tujuan, prioritas is_default
 *   3. baris tanpa zone_group (berlaku umum), prioritas is_default
 * Bila material tidak punya master kemasan, dikembalikan satu line utuh.
 */
export async function splitByPackaging(
  tx: Prisma.TransactionClient,
  material_code: string,
  qty: number,
  packCode?: string | null,
  zoneGroup?: string | null
): Promise<SplitLine[]> {
  if (!(await isTrue(tx, 'AUTO_SPLIT_PALLET'))) return [{ qty, pack_code: null }];

  const packs = await tx.packagingType.findMany({
    where: { material_code },
    orderBy: [{ is_default: 'desc' }, { qty_per_unit: 'desc' }],
  });
  if (packs.length === 0) return [{ qty, pack_code: null }];

  const group = zoneGroup ? zoneGroup.toUpperCase() : null;

  const chosen = packCode
    ? packs.find((p) => p.pack_code === packCode.toUpperCase())
    : group
      ? (packs.find((p) => p.zone_group === group && p.is_default) ??
        packs.find((p) => p.zone_group === group) ??
        packs.find((p) => !p.zone_group && p.is_default) ??
        packs.find((p) => !p.zone_group) ??
        packs.find((p) => p.is_default) ??
        packs[0])
      : (packs.find((p) => p.is_default) ?? packs[0]);

  if (!chosen || chosen.qty_per_unit <= 0) return [{ qty, pack_code: null }];

  const lines: SplitLine[] = [];
  let rest = qty;
  // batas aman supaya tidak membuat ribuan line
  const maxLines = 200;
  while (rest > 0 && lines.length < maxLines) {
    const take = Math.min(rest, chosen.qty_per_unit);
    lines.push({ qty: take, pack_code: chosen.pack_code });
    rest -= take;
  }
  if (rest > 0) lines.push({ qty: rest, pack_code: chosen.pack_code });
  return lines;
}

/* ------------------------------------------------------------------ */
/* MIGO — Goods Movement langsung (551 / 561 / 701 / 702)               */
/* ------------------------------------------------------------------ */

export async function postGoodsMovement(
  tx: Prisma.TransactionClient,
  input: MovementInput
): Promise<{ document_number: string }> {
  const qty = Math.trunc(input.qty);
  if (qty <= 0) throw new HttpError(400, 'Quantity must be greater than zero.');

  const sign = MOVEMENT_SIGN[input.movement_type];
  if (sign === 0)
    throw new HttpError(400, 'Movement 301 must be posted via transfer function (LT01/LT10/LB12).');

  const material = await getMaterialOrThrow(tx, input.material_code);
  const batch = material.is_batch_managed ? (input.batch_number ?? null) : null;
  validateBatch(material.is_batch_managed, input.batch_number ?? null, material.material_code);

  const bin_code = sign > 0 ? input.target_bin : input.source_bin;
  if (!bin_code)
    throw new HttpError(
      400,
      sign > 0
        ? `Target storage bin is mandatory for movement ${MOVEMENT_CODE[input.movement_type]}.`
        : `Source storage bin is mandatory for movement ${MOVEMENT_CODE[input.movement_type]}.`
    );

  await getBinOrThrow(tx, bin_code, input.movement_type === MovementType.ADJ_701_PLUS || input.movement_type === MovementType.ADJ_702_MIN);

  await applyStockWM(
    tx,
    { material_code: material.material_code, bin_code, batch_number: batch },
    sign * qty,
    { mfg_date: input.mfg_date ?? null, exp_date: input.exp_date ?? null }
  );
  await applyStockIM(tx, material.material_code, sign * qty);
  await refreshBinStatus(tx, bin_code);

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
      cost_center: input.cost_center ?? null,
      tr_number: input.tr_number ?? null,
      via_pdt: input.via_pdt ?? false,
      doc_date: input.doc_date ?? new Date(),
      user_id: input.user_id,
    },
  });

  return { document_number };
}

/* ------------------------------------------------------------------ */
/* Bin to Bin Transfer (301). Stock IM TIDAK berubah.                   */
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
  tr_number?: string | null;
  via_pdt?: boolean;
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

  await applyStockWM(
    tx,
    { material_code: material.material_code, bin_code: input.source_bin, batch_number: batch },
    -qty
  );
  await applyStockWM(
    tx,
    { material_code: material.material_code, bin_code: input.target_bin, batch_number: batch },
    qty,
    { mfg_date: src.mfg_date, exp_date: src.exp_date, gr_date: src.gr_date }
  );

  await refreshBinStatus(tx, input.source_bin);
  await refreshBinStatus(tx, input.target_bin);

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
      tr_number: input.tr_number ?? null,
      via_pdt: input.via_pdt ?? false,
      doc_date: input.doc_date ?? new Date(),
      user_id: input.user_id,
    },
  });

  return { document_number };
}

/* ==================================================================== */
/* TRANSFER REQUIREMENT — LB10 / LB12                                    */
/* ==================================================================== */

export interface TrItemInput {
  material_code: string;
  batch_number?: string | null;
  mfg_date?: Date | null;
  exp_date?: Date | null;
  pack_code?: string | null;
  qty: number;
  source_bin?: string | null;
  target_bin?: string | null;
}

export async function createTransferReq(
  tx: Prisma.TransactionClient,
  args: {
    tr_type: TrType;
    items: TrItemInput[];
    ref_doc?: string | null;
    reference?: string | null;
    remarks?: string | null;
    cost_center?: string | null;
    user_id: string;
  }
) {
  if (args.items.length === 0) throw new HttpError(400, 'Transfer requirement has no items.');
  const tr_number = await nextDocNumber(tx, 'TRREQ');

  return tx.transferReq.create({
    data: {
      tr_number,
      tr_type: args.tr_type,
      ref_doc: args.ref_doc ?? null,
      reference: args.reference ?? null,
      remarks: args.remarks ?? null,
      cost_center: args.cost_center ?? null,
      created_by: args.user_id,
      items: {
        create: args.items.map((it, i) => ({
          line_no: i + 1,
          material_code: it.material_code,
          batch_number: it.batch_number ?? null,
          mfg_date: it.mfg_date ?? null,
          exp_date: it.exp_date ?? null,
          pack_code: it.pack_code ?? null,
          qty: it.qty,
          source_bin: it.source_bin ?? null,
          target_bin: it.target_bin ?? null,
        })),
      },
    },
    include: { items: { orderBy: { line_no: 'asc' } } },
  });
}

/**
 * MIGO 101 — Goods Receipt (level IM).
 * Stok masuk ke bin interim TRANSIT-IN, lalu dibuatkan TR PUTAWAY yang dipecah per pallet.
 */
export async function postGoodsReceipt(
  tx: Prisma.TransactionClient,
  args: {
    material_code: string;
    qty: number;
    batch_number?: string | null;
    mfg_date?: Date | null;
    exp_date?: Date | null;
    pack_code?: string | null;
    /** kelompok gudang tujuan: BESAR | KECIL — menentukan baris palletization */
    zone_group?: string | null;
    reference?: string | null;
    remarks?: string | null;
    doc_date?: Date | null;
    user_id: string;
    via_pdt?: boolean;
    /**
     * Jenis penerimaan. Bawaannya 101 (pembelian); 501 dipakai untuk retur dan
     * penerimaan lain di luar pembelian.
     *
     * Hanya penandanya yang berbeda — alurnya identik: barang masuk ke bin
     * transit, Transfer Requirement put-away dibuat, dan raknya ditentukan
     * belakangan lewat LB12/ZRF02. Menyalin seluruh fungsi ini demi satu kode
     * yang berbeda hanya akan melahirkan dua jalur yang lambat laun menyimpang.
     */
    movement_type?: MovementType;
  }
) {
  const qty = Math.trunc(args.qty);
  if (qty <= 0) throw new HttpError(400, 'Quantity must be greater than zero.');

  const material = await getMaterialOrThrow(tx, args.material_code);
  const batch = material.is_batch_managed ? (args.batch_number ?? null) : null;
  validateBatch(material.is_batch_managed, args.batch_number ?? null, material.material_code);

  const grBin = await getInterimBin(tx, 'DEFAULT_GR_BIN');

  // 1) posting IM + WM ke bin interim
  await applyStockWM(
    tx,
    { material_code: material.material_code, bin_code: grBin.bin_code, batch_number: batch },
    qty,
    { mfg_date: args.mfg_date ?? null, exp_date: args.exp_date ?? null, gr_date: args.doc_date ?? new Date() }
  );
  await applyStockIM(tx, material.material_code, qty);
  await refreshBinStatus(tx, grBin.bin_code);

  // 2) material document 101
  const document_number = await nextDocNumber(tx, 'MATDOC');

  // 3) TR PUTAWAY, dipecah per pallet
  const split = await splitByPackaging(tx, material.material_code, qty, args.pack_code, args.zone_group);
  const tr = await createTransferReq(tx, {
    tr_type: TrType.PUTAWAY,
    ref_doc: document_number,
    reference: args.reference ?? null,
    remarks: args.remarks ?? null,
    user_id: args.user_id,
    items: split.map((s) => ({
      material_code: material.material_code,
      batch_number: batch,
      mfg_date: args.mfg_date ?? null,
      exp_date: args.exp_date ?? null,
      pack_code: s.pack_code,
      qty: s.qty,
      source_bin: grBin.bin_code,
      target_bin: null,
    })),
  });

  await tx.migoLog.create({
    data: {
      document_number,
      movement_type: args.movement_type ?? MovementType.GR_101,
      material_code: material.material_code,
      target_bin: grBin.bin_code,
      batch_number: batch,
      qty,
      uom: material.uom,
      reference: args.reference ?? null,
      remarks: args.remarks ?? null,
      tr_number: tr.tr_number,
      via_pdt: args.via_pdt ?? false,
      doc_date: args.doc_date ?? new Date(),
      user_id: args.user_id,
    },
  });

  return { document_number, tr };
}

/**
 * MIGO 201 — Goods Issue Request (level IM).
 * BELUM memposting stok; hanya membuat TR PICK. Goods issue diposting otomatis
 * saat seluruh item TR dikonfirmasi di LB12.
 */
export async function createPickRequest(
  tx: Prisma.TransactionClient,
  args: {
    material_code: string;
    qty: number;
    batch_number?: string | null;
    pack_code?: string | null;
    zone_group?: string | null;
    reference?: string | null;
    remarks?: string | null;
    /// dibawa ke TR supaya langkah goods issue mewarisi pembebanannya
    cost_center?: string | null;
    user_id: string;
  }
) {
  const qty = Math.trunc(args.qty);
  if (qty <= 0) throw new HttpError(400, 'Quantity must be greater than zero.');

  const material = await getMaterialOrThrow(tx, args.material_code);
  const batch = material.is_batch_managed ? (args.batch_number ?? null) : null;
  if (material.is_batch_managed && !batch)
    throw new HttpError(
      400,
      `Material ${material.material_code} is batch managed. Batch number is mandatory.`
    );

  const giBin = await getInterimBin(tx, 'DEFAULT_GI_BIN');

  // Ketersediaan dihitung HANYA dari rak penyimpanan.
  // Stok yang masih menunggu put-away di GR zone belum boleh dijanjikan untuk picking.
  const interimBins = await tx.storageBin.findMany({
    where: { is_interim: true },
    select: { bin_code: true },
  });
  const interimCodes = interimBins.map((b) => b.bin_code);

  const available = await tx.stockWM.aggregate({
    where: {
      material_code: material.material_code,
      batch_number: batch,
      bin_code: { notIn: interimCodes.length ? interimCodes : [giBin.bin_code] },
    },
    _sum: { qty: true },
  });

  if ((available._sum.qty ?? 0) < qty) {
    const pending = await tx.stockWM.aggregate({
      where: {
        material_code: material.material_code,
        batch_number: batch,
        bin_code: { in: interimCodes },
      },
      _sum: { qty: true },
    });
    const waiting = pending._sum.qty ?? 0;
    throw new HttpError(
      400,
      `Deficiency of stock: only ${available._sum.qty ?? 0} available on racks for ${material.material_code}${batch ? ' / batch ' + batch : ''}.` +
        (waiting > 0
          ? ` ${waiting} unit(s) are still waiting for put-away in the interim zone — process the transfer requirement in LB12 first.`
          : '')
    );
  }

  const split = await splitByPackaging(tx, material.material_code, qty, args.pack_code, args.zone_group);

  const tr = await createTransferReq(tx, {
    tr_type: TrType.PICK,
    reference: args.reference ?? null,
    remarks: args.remarks ?? null,
    cost_center: args.cost_center ?? null,
    user_id: args.user_id,
    items: split.map((s) => ({
      material_code: material.material_code,
      batch_number: batch,
      pack_code: s.pack_code,
      qty: s.qty,
      source_bin: null,
      target_bin: giBin.bin_code,
    })),
  });

  return { tr };
}

/**
 * LB12 — Konfirmasi satu item Transfer Requirement.
 * PUTAWAY : 301 dari TRANSIT-IN  -> target_bin (diisi operator)
 * PICK    : 301 dari source_bin (diisi operator) -> TRANSIT-OUT
 * INTERNAL: 301 dari source_bin -> target_bin
 */
export async function confirmTrItem(
  tx: Prisma.TransactionClient,
  args: {
    item_id: string;
    qty: number;
    bin: string;
    user_id: string;
    via_pdt?: boolean;
  }
) {
  const item = await tx.transferReqItem.findUnique({
    where: { id: args.item_id },
    include: { tr: true },
  });
  if (!item) throw new HttpError(404, 'Transfer requirement item does not exist.');
  if (item.status === TrStatus.CLOSED)
    throw new HttpError(400, `Line ${item.line_no} is already confirmed.`);
  if (item.tr.status === TrStatus.CANCELLED)
    throw new HttpError(400, `Transfer requirement ${item.tr.tr_number} is cancelled.`);

  const qty = Math.trunc(args.qty);
  const open = item.qty - item.qty_confirmed;
  if (qty <= 0) throw new HttpError(400, 'Confirmation quantity must be greater than zero.');
  if (qty > open)
    throw new HttpError(400, `Line ${item.line_no}: only ${open} open for confirmation.`);

  const bin = args.bin.toUpperCase();
  const binRow = await getBinOrThrow(tx, bin);

  let source_bin: string;
  let target_bin: string;

  if (item.tr.tr_type === TrType.PUTAWAY) {
    if (binRow.is_interim)
      throw new HttpError(400, `Bin ${bin} is an interim bin and cannot be used for put-away.`);
    source_bin = item.source_bin ?? (await getInterimBin(tx, 'DEFAULT_GR_BIN')).bin_code;
    target_bin = bin;
  } else if (item.tr.tr_type === TrType.PICK) {
    if (binRow.is_interim)
      throw new HttpError(400, `Bin ${bin} is an interim bin and cannot be used as picking source.`);
    source_bin = bin;
    target_bin = item.target_bin ?? (await getInterimBin(tx, 'DEFAULT_GI_BIN')).bin_code;
  } else {
    source_bin = item.source_bin ?? bin;
    target_bin = item.target_bin ?? bin;
    if (source_bin === target_bin)
      throw new HttpError(400, 'Source and target storage bin must be different.');
  }

  const transfer = await postBinTransfer(tx, {
    material_code: item.material_code,
    qty,
    batch_number: item.batch_number,
    source_bin,
    target_bin,
    user_id: args.user_id,
    tr_number: item.tr.tr_number,
    via_pdt: args.via_pdt,
    remarks: `TR ${item.tr.tr_number} line ${item.line_no}`,
  });

  const newConfirmed = item.qty_confirmed + qty;
  await tx.transferReqItem.update({
    where: { id: item.id },
    data: {
      qty_confirmed: newConfirmed,
      status: newConfirmed >= item.qty ? TrStatus.CLOSED : TrStatus.PARTIAL,
      source_bin,
      target_bin,
    },
  });

  // hitung ulang status header
  const siblings = await tx.transferReqItem.findMany({ where: { tr_id: item.tr_id } });
  const allClosed = siblings.every((s) => (s.id === item.id ? newConfirmed >= s.qty : s.status === TrStatus.CLOSED));
  const anyProgress = siblings.some((s) => (s.id === item.id ? newConfirmed > 0 : s.qty_confirmed > 0));

  if (allClosed) {
    await tx.transferReq.update({
      where: { id: item.tr_id },
      data: { status: TrStatus.CLOSED, closed_at: new Date() },
    });
  } else if (anyProgress) {
    await tx.transferReq.update({ where: { id: item.tr_id }, data: { status: TrStatus.PARTIAL } });
  }

  return {
    document_number: transfer.document_number,
    tr_number: item.tr.tr_number,
    line_no: item.line_no,
    source_bin,
    target_bin,
    qty,
    tr_closed: allClosed,
    /** PICK selesai: stok siap dikeluarkan lewat MIGO 201 dari bin interim ini */
    ready_for_issue: allClosed && item.tr.tr_type === TrType.PICK ? target_bin : null,
  };
}

/**
 * MIGO 201 — Post Goods Issue dari bin interim TRANSIT-OUT.
 * Dipanggil setelah picking selesai (LB12 / ZRF03) memindahkan stok ke GI zone.
 */
export async function postGoodsIssue(
  tx: Prisma.TransactionClient,
  args: {
    material_code: string;
    qty: number;
    batch_number?: string | null;
    reference?: string | null;
    remarks?: string | null;
    cost_center?: string | null;
    tr_number?: string | null;
    doc_date?: Date | null;
    user_id: string;
    via_pdt?: boolean;
  }
) {
  const giBin = await getInterimBin(tx, 'DEFAULT_GI_BIN');
  const material = await getMaterialOrThrow(tx, args.material_code);
  const batch = material.is_batch_managed ? (args.batch_number ?? null) : null;

  const quant = await tx.stockWM.findFirst({
    where: {
      material_code: material.material_code,
      bin_code: giBin.bin_code,
      batch_number: batch,
    },
  });
  if (!quant || quant.qty < args.qty)
    throw new HttpError(
      400,
      `Deficiency of stock in GI zone ${giBin.bin_code}: available ${quant?.qty ?? 0}, requested ${args.qty}. ` +
        `Confirm the picking transfer requirement in LB12 first.`
    );

  return postGoodsMovement(tx, {
    movement_type: MovementType.GI_201,
    material_code: material.material_code,
    qty: args.qty,
    batch_number: batch,
    source_bin: giBin.bin_code,
    reference: args.reference ?? null,
    remarks: args.remarks ?? null,
    cost_center: args.cost_center ?? null,
    tr_number: args.tr_number ?? null,
    doc_date: args.doc_date ?? null,
    via_pdt: args.via_pdt,
    user_id: args.user_id,
  });
}

/* ------------------------------------------------------------------ */
/* CANCELLATION — 102 / 202 / 552 / 562 / 711 / 712                     */
/* Membatalkan dokumen MIGO dengan data PERSIS sama (qty, batch, bin).  */
/* ------------------------------------------------------------------ */

export interface CancelPreview {
  document_number: string;
  movement_type: MovementType;
  cancel_movement: MovementType;
  material_code: string;
  description: string;
  uom: string;
  qty: number;
  batch_number: string | null;
  source_bin: string | null;
  target_bin: string | null;
  doc_date: Date;
  reference: string | null;
  tr_number: string | null;
  user_id: string;
}

/** Ambil dokumen asal + validasi kelayakan pembatalan (dipakai GET preview & POST). */
export async function getCancellable(
  tx: ReadDb,
  document_number: string
): Promise<CancelPreview> {
  const orig = await tx.migoLog.findUnique({ where: { document_number } });
  if (!orig) throw new HttpError(404, `Material document ${document_number} does not exist.`);
  if (orig.reversal_of)
    throw new HttpError(400, `Document ${document_number} is itself a cancellation document and cannot be cancelled.`);
  if (orig.reversed_by)
    throw new HttpError(400, `Document ${document_number} has already been cancelled by document ${orig.reversed_by}.`);

  const cancelType = CANCELLED_BY[orig.movement_type];
  if (!cancelType)
    throw new HttpError(
      400,
      `Movement ${MOVEMENT_CODE[orig.movement_type]} cannot be cancelled here. ` +
        `Bin transfer (301) dibatalkan dengan transfer balik lewat LT01.`
    );

  const material = await tx.material.findUnique({ where: { material_code: orig.material_code } });

  return {
    document_number: orig.document_number,
    movement_type: orig.movement_type,
    cancel_movement: cancelType,
    material_code: orig.material_code,
    description: material?.description ?? '',
    uom: orig.uom,
    qty: orig.qty,
    batch_number: orig.batch_number,
    source_bin: orig.source_bin,
    target_bin: orig.target_bin,
    doc_date: orig.doc_date,
    reference: orig.reference,
    tr_number: orig.tr_number,
    user_id: orig.user_id,
  };
}

/**
 * Posting pembatalan dokumen. Seluruh data (material, qty, batch, bin) diambil
 * dari dokumen asal dan TIDAK dapat diubah — sesuai perilaku MIGO Cancellation.
 */
export async function postCancellation(
  tx: Prisma.TransactionClient,
  args: {
    document_number: string;
    user_id: string;
    remarks?: string | null;
    via_pdt?: boolean;
  }
): Promise<{ document_number: string; cancel_movement: MovementType; original: CancelPreview }> {
  const prev = await getCancellable(tx, args.document_number);
  const origSign = MOVEMENT_SIGN[prev.movement_type]; // +1 = dulu menambah stok
  const bin_code = origSign > 0 ? prev.target_bin : prev.source_bin;
  if (!bin_code)
    throw new HttpError(400, `Document ${prev.document_number} has no storage bin reference.`);

  // bin boleh BLOCKED? tidak — konsisten dengan aturan movement biasa,
  // tapi izinkan bila bin interim (transit) karena cancel GR/GI menunjuk ke sana.
  await getBinOrThrow(tx, bin_code, false);

  // Khusus cancel GR (102): Transfer Requirement put-away terkait harus belum
  // dikonfirmasi sama sekali — bila barang sudah dipindah ke rak, stok di bin
  // interim memang sudah tidak utuh dan pembatalan harus ditolak.
  // Berlaku untuk SEMUA jenis penerimaan (101 maupun 501): keduanya menaruh
  // barang di bin transit dan membuat TR put-away, jadi syarat pembatalannya
  // sama persis.
  if (isGoodsReceipt(prev.movement_type) && prev.tr_number) {
    const tr = await tx.transferReq.findUnique({
      where: { tr_number: prev.tr_number },
      include: { items: true },
    });
    if (tr && tr.status !== TrStatus.CANCELLED) {
      if (tr.items.some((i) => i.qty_confirmed > 0))
        throw new HttpError(
          400,
          `Put-away for TR ${tr.tr_number} is already (partially) confirmed. ` +
            `Cancellation 102 is only possible while the stock is still in the interim bin.`
        );
      await tx.transferReq.update({
        where: { id: tr.id },
        data: { status: TrStatus.CANCELLED, closed_at: new Date() },
      });
      await tx.transferReqItem.updateMany({
        where: { tr_id: tr.id },
        data: { status: TrStatus.CANCELLED },
      });
    }
  }

  // Tanggal batch untuk quant yang dibuat kembali (cancel dari movement minus):
  // ambil dari quant lain material+batch yang masih ada.
  let dates: { mfg_date?: Date | null; exp_date?: Date | null; gr_date?: Date | null } | undefined;
  if (origSign < 0) {
    const sibling = await tx.stockWM.findFirst({
      where: { material_code: prev.material_code, batch_number: prev.batch_number },
      orderBy: { updated_at: 'desc' },
    });
    dates = {
      mfg_date: sibling?.mfg_date ?? null,
      exp_date: sibling?.exp_date ?? null,
      gr_date: sibling?.gr_date ?? prev.doc_date,
    };
  }

  // posting stok kebalikan arah dokumen asal — qty & batch persis sama
  await applyStockWM(
    tx,
    { material_code: prev.material_code, bin_code, batch_number: prev.batch_number },
    -origSign * prev.qty,
    dates
  );
  await applyStockIM(tx, prev.material_code, -origSign * prev.qty);
  await refreshBinStatus(tx, bin_code);

  const document_number = await nextDocNumber(tx, 'MATDOC');
  await tx.migoLog.create({
    data: {
      document_number,
      movement_type: prev.cancel_movement,
      material_code: prev.material_code,
      // arah dibalik: dokumen cancel yang MENGURANGI stok memakai source_bin, dst.
      source_bin: origSign > 0 ? bin_code : null,
      target_bin: origSign > 0 ? null : bin_code,
      batch_number: prev.batch_number,
      qty: prev.qty,
      uom: prev.uom,
      reference: prev.reference,
      remarks: args.remarks?.trim() || `Cancellation of ${prev.document_number}`,
      tr_number: prev.tr_number,
      via_pdt: args.via_pdt ?? false,
      doc_date: new Date(),
      user_id: args.user_id,
      reversal_of: prev.document_number,
    },
  });

  await tx.migoLog.update({
    where: { document_number: prev.document_number },
    data: { reversed_by: document_number },
  });

  return { document_number, cancel_movement: prev.cancel_movement, original: prev };
}

/** Bisa dipanggil dengan PrismaClient biasa maupun di dalam transaction. */
type ReadDb = Prisma.TransactionClient | PrismaClient;

/** Saran bin sumber untuk picking, urut FEFO (expired terdekat lebih dulu). */
export async function suggestPickBins(
  tx: ReadDb,
  material_code: string,
  batch_number: string | null,
  excludeBin?: string
) {
  const quants = await tx.stockWM.findMany({
    where: {
      material_code,
      batch_number,
      qty: { gt: 0 },
      ...(excludeBin ? { bin_code: { not: excludeBin } } : {}),
    },
    orderBy: [{ exp_date: 'asc' }, { bin_code: 'asc' }],
    take: 50,
  });
  const bins = await tx.storageBin.findMany({
    where: { bin_code: { in: quants.map((q) => q.bin_code) } },
  });
  const bMap = new Map(bins.map((b) => [b.bin_code, b]));
  return quants
    .filter((q) => !bMap.get(q.bin_code)?.is_interim)
    .map((q) => ({
      bin_code: q.bin_code,
      zone_id: bMap.get(q.bin_code)?.zone_id ?? '',
      qty: q.qty,
      exp_date: q.exp_date,
    }));
}

/** Saran bin kosong untuk put-away, prioritas zona pick lalu reserve. */
export async function suggestPutawayBins(tx: ReadDb, limit = 20) {
  const bins = await tx.storageBin.findMany({
    where: { status: BinStatus.EMPTY, is_interim: false },
    orderBy: [{ zone_id: 'asc' }, { bin_code: 'asc' }],
    take: limit,
  });
  return bins.map((b) => ({ bin_code: b.bin_code, zone_id: b.zone_id, status: b.status }));
}
