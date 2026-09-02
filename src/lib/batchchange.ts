import { Prisma, MovementType } from '@prisma/client';
import { HttpError } from './auth';
import { nextDocNumber } from './docnum';
import { applyStockWM, refreshBinStatus, getMaterialOrThrow } from './wms';

/**
 * UBAH NOMOR BATCH (SAP 309 — transfer posting batch ke batch)
 * =============================================================================
 *
 * KENAPA 309, BUKAN MOVEMENT BARU
 * -------------------------------
 * Yang terjadi secara fisik saat batch dikoreksi adalah: sejumlah stok KELUAR
 * dari (material, batch lama, bin) dan MASUK ke (material, batch baru, bin yang
 * sama). Barangnya tidak bergerak, jumlah totalnya tidak berubah, hanya
 * identitas batchnya. Itu definisi transfer posting — dan SAP memakai 309 untuk
 * itu, baik saat materialnya yang berganti maupun hanya batchnya.
 *
 * Movement 309 sudah ada di sistem ini sejak penggabungan SKU kembar (ZMATDUP)
 * dan bentuk postingnya identik: dua baris pada satu material document, sisi
 * keluar dan sisi masuk. Jadi tidak ada movement type baru yang perlu dibuat,
 * dan MB51 menampilkan koreksi batch dengan bahasa yang sama seperti koreksi
 * material.
 *
 * KENAPA BUKAN 701/702
 * --------------------
 * Menu opname memang mengubah batch lewat 701/702, dan di sana itu benar:
 * konteksnya perhitungan fisik, jadi "batch yang ditemukan berbeda dari buku"
 * memang selisih inventarisasi. Di luar opname, memakai 701/702 untuk koreksi
 * salah ketik akan mencemari statistik selisih opname — seolah gudang punya
 * masalah akurasi hitungan padahal yang terjadi hanyalah nomor yang salah
 * diketik saat penerimaan.
 *
 * TIDAK MENYENTUH STOCK IM
 * ------------------------
 * Materialnya sama di kedua sisi, jadi total stok level IM tidak berubah sama
 * sekali. Memanggil applyStockIM(-qty) lalu (+qty) memang berjumlah nol, tetapi
 * itu dua penulisan ke baris yang sama hanya untuk kembali ke angka semula —
 * pemborosan yang nyata di database yang ditagih per operasi.
 *
 * PEMBATALAN
 * ----------
 * 309 sengaja tidak punya pasangan movement pembatalan. Membalikkan koreksi
 * batch dilakukan dengan koreksi ke arah sebaliknya, sehingga kedua sisinya
 * selalu seimbang dan tidak ada dokumen yang menggantung setengah jalan.
 */

export interface BatchChangeInput {
  material_code: string;
  bin_code: string;
  batch_from: string;
  batch_to: string;
  qty: number;
  /** tanggal untuk batch BARU; boleh kosong bila batch tujuan sudah ada */
  mfg_date?: Date | null;
  exp_date?: Date | null;
  remarks?: string | null;
}

export interface BatchChangeCheck {
  line: number;
  material_code: string;
  description: string;
  uom: string;
  bin_code: string;
  batch_from: string;
  batch_to: string;
  qty: number;
  /** stok yang benar-benar ada pada material+bin+batch lama */
  available: number;
  /** true bila batch tujuan sudah punya quant di bin yang sama (akan digabung) */
  merges_into_existing: boolean;
  status: 'OK' | 'ERROR';
  message?: string;
}

/**
 * Periksa seluruh baris TANPA memposting apa pun.
 *
 * Dipakai layar sebelum konfirmasi. Alasannya sama seperti simulasi di ZREPL:
 * posting berjalan dalam satu transaksi, jadi baris pertama yang bermasalah
 * membatalkan semuanya dan hanya satu pesan yang sampai ke operator. Untuk
 * dokumen berisi belasan baris itu berarti memperbaiki satu kesalahan,
 * posting lagi, lalu bertemu kesalahan berikutnya — berulang-ulang.
 *
 * Pemeriksaan di sini KENYAMANAN, bukan pengganti pemeriksaan saat posting:
 * stok bisa berubah di sela keduanya, dan posting memeriksa ulang segalanya.
 */
