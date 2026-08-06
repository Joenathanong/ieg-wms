import { NextRequest } from 'next/server';
import prisma from '@/lib/prisma';
import { requireWrite, HttpError } from '@/lib/auth';
import { handle, ok, cleanStr, toInt, toDate, normBatch } from '@/lib/api';
import { parseMovement } from '@/lib/movement';
import { postGoodsMovement } from '@/lib/wms';
import { MovementType } from '@prisma/client';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

/**
 * POST /api/migo
 * Body:
 * {
 *   movement_type: "101" | "201" | "551" | "701" | "702" | "101_GR" ...,
 *   doc_date?: "2026-08-06",
 *   reference?: string,
 *   items: [{ material_code, qty, batch_number?, mfg_date?, exp_date?, source_bin?, target_bin?, remarks? }]
 * }
 *
 * Semua item diposting dalam SATU database transaction (all-or-nothing),
 * persis seperti satu Material Document di SAP.
 */
export async function POST(req: NextRequest) {
  return handle(async () => {
    const user = await requireWrite();
    const body = await req.json();

    const mt = parseMovement(cleanStr(body.movement_type));
    if (!mt) throw new HttpError(400, `Movement type ${body.movement_type} is not defined.`);
    if (mt === MovementType.TR_301_BIN)
      throw new HttpError(400, 'Use transaction LT01 / LT10 for movement type 301.');
    if (mt === MovementType.INIT_561)
      throw new HttpError(400, 'Movement 561 is only allowed via ZUPLOAD (initial stock upload).');

    const rawItems = Array.isArray(body.items) ? body.items : [body];
    if (rawItems.length === 0) throw new HttpError(400, 'No line items were entered.');
    if (rawItems.length > 200) throw new HttpError(400, 'Maximum 200 line items per document.');

    const docDate = toDate(body.doc_date) ?? new Date();
    const reference = cleanStr(body.reference) || null;

    const results = await prisma.$transaction(
      async (tx) => {
        const docs: { line: number; material_code: string; document_number: string }[] = [];
        for (let i = 0; i < rawItems.length; i++) {
          const it = rawItems[i];
          const material_code = cleanStr(it.material_code).toUpperCase();
          if (!material_code) throw new HttpError(400, `Line ${i + 1}: material number is missing.`);

          const r = await postGoodsMovement(tx, {
            movement_type: mt,
            material_code,
            qty: toInt(it.qty, `line ${i + 1} quantity`),
            batch_number: normBatch(it.batch_number),
            mfg_date: toDate(it.mfg_date),
            exp_date: toDate(it.exp_date),
            source_bin: cleanStr(it.source_bin).toUpperCase() || null,
            target_bin: cleanStr(it.target_bin).toUpperCase() || null,
            doc_date: docDate,
            reference,
            remarks: cleanStr(it.remarks) || null,
            user_id: user.username,
          });
          docs.push({ line: i + 1, material_code, document_number: r.document_number });
        }
        return docs;
      },
      { timeout: 20000, maxWait: 10000 }
    );

    const first = results[0].document_number;
    const msg =
      results.length === 1
        ? `Material document ${first} posted successfully`
        : `Material documents ${first} … ${results[results.length - 1].document_number} posted (${results.length} items)`;

    return ok({ documents: results }, msg);
  });
}
