import { NextRequest } from 'next/server';
import prisma from '@/lib/prisma';
import { requireUser, requireWrite, HttpError } from '@/lib/auth';
import { handle, ok, cleanStr } from '@/lib/api';
import { nextDocNumber } from '@/lib/docnum';
import { SalesTakeStatus } from '@prisma/client';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * GET /api/salestake?status=
 * Daftar dokumen SO Penjualan beserta ringkasan hasilnya.
 */
export async function GET(req: NextRequest) {
  return handle(async () => {
    await requireUser();
    const status = cleanStr(req.nextUrl.searchParams.get('status')).toUpperCase();

    const docs = await prisma.salesTakeDoc.findMany({
      where:
        status && (Object.values(SalesTakeStatus) as string[]).includes(status)
          ? { status: status as SalesTakeStatus }
          : {},
      include: { items: true },
      orderBy: { created_at: 'desc' },
      take: 200,
    });

    const rows = docs.map((d) => ({
      id: d.id,
      doc_number: d.doc_number,
      status: d.status,
      reference: d.reference ?? '',
      created_by: d.created_by,
      created_at: d.created_at,
      closed_at: d.closed_at,
      bin_count: new Set(d.items.map((i) => i.bin_code)).size,
      line_count: d.items.length,
      sold_total: d.items.reduce((a, i) => a + i.sold_qty, 0),
      surplus_total: d.items.reduce((a, i) => a + i.surplus_qty, 0),
    }));

    return ok(rows, `${rows.length} sales take document(s) selected`);
  });
}

/** POST /api/salestake — buka dokumen baru (satu shift / satu periode). */
export async function POST(req: NextRequest) {
  return handle(async () => {
    const user = await requireWrite();
    const b = await req.json();
    const reference = cleanStr(b.reference) || null;

    const doc = await prisma.$transaction(async (tx) => {
      const doc_number = await nextDocNumber(tx, 'SODOC');
      return tx.salesTakeDoc.create({
        data: {
          doc_number,
          reference,
          remarks: cleanStr(b.remarks) || null,
          created_by: user.username,
        },
      });
    });

    if (!doc) throw new HttpError(500, 'Sales take document could not be created.');
    return ok(doc, `Sales take document ${doc.doc_number} created`);
  });
}
