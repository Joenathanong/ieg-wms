import { NextRequest } from 'next/server';
import prisma from '@/lib/prisma';
import { requireWrite, HttpError } from '@/lib/auth';
import { handle, ok, cleanStr, toInt } from '@/lib/api';
import { resolveMaterialCode } from '@/lib/alias';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

interface RowResult {
  row: number;
  key: string;
  status: 'UPDATED' | 'ERROR';
  message?: string;
  old_value?: number;
  new_value?: number;
}

/**
 * POST /api/upload/safety-stock
 * Body: { rows: [{ material_code, min_safety_stock }], offset?: number }
 *
 * REPLACE nilai safety stock untuk material yang tercantum di file.
 * Material yang tidak ada di file TIDAK diubah.
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

    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const lineNo = offset + i + 1;
      const material_code = cleanStr(r.material_code ?? r.MATERIAL_CODE).toUpperCase();

      try {
        if (!material_code) throw new Error('Column material_code is empty.');
        const raw = r.min_safety_stock ?? r.MIN_SAFETY_STOCK ?? r.safety_stock;
        if (raw === undefined || cleanStr(raw) === '')
          throw new Error('Column min_safety_stock is empty.');

        const value = toInt(raw, 'min_safety_stock');
        if (value < 0) throw new Error('Safety stock cannot be negative.');

        // File dari principal masih memakai kode lama, jadi diterjemahkan dulu —
        // kalau tidak, barisnya ditolak sebagai "material tidak ada" padahal
        // barangnya jelas ada, hanya kodenya sudah digabung.
        const resolved = await resolveMaterialCode(prisma, material_code);
        if (!resolved)
          throw new Error(`Material ${material_code} does not exist in master data (MM01).`);
        const target = resolved.material_code;

        const current = await prisma.material.findUnique({
          where: { material_code: target },
          select: { min_safety_stock: true },
        });
        if (!current) throw new Error(`Material ${target} does not exist in master data (MM01).`);

        await prisma.material.update({
          where: { material_code: target },
          data: { min_safety_stock: value },
        });

        results.push({
          row: lineNo,
          key: resolved.redirected ? `${material_code} -> ${target}` : target,
          status: 'UPDATED',
          old_value: current.min_safety_stock,
          new_value: value,
        });
      } catch (e) {
        results.push({
          row: lineNo,
          key: material_code || '(empty)',
          status: 'ERROR',
          message: e instanceof Error ? e.message : 'Unknown error',
        });
      }
    }

    const updated = results.filter((r) => r.status === 'UPDATED').length;
    const errors = results.filter((r) => r.status === 'ERROR');

    return ok(
      { results, updated, error_count: errors.length },
      `Chunk processed: ${updated} safety stock updated, ${errors.length} error(s)`
    );
  });
}
