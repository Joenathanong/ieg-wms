import { NextRequest } from 'next/server';
import prisma from '@/lib/prisma';
import { requireUser, HttpError } from '@/lib/auth';
import { handle, ok } from '@/lib/api';
import { validateSalesGiRun } from '@/lib/salesgi';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

type Ctx = { params: Promise<{ id: string }> };

/**
 * POST /api/sales-gi/:id/validate — periksa seluruh SKU tanpa menyentuh stok.
 *
 * Hanya MEMBACA master dan menuliskan hasil penerjemahan ke baris. Aman
 * dijalankan berkali-kali, termasuk di database production, dan aman
 * dijalankan sebelum maupun sesudah posting.
 *
 * Untuk backfill 14 hari, urutan yang benar adalah: unggah semua tanggal,
 * validasi semuanya, betulkan master yang bermasalah, baru posting. SKU yang
 * tidak dikenali jauh lebih murah diperbaiki sebelum ada stok yang bergerak.
 */
export async function POST(req: NextRequest, ctx: Ctx) {
  return handle(async () => {
    await requireUser();
    const { id } = await ctx.params;
    const runId = decodeURIComponent(id);

    const run = await prisma.salesGiRun.findUnique({ where: { id: runId } });
    if (!run) throw new HttpError(404, 'Proses GI penjualan tidak ditemukan.');

    /**
     * Tanpa $transaction — pemeriksaan ini hanya membaca master dan menulis
     * hasilnya ke baris. Transaksi panjang di database production menahan
     * kunci tanpa memberi jaminan yang dibutuhkan di sini, dan bila ia putus
     * di detik ke-55 seluruh hasilnya hilang.
     */
    const body = await req.json().catch(() => ({}) as Record<string, unknown>);
    const from_line = Number(body?.from_line) || undefined;

    const res = await validateSalesGiRun(prisma, runId, { from_line });

    const bad = res.unknown + res.conflict;
    return ok(
      res,
      res.next_line !== null
        ? `${res.checked} material diperiksa — lanjut dari baris ${res.next_line}…`
        : bad === 0
          ? `${res.checked} material diperiksa — semuanya dikenali` +
            (res.grouped > 0
              ? `, ${res.grouped} di antaranya deskripsi yang dipakai beberapa SKU sekaligus ` +
                `(wajar — GI-nya diambil FEFO gabungan). Periksa sekilas daftar anggotanya di ` +
                `kolom keterangan sebelum posting.`
              : `. Siap diposting.`)
          : `${res.checked} material diperiksa: ${res.unknown} tidak dikenali` +
            (res.conflict > 0
              ? `, ${res.conflict} kelompoknya beda satuan / beda pengelolaan batch`
              : '') +
            `. Betulkan di MM01 lalu validasi ulang.`
    );
  });
}
