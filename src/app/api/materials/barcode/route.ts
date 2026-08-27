import { NextRequest } from 'next/server';
import prisma from '@/lib/prisma';
import { requireUser, HttpError } from '@/lib/auth';
import { handle, ok, fail, cleanStr } from '@/lib/api';

export const dynamic = 'force-dynamic';

/**
 * GET /api/materials/barcode?code=8998824551223
 * Lookup barcode scan PDT -> material master.
 * Dicocokkan ke barcode_bpom ATAU barcode_produk (exact, case-insensitive).
 */
export async function GET(req: NextRequest) {
  return handle(async () => {
    await requireUser();
    const code = cleanStr(req.nextUrl.searchParams.get('code'));
    if (!code) throw new HttpError(400, 'Barcode is empty.');

    // Kode material sendiri ikut dicocokkan: banyak kode material berupa angka
    // (mis. 1201020604) dan tidak akan pernah terdaftar di kolom barcode.
    let m = await prisma.material.findFirst({
      where: {
        OR: [
          { material_code: { equals: code } },
          { barcode_bpom: { equals: code } },
          { barcode_produk: { equals: code } },
        ],
      },
    });

    const up = code.toUpperCase();
    let alias_of: string | null = null;

    // Kode lama yang sudah digabung tetap tercetak di kemasan dan tetap dipakai
    // di file principal, jadi harus tetap bisa discan — tetapi diterjemahkan ke
    // material utama supaya stoknya tidak kembali terbelah.
    if (!m) {
      const alias = await prisma.materialAlias.findUnique({ where: { alias_code: up } });
      if (alias) {
        m = await prisma.material.findUnique({ where: { material_code: alias.material_code } });
        if (m) alias_of = up;
      }
    }

    if (!m) {
      return fail(`${code} tidak dikenali sebagai kode material maupun barcode (MM01).`, 404);
    }

    const matched_by = alias_of
      ? 'ALIAS'
      : m.material_code.toUpperCase() === up
        ? 'MATERIAL'
        : m.barcode_bpom && m.barcode_bpom.toUpperCase() === up
          ? 'BPOM'
          : 'PRODUK';

    return ok(
      {
        material_code: m.material_code,
        description: m.description,
        uom: m.uom,
        is_batch_managed: m.is_batch_managed,
        fix_bin: m.fix_bin,
        matched_by,
        /** kode lama yang discan, bila hasilnya lewat penerjemahan alias */
        alias_of,
      },
      alias_of
        ? `Kode lama ${alias_of} -> material ${m.material_code} (${m.description})`
        : `Barcode ${code} -> material ${m.material_code}`
    );
  });
}
