import { Prisma, MovementType, TrStatus, PhysInvStatus } from '@prisma/client';
import { HttpError } from './auth';
import { nextDocNumber } from './docnum';
import { applyStockIM, applyStockWM, refreshBinStatus } from './wms';

/**
 * PENGGABUNGAN SKU KEMBAR
 * =============================================================================
 * Dua kode material untuk satu barang fisik digabung menjadi satu. Yang terjadi
 * berurutan, seluruhnya di dalam SATU transaksi:
 *
 *   1. Stok dipindahkan dengan transfer posting material ke material (SAP 309).
 *      Setiap quant menghasilkan dua baris pada satu material document: sisi
 *      keluar dari kode duplikat, sisi masuk ke kode utama, pada bin dan batch
 *      yang sama persis. Jejaknya utuh dan bisa dibaca di MB51.
 *   2. Keterangan master yang hanya dimiliki kode duplikat (barcode, kode OCS,
 *      fix bin, kemasan) dipindahkan ke kode utama, supaya kemampuan scan dan
 *      pemecahan pallet tidak ikut hilang.
 *   3. Kode duplikat DITUTUP, bukan dihapus. Riwayat MB51 menyimpan kode sebagai
 *      teks; menghapus barisnya akan meninggalkan riwayat tanpa master. Barcode
 *      dilepas darinya lebih dulu, sebelum ditulis ke kode utama, supaya tidak
 *      pernah ada dua material memegang barcode yang sama.
 *   4. Kode duplikat didaftarkan sebagai alias, sehingga karton lama tetap bisa
 *      discan dan file principal yang masih memakai kode lama tetap terbaca.
 *
 * Yang sengaja TIDAK dikerjakan otomatis: apa pun yang masih berjalan.
 * Penggabungan ditolak selama masih ada transfer requirement terbuka atau
 * dokumen opname aktif yang menyebut kode itu — memindahkan stok di bawah kaki
 * pekerjaan yang sedang jalan akan membuat konfirmasi berikutnya gagal dengan
 * pesan yang tidak berhubungan.
 */

export interface MergePlanLine {
  bin_code: string;
  batch_number: string | null;
  qty: number;
  exp_date: Date | null;
}

export interface MergePlan {
  from_code: string;
  from_description: string;
  into_code: string;
  into_description: string;
  /** quant yang akan dipindahkan */
  lines: MergePlanLine[];
  total_qty: number;
  /** keterangan master yang akan ikut pindah karena kode utama belum punya */
  carried: string[];
  /** hal yang menghalangi penggabungan — kosong berarti boleh jalan */
  blockers: string[];
  /** jumlah dokumen MB51 milik kode duplikat (alasan ia ditutup, bukan dihapus) */
  history_docs: number;
}

