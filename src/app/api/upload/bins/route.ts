import { NextRequest } from 'next/server';
import prisma from '@/lib/prisma';
import { requireWrite, HttpError } from '@/lib/auth';
import { handle, ok, cleanStr } from '@/lib/api';
import { BinStatus } from '@prisma/client';
import { listZones } from '@/lib/zonemaster';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

interface RowResult {
  row: number;
  key: string;
  status: 'CREATED' | 'UPDATED' | 'ERROR';
  message?: string;
}

/**
 * POST /api/upload/bins
 * Body: { rows: [{ bin_code, zone_id, max_weight_kg, status }], offset?: number }
 */
export async function POST(req: NextRequest) {
  return handle(async () => {
    await requireWrite();
    const body = await req.json();
    const rows = Array.isArray(body.rows) ? body.rows : [];
    const offset = Number(body.offset ?? 0);

    if (rows.length === 0) throw new HttpError(400, 'No rows received.');
    if (rows.length > 200) throw new HttpError(400, 'Chunk size too large. Maximum 200 rows per request.');

    const results: RowResult[] = [];

    // master zone dibaca sekali di luar loop — upload bisa ratusan baris
    const zoneMap = new Map((await listZones()).map((z) => [z.zone_code, z]));

    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const lineNo = offset + i + 1;
      const bin_code = cleanStr(r.bin_code ?? r.BIN_CODE ?? r.Bin).toUpperCase();

      try {
        if (!bin_code) throw new Error('Column bin_code is empty.');
        const zone_id = cleanStr(r.zone_id ?? r.ZONE_ID ?? r.Zone).toUpperCase();
        if (!zone_id) throw new Error('Column zone_id is empty.');
        const zone = zoneMap.get(zone_id);
        if (!zone) throw new Error(`Zone ${zone_id} does not exist in the zone master (ZZONE).`);
        if (!zone.is_active) throw new Error(`Zone ${zone_id} is inactive (ZZONE).`);

        const max_weight_kg = Number(r.max_weight_kg ?? r.MAX_WEIGHT_KG ?? 1000) || 1000;
        const rawStatus = cleanStr(r.status ?? r.STATUS).toUpperCase();
        const status = (Object.values(BinStatus) as string[]).includes(rawStatus)
          ? (rawStatus as BinStatus)
          : BinStatus.EMPTY;

        const existing = await prisma.storageBin.findUnique({ where: { bin_code } });

        // Jangan turunkan status bin yang sudah berisi stok
        const agg = existing
          ? await prisma.stockWM.aggregate({ where: { bin_code }, _sum: { qty: true } })
          : null;
        const hasStock = (agg?._sum.qty ?? 0) > 0;

        await prisma.storageBin.upsert({
          where: { bin_code },
          create: { bin_code, zone_id, max_weight_kg, status, is_interim: zone.is_interim },
          update: {
            zone_id,
            max_weight_kg,
            is_interim: zone.is_interim,
            status: hasStock ? BinStatus.OCCUPIED : status,
          },
        });

        results.push({ row: lineNo, key: bin_code, status: existing ? 'UPDATED' : 'CREATED' });
      } catch (e) {
        results.push({
          row: lineNo,
          key: bin_code || '(empty)',
          status: 'ERROR',
          message: e instanceof Error ? e.message : 'Unknown error',
        });
      }
    }

    const created = results.filter((r) => r.status === 'CREATED').length;
    const updated = results.filter((r) => r.status === 'UPDATED').length;
    const errors = results.filter((r) => r.status === 'ERROR');

    return ok(
      { results, created, updated, error_count: errors.length },
      `Chunk processed: ${created} created, ${updated} updated, ${errors.length} error(s)`
    );
  });
}
