import { NextRequest } from 'next/server';
import prisma from '@/lib/prisma';
import { requireUser } from '@/lib/auth';
import { handle, ok, cleanStr, toDate } from '@/lib/api';
import { parseMovement, MOVEMENT_CODE, MOVEMENT_DESC } from '@/lib/movement';
import { likeWhereAny } from '@/lib/like';
import { materialCodeFilter } from '@/lib/search';
import { MovementType, Prisma } from '@prisma/client';

export const dynamic = 'force-dynamic';

/**
 * GET /api/reports/mb51 — Material Document List (audit trail level IM)
 * Query: ?material=&movement=&bin=&batch=&user=&from=&to=&page=&size=&withWm=1
 *
 * Sesuai pembagian SAP, MB51 hanya menampilkan dokumen **Inventory Management**
 * (101/102, 201/202, 551/552, 561/562, 701/702/711/712). Pemindahan antar bin
 * (movement 301) adalah dokumen level Warehouse Management dan ditampilkan di
 * transaksi **LT22 — Display Transfer Order**.
 *
 * `withWm=1` tetap disediakan bila pengguna ingin melihat keduanya sekaligus.
 */
export async function GET(req: NextRequest) {
  return handle(async () => {
    await requireUser();
    const sp = req.nextUrl.searchParams;

    const material = cleanStr(sp.get('material')).toUpperCase();
    const movement = cleanStr(sp.get('movement'));
    const bin = cleanStr(sp.get('bin')).toUpperCase();
    const batch = cleanStr(sp.get('batch')).toUpperCase();
    const user = cleanStr(sp.get('user')).toUpperCase();
    const from = toDate(sp.get('from'));
    const to = toDate(sp.get('to'));
    const page = Math.max(1, Number(sp.get('page') ?? 1));
    const size = Math.min(Number(sp.get('size') ?? 200), 1000);

    const mt = movement ? parseMovement(movement) : null;
    if (movement && !mt) return ok({ rows: [], total: 0, page, size }, `Movement type ${movement} is not defined`);

    /** 301 = dokumen level WM, tempatnya di LT22 — dikecualikan kecuali diminta khusus */
    const withWm = sp.get('withWm') === '1';
    const wmFilter: Prisma.MigoLogWhereInput =
      withWm || mt === MovementType.TR_301_BIN
        ? {}
        : { movement_type: { not: MovementType.TR_301_BIN } };

    const dateFilter: Prisma.DateTimeFilter = {};
    if (from) dateFilter.gte = from;
    if (to) {
      const end = new Date(to);
      end.setHours(23, 59, 59, 999);
      dateFilter.lte = end;
    }

    // Kolom Material mencari kode MAUPUN deskripsi, dengan wildcard '*'
    const matFilter = await materialCodeFilter('material_code', material);

    const where: Prisma.MigoLogWhereInput = {
      AND: [
        (matFilter ?? {}) as Prisma.MigoLogWhereInput,
        mt ? { movement_type: mt } : {},
        wmFilter,
        (likeWhereAny(['source_bin', 'target_bin'], bin) ?? {}) as Prisma.MigoLogWhereInput,
        (likeWhereAny(['batch_number'], batch) ?? {}) as Prisma.MigoLogWhereInput,
        (likeWhereAny(['user_id'], user) ?? {}) as Prisma.MigoLogWhereInput,
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

    const rows = logs.map((l) => ({
      document_number: l.document_number,
      movement_type: l.movement_type,
      movement_code: MOVEMENT_CODE[l.movement_type],
      movement_desc: MOVEMENT_DESC[l.movement_type],
      reversal_of: l.reversal_of ?? '',
      reversed_by: l.reversed_by ?? '',
      material_code: l.material_code,
      description: mMap.get(l.material_code) ?? '',
      batch_number: l.batch_number ?? '',
      source_bin: l.source_bin ?? '',
      target_bin: l.target_bin ?? '',
      qty: l.qty,
      uom: l.uom,
      reference: l.reference ?? '',
      remarks: l.remarks ?? '',
      doc_date: l.doc_date,
      created_at: l.created_at,
      user_id: l.user_id,
    }));

    return ok(
      { rows, total, page, size, pages: Math.max(1, Math.ceil(total / size)) },
      `${total} material document(s) selected` +
        (withWm ? ' (termasuk transfer bin 301)' : ' — transfer bin (301) ada di LT22')
    );
  });
}
