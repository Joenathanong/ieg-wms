import { Prisma, MovementType } from '@prisma/client';
import { HttpError } from './auth';
import { nextDocNumber } from './docnum';
import { applyStockIM, applyStockWM, refreshBinStatus } from './wms';

/**
 * SELISIH YANG SEBENARNYA TERTUKAR SKU, BUKAN SELISIH
 * =============================================================================
 *
 * ASAL MASALAHNYA
 * ---------------
 * Beberapa SKU sengaja dipelihara dengan DESKRIPSI yang sama — kode master
 * box-nya berbeda, kadang barcode produk dan POM NA-nya juga. Itu bentuk master
 * yang memang dipakai, bukan data kotor.
 *
 * Pada barang lepas, SKU itu TIDAK BISA DIKETAHUI. Yang tertempel di item hanya
 * barcode produk / QR B-POM, dan satu barcode hanya menunjuk satu material.
 * Jadi penghitung yang memegang botol memang tidak punya cara untuk tahu ia
 * milik SKU yang mana — seluruh isi rak jatuh ke SKU yang memegang barcode, dan
 * kembarannya terhitung nol.
 *
 * (Karton tersegel tidak punya masalah ini: kode di master box ADALAH kode
 * material, dan parseScan sudah membacanya berikut batch-nya.)
 *
 * MENGAPA TIDAK DIBIARKAN JADI SELISIH
 * ------------------------------------
 * Hasilnya +40 di SKU-A dan −40 di SKU-B padahal tidak ada satu pun barang yang
 * hilang atau lebih. Tiga akibatnya nyata:
 *
 *   - selisih itu akan diinvestigasi, dan sebabnya tidak akan pernah ketemu;
 *   - bila terlanjur diposting 701/702, total kelompoknya tetap benar tetapi
 *     saldo KEDUA SKU rusak permanen — dan tidak ada jejak yang menjelaskan
 *     mengapa;
 *   - statistik akurasi opname ikut tercemar, padahal angka itulah yang dipakai
 *     menilai gudang.
 *
 * PERLAKUANNYA
 * ------------
 * Pasangan yang saling meniadakan dalam satu rak, satu batch, dan satu kelompok
 * deskripsi diperlakukan sebagai REKLASIFIKASI: diposting 309 (material →
 * material), bukan 701/702. Stok berakhir di SKU yang benar-benar terhitung,
 * totalnya tidak berubah, dan ada dokumen yang bisa ditelusuri.
 *
 * Ini persis pola yang sudah dipakai `swap_group` untuk batch yang tertukar —
 * satu tingkat di atasnya.
 *
 * Yang TIDAK meniadakan tetap selisih asli. A +40 dengan B −30 menghasilkan
 * reklasifikasi 30 dan selisih +10; angka 10 itu memang selisih, dan menyamarkan
 * nya sebagai reklasifikasi sama buruknya dengan mengarang selisih.
 *
 * BEDA DENGAN 309 UBAH BATCH
 * --------------------------
 * Di sana materialnya sama sehingga Stock IM tidak berubah. Di sini materialnya
 * BERBEDA — IM kedua SKU harus ikut bergerak, kalau tidak MB52 akan bertentangan
 * dengan LX02.
 */

export interface ReclassCandidate {
  id: string;
  bin_code: string;
  batch_number: string | null;
  material_code: string;
  diff_qty: number;
}

export interface ReclassPair {
  /** SKU yang bukunya kelebihan — barangnya terhitung sebagai SKU lain */
  from_code: string;
  /** SKU yang benar-benar dihitung petugas */
  to_code: string;
  bin_code: string;
  batch_number: string | null;
  qty: number;
  description: string;
  uom: string;
  from_item_id: string;
  to_item_id: string;
  swap_group: string;
}

export interface ReclassPlan {
  pairs: ReclassPair[];
  /** sisa selisih per baris SESUDAH reklasifikasi — inilah yang jadi 701/702 */
  residual: Map<string, number>;
}

