import { Prisma, PrismaClient, MovementType, BinStatus, SalesGiStatus } from '@prisma/client';
import { HttpError } from './auth';
import { nextDocNumber } from './docnum';
import { applyStockIM, applyStockWM, refreshBinStatus } from './wms';
import { resolveMaterialCode } from './alias';
import { SALES_GI_BIN, SALES_GI_ZONE } from './zones';

/**
 * GOODS ISSUE PENJUALAN (601) — otomatis dari data penjualan harian
 * =============================================================================
 *
 * ALUR
 * ----
 * Penjualan satu hari dijumlahkan per material, lalu dikeluarkan dari GUDANG
 * KECIL — rak eceran tempat barang benar-benar diambil untuk pengiriman.
 * Raknya diambil dari Fix Bin material di MM01; material yang belum punya Fix
 * Bin dikumpulkan di satu bin penampung, GI-PENJUALAN.
 *
 * Bila stok di rak itu tidak cukup, sisanya TETAP dikeluarkan dan membuat
 * saldo rak menjadi MINUS. Ini keputusan sadar, bukan kelalaian: barangnya
 * memang sudah berangkat ke pelanggan, jadi menolak posting hanya akan membuat
 * stok sistem lebih tinggi daripada kenyataan. Yang minus itu bermakna
 * "replenishment dari Gudang Besar terlewat sebanyak ini", dan ia impas dengan
 * sendirinya begitu replenishment-nya diposting — saat saldo quant mencapai
 * nol, barisnya lenyap.
 *
 * Perlu dicatat: koreksi diri itu hanya terjadi kalau replenishment-nya BENAR
 * BENAR diposting kemudian. Bila tidak, Gudang Kecil tetap minus dan Gudang
 * Besar tetap kelebihan selamanya — totalnya benar, kedua raknya salah. Karena
 * itu laporan umur saldo minus bukan pelengkap, melainkan bagian dari alat ini.
 *
 * BATCH UNTUK SALDO MINUS
 * -----------------------
 * Saldo minus tetap butuh identitas batch, karena kunci quant adalah
 * (material + bin + batch). Batchnya DITEBAK dari stok FEFO di Gudang Besar —
 * batch yang paling mungkin dipakai saat replenishment nanti. Tebakan yang
 * tepat membuat minus dan barang masuk jatuh di baris yang sama sehingga
 * benar-benar impas. Tebakan yang meleset menyisakan dua baris yang bisa
 * dirapikan lewat MIGO Ubah Batch (309).
 *
 * FEFO
 * ----
 * Pengambilan dari rak urut kedaluwarsa terdekat lebih dulu. Bila tanggalnya
 * sama, quant terkecil didahulukan supaya sisa pecahan cepat habis.
 */

/** Berapa material yang diproses dalam satu transaksi. */
export const SALES_GI_CHUNK = 40;

/**
 * Batas waktu satu potongan. Fungsi serverless Vercel dihentikan paksa pada 60
 * detik; berhenti sendiri pada 40 memberi ruang untuk menutup catatan dan
 * mengembalikan jawaban. Potongan yang dihentikan paksa bukan sekadar gagal —
 * ia gagal tanpa memberi tahu berapa yang sudah keluar.
 */
export const SALES_GI_DEADLINE_MS = 40_000;


export interface SalesGiLineInput {
  /** kode SKU apa adanya dari sumber */
  sku: string;
  qty: number;
  order_count?: number;
}

/**
 * Bin penampung GI penjualan — dibuat sekali saat pertama dibutuhkan.
 *
 * Dibuat saat dipakai, bukan lewat seed, supaya pemasangan yang tidak memakai
 * GI penjualan tidak punya bin menganggur di daftar LS01N.
 */
export async function getSalesGiBin(tx: Prisma.TransactionClient) {
  const existing = await tx.storageBin.findUnique({ where: { bin_code: SALES_GI_BIN } });
  if (existing) return existing;

  const zone = await tx.zone.findUnique({ where: { zone_code: SALES_GI_ZONE } });
  if (!zone)
    await tx.zone.create({
      data: {
        zone_code: SALES_GI_ZONE,
        label: 'Gudang Kecil — Penampung GI Penjualan',
        zone_group: 'KECIL',
        bin_pattern: SALES_GI_BIN,
        is_interim: false,
        is_pick: false,
      },
    });

  // `is_pick` adalah properti ZONA, bukan bin — pick face ditentukan per zona
  // dan dibaca ZRF08 dari sana. Zona GK-GI sengaja bukan pick face: ia
  // penampung saldo minus, bukan tempat orang mengambil barang.
  return tx.storageBin.create({
    data: {
      bin_code: SALES_GI_BIN,
      zone_id: SALES_GI_ZONE,
      status: BinStatus.EMPTY,
      is_interim: false,
    },
  });
}

