import { NextRequest } from 'next/server';
import prisma from '@/lib/prisma';
import { requireUser } from '@/lib/auth';
import { handle, ok } from '@/lib/api';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * GET /api/sales-gi/negatives — saldo minus yang belum tertutup replenishment.
 *
 * Ini bukan laporan pelengkap. Skema GI penjualan ini mengoreksi diri HANYA
 * kalau replenishment Gudang Besar -> Gudang Kecil benar-benar diposting
 * kemudian. Bila tidak, Gudang Kecil tetap minus dan Gudang Besar tetap
 * kelebihan selamanya: total MB52 benar, kedua raknya salah, dan tidak ada
 * satu pun layar lain yang akan mengeluh. Daftar inilah satu-satunya tempat
 * kelalaian itu terlihat.
 *
 * Kolom `age_days` dihitung dari kapan quant terakhir berubah — makin tua,
 * makin besar kemungkinan replenishment-nya memang tidak akan pernah datang
 * dan harus ditindaklanjuti manual.
 */
export async function GET(_req: NextRequest) {
  return handle(async () => {
    await requireUser();

    const quants = await prisma.stockWM.findMany({
      where: { qty: { lt: 0 } },
      orderBy: [{ updated_at: 'asc' }],
      take: 1000,
    });

    if (quants.length === 0)
      return ok(
        { rows: [], total: 0, total_qty: 0 },
        'Tidak ada saldo minus — seluruh penjualan sudah tertutup stok.'
      );

    const codes = [...new Set(quants.map((q) => q.material_code))];
    const [materials, bins] = await Promise.all([
      prisma.material.findMany({
        where: { material_code: { in: codes } },
        select: { material_code: true, description: true, uom: true, fix_bin: true },
      }),
      prisma.storageBin.findMany({
        where: { bin_code: { in: [...new Set(quants.map((q) => q.bin_code))] } },
        select: { bin_code: true, zone_id: true },
      }),
    ]);
    const mMap = new Map(materials.map((m) => [m.material_code, m]));
    const bMap = new Map(bins.map((b) => [b.bin_code, b.zone_id]));

    const now = Date.now();
    const rows = quants.map((q) => ({
      id: q.id,
      material_code: q.material_code,
      description: mMap.get(q.material_code)?.description ?? '',
      uom: mMap.get(q.material_code)?.uom ?? 'PC',
      /** true bila materialnya memang belum punya Fix Bin — sebab yang bisa diperbaiki di MM01 */
      no_fix_bin: !mMap.get(q.material_code)?.fix_bin,
      bin_code: q.bin_code,
      zone_id: bMap.get(q.bin_code) ?? '',
      batch_number: q.batch_number,
      exp_date: q.exp_date,
      /** ditampilkan positif — "berapa yang kurang", bukan "berapa saldonya" */
      shortage: -q.qty,
      updated_at: q.updated_at,
      age_days: Math.floor((now - q.updated_at.getTime()) / 86_400_000),
    }));

    const total_qty = rows.reduce((a, r) => a + r.shortage, 0);
    const oldest = rows[0]?.age_days ?? 0;

    return ok(
      { rows, total: rows.length, total_qty },
      `${rows.length} saldo minus, total ${total_qty} pcs menunggu replenishment` +
        (oldest > 0 ? ` — yang tertua sudah ${oldest} hari.` : '.')
    );
  });
}
