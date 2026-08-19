/**
 * Pembacaan tanggal dari NOMOR BATCH.
 *
 * Sebagian pemasok mengkodekan waktu produksi di dalam nomor batch itu sendiri,
 * dengan pola 6 karakter:
 *
 *     G 26 339
 *     │  │   └── nomor urut / lot pemasok — tidak dipakai
 *     │  └────── tahun produksi, 2 digit (26 = 2026)
 *     └───────── bulan produksi sebagai huruf, A=Januari … L=Desember
 *
 * Dari situ:
 *   manufacturing date = tanggal 1 bulan tersebut  (G26 -> 1 Juli 2026)
 *   expired date       = manufacturing + umur simpan (3 tahun -> 1 Juli 2029)
 *
 * Tanggal 1 dipakai karena nomor batch hanya memuat bulan, bukan hari. Memilih
 * awal bulan membuat expired date jatuh SELAMBAT-lambatnya pada tanggal yang
 * benar, bukan lebih lama — sisi yang aman untuk gudang.
 *
 * Hasilnya SELALU boleh ditimpa operator: pengisian otomatis hanya berjalan
 * saat field-nya masih kosong.
 */
import { DEFAULT_SHELF_LIFE_YEARS } from './shelflife';

/** Panjang nomor batch yang polanya bisa dibaca. Selain ini tidak diproses. */
export const BATCH_CODE_LENGTH = 6;

/** A=Januari … L=Desember. */
const MONTH_LETTERS = 'ABCDEFGHIJKL';

export interface BatchCodeDates {
  /** YYYY-MM-DD */
  mfg_date: string;
  /** YYYY-MM-DD */
  exp_date: string;
  /** 1–12 */
  month: number;
  /** tahun penuh, mis. 2026 */
  year: number;
}

/**
 * Batas kewajaran tahun produksi terhadap tahun berjalan.
 *
 * Tanpa batas ini nomor seperti "A99XYZ" akan terbaca sebagai tahun 2099 dan
 * mengisi expired date 2102 tanpa ada yang curiga. Batch 6 karakter yang bukan
 * berpola tanggal memang ada, jadi yang di luar rentang wajar lebih baik
 * dianggap BUKAN kode tanggal dan dibiarkan diisi manual.
 */
const YEAR_BACK = 10;
const YEAR_AHEAD = 1;

/**
 * Baca tanggal dari nomor batch. Mengembalikan null bila polanya tidak cocok —
 * pemanggil cukup mengabaikannya dan membiarkan operator mengisi manual.
 */
export function parseBatchCode(
  batch: string,
  years = DEFAULT_SHELF_LIFE_YEARS
): BatchCodeDates | null {
  const b = String(batch ?? '').trim().toUpperCase();
  if (b.length !== BATCH_CODE_LENGTH) return null;

  const month = MONTH_LETTERS.indexOf(b[0]) + 1;
  if (month === 0) return null; // huruf pertama di luar A–L

  const yy = b.slice(1, 3);
  if (!/^\d{2}$/.test(yy)) return null;
  const year = 2000 + Number(yy);

  const now = new Date().getUTCFullYear();
  if (year < now - YEAR_BACK || year > now + YEAR_AHEAD) return null;

  // UTC supaya hasilnya tidak bergeser sehari di zona waktu tertentu.
  const mfg = new Date(Date.UTC(year, month - 1, 1));
  const exp = new Date(Date.UTC(year + years, month - 1, 1));

  return {
    mfg_date: mfg.toISOString().slice(0, 10),
    exp_date: exp.toISOString().slice(0, 10),
    month,
    year,
  };
}

/** Keterangan singkat untuk status bar, mis. "G26 -> Jul 2026". */
export function describeBatchCode(d: BatchCodeDates): string {
  const names = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
  return `${names[d.month - 1]} ${d.year}`;
}
