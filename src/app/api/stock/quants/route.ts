import { NextRequest } from 'next/server';
import prisma from '@/lib/prisma';
import { requireUser } from '@/lib/auth';
import { handle, ok, cleanStr } from '@/lib/api';
import { materialCodeFilter } from '@/lib/search';
import { likeWhereAny } from '@/lib/like';
import type { Prisma } from '@prisma/client';

export const dynamic = 'force-dynamic';

/**
 * GET /api/stock/quants?bin=&material=&batch=
 * Search help (F4) untuk memilih stok yang tersedia di sebuah bin —
 * dipakai layar LT01 / LT10 / MIGO 201.
 */
export async function GET(req: NextRequest) {
  return handle(async () => {
    await requireUser();
    const sp = req.nextUrl.searchParams;
    const bin = cleanStr(sp.get('bin')).toUpperCase();
    const material = cleanStr(sp.get('material')).toUpperCase();
    const batch = cleanStr(sp.get('batch')).toUpperCase();
    /**
     * `material` = pencocokan PERSIS (dipakai scanner PDT agar tidak salah ambil).
     * `q`        = pencarian bebas (kode / deskripsi, mendukung wildcard '*') —
     *              dipakai layar LT10 & pencarian manual.
     */
    const q = cleanStr(sp.get('q')).toUpperCase();
    const qFilter = await materialCodeFilter('material_code', q);

    /**
     * Kode lama yang sudah digabung diterjemahkan lebih dulu.
     *
     * Tanpa ini, operator yang memindai karton bercetak kode lama akan melihat
     * "stok tidak ada" padahal barangnya jelas di rak — pencocokan `material`
     * bersifat PERSIS, dan stoknya sudah pindah ke kode utama.
     */
    let materialFilter = material;
    let alias_of: string | null = null;
    if (material) {
      const exists = await prisma.material.findUnique({
        where: { material_code: material },
        select: { material_code: true },
      });
      if (!exists) {
        const alias = await prisma.materialAlias.findUnique({ where: { alias_code: material } });
        if (alias) {
          materialFilter = alias.material_code;
          alias_of = material;
        }
      }
    }
    /** '1' = kecualikan bin interim (TRANSIT-IN/OUT) — dipakai ZRF08 replenishment */
    const exclInterim = cleanStr(sp.get('exclInterim')) === '1';
    /**
     * Batasi ke kelompok gudang tertentu (BESAR / KECIL) — dipakai ZRF08 yang
     * hanya melayani replenishment di Gudang Besar.
     *
     * Batasannya dipasang sebagai KONDISI QUERY, bukan penyaringan setelah data
     * diambil. Bedanya bukan soal kecepatan melainkan kebenaran: `take` di bawah
     * membatasi jumlah baris yang DIAMBIL, jadi menyaring sesudahnya berarti
     * batas itu ikut memotong baris yang seharusnya tampil.
     */
    const zoneGroup = cleanStr(sp.get('zoneGroup')).toUpperCase();

    /**
     * Kode bin milik kelompok gudang yang diminta.
     *
     * stock_wm hanya menyimpan bin_code sebagai teks — tidak ada relasi ke tabel
     * bin — sehingga zona harus diterjemahkan dulu menjadi daftar kode bin.
     * Daftar kosong berarti kelompok itu memang tidak punya bin, dan `in: []`
     * dengan benar tidak mencocokkan apa pun.
     */
    let zoneBinCodes: string[] | null = null;
    if (zoneGroup) {
      const zoneCodes = (
        await prisma.zone.findMany({ where: { zone_group: zoneGroup }, select: { zone_code: true } })
      ).map((z) => z.zone_code);

      const zoneBins = zoneCodes.length
        ? await prisma.storageBin.findMany({
            where: { zone_id: { in: zoneCodes } },
            select: { bin_code: true },
          })
        : [];
      zoneBinCodes = zoneBins.map((b) => b.bin_code);
    }

    let interimCodes: string[] = [];
    if (exclInterim) {
      const interim = await prisma.storageBin.findMany({
        where: { is_interim: true },
        select: { bin_code: true },
      });
      interimCodes = interim.map((b) => b.bin_code);
    }

    const quants = await prisma.stockWM.findMany({
      where: {
        AND: [
          bin && bin.includes('*')
            ? ((likeWhereAny(['bin_code'], bin) ?? {}) as Prisma.StockWMWhereInput)
            : bin
              ? { bin_code: bin }
              : {},
          materialFilter ? { material_code: materialFilter } : {},
          (qFilter ?? {}) as Prisma.StockWMWhereInput,
          batch ? { batch_number: batch } : {},
          exclInterim && interimCodes.length ? { bin_code: { notIn: interimCodes } } : {},
          zoneBinCodes ? { bin_code: { in: zoneBinCodes } } : {},
          { qty: { gt: 0 } },
        ],
      },
      // FEFO: expired terdekat dulu; bila ED sama, ambil quant dengan qty
      // TERKECIL lebih dulu agar sisa kecil cepat habis (menghindari pecahan).
      orderBy: [{ exp_date: 'asc' }, { qty: 'asc' }, { bin_code: 'asc' }],
      take: 500,
    });

    // Zona setiap bin — dipakai untuk penyaringan kelompok gudang sekaligus
    // ditampilkan di layar supaya operator tahu asal stoknya.
    const binRows = await prisma.storageBin.findMany({
      where: { bin_code: { in: [...new Set(quants.map((q) => q.bin_code))] } },
      select: { bin_code: true, zone_id: true },
    });
    const zoneOfBin = new Map(binRows.map((b) => [b.bin_code, b.zone_id]));

    const materials = await prisma.material.findMany({
      where: { material_code: { in: [...new Set(quants.map((q) => q.material_code))] } },
      select: { material_code: true, description: true, uom: true, is_batch_managed: true, fix_bin: true },
    });
    const mMap = new Map(materials.map((m) => [m.material_code, m]));

    const rows = quants.map((q) => ({
      id: q.id,
      material_code: q.material_code,
      description: mMap.get(q.material_code)?.description ?? '',
      uom: mMap.get(q.material_code)?.uom ?? 'PC',
      is_batch_managed: mMap.get(q.material_code)?.is_batch_managed ?? true,
      /** fix bin material — saran tujuan replenishment (ZRF08) */
      fix_bin: mMap.get(q.material_code)?.fix_bin ?? null,
      bin_code: q.bin_code,
      zone_id: zoneOfBin.get(q.bin_code) ?? '',
      batch_number: q.batch_number ?? '',
      mfg_date: q.mfg_date,
      exp_date: q.exp_date,
      gr_date: q.gr_date,
      qty: q.qty,
    }));

    return ok(
      rows,
      alias_of
        ? `${rows.length} quant(s) available — kode lama ${alias_of} dibaca sebagai ${materialFilter}`
        : `${rows.length} quant(s) available`
    );
  });
}
