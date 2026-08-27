import { NextRequest } from 'next/server';
import prisma from '@/lib/prisma';
import { requireUser, requireWrite, HttpError } from '@/lib/auth';
import { handle, ok, cleanStr } from '@/lib/api';
import { getCancellableDoc, postCancellation } from '@/lib/wms';
import { MOVEMENT_CODE, MOVEMENT_LABEL } from '@/lib/movement';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * GET /api/migo/cancel?doc=XXXXXXXXXX — preview dokumen yang akan dibatalkan.
 *
 * Mengembalikan SELURUH baris dokumen beserta status kelayakannya, karena
 * pembatalan berlaku per baris: satu baris keliru bisa dibalik tanpa
 * mengganggu baris lain pada dokumen yang sama. Data ditampilkan TERKUNCI di
 * layar MIGO (tidak dapat diubah), operator hanya memilih baris.
 */
export async function GET(req: NextRequest) {
  return handle(async () => {
    await requireUser();
    const doc = cleanStr(req.nextUrl.searchParams.get('doc')).toUpperCase();
    if (!doc) throw new HttpError(400, 'Enter the material document number to cancel.');

    const prev = await getCancellableDoc(prisma, doc);
    const lines = prev.lines.map((l) => ({
      ...l,
      movement_code: MOVEMENT_CODE[l.movement_type],
      movement_label: MOVEMENT_LABEL[l.movement_type],
      cancel_code: MOVEMENT_CODE[l.cancel_movement],
      cancel_label: MOVEMENT_LABEL[l.cancel_movement],
    }));
    const head = lines.find((l) => l.cancellable) ?? lines[0];

    return ok(
      {
        document_number: prev.document_number,
        doc_date: prev.doc_date,
        reference: prev.reference,
        user_id: prev.user_id,
        // ringkasan dokumen — dipakai layar untuk judul & label movement
        movement_type: head.movement_type,
        movement_code: head.movement_code,
        movement_label: head.movement_label,
        cancel_movement: head.cancel_movement,
        cancel_code: head.cancel_code,
        cancel_label: head.cancel_label,
        lines,
      },
      `Document ${doc} (${head.movement_label}) — ${lines.filter((l) => l.cancellable).length} of ${lines.length} line(s) can be cancelled with movement ${head.cancel_code}`
    );
  });
}

/**
 * POST /api/migo/cancel — posting pembatalan.
 * Body: { document_number, lines?: number[], remarks? }
 * `lines` kosong berarti seluruh baris yang masih layak dibatalkan.
 * Material, qty, batch, dan bin diambil dari dokumen asal — tidak dapat diubah.
 */
export async function POST(req: NextRequest) {
  return handle(async () => {
    const user = await requireWrite();
    const body = await req.json();
    const document_number = cleanStr(body.document_number).toUpperCase();
    if (!document_number) throw new HttpError(400, 'Material document number is mandatory.');

    const lines = Array.isArray(body.lines)
      ? body.lines
          .map((n: unknown) => Number(n))
          .filter((n: number) => Number.isInteger(n) && n > 0)
      : null;

    const result = await prisma.$transaction(
      (tx) =>
        postCancellation(tx, {
          document_number,
          lines,
          user_id: user.username,
          remarks: cleanStr(body.remarks) || null,
          via_pdt: body.via_pdt === true,
        }),
      { timeout: 30000, maxWait: 10000 }
    );

    return ok(
      {
        document_number: result.document_number,
        cancel_code: MOVEMENT_CODE[result.cancel_movement],
        reversal_of: document_number,
        lines: result.lines,
      },
      `Material document ${result.document_number} posted — movement ${MOVEMENT_CODE[result.cancel_movement]} cancels ` +
        `${result.lines.length} line(s) of document ${document_number} (line ${result.lines.map((l) => l.source_line).join(', ')})`
    );
  });
}
