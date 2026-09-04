import { NextRequest } from 'next/server';
import prisma from '@/lib/prisma';
import { requireWrite, HttpError } from '@/lib/auth';
import { handle, ok } from '@/lib/api';
import { MovementType, SalesGiStatus } from '@prisma/client';
import { isSalesGiLocked } from '@/lib/salesgilock';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/**
 * POST /api/sales-gi/:id/reset-failed — kembalikan baris GAGAL agar bisa
 * diposting ulang.
 *
 * Aman terhadap posting ganda, dan alasannya bukan kehati-hatian melainkan
 * bentuk kodenya: setiap material diposting dalam TRANSAKSINYA SENDIRI. Baris
 * yang berakhir ERROR adalah baris yang transaksinya dibatalkan seutuhnya —
 * termasuk pergerakan stok pertamanya, bila sempat ada. Jadi baris ERROR tidak
 * pernah menyentuh stok, dan memprosesnya lagi bukan pengulangan melainkan
 * percobaan pertama yang tertunda.
 *
 * Kalimat itu tidak akan benar lagi bila suatu saat beberapa material
 * dikembalikan ke dalam satu transaksi besar: kegagalan pada material kesepuluh
 * akan menyisakan sembilan yang sudah keluar, dan tombol ini akan
 * mengeluarkannya untuk kedua kali.
 *
 * WARISAN VERSI LAMA
 * ------------------
 * Justru begitulah versi sebelumnya bekerja. Proses yang sudah terlanjur
 * dijalankan dengan kode itu bisa menyimpan baris ERROR yang stoknya sudah
 * keluar sebagian. Karena itu tombol ini TIDAK lagi percaya pada status
 * barisnya saja: sebelum mengantre ulang, ia membaca buku besar dan menahan
 * baris yang ternyata sudah punya pergerakan stok.
 *
 * Menahan, bukan menandai selesai. Baris yang stoknya keluar 60 dari 100 tidak
 * benar bila dianggap OK (40 tidak akan pernah keluar) maupun bila diantre
 * ulang (60 keluar dua kali). Yang benar adalah keputusan manusia: batalkan 60
 * itu lewat MIGO Cancellation lalu antre ulang, atau terima apa adanya. Layar
 * Audit di ZGI02 menunjukkan angkanya persis.
 *
 * Baris yang sudah OK tidak disentuh sedikit pun.
 */
export async function POST(_req: NextRequest, ctx: Ctx) {
  return handle(async () => {
    await requireWrite();
    const { id } = await ctx.params;
    const runId = decodeURIComponent(id);

    const run = await prisma.salesGiRun.findUnique({ where: { id: runId } });
    if (!run) throw new HttpError(404, 'Proses GI penjualan tidak ditemukan.');

    // Mengantre ulang di tengah proses yang sedang berjalan akan membuat baris
    // yang sedang digarap kembali PENDING dan digarap kedua kalinya.
    if (await isSalesGiLocked(run.id))
      throw new HttpError(
        409,
        'Proses ini sedang berjalan. Tunggu sampai selesai sebelum mengantre ulang baris gagal.'
      );

    const failed = await prisma.salesGiItem.findMany({
      where: { run_id: runId, status: { in: ['ERROR', 'POSTING'] } },
    });
    if (failed.length === 0) throw new HttpError(400, 'Tidak ada baris gagal yang perlu diulang.');

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

    const held = failed.filter((i) => i.material_code && (ledger.get(i.material_code) ?? 0) > 0);
    const heldIds = new Set(held.map((i) => i.id));
    const safe = failed.filter((i) => !heldIds.has(i.id));

    await prisma.$transaction(async (tx) => {
      if (safe.length > 0)
        await tx.salesGiItem.updateMany({
          // POSTING yang tersangkut ikut dibebaskan: ia hanya mungkin berasal
          // dari transaksi yang batal, dan transaksi yang batal tidak
          // mengeluarkan stok apa pun.
          where: { id: { in: safe.map((i) => i.id) } },
          data: { status: 'PENDING', message: null },
        });

      for (const i of held)
        await tx.salesGiItem.update({
          where: { id: i.id },
          data: {
            status: 'ERROR',
            message:
              `DITAHAN: ${ledger.get(i.material_code!) ?? 0} dari ${i.qty} sudah keluar pada dokumen ` +
              `${run.document_number}. Batalkan dulu lewat MIGO Cancellation bila mau diulang.`.slice(
                0,
                255
              ),
          },
        });

      await tx.salesGiRun.update({
        where: { id: runId },
        data: {
          // Hitungan gagal disetel ke jumlah yang MASIH gagal — bukan nol.
          // Menolkannya sementara ada baris yang ditahan membuat ZGI02
          // melaporkan proses ini lebih sehat daripada kenyataannya.
          failed_lines: held.length,
          status: safe.length > 0 ? SalesGiStatus.RUNNING : run.status,
          ...(safe.length > 0 ? { finished_at: null } : {}),
        },
      });
    });

    return ok(
      { reset: safe.length, held: held.length },
      held.length === 0
        ? `${safe.length} baris gagal dikembalikan ke antrean. Baris yang sudah berhasil tidak disentuh — ` +
          `jalankan posting lagi untuk memprosesnya.`
        : `${safe.length} baris dikembalikan ke antrean. ${held.length} baris DITAHAN karena stoknya ` +
          `ternyata sudah keluar sebagian pada dokumen ${run.document_number} — mengantrekannya ulang ` +
          `akan mengeluarkan stok dua kali. Buka Audit di ZGI02 untuk melihat angkanya, lalu batalkan ` +
          `pergerakan itu lewat MIGO Cancellation bila memang perlu diulang.`
    );
  });
}
