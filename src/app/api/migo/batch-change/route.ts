import { NextRequest } from 'next/server';
import prisma from '@/lib/prisma';
import { requireWrite, HttpError } from '@/lib/auth';
import { handle, ok, cleanStr, toDate, normBatch } from '@/lib/api';
import { checkBatchChange, postBatchChange, type BatchChangeInput } from '@/lib/batchchange';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * POST /api/migo/batch-change — koreksi nomor batch (movement 309).
 *
 * Body:
 * {
 *   dry_run?: boolean,
 *   doc_date?, reference?, remarks?,
 *   items: [{ material_code, bin, batch_from, batch_to, qty, mfg_date?, exp_date?, remarks? }]
 * }
 *
 * `dry_run: true` memeriksa SELURUH baris dan mengembalikan semua temuan
 * sekaligus tanpa mengubah apa pun — supaya operator memperbaiki semuanya dalam
 * sekali jalan, bukan satu kesalahan per percobaan posting.
 */
export async function POST(req: NextRequest) {
  return handle(async () => {
    const user = await requireWrite();
    const body = await req.json();

    const rawItems = Array.isArray(body.items) ? body.items : [];
    if (rawItems.length === 0) throw new HttpError(400, 'Tidak ada baris yang diisi.');
    if (rawItems.length > 100) throw new HttpError(400, 'Maksimum 100 baris per dokumen.');

    const items: BatchChangeInput[] = rawItems.map((it: Record<string, unknown>) => ({
      material_code: cleanStr(it.material_code).toUpperCase(),
      bin_code: cleanStr(it.bin ?? it.bin_code).toUpperCase(),
      batch_from: normBatch(it.batch_from) ?? '',
      batch_to: normBatch(it.batch_to) ?? '',
      /**
       * Qty diurai dengan longgar di sini — nilai yang tidak masuk akal
       * dilaporkan PER BARIS oleh checkBatchChange. Memakai toInt() yang
       * melempar akan menggagalkan seluruh permintaan karena satu kolom
       * kosong, dan operator kembali menghadapi satu pesan untuk selusin
       * baris — persis yang hendak dihindari oleh mode simulasi.
       */
      qty: Number(String(it.qty ?? '').replace(/[, ]/g, '')) || 0,
      mfg_date: toDate(it.mfg_date),
      exp_date: toDate(it.exp_date),
      remarks: cleanStr(it.remarks) || null,
    }));

    const doc_date = toDate(body.doc_date) ?? new Date();
    const reference = cleanStr(body.reference) || null;
    const remarks = cleanStr(body.remarks) || null;

    if (body.dry_run === true) {
      const rows = await prisma.$transaction((tx) => checkBatchChange(tx, items), {
        timeout: 30000,
        maxWait: 10000,
      });
      const bad = rows.filter((r) => r.status === 'ERROR').length;
      const merging = rows.filter((r) => r.status === 'OK' && r.merges_into_existing).length;
      return ok(
        { rows, error_count: bad },
        bad > 0
          ? `${bad} dari ${rows.length} baris belum bisa diposting.`
          : `${rows.length} baris siap diposting${merging > 0 ? ` — ${merging} baris akan digabung ke batch tujuan yang sudah ada di bin yang sama` : ''}.`
      );
    }

    const result = await prisma.$transaction(
      (tx) =>
        postBatchChange(tx, {
          items,
          doc_date,
          reference,
          remarks,
          user_id: user.username,
          via_pdt: body.via_pdt === true,
        }),
      { timeout: 60000, maxWait: 15000 }
    );

    return ok(
      result,
      `Material document ${result.document_number} diposting — ` +
        `${result.lines.length} batch dikoreksi dengan movement 309 (transfer batch ke batch).`
    );
  });
}