/** Rencana penggabungan — dipakai layar pratinjau DAN diperiksa ulang saat posting. */
export async function planMerge(
  tx: Prisma.TransactionClient,
  from_code: string,
  into_code: string
): Promise<MergePlan> {
  const from = from_code.trim().toUpperCase();
  const into = into_code.trim().toUpperCase();

  if (!from || !into) throw new HttpError(400, 'Kode duplikat dan kode utama wajib diisi.');
  if (from === into)
    throw new HttpError(400, 'Kode duplikat dan kode utama tidak boleh sama.');

  const [fromMat, intoMat] = await Promise.all([
    tx.material.findUnique({ where: { material_code: from } }),
    tx.material.findUnique({ where: { material_code: into } }),
  ]);
  if (!fromMat) throw new HttpError(400, `Material ${from} tidak ada di master (MM01).`);
  if (!intoMat) throw new HttpError(400, `Material ${into} tidak ada di master (MM01).`);

  const blockers: string[] = [];

  if (!fromMat.is_active) blockers.push(`${from} sudah ditutup — tidak ada yang perlu digabung.`);
  if (!intoMat.is_active) blockers.push(`${into} sudah ditutup dan tidak bisa dijadikan kode utama.`);

  // Satuan yang berbeda berarti angkanya tidak sepadan; memindahkannya begitu
  // saja akan menghasilkan jumlah yang salah tanpa ada yang menyadarinya.
  if (fromMat.uom !== intoMat.uom)
    blockers.push(
      `Satuan berbeda: ${from} memakai ${fromMat.uom}, ${into} memakai ${intoMat.uom}. ` +
        `Samakan dulu di MM01 sebelum digabung.`
    );

  // Batch management yang berbeda membuat batch tujuan wajib/terlarang tidak
  // konsisten dengan quant yang dipindah.
  if (fromMat.is_batch_managed !== intoMat.is_batch_managed)
    blockers.push(
      `Pengelolaan batch berbeda: ${from} ${fromMat.is_batch_managed ? 'pakai' : 'tanpa'} batch, ` +
        `${into} ${intoMat.is_batch_managed ? 'pakai' : 'tanpa'} batch.`
    );

  const intoIsAlias = await tx.materialAlias.findUnique({ where: { alias_code: into } });
  if (intoIsAlias)
    blockers.push(
      `${into} sendiri sudah menjadi alias dari ${intoIsAlias.material_code}. ` +
        `Gabungkan langsung ke ${intoIsAlias.material_code}.`
    );

  // Pekerjaan yang masih berjalan
  const openTr = await tx.transferReqItem.count({
    where: {
      material_code: { in: [from, into] },
      status: { in: [TrStatus.OPEN, TrStatus.PARTIAL] },
    },
  });
  if (openTr > 0)
    blockers.push(
      `Masih ada ${openTr} baris transfer requirement terbuka untuk kode ini. ` +
        `Selesaikan atau batalkan di LB10/LB12 lebih dulu.`
    );

  const openPi = await tx.physInvDocItem.count({
    where: {
      material_code: { in: [from, into] },
      doc: {
        status: {
          in: [PhysInvStatus.CREATED, PhysInvStatus.FROZEN, PhysInvStatus.COUNTED],
        },
      },
    },
  });
  if (openPi > 0)
    blockers.push(
      `Kode ini sedang tercakup dalam ${openPi} baris dokumen opname yang belum diposting. ` +
        `Selesaikan opname-nya lebih dulu.`
    );

  // Quant yang akan dipindahkan
  const quants = await tx.stockWM.findMany({
    where: { material_code: from, qty: { not: 0 } },
    orderBy: [{ bin_code: 'asc' }, { batch_number: 'asc' }],
  });

  const negative = quants.filter((q) => q.qty < 0);
  if (negative.length > 0)
    blockers.push(
      `${negative.length} quant ${from} bernilai negatif. Perbaiki lewat opname atau 701/702 dulu.`
    );

  const lines: MergePlanLine[] = quants.map((q) => ({
    bin_code: q.bin_code,
    batch_number: q.batch_number,
    qty: q.qty,
    exp_date: q.exp_date,
  }));

  // Keterangan master yang ikut pindah — hanya yang kolomnya masih kosong di
  // kode utama, supaya penggabungan tidak pernah menimpa data yang benar.
  const carried: string[] = [];
  if (fromMat.barcode_bpom && !intoMat.barcode_bpom) carried.push(`Barcode B-POM ${fromMat.barcode_bpom}`);
  if (fromMat.barcode_produk && !intoMat.barcode_produk) carried.push(`Barcode produk ${fromMat.barcode_produk}`);
  if (fromMat.kode_ocs && !intoMat.kode_ocs) carried.push(`Kode OCS ${fromMat.kode_ocs}`);
  if (fromMat.fix_bin && !intoMat.fix_bin) carried.push(`Fix bin ${fromMat.fix_bin}`);
  if (fromMat.min_safety_stock > 0 && intoMat.min_safety_stock === 0)
    carried.push(`Safety stock ${fromMat.min_safety_stock}`);

  const [fromPacks, intoPacks] = await Promise.all([
    tx.packagingType.findMany({ where: { material_code: from } }),
    tx.packagingType.findMany({ where: { material_code: into } }),
  ]);
  const intoPackCodes = new Set(intoPacks.map((p) => p.pack_code));
  const movingPacks = fromPacks.filter((p) => !intoPackCodes.has(p.pack_code));
  if (movingPacks.length > 0)
    carried.push(`${movingPacks.length} baris kemasan (${movingPacks.map((p) => p.pack_code).join(', ')})`);

  const history_docs = await tx.migoLog.count({ where: { material_code: from } });

  return {
    from_code: from,
    from_description: fromMat.description,
    into_code: into,
    into_description: intoMat.description,
    lines,
    total_qty: lines.reduce((a, l) => a + l.qty, 0),
    carried,
    blockers,
    history_docs,
  };
}

