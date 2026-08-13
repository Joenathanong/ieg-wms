import { NextRequest } from 'next/server';
import prisma from '@/lib/prisma';
import { requireWrite, HttpError } from '@/lib/auth';
import { handle, ok, cleanStr, toInt, toDate, normBatch } from '@/lib/api';
import { parseMovement, needsCostCenter } from '@/lib/movement';
import { postGoodsMovement, postGoodsReceipt, createPickRequest, postGoodsIssue } from '@/lib/wms';
import { MovementType } from '@prisma/client';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * POST /api/migo — Goods Movement level Inventory Management (MM).
 *
 * 101 GR  : stok masuk ke bin interim GR-ZONE, lalu dibuat Transfer Requirement
 *           PUTAWAY yang sudah dipecah per pallet. Rak final ditentukan di LB12.
 * 201 GI  : hanya membuat Transfer Requirement PICK. Goods issue diposting
 *           otomatis ketika seluruh item TR dikonfirmasi di LB12.
 * 551/701/702 : koreksi stok langsung pada bin tertentu (tanpa TR).
 *
 * Body:
 * {
 *   movement_type: "101" | "201" | "551" | "701" | "702",
 *   doc_date?, reference?,
 *   items: [{ material_code, qty, batch_number?, mfg_date?, exp_date?, pack_code?, bin?, remarks? }]
 * }
 */
