import { NextRequest } from 'next/server';
import prisma from '@/lib/prisma';
import { requireWrite, HttpError } from '@/lib/auth';
import { handle, ok, cleanStr, toInt, normBatch } from '@/lib/api';
import { postGoodsMovement } from '@/lib/wms';
import { MovementType, SalesTakeStatus } from '@prisma/client';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

type Ctx = { params: Promise<{ id: string }> };

/**
 * POST /api/salestake/:id/bin — hitung SATU pick bin lalu posting selisihnya.
 *
 * Body: { bin_code, via_pdt?, lines: [{ material_code, batch_number?, book_qty, actual_qty }] }
 *
 * `book_qty` adalah saldo yang DILIHAT operator saat mulai menghitung. Server
 * membandingkannya dengan saldo sekarang; kalau sudah berubah (mis. ada
 * replenishment masuk di tengah penghitungan), seluruh bin ditolak dan diminta
 * hitung ulang. Lebih baik satu bin diulang daripada barang yang baru masuk
 * ikut terhitung sebagai penjualan.
 *
 * Selisih:
 *   buku > fisik -> 601 goods issue penjualan
 *   fisik > buku -> 701 penyesuaian tambah (bukan penjualan)
 */
export async function POST(req: NextRequest, ctx: Ctx) {
  return handle(async () => {
    const user = await requireWrite();
    const { id } = await ctx.params;
    const b = await req.json();

    const bin_code = cleanStr(b.bin_code).toUpperCase();
    if (!bin_code) throw new HttpError(400, 'Storage bin is mandatory.');

    const rawLines = Array.isArray(b.lines) ? b.lines : [];
    if (rawLines.length === 0) throw new HttpError(400, 'No count lines were entered.');
    if (rawLines.length > 200) throw new HttpError(400, 'Maximum 200 lines per bin.');

    const via_pdt = b.via_pdt === true;

    const result = await prisma.$transaction(
      async (tx) => {
        const doc = await tx.salesTakeDoc.findFirst({
          where: { OR: [{ id: decodeURIComponent(id) }, { doc_number: decodeURIComponent(id) }] },
        });
        if (!doc) throw new HttpError(404, 'Sales take document does not exist.');
        if (doc.status !== SalesTakeStatus.OPEN)
          throw new HttpError(400, `Document ${doc.doc_number} is ${doc.status.toLowerCase()}.`);

        const bin = await tx.storageBin.findUnique({ where: { bin_code } });
        if (!bin) throw new HttpError(400, `Storage bin ${bin_code} does not exist (LS01N).`);
        if (bin.is_interim)
          throw new HttpError(400, `Bin ${bin_code} is an interim bin and cannot be counted here.`);

        // bin yang sudah dihitung di dokumen ini tidak boleh dihitung dua kali
        const already = await tx.salesTakeItem.count({ where: { doc_id: doc.id, bin_code } });
        if (already > 0)
          throw new HttpError(
            400,
            `Bin ${bin_code} sudah dihitung pada dokumen ${doc.doc_number}. Buka dokumen baru untuk periode berikutnya.`
          );

        const created: {
          material_code: string;
          batch_number: string | null;
          book_qty: number;
          actual_qty: number;
          sold_qty: number;
          surplus_qty: number;
          gi_document: string | null;
          adj_document: string | null;
        }[] = [];

        for (let i = 0; i < rawLines.length; i++) {
          const l = rawLines[i];
          const material_code = cleanStr(l.material_code).toUpperCase();
          if (!material_code) throw new HttpError(400, `Line ${i + 1}: material is missing.`);
          const batch_number = normBatch(l.batch_number);
          const seenBook = toInt(l.book_qty, `line ${i + 1} book quantity`);
          const actual_qty = toInt(l.actual_qty, `line ${i + 1} actual quantity`);
          if (actual_qty < 0) throw new HttpError(400, `Line ${i + 1}: actual quantity cannot be negative.`);

          const quant = await tx.stockWM.findFirst({
            where: { material_code, bin_code, batch_number },
          });
          const book_qty = quant?.qty ?? 0;

          if (book_qty !== seenBook) {
            throw new HttpError(
              409,
              `Saldo ${material_code}${batch_number ? ' / ' + batch_number : ''} di ${bin_code} berubah ` +
                `dari ${seenBook} menjadi ${book_qty} sejak Anda mulai menghitung ` +
                `(kemungkinan ada replenishment masuk). Hitung ulang bin ini.`
            );
          }

          const diff = book_qty - actual_qty;
          let gi_document: string | null = null;
          let adj_document: string | null = null;

          if (diff > 0) {
            const r = await postGoodsMovement(tx, {
              movement_type: MovementType.GI_601_SALES,
              material_code,
              qty: diff,
              batch_number,
              source_bin: bin_code,
              reference: doc.doc_number,
              remarks: `SO penjualan (buku ${book_qty} / fisik ${actual_qty})`,
              via_pdt,
              user_id: user.username,
            });
            gi_document = r.document_number;
          } else if (diff < 0) {
            const r = await postGoodsMovement(tx, {
              movement_type: MovementType.ADJ_701_PLUS,
              material_code,
              qty: -diff,
              batch_number,
              target_bin: bin_code,
              mfg_date: quant?.mfg_date ?? null,
              exp_date: quant?.exp_date ?? null,
              reference: doc.doc_number,
              remarks: `Kelebihan fisik saat SO penjualan (buku ${book_qty} / fisik ${actual_qty})`,
              via_pdt,
              user_id: user.username,
            });
            adj_document = r.document_number;
          }

          await tx.salesTakeItem.create({
            data: {
              doc_id: doc.id,
              bin_code,
              material_code,
              batch_number,
              book_qty,
              actual_qty,
              sold_qty: diff > 0 ? diff : 0,
              surplus_qty: diff < 0 ? -diff : 0,
              gi_document,
              adj_document,
              counted_by: user.username,
            },
          });

          created.push({
            material_code,
            batch_number,
            book_qty,
            actual_qty,
            sold_qty: diff > 0 ? diff : 0,
            surplus_qty: diff < 0 ? -diff : 0,
            gi_document,
            adj_document,
          });
        }

        return { doc_number: doc.doc_number, bin_code, lines: created };
      },
      { timeout: 30000, maxWait: 10000 }
    );

    const sold = result.lines.reduce((a, l) => a + l.sold_qty, 0);
    const surplus = result.lines.reduce((a, l) => a + l.surplus_qty, 0);
    const giDocs = result.lines.map((l) => l.gi_document).filter(Boolean);

    return ok(
      result,
      `${result.bin_code} selesai — penjualan ${sold}` +
        (surplus > 0 ? `, kelebihan ${surplus}` : '') +
        (giDocs.length > 0 ? ` · dokumen ${giDocs.join(', ')}` : ' · tidak ada selisih')
    );
  });
}
