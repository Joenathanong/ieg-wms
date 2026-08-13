import { NextRequest } from 'next/server';
import prisma from '@/lib/prisma';
import { requireWrite, requireAdmin, HttpError } from '@/lib/auth';
import { handle, ok, cleanStr } from '@/lib/api';
import { BinStatus } from '@prisma/client';
import { resolveZone } from '@/lib/zonemaster';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ code: string }> };

/**
 * PATCH /api/bins/:code
 *  - LS02N : ubah zone / max weight
 *  - LS06  : block / unblock bin
 */
export async function PATCH(req: NextRequest, ctx: Ctx) {
  return handle(async () => {
    await requireWrite();
    const { code } = await ctx.params;
    const bin_code = decodeURIComponent(code).toUpperCase();
    const b = await req.json();

    const bin = await prisma.storageBin.findUnique({ where: { bin_code } });
    if (!bin) throw new HttpError(404, `Storage bin ${bin_code} does not exist.`);

    let nextStatus: BinStatus | undefined;

    if (b.status !== undefined) {
      const st = cleanStr(b.status).toUpperCase() as BinStatus;
      if (!Object.values(BinStatus).includes(st)) throw new HttpError(400, `Invalid bin status ${st}.`);

      const agg = await prisma.stockWM.aggregate({ where: { bin_code }, _sum: { qty: true } });
      const total = agg._sum.qty ?? 0;

      if (st === BinStatus.BLOCKED && total > 0)
        throw new HttpError(400, `Storage bin ${bin_code} still contains ${total} pcs. Block not possible.`);

      // Unblock -> status ditentukan ulang dari stok aktual
      nextStatus = st === BinStatus.BLOCKED ? BinStatus.BLOCKED : total > 0 ? BinStatus.OCCUPIED : BinStatus.EMPTY;
    }

    // zona baru (bila diubah) harus terdaftar & aktif di master ZZONE
    const zone = b.zone_id !== undefined ? await resolveZone(b.zone_id) : null;

    const updated = await prisma.storageBin.update({
      where: { bin_code },
      data: {
        zone_id: zone ? zone.zone_code : undefined,
        is_interim: zone ? zone.is_interim : undefined,
        max_weight_kg: b.max_weight_kg !== undefined ? Number(b.max_weight_kg) || 0 : undefined,
        status: nextStatus,
      },
    });

    return ok(updated, `Storage bin ${bin_code} changed`);
  });
}

/** DELETE /api/bins/:code — hanya bin kosong */
export async function DELETE(_req: NextRequest, ctx: Ctx) {
  return handle(async () => {
    await requireAdmin();
    const { code } = await ctx.params;
    const bin_code = decodeURIComponent(code).toUpperCase();

    const agg = await prisma.stockWM.aggregate({ where: { bin_code }, _sum: { qty: true } });
    if ((agg._sum.qty ?? 0) > 0)
      throw new HttpError(400, `Storage bin ${bin_code} is not empty. Deletion not possible.`);

    await prisma.storageBin.delete({ where: { bin_code } });
    return ok({ bin_code }, `Storage bin ${bin_code} deleted`);
  });
}
