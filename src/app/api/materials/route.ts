import { NextRequest } from 'next/server';
import prisma from '@/lib/prisma';
import { requireUser, requireWrite, HttpError } from '@/lib/auth';
import { handle, ok, cleanStr, toInt } from '@/lib/api';
import { likeWhereAny } from '@/lib/like';
import type { Prisma } from '@prisma/client';

export const dynamic = 'force-dynamic';

/** GET /api/materials?q=&limit= — MM03 / search help (F4) */
export async function GET(req: NextRequest) {
  return handle(async () => {
    await requireUser();
    const sp = req.nextUrl.searchParams;
    const q = cleanStr(sp.get('q'));
    const limit = Math.min(Number(sp.get('limit') ?? 500), 2000);

    // mencari kode, deskripsi, kode OCS, maupun barcode — mendukung wildcard '*'
    const where = likeWhereAny(
      ['material_code', 'description', 'kode_ocs', 'barcode_bpom', 'barcode_produk'],
      q
    );

    const materials = await prisma.material.findMany({
      where: (where ?? undefined) as Prisma.MaterialWhereInput | undefined,
      orderBy: { material_code: 'asc' },
      take: limit,
      include: {
        packagings: { orderBy: [{ is_default: 'desc' }, { qty_per_unit: 'desc' }] },
      },
    });

    return ok(materials, `${materials.length} material(s) selected`);
  });
}

/** POST /api/materials — MM01 Create Material */
export async function POST(req: NextRequest) {
  return handle(async () => {
    await requireWrite();
    const b = await req.json();

    const material_code = cleanStr(b.material_code).toUpperCase();
    const description = cleanStr(b.description);
    if (!material_code) throw new HttpError(400, 'Material number is mandatory.');
    if (!description) throw new HttpError(400, 'Material description is mandatory.');

    const exists = await prisma.material.findUnique({ where: { material_code } });
    if (exists) throw new HttpError(409, `Material ${material_code} already exists.`);

    const barcode_bpom = cleanStr(b.barcode_bpom).toUpperCase() || null;
    const barcode_produk = cleanStr(b.barcode_produk).toUpperCase() || null;
    const kode_ocs = cleanStr(b.kode_ocs).toUpperCase() || null;
    const fix_bin = cleanStr(b.fix_bin).toUpperCase() || null;

    // barcode harus unik antar material agar lookup scan PDT tidak ambigu
    for (const [label, val] of [
      ['Barcode B-POM', barcode_bpom],
      ['Barcode produk', barcode_produk],
    ] as const) {
      if (!val) continue;
      const dup = await prisma.material.findFirst({
        where: {
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

    const m = await prisma.material.create({
      data: {
        material_code,
        description,
        uom: (cleanStr(b.uom) || 'PC').toUpperCase(),
        is_batch_managed: b.is_batch_managed === false ? false : true,
        min_safety_stock: b.min_safety_stock ? toInt(b.min_safety_stock, 'min_safety_stock') : 0,
        barcode_bpom,
        barcode_produk,
        kode_ocs,
        fix_bin,
      },
    });

    return ok(m, `Material ${material_code} created`);
  });
}
