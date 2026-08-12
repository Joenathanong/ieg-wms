import { NextRequest } from 'next/server';
import prisma from '@/lib/prisma';
import { requireWrite, HttpError } from '@/lib/auth';
import { handle, ok, cleanStr, toInt, toDate, normBatch } from '@/lib/api';
import { postBinTransfer } from '@/lib/wms';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

/**
 * POST /api/transfer  — LT01 (single) & LT10 (mass)
 * Body: { doc_date?, items: [{ material_code, qty, batch_number?, source_bin, target_bin, remarks? }] }
 *
 * Stock IM global TIDAK berubah. Hanya Stock WM (bin) yang berpindah.
 * Seluruh item diposting dalam satu transaction (ACID).
 */
export async function POST(req: NextRequest) {
  return handle(async () => {
    const user = await requireWrite();
    const body = await req.json();

    const rawItems = Array.isArray(body.items) ? body.items : [body];
    if (rawItems.length === 0) throw new HttpError(400, 'No transfer items were entered.');
    if (rawItems.length > 200) throw new HttpError(400, 'Maximum 200 transfer items per run.');

    const docDate = toDate(body.doc_date) ?? new Date();

    const results = await prisma.$transaction(
      async (tx) => {
        const docs: {
          line: number;
          material_code: string;
          source_bin: string;
          target_bin: string;
          qty: number;
          document_number: string;
        }[] = [];

        for (let i = 0; i < rawItems.length; i++) {
          const it = rawItems[i];
          const material_code = cleanStr(it.material_code).toUpperCase();
          const source_bin = cleanStr(it.source_bin).toUpperCase();
          const target_bin = cleanStr(it.target_bin).toUpperCase();
          const qty = toInt(it.qty, `line ${i + 1} quantity`);

          if (!material_code) throw new HttpError(400, `Line ${i + 1}: material number is missing.`);
          if (!source_bin) throw new HttpError(400, `Line ${i + 1}: source storage bin is missing.`);
          if (!target_bin) throw new HttpError(400, `Line ${i + 1}: destination storage bin is missing.`);

          const r = await postBinTransfer(tx, {
            material_code,
            qty,
            batch_number: normBatch(it.batch_number),
            source_bin,
            target_bin,
            doc_date: docDate,
            remarks: cleanStr(it.remarks) || null,
            via_pdt: body.via_pdt === true,
            user_id: user.username,
          });

          docs.push({
            line: i + 1,
            material_code,
            source_bin,
            target_bin,
            qty,
            document_number: r.document_number,
          });
        }
        return docs;
      },
      { timeout: 20000, maxWait: 10000 }
    );

    const msg =
      results.length === 1
        ? `Transfer order ${results[0].document_number} created and confirmed`
        : `${results.length} transfer orders created (${results[0].document_number} … ${results[results.length - 1].document_number})`;

    return ok({ documents: results }, msg);
  });
}