/**
 * Rak tujuan pengurangan stok untuk satu material.
 *
 * Fix Bin dipakai HANYA bila raknya benar-benar ada dan berada di Gudang
 * Kecil. Fix Bin yang menunjuk rak Gudang Besar berarti master-nya belum
 * disesuaikan untuk alur ini; mengurangi stok di sana akan menyembunyikan
 * masalahnya, jadi lebih baik jatuh ke penampung yang terlihat.
 */
async function resolveSalesBin(
  tx: Prisma.TransactionClient,
  fix_bin: string | null
): Promise<{ bin_code: string; from_fix_bin: boolean; note: string | null }> {
  const code = (fix_bin ?? '').trim().toUpperCase();
  if (code) {
    const bin = await tx.storageBin.findUnique({ where: { bin_code: code } });
    if (bin && !bin.is_interim) {
      const zone = await tx.zone.findUnique({ where: { zone_code: bin.zone_id } });
      if (zone?.zone_group?.toUpperCase() === 'KECIL')
        return { bin_code: bin.bin_code, from_fix_bin: true, note: null };
      return {
        bin_code: (await getSalesGiBin(tx)).bin_code,
        from_fix_bin: false,
        note: `Fix Bin ${code} bukan Gudang Kecil — dialihkan ke ${SALES_GI_BIN}.`,
      };
    }
    return {
      bin_code: (await getSalesGiBin(tx)).bin_code,
      from_fix_bin: false,
      note: `Fix Bin ${code} tidak ada / bin transit — dialihkan ke ${SALES_GI_BIN}.`,
    };
  }
  return {
    bin_code: (await getSalesGiBin(tx)).bin_code,
    from_fix_bin: false,
    note: `Belum ada Fix Bin di MM01 — dialihkan ke ${SALES_GI_BIN}.`,
  };
}

/** Bin milik zona Gudang Besar — sumber replenishment. */
async function besarBinCodes(tx: Prisma.TransactionClient): Promise<string[]> {
  const zones = await tx.zone.findMany({
    where: { zone_group: 'BESAR' },
    select: { zone_code: true },
  });
  if (zones.length === 0) return [];
  const bins = await tx.storageBin.findMany({
    where: { zone_id: { in: zones.map((z) => z.zone_code) }, is_interim: false },
    select: { bin_code: true },
  });
  return bins.map((b) => b.bin_code);
}

/**
 * Batch yang paling mungkin dipakai saat replenishment berikutnya: FEFO dari
 * Gudang Besar. Null bila material itu tidak punya stok di mana pun.
 */
async function guessReplenishBatch(
  tx: Prisma.TransactionClient,
  material_code: string,
  excludeBin: string
): Promise<string | null> {
  const binsBesar = await besarBinCodes(tx);

  if (binsBesar.length > 0) {
    const qs = await tx.stockWM.findMany({
      where: { material_code, bin_code: { in: binsBesar }, qty: { gt: 0 } },
      select: { batch_number: true, exp_date: true, qty: true },
    });
    const first = fefoSort(qs)[0];
    if (first?.batch_number) return first.batch_number;
  }

  // Tidak ada di Gudang Besar — pakai batch mana pun yang masih hidup, supaya
  // saldo minusnya tetap punya identitas yang bisa dicocokkan nanti.
  const any = await tx.stockWM.findMany({
    where: { material_code, qty: { gt: 0 }, bin_code: { not: excludeBin } },
    select: { batch_number: true, exp_date: true, qty: true },
  });
  return fefoSort(any)[0]?.batch_number ?? null;
}

/**
 * URUTAN FEFO — diurutkan di memori, bukan di database.
 * =============================================================================
 *
 * MySQL/TiDB menaruh NULL PALING DEPAN pada `ORDER BY x ASC`. Artinya
 * `orderBy: { exp_date: 'asc' }` — yang dipakai kode ini sebelumnya — selalu
 * mengambil stok TANPA tanggal kedaluwarsa lebih dulu, mendahului barang yang
 * jelas-jelas akan kedaluwarsa bulan depan. Itu kebalikan dari FEFO, dan tidak
 * terlihat sama sekali dari luar.
 *
 * Stok tanpa tanggal diambil PALING AKHIR: tanggalnya tidak diketahui, jadi
 * tidak ada dasar untuk mendahulukannya — sekaligus membuatnya menonjol sebagai
 * master yang perlu dilengkapi, bukan diam-diam terpakai duluan.
 *
 * Urutan lengkapnya: ada-tanggal dulu (ED terdekat), lalu quant terkecil supaya
 * pecahan cepat habis, lalu kode material dan batch sebagai pemutus supaya dua
 * kali jalan menghasilkan urutan yang sama persis.
 */
