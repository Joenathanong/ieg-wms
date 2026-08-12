import { NextRequest } from 'next/server';
import prisma from '@/lib/prisma';
import { requireUser, requireWrite, HttpError } from '@/lib/auth';
import { handle, ok, cleanStr, toDate } from '@/lib/api';
import { nextDocNumber } from '@/lib/docnum';
import { BinStatus, PhysInvStatus } from '@prisma/client';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

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
          bin ? { items: { some: { bin_code: { contains: bin, mode: 'insensitive' } } } } : {},
        ],
      },
      include: { items: true },
      orderBy: { created_at: 'desc' },
      take: 300,
    });

    const rows = docs.map((d) => ({
      id: d.id,
      doc_number: d.doc_number,
      scope_type: d.scope_type,
      scope_value: d.scope_value,
      bin_count: d.frozen_bins.length,
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
 * POST /api/physinv — LI01N Create Physical Inventory Document (multi-bin).
 * Body:
 *   { scope_type: 'BIN_LIST', bins: ['A-01-01-1','A-01-02-1'], planned_date? }
 *   { scope_type: 'ZONE',     zone: 'RACK-FAST' }
 *   { scope_type: 'ALL' }
 *
 * Semua bin dalam cakupan di-freeze (BLOCKED) dan snapshot stok direkam
 * sebagai baris dokumen. Satu nomor dokumen memuat banyak baris lintas bin.
 */
export async function POST(req: NextRequest) {
  return handle(async () => {
    const user = await requireWrite();
    const b = await req.json();

    const scope_type = (cleanStr(b.scope_type).toUpperCase() || 'BIN_LIST') as
      | 'BIN_LIST'
      | 'ZONE'
      | 'ALL';

    const result = await prisma.$transaction(
      async (tx) => {
        // ---- tentukan daftar bin dalam cakupan ----
        let bins: { bin_code: string }[] = [];
        let scope_value = '';

        if (scope_type === 'ZONE') {
          const zone = cleanStr(b.zone).toUpperCase();
          if (!zone) throw new HttpError(400, 'Zone is mandatory for scope type ZONE.');
          bins = await tx.storageBin.findMany({
            where: { zone_id: zone, is_interim: false },
            select: { bin_code: true },
            orderBy: { bin_code: 'asc' },
          });
          scope_value = zone;
        } else if (scope_type === 'ALL') {
          bins = await tx.storageBin.findMany({
            where: { is_interim: false },
            select: { bin_code: true },
            orderBy: { bin_code: 'asc' },
          });
          scope_value = 'ALL STORAGE BINS';
        } else {
          const list: string[] = (Array.isArray(b.bins) ? b.bins : [])
            .map((x: unknown) => cleanStr(x).toUpperCase())
            .filter(Boolean);
          if (list.length === 0) throw new HttpError(400, 'At least one storage bin must be selected.');
          bins = await tx.storageBin.findMany({
            where: { bin_code: { in: list } },
            select: { bin_code: true },
            orderBy: { bin_code: 'asc' },
          });
          const missing = list.filter((c) => !bins.some((x) => x.bin_code === c));
          if (missing.length > 0)
            throw new HttpError(400, `Storage bin ${missing.join(', ')} does not exist (LS01N).`);
          scope_value = list.join(', ');
        }

        if (bins.length === 0) throw new HttpError(400, 'No storage bin found for the selected scope.');
        if (bins.length > 500) throw new HttpError(400, 'Maximum 500 storage bins per physical inventory document.');

        const binCodes = bins.map((x) => x.bin_code);

        // ---- pastikan tidak ada dokumen lain yang masih terbuka untuk bin ini ----
        const open = await tx.physInvDoc.findMany({
          where: {
            status: { in: [PhysInvStatus.CREATED, PhysInvStatus.FROZEN, PhysInvStatus.COUNTED] },
          },
          select: { doc_number: true, frozen_bins: true },
        });
        for (const o of open) {
          const clash = o.frozen_bins.filter((x) => binCodes.includes(x));
          if (clash.length > 0)
            throw new HttpError(
              400,
              `Document ${o.doc_number} is still open for bin ${clash.slice(0, 5).join(', ')}${clash.length > 5 ? ' …' : ''}.`
            );
        }

        // ---- snapshot stok ----
        const quants = await tx.stockWM.findMany({
          where: { bin_code: { in: binCodes } },
          orderBy: [{ bin_code: 'asc' }, { material_code: 'asc' }],
        });

        const doc_number = await nextDocNumber(tx, 'PIDOC');
        const doc = await tx.physInvDoc.create({
          data: {
            doc_number,
            scope_type,
            scope_value: scope_value.slice(0, 500),
            frozen_bins: binCodes,
            status: PhysInvStatus.FROZEN,
            planned_date: toDate(b.planned_date) ?? new Date(),
            created_by: user.username,
            items: {
              create: quants.map((q) => ({
                bin_code: q.bin_code,
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

        // ---- freeze semua bin ----
        await tx.storageBin.updateMany({
          where: { bin_code: { in: binCodes } },
          data: { status: BinStatus.BLOCKED },
        });

        return doc;
      },
      { timeout: 30000, maxWait: 10000 }
    );

    return ok(
      result,
      `Physical inventory document ${result.doc_number} created — ${result.frozen_bins.length} bin(s) frozen, ${result.items.length} line(s) snapshot`
    );
  });
}
