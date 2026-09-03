import prisma from './prisma';
import { HttpError } from './auth';
import { fmtWib } from './wib';

/**
 * KUNCI PEMROSESAN GI PENJUALAN
 * =============================================================================
 *
 * `sales_date` yang unik hanya mencegah satu tanggal DIMUAT dua kali. Ia tidak
 * mencegah dua proses menggarap muatan yang sama secara bersamaan:
 *
 *   - dua operator membuka ZGI01 untuk tanggal yang sama dan sama-sama menekan
 *     Posting;
 *   - satu tombol terklik dua kali sebelum jawaban pertama tiba;
 *   - job otomatis jam 1 pagi berjalan tepat saat seseorang memproses manual.
 *
 * Klaim per baris di `postSalesGiChunk` sudah membuat stok tidak mungkin keluar
 * dua kali. Kunci di sini melengkapi dari sisi lain: menghentikan pekerjaan
 * kedua SEBELUM ia mulai, sehingga orangnya mendapat pesan yang jelas alih-alih
 * dua proses saling berebut baris dan setengahnya gagal dengan alasan yang
 * membingungkan.
 *
 * Kunci kedaluwarsa sendiri. Proses yang mati di tengah — fungsi serverless
 * yang dihentikan, jaringan putus — tidak boleh mengunci tanggal itu selamanya,
 * karena satu-satunya cara melepasnya adalah masuk ke database.
 */

/**
 * Umur kunci. Satu potongan dibatasi 55 detik, jadi 3 menit memberi kelonggaran
 * besar tanpa membuat tanggal terkunci lama bila prosesnya benar-benar mati.
 */
export const LOCK_TTL_MS = 3 * 60 * 1000;

export interface Lock {
  token: string;
  run_id: string;
}

/**
 * Ambil kunci untuk satu run. Melempar 409 bila sedang dipegang orang lain.
 *
 * Pengambilannya memakai `updateMany` dengan syarat pada kolom kunci itu
 * sendiri — atomik di database. Membaca dulu lalu menulis akan menyisakan
 * celah di antaranya, dan celah selebar beberapa milidetik sudah cukup untuk
 * dua orang yang menekan tombol pada saat yang sama.
 */
export async function acquireSalesGiLock(run_id: string, owner: string): Promise<Lock> {
  const token = `${owner}#${Date.now()}#${Math.random().toString(36).slice(2, 8)}`;
  const stale = new Date(Date.now() - LOCK_TTL_MS);

  const claimed = await prisma.salesGiRun.updateMany({
    where: {
      id: run_id,
      OR: [{ locked_at: null }, { locked_at: { lt: stale } }],
    },
    data: { locked_at: new Date(), locked_by: token },
  });

  if (claimed.count === 1) return { token, run_id };

  const run = await prisma.salesGiRun.findUnique({ where: { id: run_id } });
  if (!run) throw new HttpError(404, 'Proses GI penjualan tidak ditemukan.');

  throw new HttpError(
    409,
    `Tanggal ${run.sales_date.toISOString().slice(0, 10)} sedang diproses oleh ` +
      `${run.locked_by?.split('#')[0] ?? 'proses lain'} sejak ${fmtWib(run.locked_at)}. ` +
      `Tunggu sampai selesai — menjalankannya bersamaan berisiko mengeluarkan stok dua kali. ` +
      `Bila prosesnya memang macet, kuncinya terlepas sendiri dalam 3 menit.`
  );
}

/**
 * Lepaskan kunci — HANYA bila masih milik kita.
 *
 * Syarat `locked_by: token` itu penting: bila kunci kita sudah kedaluwarsa dan
 * diambil orang lain, melepaskannya begitu saja akan membuka pintu untuk proses
 * ketiga sementara yang kedua masih berjalan.
 */
export async function releaseSalesGiLock(lock: Lock): Promise<void> {
  await prisma.salesGiRun.updateMany({
    where: { id: lock.run_id, locked_by: lock.token },
    data: { locked_at: null, locked_by: null },
  });
}

/** true bila run sedang dipegang proses lain yang belum kedaluwarsa. */
export async function isSalesGiLocked(run_id: string): Promise<boolean> {
  const run = await prisma.salesGiRun.findUnique({
    where: { id: run_id },
    select: { locked_at: true },
  });
  if (!run?.locked_at) return false;
  return run.locked_at.getTime() > Date.now() - LOCK_TTL_MS;
}
