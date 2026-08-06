import { NextRequest } from 'next/server';
import prisma from '@/lib/prisma';
import { requireWrite, HttpError } from '@/lib/auth';
import { handle, ok } from '@/lib/api';
import { nextDocNumber } from '@/lib/docnum';
import { applyStockIM, applyStockWM } from '@/lib/wms';
import { BinStatus, MovementType, PhysInvStatus } from '@prisma/client';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

type Ctx = { params: Promise<{ id: string }> };

/**
 * POST /api/physinv/:id/post — LI21 Post Physical Inventory Difference
 * Selisih (+) diposting sebagai movement 701, selisih (-) sebagai 702.
 * Semuanya dalam satu transaction; bin di-unfreeze di akhir.
 */
export async function POST(_req: NextRequest, ctx: Ctx) {
  return handle(async () => {
    const user = await requireWrite();
    const { id } = await ctx.params;

    const result = await prisma.$transaction(
      async (tx) => {
        const doc = await tx.physInvDoc.findUnique({ where: { id }, include: { items: true } });
        if (!doc) throw new HttpError(404, 'Physical inventory document does not exist.');
        if (doc.status === PhysInvStatus.POSTED)
          throw new HttpError(400, `Document ${doc.doc_number} is already posted.`);
        if (doc.status !== PhysInvStatus.COUNTED)
          throw new HttpError(400, 'Count results must be entered before posting (LI11N).');

        const pending = doc.items.filter((i) => i.counted_qty !== null && i.diff_qty !== 0 && !i.posted);
        const docs: { document_number: string; material_code: string; diff: number }[] = [];

        for (const item of pending) {
          const diff = item.diff_qty;
          const movement = diff > 0 ? MovementType.ADJ_701_PLUS : MovementType.ADJ_702_MIN;

          const material = await tx.material.findUnique({ where: { material_code: item.material_code } });
          if (!material) throw new HttpError(400, `Material ${item.material_code} does not exist.`);

          // ambil tanggal batch dari quant lama (kalau ada) supaya tidak hilang
          const quant = await tx.stockWM.findFirst({
            where: {
              material_code: item.material_code,
              bin_code: doc.bin_code,
              batch_number: item.batch_number,
            },
          });

          await applyStockWM(
            tx,
            {
              material_code: item.material_code,
              bin_code: doc.bin_code,
              batch_number: item.batch_number,
            },
            diff,
            { mfg_date: quant?.mfg_date ?? null, exp_date: quant?.exp_date ?? null }
          );

          await applyStockIM(tx, item.material_code, diff);

          const document_number = await nextDocNumber(tx, 'MATDOC');
          await tx.migoLog.create({
            data: {
              document_number,
              movement_type: movement,
              material_code: item.material_code,
              source_bin: diff > 0 ? null : doc.bin_code,
              target_bin: diff > 0 ? doc.bin_code : null,
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
          docs.push({ document_number, material_code: item.material_code, diff });
        }

        // unfreeze bin
        const agg = await tx.stockWM.aggregate({ where: { bin_code: doc.bin_code }, _sum: { qty: true } });
        await tx.storageBin.update({
          where: { bin_code: doc.bin_code },
          data: { status: (agg._sum.qty ?? 0) > 0 ? BinStatus.OCCUPIED : BinStatus.EMPTY },
        });

        await tx.physInvDoc.update({
          where: { id },
          data: { status: PhysInvStatus.POSTED, posted_at: new Date() },
        });

        return { doc_number: doc.doc_number, bin_code: doc.bin_code, documents: docs };
      },
      { timeout: 25000, maxWait: 10000 }
    );

    const n = result.documents.length;
    return ok(
      result,
      n === 0
        ? `Document ${result.doc_number} posted — no differences found, bin ${result.bin_code} released`
        : `Document ${result.doc_number} posted — ${n} difference document(s) created, bin ${result.bin_code} released`
    );
  });
}
