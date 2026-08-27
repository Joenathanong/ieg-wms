import { NextRequest } from 'next/server';
import prisma from '@/lib/prisma';
import { requireUser, requireWrite, HttpError } from '@/lib/auth';
import { handle, ok, cleanStr, toInt, normBatch } from '@/lib/api';
import { createTransferReq, getMaterialOrThrow, splitByPackaging } from '@/lib/wms';
import { likeWhereAny } from '@/lib/like';
import { materialCodeFilter } from '@/lib/search';
import { Prisma, TrStatus, TrType } from '@prisma/client';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * GET /api/tr?status=&type=&material=&tr=  — LB10 Transfer Requirement List
 * Default hanya menampilkan TR yang masih terbuka.
 */
export async function GET(req: NextRequest) {
  return handle(async () => {
    await requireUser();
    const sp = req.nextUrl.searchParams;
    const status = cleanStr(sp.get('status')).toUpperCase();
    const type = cleanStr(sp.get('type')).toUpperCase();
    const material = cleanStr(sp.get('material')).toUpperCase();
    const tr = cleanStr(sp.get('tr')).toUpperCase();

    const statusFilter =
      status && Object.values(TrStatus).includes(status as TrStatus)
        ? { status: status as TrStatus }
        : status === 'ALL'
          ? {}
          : { status: { in: [TrStatus.OPEN, TrStatus.PARTIAL] } };

    // Kolom Material mencari kode MAUPUN deskripsi, dengan wildcard '*'
    const matFilter = await materialCodeFilter('material_code', material);

    const docs = await prisma.transferReq.findMany({
      where: {
        AND: [
          statusFilter,
          type && Object.values(TrType).includes(type as TrType) ? { tr_type: type as TrType } : {},
          (likeWhereAny(['tr_number', 'ref_doc', 'reference'], tr) ?? {}) as Prisma.TransferReqWhereInput,
          matFilter ? { items: { some: matFilter as Prisma.TransferReqItemWhereInput } } : {},
        ],
      },
      include: { items: { orderBy: { line_no: 'asc' } } },
      orderBy: { created_at: 'desc' },
      take: 300,
    });

    const codes = [...new Set(docs.flatMap((d) => d.items.map((i) => i.material_code)))];
    const materials = await prisma.material.findMany({
      where: { material_code: { in: codes } },
      select: { material_code: true, description: true, uom: true },
    });
    const mMap = new Map(materials.map((m) => [m.material_code, m]));

    const rows = docs.map((d) => ({
      id: d.id,
      tr_number: d.tr_number,
      tr_type: d.tr_type,
      status: d.status,
      ref_doc: d.ref_doc,
      reference: d.reference,
      created_by: d.created_by,
      created_at: d.created_at,
      closed_at: d.closed_at,
      item_count: d.items.length,
      open_lines: d.items.filter(
        (i) => i.status !== TrStatus.CLOSED && i.status !== TrStatus.CANCELLED
      ).length,
      total_qty: d.items.reduce((a, i) => a + i.qty, 0),
      confirmed_qty: d.items.reduce((a, i) => a + i.qty_confirmed, 0),
      materials: [...new Set(d.items.map((i) => i.material_code))].join(', '),
      description: mMap.get(d.items[0]?.material_code ?? '')?.description ?? '',
      uom: mMap.get(d.items[0]?.material_code ?? '')?.uom ?? 'PC',
    }));

    return ok(rows, `${rows.length} transfer requirement(s) selected`);
  });
}

/**
 * POST /api/tr — buat Transfer Requirement manual (tipe INTERNAL).
 * Body: { items: [{ material_code, qty, batch_number?, source_bin?, target_bin?, pack_code? }], remarks? }
 */
export async function POST(req: NextRequest) {
  return handle(async () => {
    const user = await requireWrite();
    const b = await req.json();
    const rawItems = Array.isArray(b.items) ? b.items : [];
    if (rawItems.length === 0) throw new HttpError(400, 'No items were entered.');

    const tr = await prisma.$transaction(async (tx) => {
      const items = [];
      for (let i = 0; i < rawItems.length; i++) {
        const it = rawItems[i];
        const material_code = cleanStr(it.material_code).toUpperCase();
        if (!material_code) throw new HttpError(400, `Line ${i + 1}: material number is missing.`);
        const material = await getMaterialOrThrow(tx, material_code);
        const qty = toInt(it.qty, `line ${i + 1} quantity`);
        if (qty <= 0) throw new HttpError(400, `Line ${i + 1}: quantity must be greater than zero.`);

        const split = await splitByPackaging(tx, material_code, qty, cleanStr(it.pack_code) || null);
        for (const s of split) {
          items.push({
            material_code: material.material_code,
            batch_number: material.is_batch_managed ? normBatch(it.batch_number) : null,
            pack_code: s.pack_code,
            qty: s.qty,
            source_bin: cleanStr(it.source_bin).toUpperCase() || null,
            target_bin: cleanStr(it.target_bin).toUpperCase() || null,
          });
        }
      }

      return createTransferReq(tx, {
        tr_type: TrType.INTERNAL,
        items,
        remarks: cleanStr(b.remarks) || null,
        user_id: user.username,
      });
    });

    return ok(tr, `Transfer requirement ${tr.tr_number} created (${tr.items.length} line(s))`);
  });
}
