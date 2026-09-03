import { NextRequest } from 'next/server';
import prisma from '@/lib/prisma';
import { requireUser, requireAdmin, HttpError } from '@/lib/auth';
import { handle, ok } from '@/lib/api';
import { SalesGiStatus } from '@prisma/client';
import { isSalesGiLocked } from '@/lib/salesgilock';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/** GET /api/sales-gi/:id — rincian satu proses beserta hasil per material. */
export async function GET(_req: NextRequest, ctx: Ctx) {
  return handle(async () => {
    await requireUser();
    const { id } = await ctx.params;

    const run = await prisma.salesGiRun.findUnique({
      where: { id: decodeURIComponent(id) },
      include: { items: { orderBy: { line_no: 'asc' } } },
    });
    if (!run) throw new HttpError(404, 'Proses GI penjualan tidak ditemukan.');

    const codes = [...new Set(run.items.map((i) => i.material_code).filter(Boolean))] as string[];
    const materials = codes.length
      ? await prisma.material.findMany({
          where: { material_code: { in: codes } },
          select: { material_code: true, description: true, uom: true },
        })
      : [];
    const mMap = new Map(materials.map((m) => [m.material_code, m]));

    return ok(
      {
        ...run,
        items: run.items.map((i) => ({
          ...i,
          description: i.material_code ? (mMap.get(i.material_code)?.description ?? '') : '',
          uom: i.material_code ? (mMap.get(i.material_code)?.uom ?? 'PC') : '',
        })),
      },
      `GI penjualan ${run.sales_date.toISOString().slice(0, 10)} — ${run.status}`
    );
  });
}

/**
 * DELETE /api/sales-gi/:id — hapus proses.
 *
 * Hanya untuk proses yang BELUM menyentuh stok. Proses yang sudah memposting
 * tidak boleh dihapus: catatannya adalah satu-satunya penjelasan mengapa
 * dokumen 601 itu ada, dan menghapusnya meninggalkan pergerakan stok tanpa
 * asal-usul. Bila hasilnya keliru, batalkan dokumennya lewat MIGO Cancellation
 * — per baris kalau perlu.
 */
export async function DELETE(_req: NextRequest, ctx: Ctx) {
  return handle(async () => {
    await requireAdmin();
    const { id } = await ctx.params;

    const run = await prisma.salesGiRun.findUnique({ where: { id: decodeURIComponent(id) } });
    if (!run) throw new HttpError(404, 'Proses GI penjualan tidak ditemukan.');
    // Menghapus run yang sedang digarap akan membuat transaksi yang berjalan
    // menulis ke baris yang sudah tidak ada.
    if (await isSalesGiLocked(run.id))
      throw new HttpError(409, 'Proses ini sedang berjalan. Tunggu sampai selesai.');
    if (run.posted_lines > 0 || run.status === SalesGiStatus.DONE)
      throw new HttpError(
        400,
        `${run.posted_lines} material sudah diposting pada dokumen ${run.document_number ?? '-'}. ` +
          `Batalkan dokumennya lewat MIGO Cancellation, jangan hapus catatannya.`
      );

    await prisma.salesGiRun.delete({ where: { id: run.id } });
    return ok(
      { id: run.id },
      `Proses GI penjualan ${run.sales_date.toISOString().slice(0, 10)} dihapus. Stok tidak berubah.`
    );
  });
}
