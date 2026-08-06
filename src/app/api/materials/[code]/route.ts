import { NextRequest } from 'next/server';
import prisma from '@/lib/prisma';
import { requireWrite, requireAdmin, HttpError } from '@/lib/auth';
import { handle, ok, cleanStr, toInt } from '@/lib/api';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ code: string }> };

/** PATCH /api/materials/:code — MM02 Change Material */
export async function PATCH(req: NextRequest, ctx: Ctx) {
  return handle(async () => {
    await requireWrite();
    const { code } = await ctx.params;
    const material_code = decodeURIComponent(code).toUpperCase();
    const b = await req.json();

    const current = await prisma.material.findUnique({ where: { material_code } });
    if (!current) throw new HttpError(404, `Material ${material_code} does not exist.`);

    // Ubah batch management hanya boleh jika stok = 0 (aturan SAP)
    if (b.is_batch_managed !== undefined && Boolean(b.is_batch_managed) !== current.is_batch_managed) {
      const im = await prisma.stockIM.findUnique({ where: { material_code } });
      if ((im?.total_qty ?? 0) !== 0)
        throw new HttpError(
          400,
          'Batch management indicator cannot be changed while stock exists for this material.'
        );
    }

    const m = await prisma.material.update({
      where: { material_code },
      data: {
        description: b.description !== undefined ? cleanStr(b.description) : undefined,
        uom: b.uom !== undefined ? cleanStr(b.uom).toUpperCase() : undefined,
        is_batch_managed: b.is_batch_managed !== undefined ? Boolean(b.is_batch_managed) : undefined,
        min_safety_stock:
          b.min_safety_stock !== undefined ? toInt(b.min_safety_stock, 'min_safety_stock') : undefined,
      },
    });

    return ok(m, `Material ${material_code} changed`);
  });
}

/** DELETE /api/materials/:code — hanya jika tidak ada stok & tidak ada dokumen */
export async function DELETE(_req: NextRequest, ctx: Ctx) {
  return handle(async () => {
    await requireAdmin();
    const { code } = await ctx.params;
    const material_code = decodeURIComponent(code).toUpperCase();

    const im = await prisma.stockIM.findUnique({ where: { material_code } });
    if ((im?.total_qty ?? 0) !== 0)
      throw new HttpError(400, `Material ${material_code} still has stock. Deletion not possible.`);

    const wm = await prisma.stockWM.count({ where: { material_code } });
    if (wm > 0) throw new HttpError(400, `Material ${material_code} still has warehouse quants.`);

    await prisma.$transaction([
      prisma.stockIM.deleteMany({ where: { material_code } }),
      prisma.material.delete({ where: { material_code } }),
    ]);

    return ok({ material_code }, `Material ${material_code} deleted`);
  });
}
