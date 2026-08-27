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
  /**
   * Nomor dokumen yang SUDAH dialokasikan pemanggil. Dipakai bila baris ini
   * bagian dari satu material document berisi banyak baris; bila kosong,
   * fungsi ini mengambil nomor sendiri (dokumen satu baris).
   */
  document_number?: string | null;
  /** nomor baris di dalam dokumen tersebut; bawaannya 1 */
  line_no?: number;
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
): Promise<{ document_number: string; line_no: number }> {
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

  const document_number = input.document_number ?? (await nextDocNumber(tx, 'MATDOC'));
  const line_no = input.line_no ?? 1;
  await tx.migoLog.create({
    data: {
      document_number,
      line_no,
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

  return { document_number, line_no };
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
  /**
   * Nomor baris dokumen MIGO asal. Diisi saat satu dokumen berisi banyak baris
   * supaya pembatalan per baris tahu tugas put-away mana yang ikut dibatalkan
   * (satu baris MIGO bisa pecah jadi beberapa baris TR karena split pallet).
   */
  src_line?: number | null;
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
          src_line: it.src_line ?? null,
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
    /** nomor dokumen yang sudah dialokasikan pemanggil (dokumen multi-baris) */
    document_number?: string | null;
    /** nomor baris di dalam dokumen tersebut; bawaannya 1 */
    line_no?: number;
    /**
     * Mode dokumen gabungan. Bila diisi, fungsi ini TIDAK membuat Transfer
     * Requirement sendiri; baris put-away hasil pemecahan pallet didorong ke
     * array milik pemanggil, yang lalu membuat SATU TR untuk seluruh dokumen.
     * Inilah yang membuat satu posting MIGO 5 baris menghasilkan satu daftar
     * kerja put-away, bukan lima.
     */
    defer_tr?: TrItemInput[];
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
  const document_number = args.document_number ?? (await nextDocNumber(tx, 'MATDOC'));
  const line_no = args.line_no ?? 1;

  // 3) baris put-away, dipecah per pallet
  const split = await splitByPackaging(tx, material.material_code, qty, args.pack_code, args.zone_group);
  const trItems: TrItemInput[] = split.map((s) => ({
    material_code: material.material_code,
    batch_number: batch,
    mfg_date: args.mfg_date ?? null,
    exp_date: args.exp_date ?? null,
    pack_code: s.pack_code,
    qty: s.qty,
    source_bin: grBin.bin_code,
    target_bin: null,
    src_line: line_no,
  }));

  // Dokumen gabungan: TR dibuat sekali oleh pemanggil setelah semua baris
  // selesai, jadi nomornya belum ada di sini dan ditulis balik belakangan.
  let tr: Awaited<ReturnType<typeof createTransferReq>> | null = null;
  if (args.defer_tr) {
    args.defer_tr.push(...trItems);
  } else {
    tr = await createTransferReq(tx, {
      tr_type: TrType.PUTAWAY,
      ref_doc: document_number,
      reference: args.reference ?? null,
      remarks: args.remarks ?? null,
      user_id: args.user_id,
      items: trItems,
    });
  }

  await tx.migoLog.create({
    data: {
      document_number,
      line_no,
      movement_type: args.movement_type ?? MovementType.GR_101,
      material_code: material.material_code,
      target_bin: grBin.bin_code,
      batch_number: batch,
      qty,
      uom: material.uom,
      reference: args.reference ?? null,
      remarks: args.remarks ?? null,
      tr_number: tr?.tr_number ?? null,
      via_pdt: args.via_pdt ?? false,
      doc_date: args.doc_date ?? new Date(),
      user_id: args.user_id,
    },
  });

  return { document_number, line_no, tr, tr_lines: trItems.length };
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
    /** nomor baris permintaan asal — ikut ditulis ke item TR */
    line_no?: number;
    /**
     * Mode dokumen gabungan: baris picking didorong ke array milik pemanggil
     * agar seluruh permintaan jadi SATU Transfer Requirement.
     */
    defer_tr?: TrItemInput[];
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
  const trItems: TrItemInput[] = split.map((s) => ({
    material_code: material.material_code,
    batch_number: batch,
    pack_code: s.pack_code,
    qty: s.qty,
    source_bin: null,
    target_bin: giBin.bin_code,
    src_line: args.line_no ?? 1,
  }));

  if (args.defer_tr) {
    args.defer_tr.push(...trItems);
    return { tr: null, tr_lines: trItems.length };
  }

  const tr = await createTransferReq(tx, {
    tr_type: TrType.PICK,
    reference: args.reference ?? null,
    remarks: args.remarks ?? null,
    cost_center: args.cost_center ?? null,
    user_id: args.user_id,
    items: trItems,
  });

  return { tr, tr_lines: trItems.length };
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
  // Baris bisa dibatalkan sendirian sejak pembatalan MIGO berlaku per baris:
  // barangnya sudah tidak ada lagi di bin interim, jadi tidak boleh disimpan.
  if (item.status === TrStatus.CANCELLED)
    throw new HttpError(
      400,
      `Line ${item.line_no} was cancelled together with its material document line and cannot be confirmed.`
    );
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
  // Baris yang DIBATALKAN ikut dihitung selesai — kalau tidak, satu baris batal
  // membuat header TR menggantung PARTIAL selamanya di LB10.
  const allClosed = siblings.every((s) =>
    s.id === item.id
      ? newConfirmed >= s.qty
      : s.status === TrStatus.CLOSED || s.status === TrStatus.CANCELLED
  );
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
    document_number?: string | null;
    line_no?: number;
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
    document_number: args.document_number ?? null,
    line_no: args.line_no,
  });
}

/* ------------------------------------------------------------------ */
/* CANCELLATION — 102 / 202 / 552 / 562 / 711 / 712                     */
/* Membatalkan dokumen MIGO dengan data PERSIS sama (qty, batch, bin).  */
/* ------------------------------------------------------------------ */

export interface CancelPreview {
  document_number: string;
  /// nomor baris di dalam dokumen — pembatalan berlaku per baris
  line_no: number;
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
  /// false bila baris ini sudah pernah dibatalkan
  cancellable: boolean;
  /// alasan baris tidak bisa dibatalkan (untuk ditampilkan di layar)
  blocked_reason: string | null;
}

export interface CancelDocPreview {
  document_number: string;
  doc_date: Date;
  reference: string | null;
  user_id: string;
  lines: CancelPreview[];
}

/**
 * Ambil SELURUH baris dokumen + status kelayakan pembatalannya.
 * Dipakai layar preview: operator memilih baris mana yang dibatalkan.
 */
export async function getCancellableDoc(
  tx: ReadDb,
  document_number: string
): Promise<CancelDocPreview> {
  const rows = await tx.migoLog.findMany({
    where: { document_number },
    orderBy: { line_no: 'asc' },
  });
  if (rows.length === 0)
    throw new HttpError(404, `Material document ${document_number} does not exist.`);
  if (rows.some((r) => r.reversal_of))
    throw new HttpError(
      400,
      `Document ${document_number} is itself a cancellation document and cannot be cancelled.`
    );

  const codes = [...new Set(rows.map((r) => r.material_code))];
  const materials = await tx.material.findMany({
    where: { material_code: { in: codes } },
    select: { material_code: true, description: true },
  });
  const descOf = new Map(materials.map((m) => [m.material_code, m.description]));

  const lines: CancelPreview[] = rows.map((r) => {
    const cancelType = CANCELLED_BY[r.movement_type];
    return {
      document_number: r.document_number,
      line_no: r.line_no,
      movement_type: r.movement_type,
      // bila movement-nya memang tidak bisa dibatalkan, kolomnya diisi dengan
      // movement asal agar tipenya tetap terisi; kelayakannya ditandai terpisah.
      cancel_movement: cancelType ?? r.movement_type,
      material_code: r.material_code,
      description: descOf.get(r.material_code) ?? '',
      uom: r.uom,
      qty: r.qty,
      batch_number: r.batch_number,
      source_bin: r.source_bin,
      target_bin: r.target_bin,
      doc_date: r.doc_date,
      reference: r.reference,
      tr_number: r.tr_number,
      user_id: r.user_id,
      cancellable: !r.reversed_by && !!cancelType,
      blocked_reason: r.reversed_by
        ? `Sudah dibatalkan oleh dokumen ${r.reversed_by} baris ${r.reversed_by_line ?? 1}.`
        : !cancelType
          ? `Movement ${MOVEMENT_CODE[r.movement_type]} tidak dapat dibatalkan di sini. ` +
            'Bin transfer (301) dibatalkan dengan transfer balik lewat LT01.'
          : null,
    };
  });

  if (lines.every((l) => !l.cancellable))
    throw new HttpError(
      400,
      lines[0].blocked_reason ?? `Document ${document_number} cannot be cancelled.`
    );

  return {
    document_number,
    doc_date: rows[0].doc_date,
    reference: rows[0].reference,
    user_id: rows[0].user_id,
    lines,
  };
}

/** Satu baris saja — dipakai pemanggil lama yang hanya mengenal nomor dokumen. */
export async function getCancellable(
  tx: ReadDb,
  document_number: string,
  line_no?: number
): Promise<CancelPreview> {
  const doc = await getCancellableDoc(tx, document_number);
  const line =
    line_no === undefined
      ? doc.lines.find((l) => l.cancellable)
      : doc.lines.find((l) => l.line_no === line_no);
  if (!line)
    throw new HttpError(
      404,
      `Document ${document_number} line ${line_no} does not exist.`
    );
  if (!line.cancellable)
    throw new HttpError(400, line.blocked_reason ?? `Line ${line.line_no} cannot be cancelled.`);
  return line;
}

/**
 * Posting pembatalan. Seluruh data (material, qty, batch, bin) diambil dari
 * dokumen asal dan TIDAK dapat diubah — sesuai perilaku MIGO Cancellation.
 *
 * Pembatalan berlaku PER BARIS: `lines` yang kosong berarti seluruh baris yang
 * masih layak dibatalkan. Hasilnya satu dokumen pembatalan berisi sebanyak
 * baris yang dibatalkan.
 */
export async function postCancellation(
  tx: Prisma.TransactionClient,
  args: {
    document_number: string;
    /** nomor baris yang dibatalkan; kosong = semua baris yang masih layak */
    lines?: number[] | null;
    user_id: string;
    remarks?: string | null;
    via_pdt?: boolean;
  }
): Promise<{
  document_number: string;
  cancel_movement: MovementType;
  lines: { line_no: number; source_line: number; material_code: string; qty: number }[];
  original: CancelDocPreview;
}> {
  const doc = await getCancellableDoc(tx, args.document_number);

  const wanted = args.lines && args.lines.length ? new Set(args.lines) : null;
  if (wanted) {
    for (const n of wanted) {
      const l = doc.lines.find((x) => x.line_no === n);
      if (!l) throw new HttpError(400, `Line ${n} does not exist in document ${doc.document_number}.`);
      if (!l.cancellable)
        throw new HttpError(400, `Line ${n}: ${l.blocked_reason ?? 'cannot be cancelled.'}`);
    }
  }
  const targets = doc.lines.filter((l) => l.cancellable && (!wanted || wanted.has(l.line_no)));
  if (targets.length === 0)
    throw new HttpError(400, 'No cancellable line was selected.');

  /* ---------------------------------------------------------------- *
   * Cancel GR (102/502): tugas put-away untuk baris yang dibatalkan
   * harus BELUM dikonfirmasi sama sekali — kalau barangnya sudah naik
   * ke rak, stok di bin interim tidak lagi utuh dan pembatalan ditolak.
   * Sejak satu dokumen memakai satu TR bersama, yang diperiksa dan
   * dibatalkan hanyalah item TR milik baris tersebut (src_line).
   * ---------------------------------------------------------------- */
  const grTargets = targets.filter((l) => isGoodsReceipt(l.movement_type) && l.tr_number);
  const trNumbers = [...new Set(grTargets.map((l) => l.tr_number as string))];
  for (const trNumber of trNumbers) {
    const tr = await tx.transferReq.findUnique({
      where: { tr_number: trNumber },
      include: { items: true },
    });
    if (!tr || tr.status === TrStatus.CANCELLED) continue;

    const srcLines = new Set(
      grTargets.filter((l) => l.tr_number === trNumber).map((l) => l.line_no)
    );
    // Dokumen lama dibuat sebelum ada src_line: satu dokumen = satu baris,
    // jadi item tanpa penanda memang milik baris ke-1.
    const mine = tr.items.filter((i) => srcLines.has(i.src_line ?? 1));
    if (mine.some((i) => i.qty_confirmed > 0))
      throw new HttpError(
        400,
        `Put-away for TR ${tr.tr_number} is already (partially) confirmed. ` +
          `Cancellation is only possible while the stock is still in the interim bin.`
      );

    await tx.transferReqItem.updateMany({
      where: { id: { in: mine.map((i) => i.id) } },
      data: { status: TrStatus.CANCELLED },
    });

    // Status header dihitung ulang: baris batal dianggap selesai, jadi TR yang
    // sisa barisnya sudah dikonfirmasi ikut tertutup dan tidak menggantung
    // PARTIAL di LB10.
    const others = tr.items.filter((i) => !mine.some((m) => m.id === i.id));
    const othersDone = others.every(
      (i) => i.status === TrStatus.CLOSED || i.status === TrStatus.CANCELLED
    );
    if (othersDone) {
      const anyConfirmed = others.some((i) => i.qty_confirmed > 0);
      await tx.transferReq.update({
        where: { id: tr.id },
        data: {
          status: anyConfirmed ? TrStatus.CLOSED : TrStatus.CANCELLED,
          closed_at: new Date(),
        },
      });
    }
  }

  const document_number = await nextDocNumber(tx, 'MATDOC');
  const posted: { line_no: number; source_line: number; material_code: string; qty: number }[] = [];

  for (let i = 0; i < targets.length; i++) {
    const prev = targets[i];
    const line_no = i + 1;
    const origSign = MOVEMENT_SIGN[prev.movement_type]; // +1 = dulu menambah stok
    const bin_code = origSign > 0 ? prev.target_bin : prev.source_bin;
    if (!bin_code)
      throw new HttpError(
        400,
        `Document ${prev.document_number} line ${prev.line_no} has no storage bin reference.`
      );

    await getBinOrThrow(tx, bin_code, false);

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

    await applyStockWM(
      tx,
      { material_code: prev.material_code, bin_code, batch_number: prev.batch_number },
      -origSign * prev.qty,
      dates
    );
    await applyStockIM(tx, prev.material_code, -origSign * prev.qty);
    await refreshBinStatus(tx, bin_code);

    await tx.migoLog.create({
      data: {
        document_number,
        line_no,
        movement_type: prev.cancel_movement,
        material_code: prev.material_code,
        // arah dibalik: dokumen cancel yang MENGURANGI stok memakai source_bin, dst.
        source_bin: origSign > 0 ? bin_code : null,
        target_bin: origSign > 0 ? null : bin_code,
        batch_number: prev.batch_number,
        qty: prev.qty,
        uom: prev.uom,
        reference: prev.reference,
        remarks:
          args.remarks?.trim() ||
          `Cancellation of ${prev.document_number} line ${prev.line_no}`,
        tr_number: prev.tr_number,
        via_pdt: args.via_pdt ?? false,
        doc_date: new Date(),
        user_id: args.user_id,
        reversal_of: prev.document_number,
        reversal_of_line: prev.line_no,
      },
    });

    await tx.migoLog.update({
      where: {
        document_number_line_no: {
          document_number: prev.document_number,
          line_no: prev.line_no,
        },
      },
      data: { reversed_by: document_number, reversed_by_line: line_no },
    });

    posted.push({
      line_no,
      source_line: prev.line_no,
      material_code: prev.material_code,
      qty: prev.qty,
    });
  }

  return {
    document_number,
    cancel_movement: targets[0].cancel_movement,
    lines: posted,
    original: doc,
  };
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
