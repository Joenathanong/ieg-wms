import { NextRequest } from 'next/server';
import prisma from '@/lib/prisma';
import { requireUser, requireWrite, HttpError } from '@/lib/auth';
import { handle, ok, cleanStr } from '@/lib/api';
import { BinStatus } from '@prisma/client';

export const dynamic = 'force-dynamic';

/** GET /api/bins?q=&zone=&status= — LS03N / search help */
export async function GET(req: NextRequest) {
  return handle(async () => {
    await requireUser();
    const sp = req.nextUrl.searchParams;
    const q = cleanStr(sp.get('q'));
    const zone = cleanStr(sp.get('zone'));
    const status = cleanStr(sp.get('status')).toUpperCase();
    const limit = Math.min(Number(sp.get('limit') ?? 1000), 5000);

    const bins = await prisma.storageBin.findMany({
      where: {
        AND: [
          q ? { bin_code: { contains: q, mode: 'insensitive' } } : {},
          zone ? { zone_id: { contains: zone, mode: 'insensitive' } } : {},
          status && Object.values(BinStatus).includes(status as BinStatus)
            ? { status: status as BinStatus }
            : {},
        ],
      },
      orderBy: { bin_code: 'asc' },
      take: limit,
    });

    return ok(bins, `${bins.length} storage bin(s) selected`);
  });
}

/** POST /api/bins — LS01N Create Storage Bin */
export async function POST(req: NextRequest) {
  return handle(async () => {
    await requireWrite();
    const b = await req.json();

    const bin_code = cleanStr(b.bin_code).toUpperCase();
    const zone_id = cleanStr(b.zone_id).toUpperCase();
    if (!bin_code) throw new HttpError(400, 'Storage bin is mandatory.');
    if (!zone_id) throw new HttpError(400, 'Storage section / zone is mandatory.');

    const exists = await prisma.storageBin.findUnique({ where: { bin_code } });
    if (exists) throw new HttpError(409, `Storage bin ${bin_code} already exists.`);

    const bin = await prisma.storageBin.create({
      data: {
        bin_code,
        zone_id,
        max_weight_kg: Number(b.max_weight_kg ?? 1000) || 1000,
        status: (cleanStr(b.status).toUpperCase() as BinStatus) || BinStatus.EMPTY,
      },
    });

    return ok(bin, `Storage bin ${bin_code} created`);
  });
}
