import { NextRequest } from 'next/server';
import prisma from '@/lib/prisma';
import { requireUser, requireWrite, HttpError } from '@/lib/auth';
import { handle, ok, cleanStr, toInt, normBatch } from '@/lib/api';
import { BinStatus, PhysInvStatus } from '@prisma/client';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

type Ctx = { params: Promise<{ id: string }> };

async function findDoc(idOrNumber: string) {
  const key = decodeURIComponent(idOrNumber);
  return prisma.physInvDoc.findFirst({
    where: { OR: [{ id: key }, { doc_number: key }] },
    include: {
      items: { orderBy: [{ bin_code: 'asc' }, { material_code: 'asc' }] },
      bins: { orderBy: { bin_code: 'asc' } },
    },
  });
}

/** GET /api/physinv/:id — detail dokumen + seluruh baris (lintas bin) */
export async function GET(_req: NextRequest, ctx: Ctx) {
  return handle(async () => {
    await requireUser();
    const { id } = await ctx.params;
    const doc = await findDoc(id);
    if (!doc) throw new HttpError(404, 'Physical inventory document does not exist.');

    const materials = await prisma.material.findMany({
      where: { material_code: { in: doc.items.map((i) => i.material_code) } },
      select: { material_code: true, description: true, uom: true },
    });
    const mMap = new Map(materials.map((m) => [m.material_code, m]));

    return ok(
      {
        ...doc,
        items: doc.items.map((i) => ({
          ...i,
          description: mMap.get(i.material_code)?.description ?? '',
          uom: mMap.get(i.material_code)?.uom ?? 'PC',
        })),
      },
      `Document ${doc.doc_number} displayed — ${doc.items.length} line(s) across ${doc.frozen_bins.length} bin(s)`
    );
  });
}

/**
 * PATCH /api/physinv/:id — LI11N Enter Count Result (multi-line).
 * Body: { items: [{ id?, bin_code, material_code, batch_number?, counted_qty }] }
 * Baris yang tidak ada di snapshot (barang ditemukan di bin) otomatis ditambahkan.
 */
