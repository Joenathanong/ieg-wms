import { NextRequest } from 'next/server';
import prisma from '@/lib/prisma';
import { requireWrite, HttpError } from '@/lib/auth';
import { handle, ok } from '@/lib/api';
import { SalesGiStatus } from '@prisma/client';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/**
 * POST /api/sales-gi/:id/reset-failed — kembalikan baris GAGAL agar bisa
 * diposting ulang.
 *
 * Aman terhadap posting ganda, dan alasannya bukan kehati-hatian melainkan
 * bentuk kodenya: setiap material diposting dalam TRANSAKSINYA SENDIRI. Baris
 * yang berakhir ERROR adalah baris yang transaksinya dibatalkan seutuhnya —
 * termasuk pergerakan stok pertamanya, bila sempat ada. Jadi baris ERROR
 * **tidak pernah menyentuh stok sama sekali**, dan memprosesnya lagi bukan
 * pengulangan melainkan percobaan pertama yang tertunda.
 *
 * Kalimat itu tidak akan benar lagi bila suatu saat beberapa material
 * dikembalikan ke dalam satu transaksi besar: kegagalan pada material kesepuluh
 * akan menyisakan sembilan yang sudah keluar, dan tombol ini akan
 * mengeluarkannya untuk kedua kali.
 *
 * Baris yang sudah OK tidak disentuh sedikit pun.
 *
 * Inilah yang membuat backfill 14 hari bisa dikerjakan bertahap: posting apa
 * yang bisa, betulkan master untuk yang gagal, lalu ulangi yang gagal saja.
 */
export async function POST(_req: NextRequest, ctx: Ctx) {
  return handle(async () => {
    await requireWrite();
    const { id } = await ctx.params;
    const runId = decodeURIComponent(id);

    const run = await prisma.salesGiRun.findUnique({ where: { id: runId } });
    if (!run) throw new HttpError(404, 'Proses GI penjualan tidak ditemukan.');

    const failed = await prisma.salesGiItem.count({
      where: { run_id: runId, status: { in: ['ERROR', 'POSTING'] } },
    });
    if (failed === 0) throw new HttpError(400, 'Tidak ada baris gagal yang perlu diulang.');

    await prisma.$transaction(async (tx) => {
      await tx.salesGiItem.updateMany({
        // POSTING yang tersangkut ikut dibebaskan: ia hanya mungkin berasal
        // dari transaksi yang batal, dan transaksi yang batal tidak
        // mengeluarkan stok apa pun.
        where: { run_id: runId, status: { in: ['ERROR', 'POSTING'] } },
        data: { status: 'PENDING', message: null },
      });
      await tx.salesGiRun.update({
        where: { id: runId },
        data: {
          // Hitungan gagal dinolkan karena barisnya kembali antre; hitungan
          // berhasil TIDAK disentuh — stok yang sudah keluar tetap tercatat.
          failed_lines: 0,
          status: SalesGiStatus.RUNNING,
          finished_at: null,
        },
      });
    });

    return ok(
      { reset: failed },
      `${failed} baris gagal dikembalikan ke antrean. Baris yang sudah berhasil tidak disentuh — ` +
        `jalankan posting lagi untuk memprosesnya.`
    );
  });
}