function fefoSort<T extends { exp_date: Date | null; qty: number; material_code?: string; batch_number: string | null }>(
  rows: T[]
): T[] {
  return [...rows].sort((a, b) => {
    const an = a.exp_date === null;
    const bn = b.exp_date === null;
    if (an !== bn) return an ? 1 : -1;
    if (a.exp_date && b.exp_date && a.exp_date.getTime() !== b.exp_date.getTime())
      return a.exp_date.getTime() - b.exp_date.getTime();
    if (a.qty !== b.qty) return a.qty - b.qty;
    const am = a.material_code ?? '';
    const bm = b.material_code ?? '';
    if (am !== bm) return am < bm ? -1 : 1;
    const ab = a.batch_number ?? '';
    const bb = b.batch_number ?? '';
    return ab < bb ? -1 : ab > bb ? 1 : 0;
  });
}

/** Kolom material yang dibutuhkan alur GI penjualan. */
const MATERIAL_PICK = {
  material_code: true,
  description: true,
  uom: true,
  is_batch_managed: true,
  fix_bin: true,
  barcode_bpom: true,
  barcode_produk: true,
} as const;

export type SalesMaterial = {
  material_code: string;
  description: string;
  uom: string;
  is_batch_managed: boolean;
  fix_bin: string | null;
  barcode_bpom: string | null;
  barcode_produk: string | null;
};

export interface SalesGroup {
  /** semua material yang dianggap satu barang untuk keperluan penjualan */
  members: SalesMaterial[];
  /** cara SKU itu dikenali — ditampilkan di log supaya bisa ditelusuri */
  matched_by: 'MATERIAL' | 'ALIAS' | 'DESCRIPTION' | 'KODE_OCS' | null;
  error: string | null;
}

/**
 * Terjemahkan SKU dari sumber penjualan menjadi SATU ATAU BEBERAPA material.
 * =============================================================================
 *
 * OCS memelihara beberapa SKU untuk barang yang sama. Barcode master box-nya
 * berbeda (dan kadang barcode produk serta POM NA-nya juga), tetapi
 * deskripsinya satu — dan deskripsi itulah satu-satunya kunci yang dikirim
 * bersama data penjualan. Itu bukan master yang kotor, melainkan bentuk master
 * yang memang dipelihara begitu; WMS tidak boleh memaksa penggabungannya.
 *
 * Karena itu fungsi ini mengembalikan KELOMPOK, bukan satu material. Yang
 * memutuskan SKU mana yang benar-benar keluar bukan fungsi ini melainkan FEFO
 * atas stok nyata di rak — lihat postSalesGiChunk.
 *
 * URUTANNYA, dari yang paling pasti ke yang paling longgar:
 *
 *   1. kode material / alias — identitas yang memang dirancang unik. Bila
 *      sumbernya mengirim kode material, TIDAK ada pengelompokan: yang diminta
 *      sudah spesifik.
 *   2. DESKRIPSI material — kunci yang dipakai OCS. Boleh menunjuk beberapa
 *      material sekaligus; itu justru kasus yang dilayani di sini.
 *   3. kolom kode_ocs — dipertahankan untuk pemasangan yang sudah mengisinya.
 *
 * PENGELOMPOKAN INI HANYA UNTUK PENJUALAN. MIGO, Transfer Requirement, scan
 * PDT, dan replenishment tetap ketat satu kode: di sana orang memindai barcode
 * tertentu, dan mengambilkan SKU lain berarti mengambilkan barang yang salah.
 */
export async function resolveSalesGroup(
  tx: Prisma.TransactionClient,
  sku: string
): Promise<SalesGroup> {
  const raw = String(sku ?? '').trim();
  if (!raw) return { members: [], matched_by: null, error: 'SKU kosong.' };

  const direct = await resolveMaterialCode(tx, raw);
  if (direct) {
    const m = await tx.material.findUnique({
      where: { material_code: direct.material_code },
      select: MATERIAL_PICK,
    });
    if (m)
      return {
        members: [m],
        matched_by: direct.redirected ? 'ALIAS' : 'MATERIAL',
        error: null,
      };
  }

  // Collation database berakhiran _ci, jadi '=' sudah mengabaikan besar-kecil
  // huruf tanpa perlu perlakuan khusus.
  const byDesc = await tx.material.findMany({
    where: { description: raw, is_active: true },
    select: MATERIAL_PICK,
    orderBy: { material_code: 'asc' },
    take: 20,
  });
  if (byDesc.length > 0) return checkGroup(byDesc, 'DESCRIPTION', raw);

  const byOcs = await tx.material.findMany({
    where: { kode_ocs: raw.toUpperCase(), is_active: true },
    select: MATERIAL_PICK,
    orderBy: { material_code: 'asc' },
    take: 20,
  });
  if (byOcs.length > 0) return checkGroup(byOcs, 'KODE_OCS', raw);

  return {
    members: [],
    matched_by: null,
    error: `"${raw}" tidak cocok dengan kode material, deskripsi, kode OCS, maupun alias mana pun.`,
  };
}

