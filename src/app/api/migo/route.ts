import { NextRequest } from 'next/server';
import prisma from '@/lib/prisma';
import { requireWrite, HttpError } from '@/lib/auth';
import { handle, ok, cleanStr, toInt, toDate, normBatch } from '@/lib/api';
import {
  parseMovement,
  needsCostCenter,
  isGoodsReceipt,
  needsReference,
  isMaterialTransfer,
} from '@/lib/movement';
import {
  postGoodsMovement,
  postGoodsReceipt,
  createPickRequest,
  postGoodsIssue,
  createTransferReq,
  type TrItemInput,
} from '@/lib/wms';
import { nextDocNumber } from '@/lib/docnum';
import { MovementType, TrType } from '@prisma/client';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * POST /api/migo — Goods Movement level Inventory Management (MM).
 *
 * SATU posting = SATU material document. Berapa pun baris yang diisi, semuanya
 * masuk ke nomor dokumen yang sama (baris 1..n) dan menghasilkan SATU Transfer
 * Requirement — petugas put-away/picking cukup memproses satu daftar kerja,
 * bukan satu daftar per baris.
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
    // 309 selalu berpasangan (sisi keluar + sisi masuk). Diposting sepotong
    // lewat MIGO, stoknya hilang di satu kode tanpa muncul di kode lain.
    if (isMaterialTransfer(mt))
      throw new HttpError(
        400,
        'Movement 309 hanya dibuat oleh penggabungan SKU (ZMATDUP), tidak lewat MIGO.'
      );

    const rawItems = Array.isArray(body.items) ? body.items : [body];
    if (rawItems.length === 0) throw new HttpError(400, 'No line items were entered.');
    if (rawItems.length > 100) throw new HttpError(400, 'Maximum 100 line items per document.');

    const docDate = toDate(body.doc_date) ?? new Date();
    const reference = cleanStr(body.reference) || null;
    // Ditegakkan di server juga: layar bisa dilewati, dan retur tanpa
    // keterangan vendor tidak bisa dicocokkan dengan apa pun di kemudian hari.
    if (needsReference(mt) && !reference)
      throw new HttpError(
        400,
        'Retur ke vendor wajib menyebut vendor atau nomor retur pada kolom Reference.'
      );
    const cost_center = cleanStr(body.cost_center).toUpperCase() || null;
    /** khusus 201: REQUEST = buat TR picking, ISSUE = posting goods issue dari GI zone */
    const giMode = cleanStr(body.mode).toUpperCase() === 'ISSUE' ? 'ISSUE' : 'REQUEST';

    // 201 = pemakaian internal, biayanya harus punya tujuan pembebanan.
    // Cost center boleh diisi sejak langkah REQUEST (ikut tersimpan di transfer
    // requirement) dan WAJIB ada saat langkah ISSUE. Bila operator ISSUE tidak
    // mengisinya, nilainya diambil dari TR yang bersangkutan.
    if (cost_center) {
      const cc = await prisma.costCenter.findUnique({ where: { cost_center } });
      if (!cc) throw new HttpError(400, `Cost center ${cost_center} does not exist (KS01).`);
      if (!cc.is_active) throw new HttpError(400, `Cost center ${cost_center} is inactive.`);
    }

    const isPickRequest = mt === MovementType.GI_201 && giMode === 'REQUEST';

    const result = await prisma.$transaction(
      async (tx) => {
        // Nomor dokumen dialokasikan SEKALI untuk seluruh posting. Permintaan
        // picking (201 REQUEST) belum memindahkan stok apa pun, jadi belum ada
        // material document — yang lahir hanya Transfer Requirement.
        const document_number = isPickRequest ? null : await nextDocNumber(tx, 'MATDOC');

        // Baris put-away / picking dari semua line dikumpulkan di sini, lalu
        // dijadikan satu Transfer Requirement setelah seluruh baris diposting.
        const trItems: TrItemInput[] = [];

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
          const line_no = i + 1;
          const material_code = cleanStr(it.material_code).toUpperCase();
          if (!material_code) throw new HttpError(400, `Line ${line_no}: material number is missing.`);
          const qty = toInt(it.qty, `line ${line_no} quantity`);

          if (isGoodsReceipt(mt)) {
            const r = await postGoodsReceipt(tx, {
              movement_type: mt,
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
              document_number,
              line_no,
              defer_tr: trItems,
            });
            documents.push({
              line: line_no,
              material_code,
              qty,
              document_number: r.document_number,
              tr_number: null,
              tr_lines: r.tr_lines,
            });
          } else if (isPickRequest) {
            const r = await createPickRequest(tx, {
              material_code,
              qty,
              batch_number: normBatch(it.batch_number),
              pack_code: cleanStr(it.pack_code).toUpperCase() || null,
              reference,
              cost_center,
              remarks: cleanStr(it.remarks) || null,
              user_id: user.username,
              line_no,
              defer_tr: trItems,
            });
            documents.push({
              line: line_no,
              material_code,
              qty,
              document_number: null,
              tr_number: null,
              tr_lines: r.tr_lines,
            });
          } else if (mt === MovementType.GI_201) {
            // ISSUE — keluarkan stok yang sudah dipicking ke GI zone.
            // Pembebanan diambil dari input; bila kosong, warisi dari TR asal.
            const trRef = cleanStr(it.tr_number).toUpperCase() || null;
            let cc = cost_center;
            if (!cc && trRef) {
              const tr = await tx.transferReq.findUnique({ where: { tr_number: trRef } });
              cc = tr?.cost_center ?? null;
            }
            if (!cc)
              throw new HttpError(
                400,
                `Line ${line_no}: cost center is mandatory for goods issue 201. ` +
                  `Pilih di layar, atau isi saat membuat permintaan picking. Master-nya di KS01.`
              );

            const r = await postGoodsIssue(tx, {
              material_code,
              qty,
              batch_number: normBatch(it.batch_number),
              reference,
              cost_center: cc,
              remarks: cleanStr(it.remarks) || null,
              tr_number: trRef,
              doc_date: docDate,
              user_id: user.username,
              document_number,
              line_no,
            });
            documents.push({
              line: line_no,
              material_code,
              qty,
              document_number: r.document_number,
              tr_number: trRef,
              tr_lines: 0,
            });
          } else {
            // 601 / 551 / 701 / 702 — posting langsung ke bin, bin wajib diisi.
            // 601 dipakai untuk goods issue penjualan dari pick bin: barangnya
            // sudah diambil di luar sistem, jadi tidak lewat transit-out.
            const bin = cleanStr(it.bin ?? it.source_bin ?? it.target_bin).toUpperCase();
            if (!bin)
              throw new HttpError(
                400,
                `Line ${line_no}: storage bin is mandatory for movement ${body.movement_type}.`
              );
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
              document_number,
              line_no,
            });
            documents.push({
              line: line_no,
              material_code,
              qty,
              document_number: r.document_number,
              tr_number: null,
              tr_lines: 0,
            });
          }
        }

        // SATU Transfer Requirement untuk seluruh dokumen.
        let tr_number: string | null = null;
        if (trItems.length > 0) {
          const tr = await createTransferReq(tx, {
            tr_type: isPickRequest ? TrType.PICK : TrType.PUTAWAY,
            ref_doc: document_number,
            reference,
            // TR sekarang milik dokumen, bukan baris. Keterangan diambil dari
            // header bila ada; kalau operator hanya mengisi remarks di baris
            // pertama, itu yang dipakai supaya catatannya tidak hilang.
            remarks: cleanStr(body.remarks) || cleanStr(rawItems[0]?.remarks) || null,
            cost_center: isPickRequest ? cost_center : null,
            user_id: user.username,
            items: trItems,
          });
          tr_number = tr.tr_number;
          // Nomor TR baru diketahui setelah semua baris selesai, jadi ditulis
          // balik ke seluruh baris dokumen ini.
          if (document_number)
            await tx.migoLog.updateMany({
              where: { document_number },
              data: { tr_number },
            });
          for (const d of documents) d.tr_number = tr_number;
        }

        return { document_number, tr_number, tr_lines: trItems.length, documents };
      },
      { timeout: 30000, maxWait: 10000 }
    );

    const nLines = result.documents.length;
    let msg: string;
    if (isGoodsReceipt(mt)) {
      msg =
        `Material document ${result.document_number} posted to GR zone (${nLines} line(s)) — ` +
        `transfer requirement ${result.tr_number} created (${result.tr_lines} put-away line(s)). ` +
        `Process it in LB12.`;
    } else if (isPickRequest) {
      msg =
        `Transfer requirement ${result.tr_number} created (${result.tr_lines} picking line(s) ` +
        `from ${nLines} request line(s)). Confirm the picking in LB12, then post the goods issue.`;
    } else if (mt === MovementType.GI_201) {
      msg = `Material document ${result.document_number} posted (${nLines} line(s)) — goods issue from GI zone completed`;
    } else {
      msg = `Material document ${result.document_number} posted successfully (${nLines} line(s))`;
    }

    return ok(
      {
        document_number: result.document_number,
        tr_number: result.tr_number,
        documents: result.documents,
      },
      msg
    );
  });
}
