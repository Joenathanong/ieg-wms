import { NextRequest } from 'next/server';
import prisma from '@/lib/prisma';
import { requireUser } from '@/lib/auth';
import { handle, ok, cleanStr } from '@/lib/api';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * GET /api/materials/duplicates — pemindai SKU kembar (ZMATDUP).
 *
 * Mencari dua pola:
 *   NAMA    — beberapa kode material dengan deskripsi PERSIS sama. Inilah bentuk
 *             duplikat yang sebenarnya terjadi di sini: barang yang sama didaftar
 *             ulang dengan nomor baru, namanya diketik sama.
 *   BARCODE — beberapa material memegang barcode yang sama. Dicek SILANG antara
 *             kolom B-POM dan kolom produk, karena lookup scan mencocokkan ke
 *             keduanya: barcode B-POM material A yang sama dengan barcode produk
 *             material B sudah cukup membuat scan menjadi ambigu.
 *   MIRIP   — deskripsi yang HAMPIR sama: beda spasi ganda, tanda hubung, titik,
 *             atau garis bawah. Ini BUKAN daftar untuk digabung.
 *
 *             GI penjualan, perluasan cakupan opname, dan reklasifikasi 309
 *             semuanya mengelompokkan SKU lewat deskripsi yang SAMA PERSIS. SKU
 *             kembar yang deskripsinya beda satu spasi karena itu tidak akan
 *             pernah masuk satu kelompok — penjualannya tidak digabung FEFO,
 *             dan selisih opname-nya terbaca sebagai temuan sungguhan.
 *
 *             Yang membuatnya berbahaya adalah diamnya: tidak ada error, tidak
 *             ada yang gagal, semuanya hanya bekerja seolah keduanya barang
 *             yang berbeda. Daftar ini satu-satunya tempat hal itu terlihat.
 *
 * Seluruh master dibaca sekali lalu dikelompokkan di memori, bukan lewat
 * beberapa query GROUP BY. Jumlah SKU di sini ribuan, bukan jutaan, dan
 * pengelompokan di memori adalah satu-satunya cara menangkap kecocokan silang
 * antar kolom tanpa perbandingan tabel dengan dirinya sendiri.
 */

interface Member {
  material_code: string;
  description: string;
  uom: string;
  is_batch_managed: boolean;
  barcode_bpom: string | null;
  barcode_produk: string | null;
  kode_ocs: string | null;
  fix_bin: string | null;
  min_safety_stock: number;
  created_at: Date;
  /** total stok (Stock IM) */
  total_qty: number;
  /** jumlah quant di rak */
  quants: number;
  /** jumlah baris dokumen di MB51 */
  history_docs: number;
  /** jumlah alias yang sudah menunjuk ke kode ini */
  alias_count: number;
}

interface Group {
  kind: 'NAMA' | 'BARCODE' | 'MIRIP';
  /** nilai yang membuat mereka bertemu — deskripsi atau barcode */
  key: string;
  members: Member[];
  /** saran kode utama: yang paling banyak riwayatnya, lalu yang paling tua */
  suggested_primary: string;
}