export async function checkBatchChange(
  tx: Prisma.TransactionClient,
  items: BatchChangeInput[]
): Promise<BatchChangeCheck[]> {
  const out: BatchChangeCheck[] = [];

  /**
   * Beberapa baris boleh mengambil dari quant yang sama. Sisanya dihitung
   * berjalan supaya dua baris yang sama-sama mengambil 8 dari stok 10
   * ketahuan di sini, bukan baru gagal saat posting.
   */
  const consumed = new Map<string, number>();
  const key = (m: string, b: string, batch: string) => `${m}|${b}|${batch}`;

  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    const line = i + 1;
    const bin_code = it.bin_code.trim().toUpperCase();
    const batch_from = it.batch_from.trim().toUpperCase();
    const batch_to = it.batch_to.trim().toUpperCase();

    const base: BatchChangeCheck = {
      line,
      material_code: it.material_code.trim().toUpperCase(),
      description: '',
      uom: 'PC',
      bin_code,
      batch_from,
      batch_to,
      qty: it.qty,
      available: 0,
      merges_into_existing: false,
      status: 'OK',
    };

    try {
      const material = await getMaterialOrThrow(tx, it.material_code);
      base.material_code = material.material_code;
      base.description = material.description;
      base.uom = material.uom;

      if (!material.is_batch_managed)
        throw new Error(
          `Material ${material.material_code} tidak dikelola per batch — tidak ada batch yang bisa diubah.`
        );
      if (!bin_code) throw new Error('Storage bin wajib diisi.');
      if (!batch_from) throw new Error('Batch lama wajib diisi.');
      if (!batch_to) throw new Error('Batch baru wajib diisi.');
      if (batch_from === batch_to) throw new Error('Batch lama dan batch baru sama — tidak ada yang berubah.');

      const qty = Math.trunc(it.qty);
      if (!Number.isFinite(qty) || qty <= 0) throw new Error('Quantity harus lebih besar dari nol.');

      const bin = await tx.storageBin.findUnique({ where: { bin_code } });
      if (!bin) throw new Error(`Storage bin ${bin_code} tidak ada (LS01N).`);
      // Bin BLOCKED sengaja tetap diizinkan: koreksi batch tidak memindahkan
      // barang ke mana pun. Menolaknya justru membuat data yang salah di bin
      // terblokir tidak bisa diperbaiki sama sekali.
      if (bin.is_interim)
        throw new Error(`${bin_code} adalah bin transit — selesaikan put-away/picking-nya lebih dulu.`);

      const k = key(material.material_code, bin_code, batch_from);
      const quant = await tx.stockWM.findFirst({
        where: { material_code: material.material_code, bin_code, batch_number: batch_from },
      });
      const available = (quant?.qty ?? 0) - (consumed.get(k) ?? 0);
      base.available = available;

      if (available < qty)
        throw new Error(
          `Stok batch ${batch_from} di ${bin_code} hanya ${available}, diminta ${qty}.`
        );

      const target = await tx.stockWM.findFirst({
        where: { material_code: material.material_code, bin_code, batch_number: batch_to },
      });
      base.merges_into_existing = !!target;

      consumed.set(k, (consumed.get(k) ?? 0) + qty);
      base.qty = qty;
    } catch (e) {
      base.status = 'ERROR';
      base.message = e instanceof Error ? e.message : 'Kesalahan tidak dikenal.';
    }

    out.push(base);
  }

  return out;
}

export interface BatchChangeResult {
  document_number: string;
  lines: {
    line: number;
    material_code: string;
    bin_code: string;
    batch_from: string;
    batch_to: string;
    qty: number;
  }[];
}

