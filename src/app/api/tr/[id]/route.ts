import { NextRequest } from 'next/server';
import prisma from '@/lib/prisma';
import { requireUser, requireWrite, HttpError } from '@/lib/auth';
import { handle, ok } from '@/lib/api';
import { suggestPickBins, suggestPutawayBins } from '@/lib/wms';
import { TrStatus, TrType } from '@prisma/client';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/** cari TR berdasarkan id UUID atau nomor TR. */
async function findTr(idOrNumber: string) {
  const key = decodeURIComponent(idOrNumber);
  return prisma.transferReq.findFirst({
    where: { OR: [{ id: key }, { tr_number: key.toUpperCase() }] },
    include: { items: { orderBy: { line_no: 'asc' } } },
  });
}

/** GET /api/tr/:id — detail TR + saran bin per line (LB12) */
export async function GET(_req: NextRequest, ctx: Ctx) {
  return handle(async () => {
    await requireUser();
    const { id } = await ctx.params;
    const doc = await findTr(id);
    if (!doc) throw new HttpError(404, 'Transfer requirement does not exist.');

    const materials = await prisma.material.findMany({
      where: { material_code: { in: doc.items.map((i) => i.material_code) } },
      select: { material_code: true, description: true, uom: true },
    });
    const mMap = new Map(materials.map((m) => [m.material_code, m]));

    // saran bin: PUTAWAY -> bin kosong; PICK -> quant FEFO
    const putawaySuggestions =
      doc.tr_type === TrType.PUTAWAY ? await suggestPutawayBins(prisma, 25) : [];

    const items = [];
    for (const it of doc.items) {
      const pick =
        doc.tr_type === TrType.PICK
          ? await suggestPickBins(prisma, it.material_code, it.batch_number, it.target_bin ?? undefined)
          : [];
      items.push({
        ...it,
        description: mMap.get(it.material_code)?.description ?? '',
        uom: mMap.get(it.material_code)?.uom ?? 'PC',
        // Baris yang dibatalkan tidak menyisakan pekerjaan: LB12 memakai
        // qty_open untuk menentukan baris mana yang masih bisa dikonfirmasi.
        qty_open: it.status === TrStatus.CANCELLED ? 0 : it.qty - it.qty_confirmed,
        suggestions: doc.tr_type === TrType.PICK ? pick : putawaySuggestions,
      });
    }

    return ok({ ...doc, items }, `Transfer requirement ${doc.tr_number} displayed`);
  });
}

/** DELETE /api/tr/:id — batalkan TR yang belum dikonfirmasi sama sekali */
export async function DELETE(_req: NextRequest, ctx: Ctx) {
  return handle(async () => {
    await requireWrite();
    const { id } = await ctx.params;
    const doc = await findTr(id);
    if (!doc) throw new HttpError(404, 'Transfer requirement does not exist.');
    if (doc.status === TrStatus.CLOSED) throw new HttpError(400, 'Closed transfer requirement cannot be cancelled.');
    if (doc.items.some((i) => i.qty_confirmed > 0))
      throw new HttpError(400, 'Transfer requirement is already partially confirmed and cannot be cancelled.');

    await prisma.transferReq.update({
      where: { id: doc.id },
      data: { status: TrStatus.CANCELLED, closed_at: new Date() },
    });

    const note =
      doc.tr_type === TrType.PUTAWAY
        ? ' Stock remains in the GR interim bin — move it manually with LT01 if required.'
        : '';
    return ok({ id: doc.id }, `Transfer requirement ${doc.tr_number} cancelled.${note}`);
  });
}
