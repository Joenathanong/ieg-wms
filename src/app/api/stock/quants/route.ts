import { NextRequest } from 'next/server';
import prisma from '@/lib/prisma';
import { requireUser } from '@/lib/auth';
import { handle, ok, cleanStr } from '@/lib/api';

export const dynamic = 'force-dynamic';

/**
 * GET /api/stock/quants?bin=&material=&batch=
 * Search help (F4) untuk memilih stok yang tersedia di sebuah bin —
 * dipakai layar LT01 / LT10 / MIGO 201.
 */
export async function GET(req: NextRequest) {
  return handle(async () => {
    await requireUser();
    const sp = req.nextUrl.searchParams;
    const bin = cleanStr(sp.get('bin')).toUpperCase();
    const material = cleanStr(sp.get('material')).toUpperCase();
    const batch = cleanStr(sp.get('batch')).toUpperCase();

    const quants = await prisma.stockWM.findMany({
      where: {
        AND: [
          bin ? { bin_code: bin } : {},
          material ? { material_code: material } : {},
          batch ? { batch_number: batch } : {},
          { qty: { gt: 0 } },
        ],
      },
      orderBy: [{ exp_date: 'asc' }, { bin_code: 'asc' }],
      take: 500,
    });

    const materials = await prisma.material.findMany({
      where: { material_code: { in: [...new Set(quants.map((q) => q.material_code))] } },
      select: { material_code: true, description: true, uom: true, is_batch_managed: true },
    });
    const mMap = new Map(materials.map((m) => [m.material_code, m]));

    const rows = quants.map((q) => ({
      id: q.id,
      material_code: q.material_code,
      description: mMap.get(q.material_code)?.description ?? '',
      uom: mMap.get(q.material_code)?.uom ?? 'PC',
      is_batch_managed: mMap.get(q.material_code)?.is_batch_managed ?? true,
      bin_code: q.bin_code,
      batch_number: q.batch_number ?? '',
      mfg_date: q.mfg_date,
      exp_date: q.exp_date,
      qty: q.qty,
    }));

    return ok(rows, `${rows.length} quant(s) available`);
  });
}
