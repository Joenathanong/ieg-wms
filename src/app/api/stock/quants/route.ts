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
    /** '1' = kecualikan bin interim (TRANSIT-IN/OUT) — dipakai ZRF08 replenishment */
    const exclInterim = cleanStr(sp.get('exclInterim')) === '1';

    let interimCodes: string[] = [];
    if (exclInterim) {
      const interim = await prisma.storageBin.findMany({
        where: { is_interim: true },
        select: { bin_code: true },
      });
      interimCodes = interim.map((b) => b.bin_code);
    }

    const quants = await prisma.stockWM.findMany({
      where: {
        AND: [
          bin ? { bin_code: bin } : {},
          material ? { material_code: material } : {},
          batch ? { batch_number: batch } : {},
          exclInterim && interimCodes.length ? { bin_code: { notIn: interimCodes } } : {},
          { qty: { gt: 0 } },
        ],
      },
      // FEFO: expired terdekat dulu; bila ED sama, ambil quant dengan qty
      // TERKECIL lebih dulu agar sisa kecil cepat habis (menghindari pecahan).
      orderBy: [{ exp_date: 'asc' }, { qty: 'asc' }, { bin_code: 'asc' }],
      take: 500,
    });

    const materials = await prisma.material.findMany({
      where: { material_code: { in: [...new Set(quants.map((q) => q.material_code))] } },
      select: { material_code: true, description: true, uom: true, is_batch_managed: true, fix_bin: true },
    });
    const mMap = new Map(materials.map((m) => [m.material_code, m]));

    const rows = quants.map((q) => ({
      id: q.id,
      material_code: q.material_code,
      description: mMap.get(q.material_code)?.description ?? '',
      uom: mMap.get(q.material_code)?.uom ?? 'PC',
      is_batch_managed: mMap.get(q.material_code)?.is_batch_managed ?? true,
      /** fix bin material — saran tujuan replenishment (ZRF08) */
      fix_bin: mMap.get(q.material_code)?.fix_bin ?? null,
      bin_code: q.bin_code,
      batch_number: q.batch_number ?? '',
      mfg_date: q.mfg_date,
      exp_date: q.exp_date,
      gr_date: q.gr_date,
      qty: q.qty,
    }));

    return ok(rows, `${rows.length} quant(s) available`);
  });
}
