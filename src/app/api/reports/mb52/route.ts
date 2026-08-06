import { NextRequest } from 'next/server';
import prisma from '@/lib/prisma';
import { requireUser } from '@/lib/auth';
import { handle, ok, cleanStr } from '@/lib/api';

export const dynamic = 'force-dynamic';

/**
 * GET /api/reports/mb52 — Global Stock Summary (Inventory Management level)
 * Query: ?material=&q=&onlyBelowSafety=1
 */
export async function GET(req: NextRequest) {
  return handle(async () => {
    await requireUser();
    const sp = req.nextUrl.searchParams;
    const material = cleanStr(sp.get('material')).toUpperCase();
    const q = cleanStr(sp.get('q'));
    const onlyBelow = sp.get('onlyBelowSafety') === '1';

    const materials = await prisma.material.findMany({
      where: {
        AND: [
          material ? { material_code: { contains: material, mode: 'insensitive' } } : {},
          q
            ? {
                OR: [
                  { material_code: { contains: q, mode: 'insensitive' } },
                  { description: { contains: q, mode: 'insensitive' } },
                ],
              }
            : {},
        ],
      },
      orderBy: { material_code: 'asc' },
    });

    const codes = materials.map((m) => m.material_code);

    const [ims, wmGroups] = await Promise.all([
      prisma.stockIM.findMany({ where: { material_code: { in: codes } } }),
      prisma.stockWM.groupBy({
        by: ['material_code'],
        where: { material_code: { in: codes } },
        _sum: { qty: true },
        _count: { _all: true },
      }),
    ]);

    const imMap = new Map(ims.map((i) => [i.material_code, i.total_qty]));
    const wmMap = new Map(wmGroups.map((g) => [g.material_code, g]));

    // hitung jumlah bin unik per material
    const quants = await prisma.stockWM.findMany({
      where: { material_code: { in: codes } },
      select: { material_code: true, bin_code: true },
    });
    const binMap = new Map<string, Set<string>>();
    quants.forEach((qt) => {
      if (!binMap.has(qt.material_code)) binMap.set(qt.material_code, new Set());
      binMap.get(qt.material_code)!.add(qt.bin_code);
    });

    let rows = materials.map((m) => {
      const im_qty = imMap.get(m.material_code) ?? 0;
      const wm_qty = wmMap.get(m.material_code)?._sum.qty ?? 0;
      return {
        material_code: m.material_code,
        description: m.description,
        uom: m.uom,
        is_batch_managed: m.is_batch_managed,
        min_safety_stock: m.min_safety_stock,
        im_qty,
        wm_qty,
        /** selisih IM vs WM harus 0 — indikator konsistensi data */
        variance: im_qty - wm_qty,
        bin_count: binMap.get(m.material_code)?.size ?? 0,
        quant_count: wmMap.get(m.material_code)?._count._all ?? 0,
        below_safety: im_qty < m.min_safety_stock,
      };
    });

    if (onlyBelow) rows = rows.filter((r) => r.below_safety);

    const total = rows.reduce((a, r) => a + r.im_qty, 0);

    return ok(
      { rows, total_qty: total },
      `${rows.length} material(s) selected — total ${total.toLocaleString('de-DE')} units`
    );
  });
}
