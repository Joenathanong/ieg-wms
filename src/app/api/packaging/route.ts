import { NextRequest } from 'next/server';
import prisma from '@/lib/prisma';
import { requireUser, requireWrite, HttpError } from '@/lib/auth';
import { handle, ok, cleanStr, toInt } from '@/lib/api';
import { resolveMaterialCode } from '@/lib/alias';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** GET /api/packaging?material=  — daftar tipe kemasan / pallet */
export async function GET(req: NextRequest) {
  return handle(async () => {
    await requireUser();
    const material = cleanStr(req.nextUrl.searchParams.get('material')).toUpperCase();

    const rows = await prisma.packagingType.findMany({
      where: material ? { material_code: material } : undefined,
      orderBy: [{ material_code: 'asc' }, { is_default: 'desc' }, { qty_per_unit: 'desc' }],
      take: 2000,
    });

    return ok(rows, `${rows.length} packaging type(s) selected`);
  });
}

/**
 * POST /api/packaging — tambah / ubah tipe kemasan (upsert).
 * Body: { material_code, pack_code, description?, qty_per_unit, is_default? }
 */
export async function POST(req: NextRequest) {
  return handle(async () => {
    await requireWrite();
    const b = await req.json();

    const material_code = cleanStr(b.material_code).toUpperCase();
    const pack_code = cleanStr(b.pack_code).toUpperCase();
    const qty_per_unit = toInt(b.qty_per_unit, 'qty_per_unit');
    const su_type = cleanStr(b.su_type).toUpperCase() || 'PAL';
    const zone_group = cleanStr(b.zone_group).toUpperCase() || null;

    if (!material_code) throw new HttpError(400, 'Material number is mandatory.');
    if (!pack_code) throw new HttpError(400, 'Packaging code is mandatory.');
    if (qty_per_unit <= 0) throw new HttpError(400, 'Quantity per unit must be greater than zero.');

    // Kemasan hanya boleh menempel pada material utama. Kode lama diterjemahkan
    // supaya baris kemasan tidak tercipta atas nama kode yang sudah jadi alias
    // dan karena itu tidak akan pernah terpakai saat split pallet.
    const resolvedMat = await resolveMaterialCode(prisma, material_code);
    if (!resolvedMat) throw new HttpError(400, `Material ${material_code} does not exist (MM01).`);
    const material = await prisma.material.findUnique({
      where: { material_code: resolvedMat.material_code },
    });
    if (!material) throw new HttpError(400, `Material ${material_code} does not exist (MM01).`);
    /** kode utama — dipakai untuk semua tulisan ke tabel kemasan */
    const mcode = material.material_code;

    const isDefault = b.is_default === true;

    const row = await prisma.$transaction(async (tx) => {
      if (isDefault) {
        // default berlaku per kelompok gudang
        await tx.packagingType.updateMany({
          where: { material_code: mcode, zone_group },
          data: { is_default: false },
        });
      }
      const saved = await tx.packagingType.upsert({
        where: { material_code_pack_code: { material_code: mcode, pack_code } },
        create: {
          material_code: mcode,
          pack_code,
          su_type,
          zone_group,
          description: cleanStr(b.description),
          qty_per_unit,
          is_default: isDefault,
        },
        update: {
          su_type,
          zone_group,
          description: cleanStr(b.description),
          qty_per_unit,
          ...(isDefault ? { is_default: true } : {}),
        },
      });

      // pastikan selalu ada tepat satu default
      const all = await tx.packagingType.findMany({ where: { material_code: mcode, zone_group } });
      if (all.length > 0 && !all.some((p) => p.is_default)) {
        await tx.packagingType.update({ where: { id: all[0].id }, data: { is_default: true } });
      }
      return saved;
    });

    return ok(row, `Packaging ${pack_code} for ${mcode} saved (${qty_per_unit} ${material.uom}/unit)`);
  });
}

/** DELETE /api/packaging?material=&pack= */
export async function DELETE(req: NextRequest) {
  return handle(async () => {
    await requireWrite();
    const sp = req.nextUrl.searchParams;
    const material_code = cleanStr(sp.get('material')).toUpperCase();
    const pack_code = cleanStr(sp.get('pack')).toUpperCase();
    if (!material_code || !pack_code) throw new HttpError(400, 'Material and packaging code are required.');

    await prisma.$transaction(async (tx) => {
      await tx.packagingType.delete({
        where: { material_code_pack_code: { material_code, pack_code } },
      });
      const rest = await tx.packagingType.findMany({ where: { material_code } });
      if (rest.length > 0 && !rest.some((p) => p.is_default)) {
        await tx.packagingType.update({ where: { id: rest[0].id }, data: { is_default: true } });
      }
    });

    return ok({ material_code, pack_code }, `Packaging ${pack_code} deleted from ${material_code}`);
  });
}
