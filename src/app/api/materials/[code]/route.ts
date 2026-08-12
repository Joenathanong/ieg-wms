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

    const barcode_bpom =
      b.barcode_bpom !== undefined ? cleanStr(b.barcode_bpom).toUpperCase() || null : undefined;
    const barcode_produk =
      b.barcode_produk !== undefined ? cleanStr(b.barcode_produk).toUpperCase() || null : undefined;
    const kode_ocs = b.kode_ocs !== undefined ? cleanStr(b.kode_ocs).toUpperCase() || null : undefined;
    const fix_bin = b.fix_bin !== undefined ? cleanStr(b.fix_bin).toUpperCase() || null : undefined;

    // barcode harus unik antar material agar lookup scan PDT tidak ambigu
    for (const [label, val] of [
      ['Barcode B-POM', barcode_bpom],
      ['Barcode produk', barcode_produk],
    ] as const) {
      if (!val) continue;
      const dup = await prisma.material.findFirst({
        where: {
          material_code: { not: material_code },
          OR: [
            { barcode_bpom: { equals: val, mode: 'insensitive' } },
            { barcode_produk: { equals: val, mode: 'insensitive' } },
          ],
        },
      });
      if (dup)
        throw new HttpError(409, `${label} ${val} sudah dipakai material ${dup.material_code}.`);
    }

    if (fix_bin) {
      const bin = await prisma.storageBin.findUnique({ where: { bin_code: fix_bin } });
      if (!bin) throw new HttpError(400, `Fix bin ${fix_bin} does not exist (LS01N).`);
      if (bin.is_interim) throw new HttpError(400, `Fix bin ${fix_bin} is an interim bin and cannot be used.`);
    }

    const m = await prisma.material.update({
      where: { material_code },
      data: {
        description: b.description !== undefined ? cleanStr(b.description) : undefined,
        uom: b.uom !== undefined ? cleanStr(b.uom).toUpperCase() : undefined,
        is_batch_managed: b.is_batch_managed !== undefined ? Boolean(b.is_batch_managed) : undefined,
        min_safety_stock:
          b.min_safety_stock !== undefined ? toInt(b.min_safety_stock, 'min_safety_stock') : undefined,
        barcode_bpom,
        barcode_produk,
        kode_ocs,
        fix_bin,
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
