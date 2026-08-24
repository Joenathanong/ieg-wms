import { NextRequest } from 'next/server';
import prisma from '@/lib/prisma';
import { requireUser } from '@/lib/auth';
import { handle, ok, cleanStr } from '@/lib/api';

export const dynamic = 'force-dynamic';

/**
 * GET /api/materials/catalog?v=<versi-yang-dipegang-browser>
 *
 * Katalog material RINGKAS untuk saran ketik, dengan pemeriksaan versi.
 *
 * Masalah yang dipecahkan: layar seperti ZREPL memakai `useMasterData`, yang
 * menarik SELURUH material beserta master pallet-nya setiap kali layar dibuka.
 * Untuk saran ketik, sebagian besar muatan itu tidak terpakai — dan pada
 * database serverless yang ditagih per baris terbaca, ia terbaca berulang kali
 * sepanjang hari tanpa datanya benar-benar berubah.
 *
 * Cara kerjanya: browser menyimpan katalog beserta versinya, lalu mengirim
 * versi itu di setiap pembukaan layar. Bila cocok, jawabannya hanya beberapa
 * puluh byte dan cukup satu query agregat.
 *
 * Versi dihitung dari jumlah baris + waktu perubahan terakhir. Keduanya
 * diperlukan: `MAX(updated_at)` saja tidak berubah ketika ada baris DIHAPUS,
 * dan jumlah baris saja tidak berubah ketika deskripsi disunting.
 *
 * Dengan begitu SKU baru dari MM01 atau ZUPLOAD langsung terbaca di semua
 * browser pada pembukaan layar berikutnya — tanpa penjadwalan, dan tanpa
 * jendela waktu di mana data terlihat basi.
 */
export async function GET(req: NextRequest) {
  return handle(async () => {
    await requireUser();
    const known = cleanStr(req.nextUrl.searchParams.get('v'));

    const agg = await prisma.material.aggregate({
      _count: { _all: true },
      _max: { updated_at: true },
    });
    const version = `${agg._count._all}-${agg._max.updated_at?.getTime() ?? 0}`;

    if (known && known === version) {
      return ok({ unchanged: true, version, materials: [] }, 'Catalog is up to date');
    }

    const materials = await prisma.material.findMany({
      orderBy: { material_code: 'asc' },
      // Sengaja TANPA packagings: saran ketik hanya butuh identitas material.
      select: {
        material_code: true,
        description: true,
        uom: true,
        is_batch_managed: true,
        fix_bin: true,
      },
    });

    return ok(
      { unchanged: false, version, materials },
      `${materials.length} material(s) in catalog`
    );
  });
}