export interface MergeResult {
  document_number: string | null;
  from_code: string;
  into_code: string;
  moved_lines: number;
  moved_qty: number;
  carried: string[];
}

/** Jalankan penggabungan. WAJIB dipanggil di dalam prisma.$transaction(). */
export async function mergeMaterial(
  tx: Prisma.TransactionClient,
  args: {
    from_code: string;
    into_code: string;
    user_id: string;
    remarks?: string | null;
  }
): Promise<MergeResult> {
  // Rencananya dihitung ULANG di sini, bukan dipercayakan pada apa yang dikirim
  // layar: stok dan dokumen terbuka bisa berubah antara pratinjau dan posting.
  const plan = await planMerge(tx, args.from_code, args.into_code);
  if (plan.blockers.length > 0) throw new HttpError(400, plan.blockers.join(' '));

  const from = plan.from_code;
  const into = plan.into_code;

  /* ---------------- 1. pindahkan stok lewat 309 ---------------- */
  let document_number: string | null = null;
  let line_no = 0;
  const doc_date = new Date();

  if (plan.lines.length > 0) {
    document_number = await nextDocNumber(tx, 'MATDOC');

    const intoMat = await tx.material.findUniqueOrThrow({ where: { material_code: into } });

    for (const l of plan.lines) {
      const src = await tx.stockWM.findFirst({
        where: { material_code: from, bin_code: l.bin_code, batch_number: l.batch_number },
      });
      if (!src || src.qty !== l.qty)
        throw new HttpError(
          400,
          `Stok ${from} di bin ${l.bin_code} berubah saat penggabungan berjalan. Ulangi dari awal.`
        );

      // keluar dari kode duplikat
      await applyStockWM(
        tx,
        { material_code: from, bin_code: l.bin_code, batch_number: l.batch_number },
        -l.qty
      );
      await applyStockIM(tx, from, -l.qty);

      // masuk ke kode utama — tanggal batch diwarisi supaya FEFO tidak berubah
      await applyStockWM(
        tx,
        { material_code: into, bin_code: l.bin_code, batch_number: l.batch_number },
        l.qty,
        { mfg_date: src.mfg_date, exp_date: src.exp_date, gr_date: src.gr_date }
      );
      await applyStockIM(tx, into, l.qty);
      await refreshBinStatus(tx, l.bin_code);

      const remarks = args.remarks?.trim() || `Penggabungan SKU ${from} -> ${into}`;

      await tx.migoLog.create({
        data: {
          document_number,
          line_no: ++line_no,
          movement_type: MovementType.TRM_309_OUT,
          material_code: from,
          source_bin: l.bin_code,
          batch_number: l.batch_number,
          qty: l.qty,
          uom: intoMat.uom,
          reference: into,
          remarks,
          doc_date,
          user_id: args.user_id,
        },
      });
      await tx.migoLog.create({
        data: {
          document_number,
          line_no: ++line_no,
          movement_type: MovementType.TRM_309_IN,
          material_code: into,
          target_bin: l.bin_code,
          batch_number: l.batch_number,
          qty: l.qty,
          uom: intoMat.uom,
          reference: from,
          remarks,
          doc_date,
          user_id: args.user_id,
        },
      });
    }
  }

  /* ---------------- 2. pindahkan keterangan master ---------------- */
  const fromMat = await tx.material.findUniqueOrThrow({ where: { material_code: from } });
  const intoMat = await tx.material.findUniqueOrThrow({ where: { material_code: into } });

  const carry: Prisma.MaterialUpdateInput = {};
  if (fromMat.barcode_bpom && !intoMat.barcode_bpom) carry.barcode_bpom = fromMat.barcode_bpom;
  if (fromMat.barcode_produk && !intoMat.barcode_produk) carry.barcode_produk = fromMat.barcode_produk;
  if (fromMat.kode_ocs && !intoMat.kode_ocs) carry.kode_ocs = fromMat.kode_ocs;
  if (fromMat.fix_bin && !intoMat.fix_bin) carry.fix_bin = fromMat.fix_bin;
  if (fromMat.min_safety_stock > 0 && intoMat.min_safety_stock === 0)
    carry.min_safety_stock = fromMat.min_safety_stock;

  /**
   * URUTANNYA PENTING: kode duplikat DILEPAS lebih dulu, baru barcode-nya
   * ditulis ke kode utama.
   *
   * Kalau dibalik, untuk sesaat ada DUA material memegang barcode yang sama di
   * dalam transaksi yang sama — dan batasan UNIQUE pada kolom barcode akan
   * menolak penggabungan itu mentah-mentah. Melepasnya lebih dulu membuat
   * barcode benar-benar berpindah tangan, bukan tersalin.
   */
  await tx.material.update({
    where: { material_code: from },
    data: {
      is_active: false,
      barcode_bpom: null,
      barcode_produk: null,
      fix_bin: null,
    },
  });

  if (Object.keys(carry).length > 0)
    await tx.material.update({ where: { material_code: into }, data: carry });

  // Kemasan yang belum dimiliki kode utama dipindahkan, bukan disalin: kalau
  // ditinggal, baris itu ikut terhapus saat suatu hari master lama dibersihkan.
  const [fromPacks, intoPacks] = await Promise.all([
    tx.packagingType.findMany({ where: { material_code: from } }),
    tx.packagingType.findMany({ where: { material_code: into } }),
  ]);
  const intoPackCodes = new Set(intoPacks.map((p) => p.pack_code));
  for (const p of fromPacks) {
    if (intoPackCodes.has(p.pack_code)) continue;
    await tx.packagingType.update({
      where: { id: p.id },
      data: {
        material_code: into,
        // Default hanya boleh satu per kelompok gudang. Baris pindahan tidak
        // pernah langsung jadi default kalau kode utama sudah punya.
        is_default: p.is_default && !intoPacks.some((q) => q.zone_group === p.zone_group && q.is_default),
      },
    });
  }

  /* ---------------- 3. daftarkan aliasnya ---------------- */
  await tx.materialAlias.upsert({
    where: { alias_code: from },
    create: {
      alias_code: from,
      material_code: into,
      remarks: args.remarks?.trim() || `Digabung ke ${into}`,
      created_by: args.user_id,
    },
    update: { material_code: into },
  });

  // Alias yang tadinya menunjuk ke kode duplikat harus ikut dialihkan, kalau
  // tidak rantainya jadi A -> B -> C dan resolver hanya melangkah sekali.
  await tx.materialAlias.updateMany({
    where: { material_code: from, alias_code: { not: from } },
    data: { material_code: into },
  });

  return {
    document_number,
    from_code: from,
    into_code: into,
    moved_lines: plan.lines.length,
    moved_qty: plan.total_qty,
    carried: plan.carried,
  };
}