export async function PATCH(req: NextRequest, ctx: Ctx) {
  return handle(async () => {
    const user = await requireWrite();
    const { id } = await ctx.params;
    const b = await req.json();
    const items = Array.isArray(b.items) ? b.items : [];
    /** bin yang dinyatakan selesai dihitung — termasuk bin yang ternyata kosong */
    const countedBins: string[] = (Array.isArray(b.counted_bins) ? b.counted_bins : [])
      .map((x: unknown) => cleanStr(x).toUpperCase())
      .filter(Boolean);

    if (items.length === 0 && countedBins.length === 0)
      throw new HttpError(400, 'No count results were entered.');
    if (items.length > 500) throw new HttpError(400, 'Maximum 500 count lines per request.');

    const doc = await prisma.$transaction(
      async (tx) => {
        const d = await tx.physInvDoc.findFirst({
          where: { OR: [{ id: decodeURIComponent(id) }, { doc_number: decodeURIComponent(id) }] },
          include: { items: true },
        });
        if (!d) throw new HttpError(404, 'Physical inventory document does not exist.');
        if (d.status === PhysInvStatus.POSTED)
          throw new HttpError(400, `Document ${d.doc_number} is already posted.`);

        for (const raw of items) {
          const counted = toInt(raw.counted_qty ?? 0, 'counted quantity');
          if (counted < 0) throw new HttpError(400, 'Counted quantity cannot be negative.');

          const material_code = cleanStr(raw.material_code).toUpperCase();
          const bin_code = cleanStr(raw.bin_code).toUpperCase();
          const batch_number = normBatch(raw.batch_number);

          const existing = raw.id
            ? d.items.find((i) => i.id === raw.id)
            : d.items.find(
                (i) =>
                  i.material_code === material_code &&
                  i.bin_code === bin_code &&
                  i.batch_number === batch_number
              );

          if (existing) {
            await tx.physInvDocItem.update({
              where: { id: existing.id },
              data: { counted_qty: counted, diff_qty: counted - existing.book_qty },
            });
          } else {
            if (!material_code) throw new HttpError(400, 'Material number is mandatory for new count item.');
            if (!bin_code) throw new HttpError(400, 'Storage bin is mandatory for new count item.');
            if (!d.frozen_bins.includes(bin_code))
              throw new HttpError(400, `Bin ${bin_code} is not part of document ${d.doc_number}.`);

            const mat = await tx.material.findUnique({ where: { material_code } });
            if (!mat) throw new HttpError(400, `Material ${material_code} does not exist in master data.`);
            if (mat.is_batch_managed && !batch_number)
              throw new HttpError(400, `Material ${material_code} is batch managed. Batch is mandatory.`);

            await tx.physInvDocItem.create({
              data: {
                doc_id: d.id,
                bin_code,
                material_code,
                batch_number: mat.is_batch_managed ? batch_number : null,
                book_qty: 0,
                counted_qty: counted,
                diff_qty: counted,
              },
            });
          }
        }

        // ---- tandai bin yang selesai dihitung ----
        // Sebuah bin dianggap selesai bila operator menyatakannya (tombol
        // "selesai" / "bin kosong" di ZRF05) ATAU seluruh barisnya sudah terisi.
        const fresh = await tx.physInvDocItem.findMany({ where: { doc_id: d.id } });
        const byBin = new Map<string, { total: number; filled: number }>();
        for (const i of fresh) {
          const e = byBin.get(i.bin_code) ?? { total: 0, filled: 0 };
          e.total++;
          if (i.counted_qty !== null) e.filled++;
          byBin.set(i.bin_code, e);
        }

        const done = new Set(countedBins.filter((c) => d.frozen_bins.includes(c)));
        for (const [bin, e] of byBin) {
          if (e.total > 0 && e.total === e.filled) done.add(bin);
        }

        if (done.size > 0) {
          await tx.physInvBin.updateMany({
            where: { doc_id: d.id, bin_code: { in: [...done] }, counted_at: null },
            data: { counted_at: new Date(), counted_by: user.username },
          });
        }

        return tx.physInvDoc.update({
          where: { id: d.id },
          data: { status: PhysInvStatus.COUNTED, counted_at: new Date() },
          include: { items: true, bins: true },
        });
      },
      { timeout: 30000, maxWait: 10000 }
    );

    const diff = doc.items.reduce((a, i) => a + i.diff_qty, 0);
    const counted = doc.items.filter((i) => i.counted_qty !== null).length;
    const binsDone = doc.bins.filter((x) => x.counted_at !== null).length;
    return ok(
      doc,
      `Count saved for ${doc.doc_number} — ${binsDone}/${doc.bins.length} bin(s) done, ` +
        `${counted}/${doc.items.length} line(s) counted, net difference ${diff > 0 ? '+' : ''}${diff}`
    );
  });
}

/** DELETE /api/physinv/:id — batalkan dokumen & release semua bin */
export async function DELETE(_req: NextRequest, ctx: Ctx) {
  return handle(async () => {
    await requireWrite();
    const { id } = await ctx.params;

    const doc = await prisma.$transaction(async (tx) => {
      const d = await tx.physInvDoc.findFirst({
        where: { OR: [{ id: decodeURIComponent(id) }, { doc_number: decodeURIComponent(id) }] },
      });
      if (!d) throw new HttpError(404, 'Physical inventory document does not exist.');
      if (d.status === PhysInvStatus.POSTED)
        throw new HttpError(400, 'Posted document cannot be deleted.');

      await tx.physInvDoc.delete({ where: { id: d.id } });

      // release semua bin sesuai stok aktual
      for (const bin_code of d.frozen_bins) {
        const agg = await tx.stockWM.aggregate({ where: { bin_code }, _sum: { qty: true } });
        await tx.storageBin.updateMany({
          where: { bin_code },
          data: { status: (agg._sum.qty ?? 0) > 0 ? BinStatus.OCCUPIED : BinStatus.EMPTY },
        });
      }
      return d;
    }, { timeout: 30000, maxWait: 10000 });

    return ok({ id: doc.id }, `Document ${doc.doc_number} deleted — ${doc.frozen_bins.length} bin(s) released`);
  });
}
