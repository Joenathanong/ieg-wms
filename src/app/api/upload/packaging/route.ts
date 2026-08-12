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
 * POST /api/upload/packaging — master kemasan / pallet per material.
 * Body: { rows: [{ material_code, pack_code, description, qty_per_unit, is_default }], offset? }
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
    const touchedMaterials = new Set<string>();

    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const lineNo = offset + i + 1;
      const material_code = cleanStr(r.material_code ?? r.MATERIAL_CODE).toUpperCase();
      const pack_code = cleanStr(r.pack_code ?? r.PACK_CODE).toUpperCase();
      const key = `${material_code}/${pack_code}`;

      try {
        if (!material_code) throw new Error('Column material_code is empty.');
        if (!pack_code) throw new Error('Column pack_code is empty.');

        const material = await prisma.material.findUnique({ where: { material_code } });
        if (!material) throw new Error(`Material ${material_code} does not exist in master data (MM01).`);

        const qty_per_unit = toInt(r.qty_per_unit ?? r.QTY_PER_UNIT ?? 0, 'qty_per_unit');
        if (qty_per_unit <= 0) throw new Error('Column qty_per_unit must be greater than zero.');

        const su_type = cleanStr(r.su_type ?? r.SU_TYPE).toUpperCase() || 'PAL';
        const zone_group = cleanStr(r.zone_group ?? r.ZONE_GROUP).toUpperCase() || null;
        const rawDefault = cleanStr(r.is_default ?? r.IS_DEFAULT).toUpperCase();
        const is_default = ['TRUE', 'X', 'Y', 'YES', '1'].includes(rawDefault);

        const existing = await prisma.packagingType.findUnique({
          where: { material_code_pack_code: { material_code, pack_code } },
        });

        await prisma.$transaction(async (tx) => {
          if (is_default) {
            await tx.packagingType.updateMany({
              where: { material_code, zone_group },
              data: { is_default: false },
            });
          }
          await tx.packagingType.upsert({
            where: { material_code_pack_code: { material_code, pack_code } },
            create: {
              material_code,
              pack_code,
              su_type,
              zone_group,
              description: cleanStr(r.description ?? r.DESCRIPTION),
              qty_per_unit,
              is_default,
            },
            update: {
              su_type,
              zone_group,
              description: cleanStr(r.description ?? r.DESCRIPTION),
              qty_per_unit,
              ...(is_default ? { is_default: true } : {}),
            },
          });
        });

        touchedMaterials.add(material_code);
        results.push({ row: lineNo, key, status: existing ? 'UPDATED' : 'CREATED' });
      } catch (e) {
        results.push({
          row: lineNo,
          key: key || '(empty)',
          status: 'ERROR',
          message: e instanceof Error ? e.message : 'Unknown error',
        });
      }
    }

    // pastikan setiap material yang disentuh punya tepat satu default
    for (const m of touchedMaterials) {
      const all = await prisma.packagingType.findMany({
        where: { material_code: m },
        orderBy: { qty_per_unit: 'desc' },
      });
      if (all.length > 0 && !all.some((p) => p.is_default)) {
        await prisma.packagingType.update({ where: { id: all[0].id }, data: { is_default: true } });
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