/**
 * Cari pasangan yang saling meniadakan. Tidak menyentuh apa pun.
 *
 * Kuncinya SENGAJA ketat: rak sama, batch sama, deskripsi sama. Batch ikut
 * dicocokkan karena nomor batch tercetak di item dan MEMANG terbaca petugas —
 * yang tidak terbaca hanya SKU-nya. Melonggarkan kunci ini berarti memasangkan
 * dua kekeliruan yang berbeda dan menyembunyikan keduanya sekaligus.
 */
export async function planReclass(
  tx: Prisma.TransactionClient,
  pending: ReclassCandidate[]
): Promise<ReclassPlan> {
  const residual = new Map<string, number>(pending.map((p) => [p.id, p.diff_qty]));
  const pairs: ReclassPair[] = [];

  const codes = [...new Set(pending.map((p) => p.material_code))];
  if (codes.length < 2) return { pairs, residual };

  const materials = await tx.material.findMany({
    where: { material_code: { in: codes } },
    select: { material_code: true, description: true, uom: true },
  });
  const info = new Map(materials.map((m) => [m.material_code, m]));

  /** rak | batch | deskripsi */
  const buckets = new Map<string, ReclassCandidate[]>();
  for (const p of pending) {
    const m = info.get(p.material_code);
    if (!m) continue;
    const key = `${p.bin_code}|${p.batch_number ?? ''}|${m.description.trim().toUpperCase()}`;
    const arr = buckets.get(key);
    if (arr) arr.push(p);
    else buckets.set(key, [p]);
  }

  let seq = 0;

  for (const group of buckets.values()) {
    if (group.length < 2) continue;
    // Dua baris dengan material yang sama bukan tertukar SKU — itu kasus lain
    // (mis. batch), dan bukan urusan file ini.
    if (new Set(group.map((g) => g.material_code)).size < 2) continue;

    // Satuan berbeda dalam satu deskripsi berarti masternya keliru, bukan SKU
    // yang tertukar. Menjumlahkannya akan menghasilkan angka yang salah tanpa
    // ada laporan yang menunjukkannya — jadi jangan dipasangkan sama sekali.
    const uoms = new Set(
      group.map((g) => (info.get(g.material_code)?.uom ?? '').toUpperCase())
    );
    if (uoms.size > 1) continue;

    // Urutan menentukan hasil, jadi dibuat pasti: yang terbesar lebih dulu,
    // seri diputus kode material.
    const plus = group
      .filter((g) => (residual.get(g.id) ?? 0) > 0)
      .sort((a, b) => (residual.get(b.id) ?? 0) - (residual.get(a.id) ?? 0) || (a.material_code < b.material_code ? -1 : 1));
    const minus = group
      .filter((g) => (residual.get(g.id) ?? 0) < 0)
      .sort((a, b) => (residual.get(a.id) ?? 0) - (residual.get(b.id) ?? 0) || (a.material_code < b.material_code ? -1 : 1));
    if (plus.length === 0 || minus.length === 0) continue;

    for (const p of plus) {
      for (const m of minus) {
        const need = residual.get(p.id) ?? 0;
        if (need <= 0) break;
        const give = -(residual.get(m.id) ?? 0);
        if (give <= 0) continue;

        const qty = Math.min(need, give);
        const meta = info.get(p.material_code)!;
        pairs.push({
          from_code: m.material_code,
          to_code: p.material_code,
          bin_code: p.bin_code,
          batch_number: p.batch_number,
          qty,
          description: meta.description,
          uom: meta.uom,
          from_item_id: m.id,
          to_item_id: p.id,
          swap_group: `SKU-${++seq}`,
        });
        residual.set(p.id, need - qty);
        residual.set(m.id, (residual.get(m.id) ?? 0) + qty);
      }
    }
  }

  return { pairs, residual };
}

export interface ReclassPosted {
  document_number: string;
  from_code: string;
  to_code: string;
  bin_code: string;
  batch_number: string | null;
  qty: number;
}