export async function GET(req: NextRequest) {
  return handle(async () => {
    await requireUser();
    const q = cleanStr(req.nextUrl.searchParams.get('q')).toUpperCase();
    /** 'NAMA' | 'BARCODE' | 'MIRIP' | '' (semua) */
    const kind = cleanStr(req.nextUrl.searchParams.get('kind')).toUpperCase();

    // Material yang sudah ditutup sengaja tidak ikut: ia memang hasil
    // penggabungan sebelumnya, dan menampilkannya kembali sebagai "duplikat"
    // akan membuat daftar ini tidak pernah habis.
    const all = await prisma.material.findMany({
      where: { is_active: true },
      select: {
        material_code: true,
        description: true,
        uom: true,
        is_batch_managed: true,
        barcode_bpom: true,
        barcode_produk: true,
        kode_ocs: true,
        fix_bin: true,
        min_safety_stock: true,
        created_at: true,
      },
      orderBy: { material_code: 'asc' },
    });

    /* ---------------- kelompokkan ---------------- */
    const byName = new Map<string, string[]>();
    const byBarcode = new Map<string, Set<string>>();
    /** deskripsi tanpa spasi & tanda baca -> kode material */
    const byNorm = new Map<string, string[]>();
    /** kode material -> deskripsi apa adanya (rapi) */
    const descOf = new Map<string, string>();

    // Hanya karakter huruf dan angka yang dipertahankan. Yang dicari di sini
    // adalah deskripsi yang MAKSUDNYA sama tetapi penulisannya berbeda, dan
    // perbedaan itu selalu berupa pemisah: spasi ganda, tanda hubung, titik.
    const norm = (t: string) => t.toUpperCase().replace(/[^A-Z0-9]+/g, '');

    for (const m of all) {
      const name = m.description.trim().toUpperCase();
      descOf.set(m.material_code, name);
      if (name) {
        const list = byName.get(name) ?? [];
        list.push(m.material_code);
        byName.set(name, list);

        const nk = norm(name);
        if (nk) {
          const nlist = byNorm.get(nk) ?? [];
          nlist.push(m.material_code);
          byNorm.set(nk, nlist);
        }
      }
      for (const bc of [m.barcode_bpom, m.barcode_produk]) {
        const v = (bc ?? '').trim().toUpperCase();
        if (!v) continue;
        const set = byBarcode.get(v) ?? new Set<string>();
        set.add(m.material_code);
        byBarcode.set(v, set);
      }
    }

    const nameGroups = [...byName.entries()].filter(([, codes]) => codes.length > 1);
    const barcodeGroups = [...byBarcode.entries()].filter(([, codes]) => codes.size > 1);

    /**
     * MIRIP hanya berisi yang penulisannya BERBEDA. Kelompok yang seluruh
     * anggotanya sudah bertuliskan sama persis bukan masalah — itu justru
     * kelompok yang bekerja dengan benar, dan sudah terdaftar sebagai NAMA.
     */
    const miripGroups = [...byNorm.entries()]
      .filter(([, codes]) => codes.length > 1)
      .map(([, codes]) => {
        const raws = [...new Set(codes.map((c) => descOf.get(c) ?? ''))];
        return { raws, codes };
      })
      .filter((g) => g.raws.length > 1);

    const wantName = !kind || kind === 'NAMA';
    const wantBarcode = !kind || kind === 'BARCODE';
    const wantMirip = !kind || kind === 'MIRIP';

    const rawGroups: { kind: 'NAMA' | 'BARCODE' | 'MIRIP'; key: string; codes: string[] }[] = [
      ...(wantName ? nameGroups.map(([key, codes]) => ({ kind: 'NAMA' as const, key, codes })) : []),
      ...(wantBarcode
        ? barcodeGroups.map(([key, codes]) => ({ kind: 'BARCODE' as const, key, codes: [...codes] }))
        : []),
      ...(wantMirip
        ? miripGroups.map((g) => ({
            kind: 'MIRIP' as const,
            // Kuncinya sengaja menampilkan kedua penulisannya berdampingan —
            // itulah satu-satunya yang perlu dilihat orang di baris ini.
            key: g.raws.join('  ≠  '),
            codes: g.codes,
          }))
        : []),
    ];

    // Penyaringan kata kunci dilakukan SESUDAH pengelompokan, bukan sebelumnya.
    // Menyaring lebih dulu akan memotong sebagian anggota kelompok, dan yang
    // tersisa terlihat seperti kode tunggal yang tidak punya kembaran.
    const filtered = q
      ? rawGroups.filter(
          (g) => g.key.includes(q) || g.codes.some((c) => c.toUpperCase().includes(q))
        )
      : rawGroups;

    if (filtered.length === 0)
      return ok({ groups: [] as Group[], total_groups: 0 }, 'Tidak ada SKU kembar yang ditemukan.');

    /* ---------------- lengkapi dengan angka stok & riwayat ---------------- */
    const codes = [...new Set(filtered.flatMap((g) => g.codes))];

    const [ims, quantRows, docRows, aliasRows] = await Promise.all([
      prisma.stockIM.findMany({
        where: { material_code: { in: codes } },
        select: { material_code: true, total_qty: true },
      }),
      prisma.stockWM.groupBy({
        by: ['material_code'],
        where: { material_code: { in: codes }, qty: { not: 0 } },
        _count: { _all: true },
      }),
      prisma.migoLog.groupBy({
        by: ['material_code'],
        where: { material_code: { in: codes } },
        _count: { _all: true },
      }),
      prisma.materialAlias.groupBy({
        by: ['material_code'],
        where: { material_code: { in: codes } },
        _count: { _all: true },
      }),
    ]);

    const imMap = new Map(ims.map((r) => [r.material_code, r.total_qty]));
    const quantMap = new Map(quantRows.map((r) => [r.material_code, r._count._all]));
    const docMap = new Map(docRows.map((r) => [r.material_code, r._count._all]));
    const aliasMap = new Map(aliasRows.map((r) => [r.material_code, r._count._all]));
    const matMap = new Map(all.map((m) => [m.material_code, m]));

    const groups: Group[] = filtered.map((g) => {
      const members: Member[] = g.codes
        .map((c) => matMap.get(c))
        .filter((m): m is (typeof all)[number] => Boolean(m))
        .map((m) => ({
          ...m,
          total_qty: imMap.get(m.material_code) ?? 0,
          quants: quantMap.get(m.material_code) ?? 0,
          history_docs: docMap.get(m.material_code) ?? 0,
          alias_count: aliasMap.get(m.material_code) ?? 0,
        }));

      /**
       * Saran kode utama.
       *
       * Yang dipilih adalah kode dengan RIWAYAT terbanyak, bukan stok terbanyak.
       * Riwayat tidak ikut pindah saat penggabungan — laporan MB51 lama tetap
       * menyebut kode aslinya — sedangkan stok memang dipindahkan. Menjadikan
       * kode berriwayat panjang sebagai kode utama karena itu menyisakan paling
       * sedikit jejak yang terpencar. Bila seri, yang lebih tua menang.
       */
      const sorted = [...members].sort(
        (a, b) =>
          b.history_docs - a.history_docs ||
          b.total_qty - a.total_qty ||
          a.created_at.getTime() - b.created_at.getTime()
      );

      return {
        kind: g.kind,
        key: g.key,
        members: members.sort((a, b) => a.material_code.localeCompare(b.material_code)),
        suggested_primary: sorted[0]?.material_code ?? '',
      };
    });

    groups.sort((a, b) => a.kind.localeCompare(b.kind) || a.key.localeCompare(b.key));

    const skuCount = new Set(groups.flatMap((g) => g.members.map((m) => m.material_code))).size;
    const mirip = groups.filter((g) => g.kind === 'MIRIP').length;

    return ok(
      { groups, total_groups: groups.length },
      `${groups.length} kelompok kembar ditemukan, melibatkan ${skuCount} kode SKU.` +
        (mirip > 0
          ? ` ${mirip} di antaranya MIRIP — deskripsinya nyaris sama tetapi tidak persis, sehingga ` +
            `SKU-nya TIDAK ikut dikelompokkan di GI penjualan maupun opname. Seragamkan penulisannya ` +
            `di MM01; tidak perlu digabung.`
          : '')
    );
  });
}