/** Posting koreksi batch. WAJIB dipanggil di dalam prisma.$transaction(). */
export async function postBatchChange(
  tx: Prisma.TransactionClient,
  args: {
    items: BatchChangeInput[];
    doc_date?: Date | null;
    reference?: string | null;
    remarks?: string | null;
    user_id: string;
    via_pdt?: boolean;
  }
): Promise<BatchChangeResult> {
  if (args.items.length === 0) throw new HttpError(400, 'Tidak ada baris yang diisi.');

  // Diperiksa ULANG di dalam transaksi, bukan mempercayai hasil simulasi layar.
  const checks = await checkBatchChange(tx, args.items);
  const bad = checks.filter((c) => c.status === 'ERROR');
  if (bad.length > 0)
    throw new HttpError(400, bad.map((b) => `Baris ${b.line}: ${b.message}`).join(' '));

  const document_number = await nextDocNumber(tx, 'MATDOC');
  const doc_date = args.doc_date ?? new Date();
  const lines: BatchChangeResult['lines'] = [];
  let line_no = 0;

  for (let i = 0; i < args.items.length; i++) {
    const it = args.items[i];
    // Kode & satuan diambil dari hasil pemeriksaan di atas, yang sudah
    // menerjemahkan alias dan memvalidasi materialnya — tidak perlu menanyakan
    // master untuk kedua kalinya pada baris yang sama.
    const c = checks[i];

    const src = await tx.stockWM.findFirst({
      where: {
        material_code: c.material_code,
        bin_code: c.bin_code,
        batch_number: c.batch_from,
      },
    });
    if (!src) throw new HttpError(400, `Baris ${c.line}: quant batch ${c.batch_from} sudah tidak ada.`);

    // Keluar dari batch lama
    await applyStockWM(
      tx,
      { material_code: c.material_code, bin_code: c.bin_code, batch_number: c.batch_from },
      -c.qty
    );

    /**
     * Masuk ke batch baru.
     *
     * Tanggal yang diisi operator MENANG atas tanggal quant lama: seluruh
     * gunanya layar ini adalah memperbaiki identitas batch, dan tanggal yang
     * ikut salah harus bisa ikut dibetulkan. Bila operator mengosongkannya,
     * tanggal quant lama diwarisi supaya FEFO tidak mendadak kehilangan acuan.
     *
     * gr_date sengaja diwarisi apa adanya: tanggal barang diterima tidak
     * berubah hanya karena nomor batchnya dikoreksi.
     */
    await applyStockWM(
      tx,
      { material_code: c.material_code, bin_code: c.bin_code, batch_number: c.batch_to },
      c.qty,
      {
        mfg_date: it.mfg_date ?? src.mfg_date,
        exp_date: it.exp_date ?? src.exp_date,
        gr_date: src.gr_date,
      }
    );

    await refreshBinStatus(tx, c.bin_code);

    const remarks =
      it.remarks?.trim() ||
      args.remarks?.trim() ||
      `Ubah batch ${c.batch_from} -> ${c.batch_to}`;

    await tx.migoLog.create({
      data: {
        document_number,
        line_no: ++line_no,
        movement_type: MovementType.TRM_309_OUT,
        material_code: c.material_code,
        source_bin: c.bin_code,
        batch_number: c.batch_from,
        qty: c.qty,
        uom: c.uom,
        // Referensi silang: baris keluar menunjuk batch tujuan, baris masuk
        // menunjuk batch asal. Dengan begitu MB51 bisa dibaca dari sisi mana
        // pun tanpa perlu mencari pasangannya.
        reference: args.reference?.trim() || c.batch_to,
        remarks,
        via_pdt: args.via_pdt ?? false,
        doc_date,
        user_id: args.user_id,
      },
    });

    await tx.migoLog.create({
      data: {
        document_number,
        line_no: ++line_no,
        movement_type: MovementType.TRM_309_IN,
        material_code: c.material_code,
        target_bin: c.bin_code,
        batch_number: c.batch_to,
        qty: c.qty,
        uom: c.uom,
        reference: args.reference?.trim() || c.batch_from,
        remarks,
        via_pdt: args.via_pdt ?? false,
        doc_date,
        user_id: args.user_id,
      },
    });

    lines.push({
      line: c.line,
      material_code: c.material_code,
      bin_code: c.bin_code,
      batch_from: c.batch_from,
      batch_to: c.batch_to,
      qty: c.qty,
    });
  }

  return { document_number, lines };
}
