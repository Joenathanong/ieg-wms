import { NextRequest } from 'next/server';
import prisma from '@/lib/prisma';
import { requireWrite, HttpError } from '@/lib/auth';
import { handle, ok, cleanStr, toInt } from '@/lib/api';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

interface RowResult {
  row: number;
  key: string;
  status: 'CREATED' | 'UPDATED' | 'ERROR';
  message?: string;
}

/**
 * POST /api/upload/materials
 * Body: { rows: [{ material_code, description, uom, is_batch_managed, min_safety_stock }], offset?: number }
 * Dipanggil per-chunk (50–100 baris) dari frontend agar aman dari timeout serverless.
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
      const material_code = cleanStr(r.material_code ?? r.MATERIAL_CODE ?? r.Material).toUpperCase();

      try {
        if (!material_code) throw new Error('Column material_code is empty.');
        const description = cleanStr(r.description ?? r.DESCRIPTION ?? r.Description);
        if (!description) throw new Error('Column description is empty.');

        const uom = (cleanStr(r.uom ?? r.UOM) || 'PC').toUpperCase();
        const rawBatch = cleanStr(r.is_batch_managed ?? r.IS_BATCH_MANAGED).toUpperCase();
        const is_batch_managed = rawBatch === '' ? true : !['FALSE', 'N', 'NO', '0', 'X-NO'].includes(rawBatch);
        const min_safety_stock = r.min_safety_stock ? toInt(r.min_safety_stock, 'min_safety_stock') : 0;
        const barcode_bpom = cleanStr(r.barcode_bpom ?? r.BARCODE_BPOM).toUpperCase() || null;
        const barcode_produk = cleanStr(r.barcode_produk ?? r.BARCODE_PRODUK).toUpperCase() || null;
        const kode_ocs = cleanStr(r.kode_ocs ?? r.KODE_OCS).toUpperCase() || null;
        const fix_bin = cleanStr(r.fix_bin ?? r.FIX_BIN).toUpperCase() || null;

        if (fix_bin) {
          const bin = await prisma.storageBin.findUnique({ where: { bin_code: fix_bin } });
          if (!bin) throw new Error(`Fix bin ${fix_bin} does not exist (upload storage bins first).`);
        }

        const existing = await prisma.material.findUnique({ where: { material_code } });

        await prisma.material.upsert({
          where: { material_code },
          create: { material_code, description, uom, is_batch_managed, min_safety_stock, barcode_bpom, barcode_produk, kode_ocs, fix_bin },
          update: { description, uom, is_batch_managed, min_safety_stock, barcode_bpom, barcode_produk, kode_ocs, fix_bin },
        });

        results.push({ row: lineNo, key: material_code, status: existing ? 'UPDATED' : 'CREATED' });
      } catch (e) {
        results.push({
          row: lineNo,
          key: material_code || '(empty)',
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
