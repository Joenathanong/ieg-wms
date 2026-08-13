import { NextRequest } from 'next/server';
import prisma from '@/lib/prisma';
import { requireUser } from '@/lib/auth';
import { handle, ok, cleanStr } from '@/lib/api';
import { likeWhereAny } from '@/lib/like';
import type { Prisma } from '@prisma/client';

export const dynamic = 'force-dynamic';

/**
 * GET /api/reports/mb52 — Stock Overview
 * Query: ?material=&q=&onlyBelowSafety=1&level=MATERIAL|BATCH
 *
 * level=MATERIAL : satu baris per material (IM vs WM, safety stock)
 * level=BATCH    : dipecah sampai level batch — qty per batch, tanggal
 *                  expired/produksi, jumlah bin, dan status kadaluarsa.
 */
export async function GET(req: NextRequest) {
  return handle(async () => {
    await requireUser();
    const sp = req.nextUrl.searchParams;
    const material = cleanStr(sp.get('material')).toUpperCase();
    const q = cleanStr(sp.get('q'));
    const onlyBelow = sp.get('onlyBelowSafety') === '1';
    // Default = BATCH: MB52 menampilkan stok sampai level batch (gabungan
    // seluruh storage bin). Level MATERIAL tetap tersedia untuk cek IM vs WM.
    const level = cleanStr(sp.get('level')).toUpperCase() === 'MATERIAL' ? 'MATERIAL' : 'BATCH';

    // kedua parameter mencari kode MAUPUN deskripsi, mendukung wildcard '*'
    const materials = await prisma.material.findMany({
      where: {
        AND: [
          (likeWhereAny(['material_code', 'description'], material) ?? {}) as Prisma.MaterialWhereInput,
          (likeWhereAny(['material_code', 'description'], q) ?? {}) as Prisma.MaterialWhereInput,
        ],
      },
      orderBy: { material_code: 'asc' },
    });

    const codes = materials.map((m) => m.material_code);

    const [ims, wmGroups] = await Promise.all([
      prisma.stockIM.findMany({ where: { material_code: { in: codes } } }),
      prisma.stockWM.groupBy({
        by: ['material_code'],
        where: { material_code: { in: codes } },
        _sum: { qty: true },
        _count: { _all: true },
      }),
    ]);

    const imMap = new Map(ims.map((i) => [i.material_code, i.total_qty]));
    const wmMap = new Map(wmGroups.map((g) => [g.material_code, g]));

    // hitung jumlah bin unik per material
    const quants = await prisma.stockWM.findMany({
      where: { material_code: { in: codes } },
      select: { material_code: true, bin_code: true },
    });
    const binMap = new Map<string, Set<string>>();
    quants.forEach((qt) => {
      if (!binMap.has(qt.material_code)) binMap.set(qt.material_code, new Set());
      binMap.get(qt.material_code)!.add(qt.bin_code);
    });

    let rows = materials.map((m) => {
      const im_qty = imMap.get(m.material_code) ?? 0;
      const wm_qty = wmMap.get(m.material_code)?._sum.qty ?? 0;
      return {
        material_code: m.material_code,
        description: m.description,
        uom: m.uom,
        is_batch_managed: m.is_batch_managed,
        min_safety_stock: m.min_safety_stock,
        im_qty,
        wm_qty,
        /** selisih IM vs WM harus 0 — indikator konsistensi data */
        variance: im_qty - wm_qty,
        bin_count: binMap.get(m.material_code)?.size ?? 0,
        quant_count: wmMap.get(m.material_code)?._count._all ?? 0,
        below_safety: im_qty < m.min_safety_stock,
      };
    });

    if (onlyBelow) rows = rows.filter((r) => r.below_safety);

    const total = rows.reduce((a, r) => a + r.im_qty, 0);

    /* ---------------- level BATCH ---------------- */
    if (level === 'BATCH') {
      const keep = new Set(rows.map((r) => r.material_code));

      const quants = await prisma.stockWM.findMany({
        where: { material_code: { in: [...keep] } },
        orderBy: [{ material_code: 'asc' }, { exp_date: 'asc' }],
        take: 20000,
      });

      // gabungkan per material + batch (satu batch bisa tersebar di beberapa bin)
      type Agg = {
        material_code: string;
        batch_number: string;
        mfg_date: Date | null;
        exp_date: Date | null;
        gr_date: Date | null;
        qty: number;
        /** rincian sebaran bin — batch yang sama bisa tersimpan di banyak bin */
        bins: Map<string, number>;
      };
      const map = new Map<string, Agg>();

      for (const qt of quants) {
        const batch = qt.batch_number ?? '';
        const key = `${qt.material_code}|${batch}`;
        const cur = map.get(key);
        if (cur) {
          cur.qty += qt.qty;
          cur.bins.set(qt.bin_code, (cur.bins.get(qt.bin_code) ?? 0) + qt.qty);
          if (!cur.exp_date && qt.exp_date) cur.exp_date = qt.exp_date;
          if (!cur.mfg_date && qt.mfg_date) cur.mfg_date = qt.mfg_date;
          if (!cur.gr_date && qt.gr_date) cur.gr_date = qt.gr_date;
        } else {
          map.set(key, {
            material_code: qt.material_code,
            batch_number: batch,
            mfg_date: qt.mfg_date,
            exp_date: qt.exp_date,
            gr_date: qt.gr_date,
            qty: qt.qty,
            bins: new Map([[qt.bin_code, qt.qty]]),
          });
        }
      }

      const mMap = new Map(materials.map((m) => [m.material_code, m]));
      const today = new Date();

      const batchRows = [...map.values()]
        .map((b) => {
          const m = mMap.get(b.material_code);
          const days_to_exp = b.exp_date
            ? Math.ceil((b.exp_date.getTime() - today.getTime()) / 86400000)
            : null;
          // urut bin dari qty terbesar supaya lokasi utama terbaca lebih dulu
          const binList = [...b.bins.entries()].sort((x, y) => y[1] - x[1]);
          return {
            material_code: b.material_code,
            description: m?.description ?? '',
            uom: m?.uom ?? 'PC',
            is_batch_managed: m?.is_batch_managed ?? true,
            min_safety_stock: m?.min_safety_stock ?? 0,
            batch_number: b.batch_number,
            mfg_date: b.mfg_date,
            exp_date: b.exp_date,
            gr_date: b.gr_date,
            days_to_exp,
            expiry_flag:
              days_to_exp === null ? '' : days_to_exp < 0 ? 'EXPIRED' : days_to_exp <= 30 ? 'CRITICAL' : '',
            /** qty batch ini — gabungan seluruh storage bin */
            qty: b.qty,
            bin_count: b.bins.size,
            /** sebaran bin: "GB-A-01-01-1 (480) · GB-PICK-A-01 (120)" */
            bins: binList.map(([bin_code, qty]) => ({ bin_code, qty })),
            bin_list: binList.map(([bin_code, qty]) => `${bin_code} (${qty})`).join(' · '),
            /** total material — memudahkan pembacaan saat baris batch banyak */
            material_total: imMap.get(b.material_code) ?? 0,
          };
        })
        .sort(
          (a, b) =>
            a.material_code.localeCompare(b.material_code, 'id', { numeric: true }) ||
            (a.exp_date?.getTime() ?? Infinity) - (b.exp_date?.getTime() ?? Infinity) ||
            a.batch_number.localeCompare(b.batch_number, 'id', { numeric: true })
        );

      const batchTotal = batchRows.reduce((a, r) => a + r.qty, 0);

      return ok(
        { rows: batchRows, total_qty: batchTotal, level: 'BATCH', material_count: rows.length },
        `${batchRows.length} batch dari ${rows.length} material — total ${batchTotal.toLocaleString('de-DE')} unit`
      );
    }

    return ok(
      { rows, total_qty: total, level: 'MATERIAL', material_count: rows.length },
      `${rows.length} material(s) selected — total ${total.toLocaleString('de-DE')} units`
    );
  });
}