/**
 * Satu kelompok hanya sah bila anggotanya benar-benar barang yang sama untuk
 * keperluan hitung-hitungan: SATUAN yang sama dan pengelolaan batch yang sama.
 *
 * Beda satuan dalam satu deskripsi bukan duplikasi OCS yang wajar melainkan
 * salah master — menjumlahkan PC dengan CTN menghasilkan angka yang salah, dan
 * tidak ada satu pun laporan yang akan menunjukkan kekeliruannya. Lebih baik
 * barisnya ditolak dengan sebab yang jelas.
 */
function checkGroup(
  members: SalesMaterial[],
  matched_by: 'DESCRIPTION' | 'KODE_OCS',
  raw: string
): SalesGroup {
  if (members.length > 1) {
    const uoms = [...new Set(members.map((m) => m.uom.toUpperCase()))];
    if (uoms.length > 1)
      return {
        members: [],
        matched_by,
        error:
          `"${raw}" dipakai ${members.length} material dengan SATUAN berbeda (${uoms.join(', ')}). ` +
          `Tidak bisa dijumlahkan — samakan UoM-nya di MM01.`,
      };
    const batchFlags = [...new Set(members.map((m) => m.is_batch_managed))];
    if (batchFlags.length > 1)
      return {
        members: [],
        matched_by,
        error:
          `"${raw}" dipakai ${members.length} material dengan pengelolaan batch berbeda ` +
          `(${members.map((m) => `${m.material_code}=${m.is_batch_managed ? 'batch' : 'non-batch'}`).join(', ')}). ` +
          `Samakan dulu di MM01.`,
      };
  }
  return { members, matched_by, error: null };
}

/**
 * SKU penanggung saldo minus.
 *
 * Pengambilan nyata selalu tercatat atas material aslinya, jadi telusur POM NA
 * tetap utuh. Yang tidak punya asal-usul hanyalah kekurangannya — barangnya
 * memang tidak ada di mana pun, jadi kodenya harus dipilih.
 *
 * Pilihannya: anggota yang fix bin Gudang Kecil-nya sah, lalu yang stok Gudang
 * Besar-nya paling banyak — yaitu yang paling mungkin turun saat replenishment
 * berikutnya. Itu penting karena saldo minus hanya impas bila barang masuk
 * jatuh pada kode dan rak yang sama.
 */
async function pickAnchor(
  tx: Prisma.TransactionClient,
  members: SalesMaterial[],
  targets: Map<string, { bin_code: string; from_fix_bin: boolean }>
): Promise<SalesMaterial> {
  if (members.length === 1) return members[0];

  const withFixBin = members.filter((m) => targets.get(m.material_code)?.from_fix_bin);
  const pool = withFixBin.length > 0 ? withFixBin : members;
  if (pool.length === 1) return pool[0];

  const binsBesar = await besarBinCodes(tx);
  let best = pool[0];
  let bestQty = -1;
  for (const m of pool) {
    const agg = binsBesar.length
      ? await tx.stockWM.aggregate({
          _sum: { qty: true },
          where: { material_code: m.material_code, bin_code: { in: binsBesar }, qty: { gt: 0 } },
        })
      : null;
    const q = agg?._sum.qty ?? 0;
    // Seri diputus kode material terkecil supaya hasilnya tidak bergantung pada
    // urutan baris yang dikembalikan database.
    if (q > bestQty) {
      best = m;
      bestQty = q;
    }
  }
  return best;
}

export interface SalesGiValidateResult {
  checked: number;
  /** SKU yang tidak cocok dengan material mana pun — harus dibetulkan */
  unknown: number;
  /** deskripsi yang dipakai lebih dari satu material — normal, hanya informasi */
  grouped: number;
  /** kelompok yang anggotanya beda satuan / beda pengelolaan batch — harus dibetulkan */
  conflict: number;
  /** line_no berikutnya bila pemeriksaan berhenti karena batas waktu; null bila habis */
  next_line: number | null;
}

/**
 * Periksa seluruh baris TANPA menyentuh stok.
 *
 * Untuk backfill 14 hari ini bukan kemewahan melainkan syarat: SKU yang tidak
 * dikenali baru ketahuan saat posting, dan memperbaikinya setelah separuh hari
 * terlanjur keluar jauh lebih repot daripada memperbaikinya sebelum apa pun
 * bergerak.
 *
 * Sejak GI penjualan membaca per DESKRIPSI, layar ini punya tugas kedua yang
 * sama pentingnya: menampilkan siapa saja anggota tiap kelompok. Pengelompokan
 * yang benar tidak bisa dibedakan dari yang keliru hanya dari angkanya — dua
 * barang yang betul-betul berbeda tetapi kebetulan deskripsinya sama akan
 * digabung tanpa suara. Daftar anggota di sini adalah satu-satunya tempat hal
 * itu bisa tertangkap sebelum stok bergerak.
 *
 * SENGAJA TIDAK di dalam transaksi. Pemeriksaan ini tidak menyentuh stok, jadi
 * tidak ada yang perlu dibatalkan bersama-sama — sementara membungkus ratusan
 * material dalam satu transaksi panjang di database production menahan kunci
 * lebih lama daripada manfaatnya, dan berisiko putus di detik ke-55 tanpa
 * menyimpan satu hasil pun.
 */
