import { NextRequest } from 'next/server';
import prisma from '@/lib/prisma';
import { requireUser, requireAdmin, HttpError } from '@/lib/auth';
import { handle, ok, cleanStr } from '@/lib/api';
import { assertAliasAllowed } from '@/lib/alias';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ code: string }> };

async function target(ctx: Ctx) {
  const { code } = await ctx.params;
  const material_code = decodeURIComponent(code).toUpperCase();
  const m = await prisma.material.findUnique({ where: { material_code } });
  if (!m) throw new HttpError(404, `Material ${material_code} does not exist.`);
  return m;
}

/** GET /api/materials/:code/alias — kode lain yang menunjuk ke material ini. */
export async function GET(_req: NextRequest, ctx: Ctx) {
  return handle(async () => {
    await requireUser();
    const m = await target(ctx);

    const [aliases, self] = await Promise.all([
      prisma.materialAlias.findMany({
        where: { material_code: m.material_code },
        orderBy: { alias_code: 'asc' },
      }),
      // Material ini sendiri bisa saja sudah menjadi alias kode lain — layar
      // perlu tahu supaya tidak menawarkan penambahan alias di kode yang sudah
      // ditutup.
      prisma.materialAlias.findUnique({ where: { alias_code: m.material_code } }),
    ]);

    return ok(
      {
        material_code: m.material_code,
        is_active: m.is_active,
        alias_of: self?.material_code ?? null,
        aliases,
      },
      `${aliases.length} kode alias untuk ${m.material_code}`
    );
  });
}

/**
 * POST /api/materials/:code/alias — daftarkan kode lain sebagai alias.
 * Body: { alias_code, remarks? }
 *
 * Ini HANYA membuat penunjuk. Kalau kode alias itu masih berupa material yang
 * punya stok, pakai penggabungan SKU (ZMATDUP) — stoknya harus dipindahkan
 * lebih dulu, kalau tidak ia terkunci di kode yang sudah tidak bisa diposting.
 */
export async function POST(req: NextRequest, ctx: Ctx) {
  return handle(async () => {
    const user = await requireAdmin();
    const m = await target(ctx);
    const b = await req.json();
    const alias_code = cleanStr(b.alias_code).toUpperCase();

    if (!alias_code) throw new HttpError(400, 'Kode alias wajib diisi.');

    try {
      await assertAliasAllowed(prisma, alias_code, m.material_code);
    } catch (e) {
      throw new HttpError(400, e instanceof Error ? e.message : 'Alias tidak sah.');
    }

    const existingMat = await prisma.material.findUnique({ where: { material_code: alias_code } });
    if (existingMat?.is_active) {
      const im = await prisma.stockIM.findUnique({ where: { material_code: alias_code } });
      const qty = im?.total_qty ?? 0;
      if (qty !== 0)
        throw new HttpError(
          400,
          `${alias_code} masih berupa material aktif dengan stok ${qty}. ` +
            `Pakai penggabungan SKU (ZMATDUP) supaya stoknya ikut pindah, bukan alias biasa.`
        );
      throw new HttpError(
        400,
        `${alias_code} masih berupa material aktif. Tutup lewat penggabungan SKU (ZMATDUP) ` +
          `supaya master, barcode, dan kemasannya ikut dibereskan.`
      );
    }

    const row = await prisma.materialAlias.upsert({
      where: { alias_code },
      create: {
        alias_code,
        material_code: m.material_code,
        remarks: cleanStr(b.remarks) || null,
        created_by: user.username,
      },
      update: { material_code: m.material_code, remarks: cleanStr(b.remarks) || null },
    });

    return ok(row, `Kode ${alias_code} kini dibaca sebagai ${m.material_code}.`);
  });
}

/**
 * DELETE /api/materials/:code/alias?alias=XXX — lepaskan alias.
 *
 * Setelah dilepas, kode itu tidak dikenali lagi: scan karton lama akan berhenti
 * dengan pesan "tidak dikenali", bukan diam-diam menunjuk ke tempat lain.
 */
export async function DELETE(req: NextRequest, ctx: Ctx) {
  return handle(async () => {
    await requireAdmin();
    const m = await target(ctx);
    const alias_code = cleanStr(req.nextUrl.searchParams.get('alias')).toUpperCase();
    if (!alias_code) throw new HttpError(400, 'Kode alias yang akan dilepas wajib disebut.');

    const row = await prisma.materialAlias.findUnique({ where: { alias_code } });
    if (!row || row.material_code !== m.material_code)
      throw new HttpError(404, `${alias_code} bukan alias dari ${m.material_code}.`);

    await prisma.materialAlias.delete({ where: { alias_code } });

    const stillClosed = await prisma.material.findUnique({ where: { material_code: alias_code } });
    const note =
      stillClosed && !stillClosed.is_active
        ? ` Material ${alias_code} tetap berstatus ditutup — aktifkan lagi di MM01 bila memang mau dipakai sendiri.`
        : '';

    return ok({ alias_code }, `Alias ${alias_code} dilepas dari ${m.material_code}.${note}`);
  });
}
