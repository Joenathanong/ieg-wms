import { NextRequest } from 'next/server';
import prisma from '@/lib/prisma';
import { requireWrite, HttpError } from '@/lib/auth';
import { handle, ok, cleanStr, toInt, toDate, normBatch } from '@/lib/api';
import { nextDocNumber } from '@/lib/docnum';
import { applyStockIM, applyStockWM, refreshBinStatus, getBinOrThrow, getMaterialOrThrow } from '@/lib/wms';
import { MovementType } from '@prisma/client';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

interface RowResult {
  row: number;
  key: string;
  status: 'POSTED' | 'ERROR';
  document_number?: string;
  message?: string;
}

/**
 * POST /api/upload/initial-stock — Saldo Awal (Movement 561)
 * Body: {
 *   rows: [{ material_code, bin_code, batch_number?, mfg_date?, exp_date?, qty }],
 *   offset?: number,
 *   mode?: 'ADD' | 'SET'      // ADD = tambah ke stok existing (default), SET = samakan dengan nilai di file
 * }
 *
 * Setiap baris diposting dalam transaction-nya sendiri sehingga satu baris gagal
 * tidak membatalkan seluruh chunk. Mengisi Stock IM, Stock WM, status Bin, dan log 561.
 */
export async function POST(req: NextRequest) {
  return handle(async () => {
    const user = await requireWrite();
    const body = await req.json();
    const rows = Array.isArray(body.rows) ? body.rows : [];
    const offset = Number(body.offset ?? 0);
    const mode: 'ADD' | 'SET' = cleanStr(body.mode).toUpperCase() === 'SET' ? 'SET' : 'ADD';

    if (rows.length === 0) throw new HttpError(400, 'No rows received.');
    if (rows.length > 200) throw new HttpError(400, 'Chunk size too large. Maximum 200 rows per request.');

    const results: RowResult[] = [];

    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const lineNo = offset + i + 1;
      const material_code = cleanStr(r.material_code ?? r.MATERIAL_CODE).toUpperCase();
      const bin_code = cleanStr(r.bin_code ?? r.BIN_CODE).toUpperCase();
      const key = `${material_code}/${bin_code}`;

      try {
        if (!material_code) throw new Error('Column material_code is empty.');
        if (!bin_code) throw new Error('Column bin_code is empty.');

        const fileQty = toInt(r.qty ?? r.QTY ?? 0, 'qty');
        if (fileQty < 0) throw new Error('Quantity cannot be negative.');

        const document_number = await prisma.$transaction(
          async (tx) => {
            const material = await getMaterialOrThrow(tx, material_code);
            await getBinOrThrow(tx, bin_code, true);

            const batch_number = material.is_batch_managed ? normBatch(r.batch_number ?? r.BATCH_NUMBER) : null;
            if (material.is_batch_managed && !batch_number)
              throw new Error(`Material ${material_code} is batch managed. Column batch_number is mandatory.`);

            const mfg_date = toDate(r.mfg_date ?? r.MFG_DATE);
            const exp_date = toDate(r.exp_date ?? r.EXP_DATE);

            let delta = fileQty;
            if (mode === 'SET') {
              const existing = await tx.stockWM.findFirst({
                where: { material_code, bin_code, batch_number },
              });
              delta = fileQty - (existing?.qty ?? 0);
            }

            if (delta === 0) return null;

            await applyStockWM(tx, { material_code, bin_code, batch_number }, delta, { mfg_date, exp_date });
            await applyStockIM(tx, material_code, delta);
            await refreshBinStatus(tx, bin_code);

            const docNo = await nextDocNumber(tx, 'MATDOC');
            await tx.migoLog.create({
              data: {
                document_number: docNo,
                movement_type: MovementType.INIT_561,
                material_code,
                source_bin: delta < 0 ? bin_code : null,
                target_bin: delta > 0 ? bin_code : null,
                batch_number,
                qty: Math.abs(delta),
                uom: material.uom,
                reference: 'ZUPLOAD',
                remarks: `Initial stock upload (${mode})`,
                doc_date: new Date(),
                user_id: user.username,
              },
            });

            return docNo;
          },
          { timeout: 15000, maxWait: 8000 }
        );

        results.push({
          row: lineNo,
          key,
          status: 'POSTED',
          document_number: document_number ?? '(no change)',
        });
      } catch (e) {
        results.push({
          row: lineNo,
          key,
          status: 'ERROR',
          message: e instanceof Error ? e.message : 'Unknown error',
        });
      }
    }

    const posted = results.filter((r) => r.status === 'POSTED').length;
    const errors = results.filter((r) => r.status === 'ERROR');

    return ok(
      { results, posted, error_count: errors.length },
      `Chunk processed: ${posted} posted, ${errors.length} error(s)`
    );
  });
}
