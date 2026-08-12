import { NextRequest } from 'next/server';
import prisma from '@/lib/prisma';
import { requireUser, requireWrite, HttpError } from '@/lib/auth';
import { handle, ok, cleanStr } from '@/lib/api';
import { getCancellable, postCancellation } from '@/lib/wms';
import { MOVEMENT_CODE, MOVEMENT_LABEL } from '@/lib/movement';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * GET /api/migo/cancel?doc=XXXXXXXXXX — preview dokumen yang akan dibatalkan.
 * Mengembalikan data dokumen asal + movement pembatalan yang akan dipakai.
 * Data ini ditampilkan TERKUNCI di layar MIGO (tidak dapat diubah).
 */
export async function GET(req: NextRequest) {
  return handle(async () => {
    await requireUser();
    const doc = cleanStr(req.nextUrl.searchParams.get('doc')).toUpperCase();
    if (!doc) throw new HttpError(400, 'Enter the material document number to cancel.');

    const prev = await getCancellable(prisma, doc);
    return ok(
      {
        ...prev,
        movement_code: MOVEMENT_CODE[prev.movement_type],
        movement_label: MOVEMENT_LABEL[prev.movement_type],
        cancel_code: MOVEMENT_CODE[prev.cancel_movement],
        cancel_label: MOVEMENT_LABEL[prev.cancel_movement],
      },
      `Document ${doc} (${MOVEMENT_LABEL[prev.movement_type]}) can be cancelled with movement ${MOVEMENT_CODE[prev.cancel_movement]}`
    );
  });
}

/**
 * POST /api/migo/cancel — posting pembatalan.
 * Body: { document_number, remarks? }
 * Material, qty, batch, dan bin diambil dari dokumen asal — tidak dapat diubah.
 */
export async function POST(req: NextRequest) {
  return handle(async () => {
    const user = await requireWrite();
    const body = await req.json();
    const document_number = cleanStr(body.document_number).toUpperCase();
    if (!document_number) throw new HttpError(400, 'Material document number is mandatory.');

    const result = await prisma.$transaction(
      (tx) =>
        postCancellation(tx, {
          document_number,
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
      },
      `Material document ${result.document_number} posted — movement ${MOVEMENT_CODE[result.cancel_movement]} cancels document ${document_number}`
    );
  });
}