export async function validateSalesGiRun(
  db: PrismaClient,
  run_id: string,
  opts?: { from_line?: number; deadline_ms?: number }
): Promise<SalesGiValidateResult> {
  const deadline = Date.now() + (opts?.deadline_ms ?? SALES_GI_DEADLINE_MS);

  const items = await db.salesGiItem.findMany({
    where: {
      run_id,
      status: { in: ['PENDING', 'POSTING', 'ERROR'] },
      ...(opts?.from_line ? { line_no: { gte: opts.from_line } } : {}),
    },
    orderBy: { line_no: 'asc' },
  });

  let checked = 0;
  let unknown = 0;
  let grouped = 0;
  let conflict = 0;
  let next_line: number | null = null;

  const cache = new Map<string, SalesGroup>();

  for (const it of items) {
    if (Date.now() > deadline) {
      next_line = it.line_no;
      break;
    }

    const key = it.sku.trim().toUpperCase();
    let g = cache.get(key);
    if (!g) {
      g = await resolveSalesGroup(db, it.sku);
      cache.set(key, g);
    }

    let message: string;
    if (g.error) {
      if (g.members.length === 0 && g.matched_by === null) unknown++;
      else conflict++;
      message = g.error;
    } else if (g.members.length > 1) {
      grouped++;
      message =
        `Dikenali lewat ${g.matched_by} — ${g.members.length} SKU dianggap satu barang: ` +
        g.members
          .map((m) => `${m.material_code}${m.fix_bin ? `@${m.fix_bin}` : ' (tanpa fix bin)'}`)
          .join(', ') +
        `. GI diambil FEFO gabungan dari rak-rak itu.`;
    } else {
      message = `Dikenali lewat ${g.matched_by}.`;
    }

    await db.salesGiItem.update({
      where: { id: it.id },
      data: {
        // Kode yang disimpan di sini hanya penanda sementara agar layar punya
        // sesuatu untuk ditampilkan; kode sebenarnya baru ditentukan FEFO saat
        // posting, dan bisa lebih dari satu.
        material_code: g.members[0]?.material_code ?? null,
        // Status TIDAK diubah menjadi ERROR di sini: baris yang bermasalah
        // tetap PENDING supaya bisa langsung diposting setelah masternya
        // dibetulkan, tanpa perlu langkah reset terpisah.
        message: message.slice(0, 255),
      },
    });
    checked++;
  }

  return { checked, unknown, grouped, conflict, next_line };
}

export interface SalesGiChunkResult {
  processed: number;
  posted: number;
  failed: number;
  remaining: number;
  document_number: string;
  /** true bila potongan dihentikan karena waktu, bukan karena baris habis */
  stopped_early: boolean;
}

/**
 * Proses SEBAGIAN baris dari satu run. Dipanggil berulang sampai `remaining`
 * nol.
 *
 * SATU TRANSAKSI PER MATERIAL — bukan satu transaksi untuk seluruh potongan.
 * =============================================================================
 * Ini bukan pilihan gaya. Satu material bisa menghasilkan beberapa pergerakan
 * (FEFO dari dua batch, ditambah sisa yang jadi saldo minus). Bila semuanya
 * berada dalam satu transaksi besar bersama 39 material lain, kegagalan pada
 * pergerakan KEDUA sebuah material meninggalkan pergerakan PERTAMA-nya tetap
 * tercatat — sementara barisnya ditandai ERROR. Menjalankan ulang baris ERROR
 * itu kemudian mengeluarkan stok yang sama untuk kedua kalinya.
 *
 * Dengan satu transaksi per material, kegagalan membatalkan seluruh pergerakan
 * material itu dan tidak menyentuh material lain. Karena itu kalimat di
 * /reset-failed benar apa adanya: baris ERROR tidak pernah menyentuh stok.
 *
 * Konsekuensinya harus diakui: potongan yang terputus di tengah meninggalkan
 * sebagian material sudah keluar dan sebagian belum. Itu memang yang
 * diinginkan — yang sudah keluar berstatus OK dan tidak akan digarap lagi,
 * yang belum tetap PENDING dan pasti kebagian pada panggilan berikutnya.
 *
 * Dokumen materialnya tetap SATU untuk seluruh hari; nomor barisnya menyambung.
 *
 * JANGAN membungkus pemanggilan ini dengan prisma.$transaction().
 */
