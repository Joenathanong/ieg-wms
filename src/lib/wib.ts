/**
 * WAKTU INDONESIA BARAT (WIB, UTC+7)
 * =============================================================================
 *
 * Aplikasi ini berjalan di server yang jamnya UTC — Vercel maupun TiDB. Untuk
 * sebagian besar layar itu tidak jadi soal, tetapi untuk GI penjualan otomatis
 * ia menentukan TANGGAL MANA yang diproses, dan salah sehari berarti penjualan
 * satu hari terlewat sementara hari lain diposting dua kali.
 *
 * Dua tempat yang mudah keliru, keduanya ditangani di file ini:
 *
 *   1. "Kemarin" menurut siapa. Pukul 01:00 WIB tanggal 3 September adalah
 *      pukul 18:00 UTC tanggal 2 September. `new Date()` di server saat itu
 *      menunjuk 2 September, sehingga "kemarin" versi UTC adalah 1 September —
 *      padahal yang dimaksud adalah 2 September.
 *
 *   2. Jadwal cron. Vercel menjalankan cron dalam UTC dan TIDAK mengenal zona
 *      waktu. Jam 01:00 WIB harus ditulis sebagai 18:00 UTC.
 *
 * Indonesia tidak menerapkan daylight saving dan WIB tetap UTC+7 sepanjang
 * tahun, jadi selisih tetap ini aman — tidak perlu pustaka zona waktu.
 */

/** Selisih WIB terhadap UTC, dalam milidetik. */
const WIB_OFFSET_MS = 7 * 60 * 60 * 1000;

/**
 * Ekspresi cron untuk pukul 01:00 WIB.
 *
 * 01:00 WIB − 7 jam = 18:00 UTC hari SEBELUMNYA. Karena itu jadwalnya harian
 * pada 18:00 UTC; tanggal penjualan yang diproses dihitung terpisah oleh
 * `wibYesterday()`, bukan disimpulkan dari tanggal cron berjalan.
 */
export const CRON_0100_WIB = '0 18 * * *';

/** Tanggal hari ini menurut WIB, format YYYY-MM-DD. */
export function wibToday(now: Date = new Date()): string {
  return new Date(now.getTime() + WIB_OFFSET_MS).toISOString().slice(0, 10);
}

/**
 * Tanggal kemarin menurut WIB, format YYYY-MM-DD.
 *
 * Inilah tanggal penjualan yang diproses job jam 1 pagi: saat job berjalan
 * pukul 01:00 WIB tanggal 3, yang diproses adalah penjualan tanggal 2.
 */
export function wibYesterday(now: Date = new Date()): string {
  return new Date(now.getTime() + WIB_OFFSET_MS - 86_400_000).toISOString().slice(0, 10);
}

/**
 * "YYYY-MM-DD" -> Date tengah malam UTC.
 *
 * Dipakai untuk kolom bertipe DATE. Nilainya sengaja dipatok ke tengah malam
 * UTC dan BUKAN dikonversi dari WIB: kolom tanggal tidak menyimpan jam, jadi
 * yang penting adalah setiap proses untuk tanggal yang sama menghasilkan nilai
 * yang sama persis — itulah yang membuat kunci unik `sales_date` benar-benar
 * mencegah posting ganda.
 */
export function dateOnly(iso: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso ?? '').trim());
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return isNaN(d.getTime()) ? null : d;
}

/** Date -> "YYYY-MM-DD" (dibaca sebagai tanggal murni, tanpa geser zona). */
export function dateOnlyString(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Daftar tanggal dari `from` sampai `to`, inklusif.
 * Dipakai layar backfill untuk menunjukkan hari mana yang belum diproses.
 */
export function dateRange(from: string, to: string, max = 400): string[] {
  const a = dateOnly(from);
  const b = dateOnly(to);
  if (!a || !b || a > b) return [];
  const out: string[] = [];
  for (let d = new Date(a); d <= b && out.length < max; d.setUTCDate(d.getUTCDate() + 1)) {
    out.push(dateOnlyString(d));
  }
  return out;
}

/** Tampilan jam WIB untuk layar, mis. "03.09.2026 01:00 WIB". */
export function fmtWib(value: Date | string | null | undefined): string {
  if (!value) return '';
  const d = typeof value === 'string' ? new Date(value) : value;
  if (isNaN(d.getTime())) return '';
  const w = new Date(d.getTime() + WIB_OFFSET_MS);
  const p = (n: number) => String(n).padStart(2, '0');
  return (
    `${p(w.getUTCDate())}.${p(w.getUTCMonth() + 1)}.${w.getUTCFullYear()} ` +
    `${p(w.getUTCHours())}:${p(w.getUTCMinutes())} WIB`
  );
}
