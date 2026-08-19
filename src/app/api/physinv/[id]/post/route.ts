import { NextRequest } from 'next/server';
import prisma from '@/lib/prisma';
import { requireWrite, HttpError } from '@/lib/auth';
import { handle, ok } from '@/lib/api';
import { nextDocNumber } from '@/lib/docnum';
import { applyStockIM, applyStockWM } from '@/lib/wms';
import { BinStatus, MovementType, PhysInvStatus } from '@prisma/client';
import { fromDbList, toDbList } from '@/lib/dblist';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

type Ctx = { params: Promise<{ id: string }> };

/**
 * POST /api/physinv/:id/post — LI21 Post Physical Inventory Difference.
 * Seluruh baris (lintas bin) diproses dalam satu transaction:
 * selisih (+) -> movement 701, selisih (-) -> movement 702.
 * Semua bin yang di-freeze dilepas kembali di akhir.
 */
export async function POST(_req: NextRequest, ctx: Ctx) {
  return handle(async () => {
    const user = await requireWrite();
    const { id } = await ctx.params;

    const result = await prisma.$transaction(
      async (tx) => {
        const doc = await tx.physInvDoc.findFirst({
          where: { OR: [{ id: decodeURIComponent(id) }, { doc_number: decodeURIComponent(id) }] },
          include: { items: true },
        });
        if (!doc) throw new HttpError(404, 'Physical inventory document does not exist.');
        if (doc.status === PhysInvStatus.POSTED)
          throw new HttpError(400, `Document ${doc.doc_number} is already posted.`);
        if (doc.status !== PhysInvStatus.COUNTED)
          throw new HttpError(400, 'Count results must be entered before posting (LI11N).');

        const pending = doc.items.filter(
          (i) => i.counted_qty !== null && i.diff_qty !== 0 && !i.posted
        );

        const docs: {
          document_number: string;
          bin_code: string;
          material_code: string;
          batch_number: string | null;
          diff: number;
        }[] = [];

        for (const item of pending) {
          const diff = item.diff_qty;
          const movement = diff > 0 ? MovementType.ADJ_701_PLUS : MovementType.ADJ_702_MIN;

          const material = await tx.material.findUnique({
            where: { material_code: item.material_code },
          });
          if (!material) throw new HttpError(400, `Material ${item.material_code} does not exist.`);

          const quant = await tx.stockWM.findFirst({
            where: {
              material_code: item.material_code,
              bin_code: item.bin_code,
              batch_number: item.batch_number,
            },
          });

          // Tanggal quant hasil selisih:
          //   - utamakan yang direkam saat menghitung (baris temuan),
          //   - kalau tidak ada, ikuti quant yang sudah ada di bin itu,
          //   - GR date untuk stok yang baru muncul = tanggal posting opname,
          //     karena dari sudut pandang gudang barang ini "diterima" hari ini.
          const postedAt = new Date();
          await applyStockWM(
            tx,
            {
              material_code: item.material_code,
              bin_code: item.bin_code,
              batch_number: item.batch_number,
            },
            diff,
            {
              mfg_date: item.mfg_date ?? quant?.mfg_date ?? null,
              exp_date: item.exp_date ?? quant?.exp_date ?? null,
              gr_date: quant?.gr_date ?? postedAt,
            }
          );

          await applyStockIM(tx, item.material_code, diff);

          const document_number = await nextDocNumber(tx, 'MATDOC');
          await tx.migoLog.create({
            data: {
              document_number,
              movement_type: movement,
              material_code: item.material_code,
              source_bin: diff > 0 ? null : item.bin_code,
              target_bin: diff > 0 ? item.bin_code : null,
              batch_number: item.batch_number,
              qty: Math.abs(diff),
              uom: material.uom,
              reference: doc.doc_number,
              remarks: `Physical inventory clearance (book ${item.book_qty} / counted ${item.counted_qty})`,
              doc_date: new Date(),
              user_id: user.username,
            },
          });

          await tx.physInvDocItem.update({ where: { id: item.id }, data: { posted: true } });
          docs.push({
            document_number,
            bin_code: item.bin_code,
            material_code: item.material_code,
            batch_number: item.batch_number,
            diff,
          });
        }

        // release semua bin yang di-freeze
        for (const bin_code of fromDbList(doc.frozen_bins)) {
          const agg = await tx.stockWM.aggregate({ where: { bin_code }, _sum: { qty: true } });
          await tx.storageBin.updateMany({
            where: { bin_code },
            data: { status: (agg._sum.qty ?? 0) > 0 ? BinStatus.OCCUPIED : BinStatus.EMPTY },
          });
        }

        await tx.physInvDoc.update({
          where: { id: doc.id },
          data: { status: PhysInvStatus.POSTED, posted_at: new Date() },
        });

        return {
          doc_number: doc.doc_number,
          bins: fromDbList(doc.frozen_bins).length,
          documents: docs,
        };
      },
      { timeout: 60000, maxWait: 15000 }
    );

    const n = result.documents.length;
    return ok(
      result,
      n === 0
        ? `Document ${result.doc_number} posted — no differences found, ${result.bins} bin(s) released`
        : `Document ${result.doc_number} posted — ${n} difference document(s) created, ${result.bins} bin(s) released`
    );
  });
}
