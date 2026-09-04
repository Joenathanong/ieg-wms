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

    /**
     * SKU KEMBAR — deskripsi sama, barcode berbeda.
     *
     * Hanya diperiksa bila yang discan barcode ITEM (B-POM / produk). Pada
     * barang lepas, barcode item tidak bisa membedakan SKU: ia hanya menunjuk
     * SKU yang kebetulan memegang barcode itu, sementara kembarannya tidak
     * memegang apa-apa. Petugas yang menghitung perlu diberi tahu di detik itu
     * juga — kalau kartonnya masih tersegel, kode master box (yang ADALAH kode
     * material) memberi jawaban yang pasti.
     *
     * Scan kode material dan kode master box tidak pernah ambigu, jadi tidak
     * perlu diganggu peringatan.
     */
    const twins =
      matched_by === 'BPOM' || matched_by === 'PRODUK'
        ? (
            await prisma.material.findMany({
              where: {
                description: m.description,
                is_active: true,
                material_code: { not: m.material_code },
              },
              select: { material_code: true },
              orderBy: { material_code: 'asc' },
              take: 10,
            })
          ).map((x) => x.material_code)
        : [];

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
        /** SKU lain berdeskripsi sama — barcode item tidak bisa membedakannya */
        twins,
      },
      twins.length > 0
        ? `${m.material_code} — ${m.description}. PERHATIAN: deskripsi ini dipakai ` +
          `${twins.length + 1} SKU (${[m.material_code, ...twins].join(', ')}) dan barcode item ` +
          `tidak bisa membedakannya. Bila kartonnya masih tersegel, scan kode master box.`
        : alias_of
          ? `Kode lama ${alias_of} -> material ${m.material_code} (${m.description})`
          : `Barcode ${code} -> material ${m.material_code}`
    );
  });
}
