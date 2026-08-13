import { NextRequest } from 'next/server';
import prisma from '@/lib/prisma';
import { requireAdmin, HttpError } from '@/lib/auth';
import { handle, ok, cleanStr } from '@/lib/api';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ code: string }> };

async function findCc(raw: string) {
  const cost_center = decodeURIComponent(raw ?? '').trim().toUpperCase();
  const cc = await prisma.costCenter.findUnique({ where: { cost_center } });
  if (!cc) throw new HttpError(404, `Cost center ${cost_center} not found.`);
  return cc;
}

/** PATCH /api/costcenters/[code] — KS02 Change Cost Center. Kode tidak bisa diubah. */
export async function PATCH(req: NextRequest, ctx: Ctx) {
  return handle(async () => {
    await requireAdmin();
    const { code } = await ctx.params;
    const cc = await findCc(code);
    const b = await req.json();

    const description = b.description !== undefined ? cleanStr(b.description) : undefined;
    if (description !== undefined && !description)
      throw new HttpError(400, 'Cost center description is mandatory.');

    const row = await prisma.costCenter.update({
      where: { cost_center: cc.cost_center },
      data: {
        description,
        department:
          b.department !== undefined ? cleanStr(b.department).toUpperCase() || null : undefined,
        is_active: b.is_active !== undefined ? !!b.is_active : undefined,
      },
    });

    return ok(row, `Cost center ${row.cost_center} changed`);
  });
}

/**
 * DELETE /api/costcenters/[code]
 * Ditolak bila sudah pernah dipakai di dokumen material — riwayat MB51 harus
 * tetap bisa menjelaskan pembebanan lamanya. Nonaktifkan saja bila sudah tidak
 * dipakai lagi.
 */
export async function DELETE(_req: NextRequest, ctx: Ctx) {
  return handle(async () => {
    await requireAdmin();
    const { code } = await ctx.params;
    const cc = await findCc(code);

    const used = await prisma.migoLog.count({ where: { cost_center: cc.cost_center } });
    if (used > 0) {
      throw new HttpError(
        409,
        `Cost center ${cc.cost_center} is already used in ${used} material document(s). ` +
          `Deactivate it instead of deleting.`
      );
    }

    await prisma.costCenter.delete({ where: { cost_center: cc.cost_center } });
    return ok({ cost_center: cc.cost_center }, `Cost center ${cc.cost_center} deleted`);
  });
}
