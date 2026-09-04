import { NextRequest } from 'next/server';
import prisma from '@/lib/prisma';
import { requireUser, HttpError } from '@/lib/auth';
import { handle, ok } from '@/lib/api';
import { MovementType } from '@prisma/client';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/**
 * GET /api/sales-gi/:id/audit — cocokkan CATATAN PROSES dengan BUKU BESAR.
 * =============================================================================
 *
 * Status baris di ZGI02 dan pergerakan stok di MB51 adalah dua catatan yang
 * berbeda. Biasanya keduanya sepakat, karena sejak perbaikan terakhir setiap
 * material diposting dalam transaksinya sendiri: kalau transaksinya batal,
 * status DAN stoknya sama-sama tidak jadi.
 *
 * Yang tidak dijamin oleh perbaikan itu adalah masa LALU. Versi sebelumnya
 * memproses 40 material dalam SATU transaksi dengan penanganan galat per
 * material; sebuah material yang gagal pada pengambilan keduanya meninggalkan
 * pengambilan pertamanya tetap tersimpan, sementara barisnya ditandai ERROR.
 * Baris seperti itu terlihat "belum diproses" padahal stoknya sudah keluar
 * sebagian — dan memprosesnya ulang akan mengeluarkannya untuk kedua kali.
 *
 * Karena itu pemeriksaan ini membaca buku besar, bukan status. Ia tidak
 * mengubah apa pun, aman dijalankan kapan saja, termasuk di database
 * production.
 *
 * BATAS KETELITIAN
 * ----------------
 * Baris buku besar dicocokkan lewat KODE MATERIAL di bawah nomor dokumen run
 * ini. Bila dua SKU penjualan yang berbeda kebetulan menunjuk material yang
 * sama, keduanya akan terlihat berbagi pergerakan yang sama — dilaporkan apa
 * adanya sebagai AMBIGU, bukan ditebak. Menebak di sini berarti menyembunyikan
 * satu-satunya petunjuk bahwa ada yang perlu dilihat manusia.
 */
export async function GET(_req: NextRequest, ctx: Ctx) {
  return handle(async () => {
    await requireUser();
    const { id } = await ctx.params;
    const runId = decodeURIComponent(id);

    const run = await prisma.salesGiRun.findUnique({
      where: { id: runId },
      include: { items: { orderBy: { line_no: 'asc' } } },
    });
    if (!run) throw new HttpError(404, 'Proses GI penjualan tidak ditemukan.');

    /** material_code -> qty yang benar-benar keluar menurut buku besar */
    const ledger = new Map<string, number>();
    if (run.document_number) {
      const rows = await prisma.migoLog.groupBy({
        by: ['material_code'],
        where: {
          document_number: run.document_number,
          movement_type: MovementType.GI_601_SALES,
        },
        _sum: { qty: true },
      });
      for (const r of rows) ledger.set(r.material_code, r._sum.qty ?? 0);
    }

    // Material yang dipakai lebih dari satu baris tidak bisa dibagi dengan
    // yakin — ditandai, tidak ditebak.
    const useCount = new Map<string, number>();
    for (const it of run.items)
      if (it.material_code) useCount.set(it.material_code, (useCount.get(it.material_code) ?? 0) + 1);

    type Verdict = 'COCOK' | 'BELUM_KELUAR' | 'SUDAH_KELUAR' | 'SEBAGIAN' | 'AMBIGU' | 'TAK_DIKENAL';

    const lines = run.items.map((it) => {
      const posted = it.material_code ? (ledger.get(it.material_code) ?? 0) : 0;
      const ambiguous = it.material_code ? (useCount.get(it.material_code) ?? 0) > 1 : false;

      let verdict: Verdict;
      if (!it.material_code) verdict = 'TAK_DIKENAL';
      else if (ambiguous && posted > 0) verdict = 'AMBIGU';
      else if (it.status === 'OK') verdict = posted > 0 ? 'COCOK' : 'BELUM_KELUAR';
      else if (posted === 0) verdict = 'COCOK';
      else if (posted >= it.qty) verdict = 'SUDAH_KELUAR';
      else verdict = 'SEBAGIAN';

      return {
        line_no: it.line_no,
        sku: it.sku,
        material_code: it.material_code,
        status: it.status,
        qty: it.qty,
        posted_qty: posted,
        verdict,
      };
    });

    /**
     * Baris yang BERBAHAYA bila diproses ulang: statusnya bukan OK, tetapi
     * stoknya sudah keluar. Inilah satu-satunya kelompok yang benar-benar perlu
     * tindakan sebelum posting dijalankan lagi.
     */
    const risky = lines.filter((l) => l.verdict === 'SUDAH_KELUAR' || l.verdict === 'SEBAGIAN');
    const ambiguous = lines.filter((l) => l.verdict === 'AMBIGU');
    const orphan = lines.filter((l) => l.verdict === 'BELUM_KELUAR');

    return ok(
      {
        sales_date: run.sales_date,
        status: run.status,
        document_number: run.document_number,
        total_lines: run.total_lines,
        posted_lines: run.posted_lines,
        failed_lines: run.failed_lines,
        ledger_qty: [...ledger.values()].reduce((a, b) => a + b, 0),
        risky: risky.length,
        ambiguous: ambiguous.length,
        orphan: orphan.length,
        lines,
      },
      risky.length === 0 && orphan.length === 0 && ambiguous.length === 0
        ? `Catatan proses dan buku besar cocok untuk ${lines.length} baris. Aman diproses ulang — ` +
          `baris yang gagal memang belum pernah mengeluarkan stok.`
        : `PERIKSA DULU: ` +
          [
            risky.length > 0
              ? `${risky.length} baris berstatus gagal TETAPI stoknya sudah keluar ` +
                `(${risky.slice(0, 5).map((l) => `${l.sku} ${l.posted_qty}/${l.qty}`).join('; ')}` +
                `${risky.length > 5 ? ' …' : ''})`
              : null,
            orphan.length > 0 ? `${orphan.length} baris berstatus OK tetapi tanpa pergerakan stok` : null,
            ambiguous.length > 0
              ? `${ambiguous.length} baris berbagi kode material sehingga tidak bisa dipastikan`
              : null,
          ]
            .filter(Boolean)
            .join(', ') +
          `. Batalkan pergerakannya lewat MIGO Cancellation (per baris) sebelum diproses ulang, ` +
          `atau biarkan apa adanya bila memang sudah benar.`
    );
  });
}