export async function POST(req: NextRequest) {
  return handle(async () => {
    const user = await requireWrite();
    const body = await req.json();

    const mt = parseMovement(cleanStr(body.movement_type));
    if (!mt) throw new HttpError(400, `Movement type ${body.movement_type} is not defined.`);
    if (mt === MovementType.TR_301_BIN)
      throw new HttpError(400, 'Use transaction LT01 / LT10 / LB12 for movement type 301.');
    if (mt === MovementType.INIT_561)
      throw new HttpError(400, 'Movement 561 is only allowed via ZUPLOAD (initial stock upload).');

    const rawItems = Array.isArray(body.items) ? body.items : [body];
    if (rawItems.length === 0) throw new HttpError(400, 'No line items were entered.');
    if (rawItems.length > 100) throw new HttpError(400, 'Maximum 100 line items per document.');

    const docDate = toDate(body.doc_date) ?? new Date();
    const reference = cleanStr(body.reference) || null;
    const cost_center = cleanStr(body.cost_center).toUpperCase() || null;
    /** khusus 201: REQUEST = buat TR picking, ISSUE = posting goods issue dari GI zone */
    const giMode = cleanStr(body.mode).toUpperCase() === 'ISSUE' ? 'ISSUE' : 'REQUEST';

    // 201 = pemakaian internal: biayanya harus punya tujuan pembebanan.
    // Divalidasi hanya saat posting nyata (mode ISSUE); tahap REQUEST baru
    // membuat transfer requirement dan belum menyentuh biaya.
    if (needsCostCenter(mt) && giMode === 'ISSUE') {
      if (!cost_center)
        throw new HttpError(
          400,
          `Cost center is mandatory for movement ${body.movement_type} (goods issue to cost center). Maintain it in KS01.`
        );
      const cc = await prisma.costCenter.findUnique({ where: { cost_center } });
      if (!cc) throw new HttpError(400, `Cost center ${cost_center} does not exist (KS01).`);
      if (!cc.is_active) throw new HttpError(400, `Cost center ${cost_center} is inactive.`);
    }

    const result = await prisma.$transaction(
      async (tx) => {
        const documents: {
          line: number;
          material_code: string;
          qty: number;
          document_number: string | null;
          tr_number: string | null;
          tr_lines: number;
        }[] = [];

        for (let i = 0; i < rawItems.length; i++) {
          const it = rawItems[i];
          const material_code = cleanStr(it.material_code).toUpperCase();
          if (!material_code) throw new HttpError(400, `Line ${i + 1}: material number is missing.`);
          const qty = toInt(it.qty, `line ${i + 1} quantity`);

          if (mt === MovementType.GR_101) {
            const r = await postGoodsReceipt(tx, {
              material_code,
              qty,
              batch_number: normBatch(it.batch_number),
              mfg_date: toDate(it.mfg_date),
              exp_date: toDate(it.exp_date),
              pack_code: cleanStr(it.pack_code).toUpperCase() || null,
              zone_group: cleanStr(body.zone_group ?? it.zone_group).toUpperCase() || null,
              reference,
              remarks: cleanStr(it.remarks) || null,
              doc_date: docDate,
              user_id: user.username,
            });
            documents.push({
              line: i + 1,
              material_code,
              qty,
              document_number: r.document_number,
              tr_number: r.tr.tr_number,
              tr_lines: r.tr.items.length,
            });
          } else if (mt === MovementType.GI_201 && giMode === 'REQUEST') {
            const r = await createPickRequest(tx, {
              material_code,
              qty,
              batch_number: normBatch(it.batch_number),
              pack_code: cleanStr(it.pack_code).toUpperCase() || null,
              reference,
              remarks: cleanStr(it.remarks) || null,
              user_id: user.username,
            });
            documents.push({
              line: i + 1,
              material_code,
              qty,
              document_number: null,
              tr_number: r.tr.tr_number,
              tr_lines: r.tr.items.length,
            });
          } else if (mt === MovementType.GI_201) {
            // ISSUE — keluarkan stok yang sudah dipicking ke GI zone
            const r = await postGoodsIssue(tx, {
              material_code,
              qty,
              batch_number: normBatch(it.batch_number),
              reference,
              cost_center,
              remarks: cleanStr(it.remarks) || null,
              tr_number: cleanStr(it.tr_number).toUpperCase() || null,
              doc_date: docDate,
              user_id: user.username,
            });
            documents.push({
              line: i + 1,
              material_code,
              qty,
              document_number: r.document_number,
              tr_number: cleanStr(it.tr_number).toUpperCase() || null,
              tr_lines: 0,
            });
          } else {
            // 601 / 551 / 701 / 702 — posting langsung ke bin, bin wajib diisi.
            // 601 dipakai untuk goods issue penjualan dari pick bin: barangnya
            // sudah diambil di luar sistem, jadi tidak lewat transit-out.
            const bin = cleanStr(it.bin ?? it.source_bin ?? it.target_bin).toUpperCase();
            if (!bin) throw new HttpError(400, `Line ${i + 1}: storage bin is mandatory for movement ${body.movement_type}.`);
            const isPlus = mt === MovementType.ADJ_701_PLUS;
            const r = await postGoodsMovement(tx, {
              movement_type: mt,
              material_code,
              qty,
              batch_number: normBatch(it.batch_number),
              mfg_date: toDate(it.mfg_date),
              exp_date: toDate(it.exp_date),
              source_bin: isPlus ? null : bin,
              target_bin: isPlus ? bin : null,
              doc_date: docDate,
              reference,
              cost_center,
              remarks: cleanStr(it.remarks) || null,
              user_id: user.username,
            });
            documents.push({
              line: i + 1,
              material_code,
              qty,
              document_number: r.document_number,
              tr_number: null,
              tr_lines: 0,
            });
          }
        }
        return documents;
      },
      { timeout: 30000, maxWait: 10000 }
    );

    let msg: string;
    if (mt === MovementType.GR_101) {
      const trs = result.map((d) => d.tr_number).filter(Boolean);
      const lines = result.reduce((a, d) => a + d.tr_lines, 0);
      msg =
        `Material document ${result[0].document_number} posted to GR zone — ` +
        `transfer requirement ${trs.join(', ')} created (${lines} put-away line(s)). Process it in LB12.`;
    } else if (mt === MovementType.GI_201 && giMode === 'REQUEST') {
      const trs = result.map((d) => d.tr_number).filter(Boolean);
      const lines = result.reduce((a, d) => a + d.tr_lines, 0);
      msg = `Transfer requirement ${trs.join(', ')} created (${lines} picking line(s)). Confirm the picking in LB12, then post the goods issue.`;
    } else if (mt === MovementType.GI_201) {
      msg =
        result.length === 1
          ? `Material document ${result[0].document_number} posted — goods issue from GI zone completed`
          : `${result.length} goods issue documents posted from GI zone`;
    } else {
      msg =
        result.length === 1
          ? `Material document ${result[0].document_number} posted successfully`
          : `${result.length} material documents posted successfully`;
    }

    return ok({ documents: result }, msg);
  });
}