/**
 * Posting reklasifikasi. Satu dokumen per pasangan, dua baris (keluar & masuk)
 * seperti 309 lainnya.
 */
export async function postReclass(
  tx: Prisma.TransactionClient,
  pairs: ReclassPair[],
  args: { reference: string; user_id: string; doc_date?: Date }
): Promise<ReclassPosted[]> {
  const out: ReclassPosted[] = [];
  const doc_date = args.doc_date ?? new Date();

  for (const p of pairs) {
    const src = await tx.stockWM.findFirst({
      where: {
        material_code: p.from_code,
        bin_code: p.bin_code,
        batch_number: p.batch_number,
      },
    });
    if (!src || src.qty < p.qty)
      throw new HttpError(
        400,
        `Reklasifikasi ${p.from_code} → ${p.to_code} di ${p.bin_code} sebanyak ${p.qty} ` +
          `tidak bisa diposting: stok ${p.from_code} tinggal ${src?.qty ?? 0}. ` +
          `Periksa apakah ada pergerakan lain setelah rak ini di-freeze.`
      );

    // Keluar dari SKU yang bukunya kelebihan.
    await applyStockWM(
      tx,
      { material_code: p.from_code, bin_code: p.bin_code, batch_number: p.batch_number },
      -p.qty
    );
    await applyStockIM(tx, p.from_code, -p.qty);

    /**
     * Masuk ke SKU yang benar-benar dihitung. Tanggalnya diwarisi dari quant
     * asal — barangnya sama persis, hanya kodenya yang berpindah, jadi FEFO
     * tidak boleh kehilangan acuan dan tanggal terima tidak berubah.
     */
    await applyStockWM(
      tx,
      { material_code: p.to_code, bin_code: p.bin_code, batch_number: p.batch_number },
      p.qty,
      { mfg_date: src.mfg_date, exp_date: src.exp_date, gr_date: src.gr_date }
    );
    await applyStockIM(tx, p.to_code, p.qty);

    await refreshBinStatus(tx, p.bin_code);

    const document_number = await nextDocNumber(tx, 'MATDOC');
    const remarks =
      `Reklasifikasi SKU deskripsi sama (${p.description}) — ` +
      `dihitung sebagai ${p.to_code}, buku pada ${p.from_code}`;

    await tx.migoLog.create({
      data: {
        document_number,
        line_no: 1,
        movement_type: MovementType.TRM_309_OUT,
        material_code: p.from_code,
        source_bin: p.bin_code,
        batch_number: p.batch_number,
        qty: p.qty,
        uom: p.uom,
        // Referensi silang: baris keluar menunjuk SKU tujuan, baris masuk
        // menunjuk SKU asal — MB51 bisa dibaca dari sisi mana pun.
        reference: `${args.reference} / ${p.to_code}`,
        remarks,
        doc_date,
        user_id: args.user_id,
      },
    });

    await tx.migoLog.create({
      data: {
        document_number,
        line_no: 2,
        movement_type: MovementType.TRM_309_IN,
        material_code: p.to_code,
        target_bin: p.bin_code,
        batch_number: p.batch_number,
        qty: p.qty,
        uom: p.uom,
        reference: `${args.reference} / ${p.from_code}`,
        remarks,
        doc_date,
        user_id: args.user_id,
      },
    });

    // Kedua barisnya ditandai supaya laporan bisa memisahkan "tertukar SKU"
    // dari "selisih stok" — tanpa ini satu kekeliruan terhitung dua kali
    // sebagai temuan dan akurasi opname terlihat jauh lebih buruk daripada
    // kenyataannya.
    await tx.physInvDocItem.updateMany({
      where: { id: { in: [p.from_item_id, p.to_item_id] } },
      data: { swap_group: p.swap_group },
    });

    out.push({
      document_number,
      from_code: p.from_code,
      to_code: p.to_code,
      bin_code: p.bin_code,
      batch_number: p.batch_number,
      qty: p.qty,
    });
  }

  return out;
}
