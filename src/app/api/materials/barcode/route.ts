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

    const m = await prisma.material.findFirst({
      where: {
        OR: [
          { barcode_bpom: { equals: code, mode: 'insensitive' } },
          { barcode_produk: { equals: code, mode: 'insensitive' } },
        ],
      },
    });

    if (!m) {
      return fail(`Barcode ${code} tidak terdaftar di master data (MM01).`, 404);
    }

    const matched_by =
      m.barcode_bpom && m.barcode_bpom.toUpperCase() === code.toUpperCase() ? 'BPOM' : 'PRODUK';

    return ok(
      {
        material_code: m.material_code,
        description: m.description,
        uom: m.uom,
        is_batch_managed: m.is_batch_managed,
        fix_bin: m.fix_bin,
        matched_by,
      },
      `Barcode ${code} -> material ${m.material_code}`
    );
  });
}
