/**
 * Perkiraan tanggal produksi dari tanggal kedaluwarsa.
 *
 * Produk di gudang ini umumnya berumur simpan 3 tahun, sehingga operator cukup
 * memasukkan expired date dan manufacturing date-nya terisi otomatis. Nilai
 * hasil perkiraan ini SELALU boleh ditimpa manual — pengisian otomatis hanya
 * berjalan saat field manufacturing date masih kosong.
 *
 * Catatan: bila nanti umur simpan berbeda-beda per material, tempat yang benar
 * untuk menyimpannya adalah master material (MM01), bukan konstanta di sini.
 */
export const DEFAULT_SHELF_LIFE_YEARS = 3;

/**
 * Terima & kembalikan format input tanggal HTML (`YYYY-MM-DD`).
 * Mengembalikan '' bila input tidak valid, supaya pemanggil bisa mengabaikannya.
 */
export function mfgFromExp(exp: string, years = DEFAULT_SHELF_LIFE_YEARS): string {
  const s = String(exp ?? '').trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return '';

  const y = Number(m[1]) - years;
  if (y < 1900) return '';

  // Pakai UTC supaya hasilnya tidak bergeser sehari di zona waktu tertentu.
  const d = new Date(Date.UTC(y, Number(m[2]) - 1, Number(m[3])));
  // 29 Februari pada tahun kabisat -> mundur ke 28 Februari bila tahun tujuan bukan kabisat
  if (d.getUTCMonth() !== Number(m[2]) - 1) d.setUTCDate(0);

  return d.toISOString().slice(0, 10);
}

/** Isi manufacturing date hanya bila operator belum mengisinya sendiri. */
export function fillMfg(exp: string, currentMfg: string): string {
  if (currentMfg.trim() !== '') return currentMfg;
  return mfgFromExp(exp);
}
