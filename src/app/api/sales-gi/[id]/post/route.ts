import { NextRequest } from 'next/server';
import prisma from '@/lib/prisma';
import { requireWrite, HttpError } from '@/lib/auth';
import { handle, ok } from '@/lib/api';
import {
  postSalesGiChunk,
  finalizeSalesGiRun,
  SALES_GI_CHUNK,
  type SalesGiChunkResult,
} from '@/lib/salesgi';
import { acquireSalesGiLock, releaseSalesGiLock } from '@/lib/salesgilock';
import { SalesGiStatus } from '@prisma/client';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

type Ctx = { params: Promise<{ id: string }> };

/**
 * POST /api/sales-gi/:id/post — proses SATU potongan.
 *
 * Sengaja tidak memproses seluruh baris dalam satu permintaan. Satu hari
 * penjualan bisa menyentuh ratusan material, dan fungsi serverless dihentikan
 * paksa pada 60 detik. Yang paling buruk dari batas itu bukan kegagalannya
 * melainkan bentuknya — putus di tengah tanpa ada yang tahu berapa yang sudah
 * keluar.
 *
 * Dua lapis membuat bentuk itu tidak mungkin: potongan berhenti sendiri
 * sebelum batas waktu, dan di dalamnya setiap material punya transaksinya
 * sendiri. Apa pun yang sudah berstatus OK bersifat final; sisanya tetap
 * antre. Layar memanggil endpoint ini berulang selama `remaining` masih ada.
 */
export async function POST(_req: NextRequest, ctx: Ctx) {
  return handle(async () => {
    const user = await requireWrite();
    const { id } = await ctx.params;
    const runId = decodeURIComponent(id);

    const before = await prisma.salesGiRun.findUnique({ where: { id: runId } });
    if (!before) throw new HttpError(404, 'Proses GI penjualan tidak ditemukan.');
    if (before.status === SalesGiStatus.DONE || before.status === SalesGiStatus.PARTIAL)
      throw new HttpError(
        400,
        `Penjualan ${before.sales_date.toISOString().slice(0, 10)} sudah selesai diproses ` +
          `(dokumen ${before.document_number ?? '-'}). Memprosesnya lagi akan mengeluarkan stok dua kali.`
      );

    /**
     * Kunci diambil SEBELUM transaksi dan dilepas SESUDAHNYA.
     *
     * Kalau ia diambil di dalam transaksi, ia ikut hilang saat transaksi batal
     * — persis di saat ia paling dibutuhkan. Dan bila transaksinya berhasil,
     * kuncinya justru tertinggal terpasang.
     */
    const lock = await acquireSalesGiLock(runId, user.username);

    let chunk: SalesGiChunkResult | undefined;
    let status: SalesGiStatus = SalesGiStatus.RUNNING;
    try {
      /**
       * TIDAK dibungkus $transaction. `postSalesGiChunk` membuka satu transaksi
       * kecil PER MATERIAL: kegagalan satu material membatalkan pergerakannya
       * sendiri saja, dan material yang sudah keluar tetap final walau potongan
       * ini berhenti di tengah.
       */
      chunk = await postSalesGiChunk(prisma, {
        run_id: runId,
        user_id: user.username,
        limit: SALES_GI_CHUNK,
      });

      if (chunk.remaining === 0) {
        status = await prisma.$transaction((tx) => finalizeSalesGiRun(tx, runId));
      }
    } finally {
      // Dilepas apa pun hasilnya. Kegagalan tidak boleh mengunci tanggal itu
      // sampai kuncinya kedaluwarsa sendiri.
      await releaseSalesGiLock(lock);
    }

    // Kegagalan di dalam try sudah dilempar keluar oleh `finally`, jadi baris
    // ini hanya tercapai bila potongannya selesai — penjaga ini semata agar
    // tipenya pasti, bukan karena kasusnya mungkin terjadi.
    if (!chunk) throw new HttpError(500, 'Potongan tidak menghasilkan apa pun.');

    const run = await prisma.salesGiRun.findUniqueOrThrow({ where: { id: runId } });

    return ok(
      {
        ...chunk,
        status,
        posted_lines: run.posted_lines,
        failed_lines: run.failed_lines,
        total_lines: run.total_lines,
        short_qty: run.short_qty,
      },
      chunk.remaining > 0
        ? `${run.posted_lines + run.failed_lines} dari ${run.total_lines} material diproses` +
          (chunk.stopped_early ? ' (potongan dihentikan karena batas waktu)' : '') +
          ` — lanjut…`
        : `Selesai: dokumen ${chunk.document_number}, ${run.posted_lines} material keluar, ` +
          `${run.failed_lines} gagal` +
          (run.short_qty > 0
            ? `, ${run.short_qty} pcs jadi saldo minus di Gudang Kecil (menunggu replenishment).`
            : '.')
    );
  });
}