export async function postSalesGiChunk(
  db: PrismaClient,
  args: { run_id: string; user_id: string; limit?: number; deadline_ms?: number }
): Promise<SalesGiChunkResult> {
  const deadline = Date.now() + (args.deadline_ms ?? SALES_GI_DEADLINE_MS);

  const run = await db.salesGiRun.findUnique({ where: { id: args.run_id } });
  if (!run) throw new HttpError(404, 'Proses GI penjualan tidak ditemukan.');
  if (run.status === SalesGiStatus.DONE)
    throw new HttpError(
      400,
      `GI penjualan tanggal ${run.sales_date.toISOString().slice(0, 10)} sudah selesai diposting.`
    );

  /**
   * Nomor dokumen diambil sekali lalu DISIMPAN sebelum baris mana pun
   * diproses. Bila ia hanya dipegang di memori, potongan kedua akan meminta
   * nomor baru dan penjualan satu hari terpecah menjadi dua dokumen.
   */
  let doc = run.document_number;
  if (!doc) {
    doc = await db.$transaction(async (tx) => {
      const fresh = await tx.salesGiRun.findUniqueOrThrow({ where: { id: run.id } });
      if (fresh.document_number) return fresh.document_number;
      const fresh_doc = await nextDocNumber(tx, 'MATDOC');
      await tx.salesGiRun.update({
        where: { id: run.id },
        data: {
          document_number: fresh_doc,
          started_at: fresh.started_at ?? new Date(),
          status: SalesGiStatus.RUNNING,
        },
      });
      return fresh_doc;
    });
  } else if (!run.started_at) {
    await db.salesGiRun.update({
      where: { id: run.id },
      data: { started_at: new Date(), status: SalesGiStatus.RUNNING },
    });
  }

  /**
   * Dibekukan ke const supaya penyempitan tipenya tetap berlaku di dalam
   * transaksi per baris — TypeScript melepas penyempitan pada `let` yang
   * ditangkap closure.
   */
  const document_number: string = doc;

  /**
   * POSTING ikut diambil, bukan hanya PENDING.
   *
   * POSTING yang masih tertinggal hanya mungkin berasal dari transaksi yang
   * BATAL — kalau transaksinya berhasil, statusnya pasti sudah OK atau ERROR
   * dalam transaksi yang sama. Transaksi yang batal tidak mengeluarkan stok apa
   * pun, jadi menggarapnya lagi bukan pengulangan.
   *
   * Tanpa ini, satu baris POSTING yang tersangkut akan membuat `remaining`
   * tidak pernah nol sementara tidak ada yang bisa mengambilnya: layar berputar
   * tanpa henti.
   */
  const candidates = await db.salesGiItem.findMany({
    where: { run_id: run.id, status: { in: ['PENDING', 'POSTING'] } },
    orderBy: { line_no: 'asc' },
    take: args.limit ?? SALES_GI_CHUNK,
  });

  let processed = 0;
  let posted = 0;
  let failed = 0;
  let stopped_early = false;

  for (const item of candidates) {
    if (Date.now() > deadline) {
      stopped_early = true;
      break;
    }

    try {
      const done = await db.$transaction(
        async (tx) => {
          /**
           * KLAIM baris sebagai langkah pertama di dalam transaksi.
           *
           * `updateMany` dengan syarat pada status bersifat atomik: bila dua
           * proses berlomba, yang kedua menunggu kunci baris lalu mengevaluasi
           * ulang syaratnya terhadap versi terbaru. Bila yang pertama sudah
           * menandainya, yang kedua mencocokkan NOL baris dan melewatinya.
           *
           * Karena klaim dan posting berada dalam transaksi yang sama, tidak
           * ada celah di antaranya — dan bila postingnya batal, klaimnya ikut
           * batal sehingga barisnya kembali bisa digarap.
           */
          const claim = await tx.salesGiItem.updateMany({
            where: { id: item.id, status: { in: ['PENDING', 'POSTING'] } },
            data: { status: 'POSTING' },
          });
          if (claim.count !== 1) return null;

          const group = await resolveSalesGroup(tx, item.sku);
          if (group.error) throw new Error(group.error);
          const members = group.members;
          if (members.length === 0) throw new Error('SKU tidak dikenali.');
          const byCode = new Map(members.map((m) => [m.material_code, m]));

          const qty = Math.trunc(item.qty);
          if (qty <= 0) throw new Error('Quantity harus lebih besar dari nol.');

          /* ---------- rak tujuan tiap anggota kelompok ---------- */
          const targets = new Map<
            string,
            { bin_code: string; from_fix_bin: boolean; note: string | null }
          >();
          for (const m of members) targets.set(m.material_code, await resolveSalesBin(tx, m.fix_bin));

          /* ---------- kumpulkan dulu, baru FEFO ---------- */
          /**
           * Stok seluruh anggota kelompok dijadikan SATU kolam sebelum
           * diurutkan. Inilah inti perubahannya: yang memutuskan SKU mana yang
           * keluar bukan tebakan atas kode, melainkan tanggal kedaluwarsa
           * barang yang benar-benar ada di rak.
           *
           * Setiap pengambilan tetap tercatat atas material aslinya, jadi
           * dokumen materialnya tetap menunjukkan POM NA mana yang keluar —
           * penggabungan ini terjadi saat memilih, bukan saat mencatat.
           */
          const pool: {
            material_code: string;
            bin_code: string;
            batch_number: string | null;
            exp_date: Date | null;
            qty: number;
          }[] = [];
          for (const m of members) {
            const bin = targets.get(m.material_code)!.bin_code;
            const qs = await tx.stockWM.findMany({
              where: { material_code: m.material_code, bin_code: bin, qty: { gt: 0 } },
              select: {
                material_code: true,
                bin_code: true,
                batch_number: true,
                exp_date: true,
                qty: true,
              },
            });
            pool.push(...qs);
          }

          const picks: {
            material_code: string;
            bin_code: string;
            batch: string | null;
            take: number;
          }[] = [];
          let rest = qty;
          for (const q of fefoSort(pool)) {
            if (rest <= 0) break;
            const take = Math.min(rest, q.qty);
            picks.push({
              material_code: q.material_code,
              bin_code: q.bin_code,
              batch: q.batch_number,
              take,
            });
            rest -= take;
          }

          /* ---------- sisanya jadi saldo minus, pada SKU penanggung ---------- */
          const anchor = await pickAnchor(tx, members, targets);
          const anchorTarget = targets.get(anchor.material_code)!;

          let shortBatch: string | null = null;
          if (rest > 0) {
            shortBatch = anchor.is_batch_managed
              ? await guessReplenishBatch(tx, anchor.material_code, anchorTarget.bin_code)
              : null;
            picks.push({
              material_code: anchor.material_code,
              bin_code: anchorTarget.bin_code,
              batch: shortBatch,
              take: rest,
            });
          }

          /**
           * Nomor baris dibaca ulang di dalam transaksi ini, bukan dihitung di
           * luar. Transaksi yang batal mengembalikan barisnya, jadi nomor yang
           * dihitung di luar akan menyisakan lubang — dan lebih buruk, dua
           * transaksi yang berdekatan bisa memilih nomor yang sama.
           */
          const last = await tx.migoLog.findFirst({
            where: { document_number },
            orderBy: { line_no: 'desc' },
            select: { line_no: true },
          });
          let line_no = last?.line_no ?? 0;

          for (const p of picks) {
            await applyStockWM(
              tx,
              { material_code: p.material_code, bin_code: p.bin_code, batch_number: p.batch },
              -p.take,
              undefined,
              // Satu-satunya tempat saldo negatif diizinkan di seluruh aplikasi.
              { allowNegative: true }
            );
            // Level IM harus mengikuti level bin. Bila hanya salah satunya
            // boleh minus, MB52 dan LX02 akan menampilkan angka berbeda.
            await applyStockIM(tx, p.material_code, -p.take, { allowNegative: true });

            await tx.migoLog.create({
              data: {
                document_number,
                line_no: ++line_no,
                movement_type: MovementType.GI_601_SALES,
                material_code: p.material_code,
                source_bin: p.bin_code,
                batch_number: p.batch,
                qty: p.take,
                uom: byCode.get(p.material_code)?.uom ?? anchor.uom,
                reference: `SALES ${run.sales_date.toISOString().slice(0, 10)}`,
                remarks:
                  item.sku === p.material_code
                    ? `GI penjualan (${run.source})`
                    : `GI penjualan (${run.source}) — SKU ${item.sku}`,
                doc_date: run.sales_date,
                user_id: args.user_id,
              },
            });
          }

          // Satu baris penjualan kini bisa menyentuh beberapa rak sekaligus.
          for (const bin of new Set(picks.map((p) => p.bin_code)))
            await refreshBinStatus(tx, bin);

          const detail = picks
            .map((p) => `${p.material_code}/${p.bin_code}/${p.batch ?? '(tanpa batch)'}:${p.take}`)
            .join(', ');

          const usedCodes = new Set(picks.map((p) => p.material_code));
          const notes = [...usedCodes]
            .map((c) => targets.get(c)?.note)
            .filter((n): n is string => Boolean(n));

          await tx.salesGiItem.update({
            where: { id: item.id },
            data: {
              // Kode yang disimpan adalah SKU penanggung. Rincian sebenarnya —
              // termasuk SKU lain yang ikut terambil — ada di kolom `picked`.
              material_code: anchor.material_code,
              status: 'OK',
              short_qty: rest,
              picked: detail.slice(0, 500),
              message:
                [
                  members.length > 1
                    ? `Gabungan ${members.length} SKU (${members.map((m) => m.material_code).join(', ')}).`
                    : null,
                  ...notes,
                  rest > 0
                    ? `Kurang ${rest} — minus di ${anchor.material_code}` +
                      `${shortBatch ? ` batch ${shortBatch}` : ''}.`
                    : null,
                ]
                  .filter(Boolean)
                  .join(' ')
                  .slice(0, 255) || null,
            },
          });

          /**
           * Hitungan run dinaikkan DI DALAM transaksi yang sama dengan stoknya.
           * Bila ia dinaikkan di luar, satu transaksi yang batal setelah stok
           * keluar — atau satu fungsi yang dihentikan di antara keduanya —
           * membuat angka di ZGI02 tidak lagi menjelaskan isi dokumennya.
           */
          await tx.salesGiRun.update({
            where: { id: run.id },
            data: {
              posted_lines: { increment: 1 },
              posted_qty: { increment: qty },
              short_qty: { increment: rest },
            },
          });

          return true;
        },
        { timeout: 20000, maxWait: 10000 }
      );

      if (done === null) continue; // diklaim proses lain
      processed++;
      posted++;
    } catch (e) {
      /**
       * SEBELUM menandai gagal, tanyakan pada database apa yang sebenarnya
       * terjadi.
       *
       * Ada satu keadaan yang tidak bisa dibedakan dari sisi kode: koneksi
       * putus atau habis waktu TEPAT saat commit. Klien menerima kesalahan,
       * padahal transaksinya bisa saja sudah tersimpan. Menandai baris itu
       * ERROR akan menimpa status OK yang sah — dan tombol "ulangi yang gagal"
       * kemudian mengeluarkan stoknya untuk kedua kali.
       *
       * Statusnya sendiri adalah jawabannya: ia ditulis di dalam transaksi yang
       * sama dengan pergerakan stoknya. OK berarti commit-nya berhasil,
       * apa pun yang dilihat klien.
       */
      let actual: string | null;
      try {
        const fresh = await db.salesGiItem.findUnique({
          where: { id: item.id },
          select: { status: true },
        });
        actual = fresh?.status ?? null;
      } catch {
        actual = 'UNKNOWN';
      }

      if (actual === 'OK') {
        processed++;
        posted++;
        continue;
      }
      if (actual === 'UNKNOWN') {
        // Tidak tahu apa yang terjadi, jadi tidak menulis apa pun. Baris ini
        // dibiarkan sebagaimana adanya di database; menebak di sini justru
        // yang berbahaya.
        continue;
      }

      /**
       * Penandaan ERROR sengaja berada DI LUAR transaksi yang batal. Menulisnya
       * di dalam transaksi yang sudah gagal tidak akan pernah tersimpan — dan
       * barisnya akan tertinggal berstatus POSTING tanpa penjelasan.
       */
      processed++;
      failed++;
      const message = (e instanceof Error ? e.message : 'Kesalahan tidak dikenal.').slice(0, 255);
      try {
        await db.$transaction(async (tx) => {
          await tx.salesGiItem.update({
            where: { id: item.id },
            data: { status: 'ERROR', message },
          });
          await tx.salesGiRun.update({
            where: { id: run.id },
            data: { failed_lines: { increment: 1 } },
          });
        });
      } catch {
        // Database benar-benar tidak bisa ditulis. Barisnya tetap PENDING /
        // POSTING sehingga panggilan berikutnya menggarapnya lagi — jauh lebih
        // baik daripada menghentikan seluruh potongan karena satu baris.
        failed--;
        processed--;
      }
    }
  }

  const remaining = await db.salesGiItem.count({
    where: { run_id: run.id, status: { in: ['PENDING', 'POSTING'] } },
  });

  await db.salesGiRun.update({
    where: { id: run.id },
    data: {
      status: remaining > 0 ? SalesGiStatus.RUNNING : SalesGiStatus.DONE,
      ...(remaining === 0 ? { finished_at: new Date() } : {}),
    },
  });

  return { processed, posted, failed, remaining, document_number, stopped_early };
}

/** Status akhir dihitung dari hasil seluruh baris, bukan dari baris terakhir. */
export async function finalizeSalesGiRun(tx: Prisma.TransactionClient, run_id: string) {
  const run = await tx.salesGiRun.findUniqueOrThrow({ where: { id: run_id } });
  const status =
    run.failed_lines === 0
      ? SalesGiStatus.DONE
      : run.posted_lines === 0
        ? SalesGiStatus.FAILED
        : SalesGiStatus.PARTIAL;

  await tx.salesGiRun.update({
    where: { id: run_id },
    data: { status, finished_at: new Date() },
  });
  return status;
}
