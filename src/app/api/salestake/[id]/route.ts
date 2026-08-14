import { NextRequest } from 'next/server';
import prisma from '@/lib/prisma';
import { requireUser, requireWrite, HttpError } from '@/lib/auth';
import { handle, ok, cleanStr } from '@/lib/api';
import { SalesTakeStatus } from '@prisma/client';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

async function findDoc(idOrNumber: string) {
  const key = decodeURIComponent(idOrNumber);
  return prisma.salesTakeDoc.findFirst({
    where: { OR: [{ id: key }, { doc_number: key }] },
    include: { items: { orderBy: [{ counted_at: 'asc' }] } },
  });
}

/** GET /api/salestake/:id — detail dokumen + seluruh baris hasil hitung. */
export async function GET(_req: NextRequest, ctx: Ctx) {
  return handle(async () => {
    await requireUser();
    const { id } = await ctx.params;
    const doc = await findDoc(id);
    if (!doc) throw new HttpError(404, 'Sales take document does not exist.');

    const materials = await prisma.material.findMany({
      where: { material_code: { in: doc.items.map((i) => i.material_code) } },
      select: { material_code: true, description: true, uom: true },
    });
    const mMap = new Map(materials.map((m) => [m.material_code, m]));

    const bins = [...new Set(doc.items.map((i) => i.bin_code))];

    return ok(
      {
        ...doc,
        counted_bins: bins,
        items: doc.items.map((i) => ({
          ...i,
          description: mMap.get(i.material_code)?.description ?? '',
          uom: mMap.get(i.material_code)?.uom ?? 'PC',
        })),
      },
      `Document ${doc.doc_number} — ${bins.length} bin, ${doc.items.length} line`
    );
  });
}

/**
 * PATCH /api/salestake/:id — tutup atau batalkan dokumen.
 * Body: { status: 'CLOSED' | 'CANCELLED' }
 *
 * Membatalkan dokumen TIDAK membatalkan posting yang sudah terjadi — setiap bin
 * diposting saat itu juga. Pembatalan dokumen 601 dilakukan per dokumen lewat
 * MIGO Cancellation (602).
 */
export async function PATCH(req: NextRequest, ctx: Ctx) {
  return handle(async () => {
    await requireWrite();
    const { id } = await ctx.params;
    const doc = await findDoc(id);
    if (!doc) throw new HttpError(404, 'Sales take document does not exist.');

    const b = await req.json();
    const status = cleanStr(b.status).toUpperCase();
    if (status !== 'CLOSED' && status !== 'CANCELLED')
      throw new HttpError(400, 'Status must be CLOSED or CANCELLED.');
    if (doc.status !== SalesTakeStatus.OPEN)
      throw new HttpError(400, `Document ${doc.doc_number} is already ${doc.status.toLowerCase()}.`);

    const updated = await prisma.salesTakeDoc.update({
      where: { id: doc.id },
      data: { status: status as SalesTakeStatus, closed_at: new Date() },
    });

    return ok(
      updated,
      status === 'CLOSED'
        ? `Document ${doc.doc_number} closed — ${doc.items.length} line(s) recorded`
        : `Document ${doc.doc_number} cancelled. Dokumen material yang sudah diposting tidak ikut dibatalkan.`
    );
  });
}
