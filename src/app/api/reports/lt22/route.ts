import { NextRequest } from 'next/server';
import prisma from '@/lib/prisma';
import { requireUser } from '@/lib/auth';
import { handle, ok, cleanStr, toDate } from '@/lib/api';
import { likeWhereAny } from '@/lib/like';
import { materialCodeFilter } from '@/lib/search';
import { MovementType, Prisma } from '@prisma/client';

export const dynamic = 'force-dynamic';

/**
 * GET /api/reports/lt22 — Display Transfer Order (riwayat pemindahan bin).
 *
 * Berisi dokumen level **Warehouse Management**: movement 301 hasil put-away,
 * picking, bin transfer manual (LT01/LT10), dan transfer lewat PDT (ZRF02/03/04/08).
 * Stock IM tidak berubah pada dokumen jenis ini — karena itu dipisahkan dari MB51.
 *
 * Query: ?material=&bin=&batch=&user=&tr=&source=&target=&from=&to=&via=&page=&size=
 */
export async function GET(req: NextRequest) {
  return handle(async () => {
    await requireUser();
    const sp = req.nextUrl.searchParams;

    const material = cleanStr(sp.get('material')).toUpperCase();
    const bin = cleanStr(sp.get('bin')).toUpperCase();
    const source = cleanStr(sp.get('source')).toUpperCase();
    const target = cleanStr(sp.get('target')).toUpperCase();
    const batch = cleanStr(sp.get('batch')).toUpperCase();
    const user = cleanStr(sp.get('user')).toUpperCase();
    const tr = cleanStr(sp.get('tr')).toUpperCase();
    /** '' = semua, 'PDT' = hanya dari terminal PDT, 'GUI' = hanya dari desktop */
    const via = cleanStr(sp.get('via')).toUpperCase();
    const from = toDate(sp.get('from'));
    const to = toDate(sp.get('to'));
    const page = Math.max(1, Number(sp.get('page') ?? 1));
    const size = Math.min(Number(sp.get('size') ?? 200), 1000);

    const dateFilter: Prisma.DateTimeFilter = {};
    if (from) dateFilter.gte = from;
    if (to) {
      const end = new Date(to);
      end.setHours(23, 59, 59, 999);
      dateFilter.lte = end;
    }

    const matFilter = await materialCodeFilter('material_code', material);

    const where: Prisma.MigoLogWhereInput = {
      AND: [
        { movement_type: MovementType.TR_301_BIN },
        (matFilter ?? {}) as Prisma.MigoLogWhereInput,
        (likeWhereAny(['source_bin', 'target_bin'], bin) ?? {}) as Prisma.MigoLogWhereInput,
        (likeWhereAny(['source_bin'], source) ?? {}) as Prisma.MigoLogWhereInput,
        (likeWhereAny(['target_bin'], target) ?? {}) as Prisma.MigoLogWhereInput,
        (likeWhereAny(['batch_number'], batch) ?? {}) as Prisma.MigoLogWhereInput,
        (likeWhereAny(['user_id'], user) ?? {}) as Prisma.MigoLogWhereInput,
        (likeWhereAny(['tr_number'], tr) ?? {}) as Prisma.MigoLogWhereInput,
        via === 'PDT' ? { via_pdt: true } : via === 'GUI' ? { via_pdt: false } : {},
        from || to ? { doc_date: dateFilter } : {},
      ],
    };

    const [total, logs] = await Promise.all([
      prisma.migoLog.count({ where }),
      prisma.migoLog.findMany({
        where,
        orderBy: [{ doc_date: 'desc' }, { created_at: 'desc' }],
        skip: (page - 1) * size,
        take: size,
      }),
    ]);

    const materials = await prisma.material.findMany({
      where: { material_code: { in: [...new Set(logs.map((l) => l.material_code))] } },
      select: { material_code: true, description: true },
    });
    const mMap = new Map(materials.map((m) => [m.material_code, m.description]));

    // tipe pekerjaan ditebak dari bin interim yang terlibat
    const interim = await prisma.storageBin.findMany({
      where: { is_interim: true },
      select: { bin_code: true },
    });
    const interimSet = new Set(interim.map((b) => b.bin_code));

    const rows = logs.map((l) => {
      const fromInterim = l.source_bin ? interimSet.has(l.source_bin) : false;
      const toInterim = l.target_bin ? interimSet.has(l.target_bin) : false;
      const kind = fromInterim ? 'PUT-AWAY' : toInterim ? 'PICKING' : 'BIN TRANSFER';

      return {
        document_number: l.document_number,
        movement_code: '301',
        kind,
        material_code: l.material_code,
        description: mMap.get(l.material_code) ?? '',
        batch_number: l.batch_number ?? '',
        source_bin: l.source_bin ?? '',
        target_bin: l.target_bin ?? '',
        qty: l.qty,
        uom: l.uom,
        tr_number: l.tr_number ?? '',
        remarks: l.remarks ?? '',
        via_pdt: l.via_pdt,
        doc_date: l.doc_date,
        created_at: l.created_at,
        user_id: l.user_id,
      };
    });

    const movedQty = rows.reduce((a, r) => a + r.qty, 0);

    return ok(
      { rows, total, page, size, pages: Math.max(1, Math.ceil(total / size)), moved_qty: movedQty },
      `${total} transfer order(s) selected — stock IM tidak berubah pada dokumen ini`
    );
  });
}
