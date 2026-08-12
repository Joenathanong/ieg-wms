import { NextRequest } from 'next/server';
import prisma from '@/lib/prisma';
import { requireUser } from '@/lib/auth';
import { handle, ok, cleanStr } from '@/lib/api';
import { likeWhereAny } from '@/lib/like';
import type { Prisma } from '@prisma/client';

export const dynamic = 'force-dynamic';

/**
 * GET /api/reports/ls04 — Empty Storage Bin List
 * Menampilkan bin berstatus EMPTY ATAU bin yang total quant-nya 0.
 * Query: ?zone=&bin=&includeBlocked=1
 */
export async function GET(req: NextRequest) {
  return handle(async () => {
    await requireUser();
    const sp = req.nextUrl.searchParams;
    const zone = cleanStr(sp.get('zone')).toUpperCase();
    const bin = cleanStr(sp.get('bin')).toUpperCase();
    const includeBlocked = sp.get('includeBlocked') === '1';

    const bins = await prisma.storageBin.findMany({
      where: {
        AND: [
          (likeWhereAny(['zone_id'], zone) ?? {}) as Prisma.StorageBinWhereInput,
          (likeWhereAny(['bin_code'], bin) ?? {}) as Prisma.StorageBinWhereInput,
          includeBlocked ? {} : { status: { not: 'BLOCKED' } },
        ],
      },
      orderBy: { bin_code: 'asc' },
    });

    const groups = await prisma.stockWM.groupBy({
      by: ['bin_code'],
      _sum: { qty: true },
    });
    const qtyMap = new Map(groups.map((g) => [g.bin_code, g._sum.qty ?? 0]));

    const rows = bins
      .map((b) => ({
        bin_code: b.bin_code,
        zone_id: b.zone_id,
        status: b.status,
        max_weight_kg: b.max_weight_kg,
        current_qty: qtyMap.get(b.bin_code) ?? 0,
      }))
      .filter((r) => r.current_qty === 0);

    return ok({ rows }, `${rows.length} empty storage bin(s) found`);
  });
}
