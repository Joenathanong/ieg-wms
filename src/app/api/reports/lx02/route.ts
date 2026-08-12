import { NextRequest } from 'next/server';
import prisma from '@/lib/prisma';
import { requireUser } from '@/lib/auth';
import { handle, ok, cleanStr, toDate } from '@/lib/api';
import { likeWhereAny } from '@/lib/like';
import { materialCodeFilter } from '@/lib/search';
import type { Prisma } from '@prisma/client';

export const dynamic = 'force-dynamic';

/**
 * GET /api/reports/lx02 — Stock per Storage Bin (WM breakdown)
 * Query: ?material=&bin=&zone=&batch=&expBefore=&sort=
 */
export async function GET(req: NextRequest) {
  return handle(async () => {
    await requireUser();
    const sp = req.nextUrl.searchParams;
    const material = cleanStr(sp.get('material')).toUpperCase();
    const bin = cleanStr(sp.get('bin')).toUpperCase();
    const zone = cleanStr(sp.get('zone')).toUpperCase();
    const batch = cleanStr(sp.get('batch')).toUpperCase();
    const expBefore = toDate(sp.get('expBefore'));
    const sort = cleanStr(sp.get('sort')) || 'bin';

    // filter zone -> daftar bin
    let binFilter: string[] | undefined;
    if (zone) {
      const zoneWhere = likeWhereAny(['zone_id'], zone);
      const bins = await prisma.storageBin.findMany({
        where: (zoneWhere ?? {}) as Prisma.StorageBinWhereInput,
        select: { bin_code: true },
      });
      binFilter = bins.map((b) => b.bin_code);
      if (binFilter.length === 0) return ok({ rows: [], total_qty: 0 }, 'No data exists for the selection criteria');
    }

    // Kolom Material mencari kode MAUPUN deskripsi, dengan wildcard '*'
    const matFilter = await materialCodeFilter('material_code', material);

    const quants = await prisma.stockWM.findMany({
      where: {
        AND: [
          (matFilter ?? {}) as Prisma.StockWMWhereInput,
          (likeWhereAny(['bin_code'], bin) ?? {}) as Prisma.StockWMWhereInput,
          (likeWhereAny(['batch_number'], batch) ?? {}) as Prisma.StockWMWhereInput,
          binFilter ? { bin_code: { in: binFilter } } : {},
          expBefore ? { exp_date: { lte: expBefore } } : {},
        ],
      },
      take: 5000,
    });

    const [materials, bins] = await Promise.all([
      prisma.material.findMany({
        where: { material_code: { in: [...new Set(quants.map((q) => q.material_code))] } },
      }),
      prisma.storageBin.findMany({
        where: { bin_code: { in: [...new Set(quants.map((q) => q.bin_code))] } },
      }),
    ]);
    const mMap = new Map(materials.map((m) => [m.material_code, m]));
    const bMap = new Map(bins.map((b) => [b.bin_code, b]));

    const today = new Date();
    const rows = quants.map((q) => {
      const m = mMap.get(q.material_code);
      const b = bMap.get(q.bin_code);
      const days_to_exp = q.exp_date
        ? Math.ceil((q.exp_date.getTime() - today.getTime()) / 86400000)
        : null;
      return {
        bin_code: q.bin_code,
        zone_id: b?.zone_id ?? '',
        bin_status: b?.status ?? 'EMPTY',
        material_code: q.material_code,
        description: m?.description ?? '',
        uom: m?.uom ?? 'PC',
        batch_number: q.batch_number ?? '',
        mfg_date: q.mfg_date,
        exp_date: q.exp_date,
        gr_date: q.gr_date,
        days_to_exp,
        expiry_flag:
          days_to_exp === null ? '' : days_to_exp < 0 ? 'EXPIRED' : days_to_exp <= 30 ? 'CRITICAL' : '',
        qty: q.qty,
      };
    });

    rows.sort((a, b) => {
      if (sort === 'material') return a.material_code.localeCompare(b.material_code);
      if (sort === 'qty') return b.qty - a.qty;
      if (sort === 'exp')
        return (a.exp_date?.getTime() ?? Infinity) - (b.exp_date?.getTime() ?? Infinity);
      return a.bin_code.localeCompare(b.bin_code);
    });

    const total = rows.reduce((a, r) => a + r.qty, 0);
    return ok(
      { rows, total_qty: total },
      `${rows.length} quant(s) selected — total ${total.toLocaleString('de-DE')} units`
    );
  });
}
