import { NextRequest } from 'next/server';
import prisma from '@/lib/prisma';
import { requireUser, requireWrite, HttpError } from '@/lib/auth';
import { handle, ok, cleanStr, toDate } from '@/lib/api';
import { nextDocNumber } from '@/lib/docnum';
import { BinStatus, PhysInvStatus } from '@prisma/client';

export const dynamic = 'force-dynamic';

/** GET /api/physinv?status=&bin= — daftar dokumen stock opname */
export async function GET(req: NextRequest) {
  return handle(async () => {
    await requireUser();
    const sp = req.nextUrl.searchParams;
    const status = cleanStr(sp.get('status')).toUpperCase();
    const bin = cleanStr(sp.get('bin')).toUpperCase();

    const docs = await prisma.physInvDoc.findMany({
      where: {
        AND: [
          status && Object.values(PhysInvStatus).includes(status as PhysInvStatus)
            ? { status: status as PhysInvStatus }
            : {},
          bin ? { bin_code: { contains: bin, mode: 'insensitive' } } : {},
        ],
      },
      include: { items: true },
      orderBy: { created_at: 'desc' },
      take: 300,
    });

    const rows = docs.map((d) => ({
      id: d.id,
      doc_number: d.doc_number,
      bin_code: d.bin_code,
      status: d.status,
      planned_date: d.planned_date,
      counted_at: d.counted_at,
      posted_at: d.posted_at,
      created_by: d.created_by,
      created_at: d.created_at,
      item_count: d.items.length,
      book_total: d.items.reduce((a, i) => a + i.book_qty, 0),
      counted_total: d.items.reduce((a, i) => a + (i.counted_qty ?? 0), 0),
      diff_total: d.items.reduce((a, i) => a + i.diff_qty, 0),
    }));

    return ok(rows, `${rows.length} physical inventory document(s) selected`);
  });
}

/**
 * POST /api/physinv — LI01N Create Physical Inventory Document (Freeze Bin)
 * Body: { bin_code, planned_date? }
 * Bin di-set BLOCKED sehingga tidak ada pergerakan stok selama counting.
 */
export async function POST(req: NextRequest) {
  return handle(async () => {
    const user = await requireWrite();
    const b = await req.json();
    const bin_code = cleanStr(b.bin_code).toUpperCase();
    if (!bin_code) throw new HttpError(400, 'Storage bin is mandatory.');

    const result = await prisma.$transaction(async (tx) => {
      const bin = await tx.storageBin.findUnique({ where: { bin_code } });
      if (!bin) throw new HttpError(400, `Storage bin ${bin_code} does not exist.`);

      const open = await tx.physInvDoc.findFirst({
        where: { bin_code, status: { in: [PhysInvStatus.CREATED, PhysInvStatus.FROZEN, PhysInvStatus.COUNTED] } },
      });
      if (open)
        throw new HttpError(
          400,
          `Physical inventory document ${open.doc_number} is still open for bin ${bin_code}.`
        );

      const quants = await tx.stockWM.findMany({ where: { bin_code } });

      const doc_number = await nextDocNumber(tx, 'PIDOC');
      const doc = await tx.physInvDoc.create({
        data: {
          doc_number,
          bin_code,
          status: PhysInvStatus.FROZEN,
          planned_date: toDate(b.planned_date) ?? new Date(),
          created_by: user.username,
          items: {
            create: quants.map((q) => ({
              material_code: q.material_code,
              batch_number: q.batch_number,
              book_qty: q.qty,
              counted_qty: null,
              diff_qty: 0,
            })),
          },
        },
        include: { items: true },
      });

      // Freeze bin
      await tx.storageBin.update({ where: { bin_code }, data: { status: BinStatus.BLOCKED } });

      return doc;
    });

    return ok(
      result,
      `Physical inventory document ${result.doc_number} created — bin ${bin_code} is frozen (${result.items.length} item(s))`
    );
  });
}
