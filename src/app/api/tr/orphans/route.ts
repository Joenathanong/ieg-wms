import { NextRequest } from 'next/server';
import prisma from '@/lib/prisma';
import { requireUser } from '@/lib/auth';
import { handle, ok } from '@/lib/api';
import { TrStatus, TrType } from '@prisma/client';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * GET /api/tr/orphans — Transfer Requirement put-away yang "yatim".
 *
 * Yatim = barisnya masih terbuka, tetapi stok yang ditunggunya SUDAH TIDAK ADA
 * di bin transit. Artinya barangnya sudah dipindahkan lewat jalur lain —
 * biasanya transfer bin manual (LT01/LT10) yang melewati LB12 — sehingga
 * barisnya tidak akan pernah bisa dikonfirmasi.
 *
 * Baris seperti ini berbahaya justru karena diam: LB10 terus menampilkannya
 * sebagai pekerjaan, petugas berikutnya mencari barang yang sudah naik rak, dan
 * kalau kebetulan ada penerimaan baru untuk batch yang sama menunggu di bin
 * transit, konfirmasinya akan mengambil barang BARU itu.
 *
 * Deteksinya membandingkan sisa terbuka dengan stok nyata di bin transit, bukan
 * sekadar "stoknya nol": bila TR menunggu 4.096 sedangkan yang tersisa 500,
 * selisihnya tetap tidak akan pernah bisa dikonfirmasi.
 */
export async function GET(_req: NextRequest) {
  return handle(async () => {
    await requireUser();

    const items = await prisma.transferReqItem.findMany({
      where: {
        status: { in: [TrStatus.OPEN, TrStatus.PARTIAL] },
        tr: { tr_type: TrType.PUTAWAY, status: { in: [TrStatus.OPEN, TrStatus.PARTIAL] } },
        source_bin: { not: null },
      },
      include: { tr: { select: { tr_number: true, ref_doc: true, created_at: true, created_by: true } } },
      orderBy: [{ tr_id: 'asc' }, { line_no: 'asc' }],
      take: 2000,
    });
    if (items.length === 0)
      return ok({ rows: [], total: 0 }, 'Tidak ada baris put-away yang menggantung.');

    // Bin yang terlibat dibaca sekali, bukan per baris — satu TR bisa punya
    // puluhan baris yang semuanya menunjuk bin transit yang sama.
    const binCodes = [...new Set(items.map((i) => i.source_bin as string))];
    const bins = await prisma.storageBin.findMany({
      where: { bin_code: { in: binCodes } },
      select: { bin_code: true, is_interim: true },
    });
    const interim = new Set(bins.filter((b) => b.is_interim).map((b) => b.bin_code));

    const candidates = items.filter((i) => interim.has(i.source_bin as string));
    if (candidates.length === 0)
      return ok({ rows: [], total: 0 }, 'Tidak ada baris put-away yang menggantung.');

    const quants = await prisma.stockWM.findMany({
      where: {
        bin_code: { in: [...interim] },
        material_code: { in: [...new Set(candidates.map((i) => i.material_code))] },
      },
      select: { material_code: true, bin_code: true, batch_number: true, qty: true },
    });
    const qKey = (m: string, b: string, batch: string | null) => `${m}|${b}|${batch ?? ''}`;
    const stock = new Map(quants.map((q) => [qKey(q.material_code, q.bin_code, q.batch_number), q.qty]));

    const materials = await prisma.material.findMany({
      where: { material_code: { in: [...new Set(candidates.map((i) => i.material_code))] } },
      select: { material_code: true, description: true, uom: true },
    });
    const mMap = new Map(materials.map((m) => [m.material_code, m]));

    /**
     * Sisa terbuka dijumlahkan PER (material, bin, batch) lebih dulu.
     *
     * Dua baris TR berbeda bisa menunggu batch yang sama di bin yang sama;
     * membandingkan masing-masing terhadap stok penuh akan menyatakan keduanya
     * sehat padahal stoknya hanya cukup untuk satu.
     */
    const need = new Map<string, number>();
    for (const i of candidates) {
      const k = qKey(i.material_code, i.source_bin as string, i.batch_number);
      need.set(k, (need.get(k) ?? 0) + (i.qty - i.qty_confirmed));
    }

    const rows = candidates
      .map((i) => {
        const k = qKey(i.material_code, i.source_bin as string, i.batch_number);
        const open = i.qty - i.qty_confirmed;
        const available = stock.get(k) ?? 0;
        const shortage = Math.max(0, (need.get(k) ?? 0) - available);
        return {
          item_id: i.id,
          tr_number: i.tr.tr_number,
          ref_doc: i.tr.ref_doc,
          created_by: i.tr.created_by,
          created_at: i.tr.created_at,
          line_no: i.line_no,
          material_code: i.material_code,
          description: mMap.get(i.material_code)?.description ?? '',
          uom: mMap.get(i.material_code)?.uom ?? 'PC',
          batch_number: i.batch_number,
          bin_code: i.source_bin as string,
          open_qty: open,
          /** stok batch itu yang masih benar-benar ada di bin transit */
          available,
          /** kekurangan pada kelompok material+bin+batch ini */
          shortage,
        };
      })
      .filter((r) => r.shortage > 0)
      .sort((a, b) => a.tr_number.localeCompare(b.tr_number) || a.line_no - b.line_no);

    const trCount = new Set(rows.map((r) => r.tr_number)).size;

    return ok(
      { rows, total: rows.length },
      rows.length === 0
        ? 'Tidak ada baris put-away yang menggantung — semua yang terbuka masih punya stok di bin transit.'
        : `${rows.length} baris menggantung pada ${trCount} transfer requirement: stoknya sudah tidak ada di bin transit, jadi tidak akan pernah bisa dikonfirmasi.`
    );
  });
}
