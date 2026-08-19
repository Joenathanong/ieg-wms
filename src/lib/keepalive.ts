/**
 * Jendela waktu untuk keep-alive database.
 *
 * TiDB Serverless menidurkan cluster setelah beberapa menit tanpa aktivitas.
 * Transaksi pertama sesudah itu harus menunggu cluster bangun, dan bagi
 * operator gudang penundaan itu terasa seperti aplikasi menggantung.
 *
 * Penangkalnya adalah query paling ringan yang mungkin (`SELECT 1`) dikirim
 * berkala — tetapi HANYA pada jam kerja. Menjaga database tetap bangun 24 jam
 * berarti membayar untuk waktu yang tidak dipakai siapa pun, jadi jam mulai
 * dan jam selesai dibuat bisa diatur di ZSET, lengkap dengan saklar mati.
 *
 * File ini sengaja murni (tanpa Prisma, tanpa React) supaya bisa dipakai
 * server maupun layar.
 */

/** Batas aman interval keep-alive dalam menit. */
export const KEEPALIVE_MIN_INTERVAL = 1;
export const KEEPALIVE_MAX_INTERVAL = 60;

/** "07:30" -> 450 menit sejak tengah malam. null bila format salah. */
export function parseHHMM(value: string | null | undefined): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(value ?? '').trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

/** Normalisasi ke "HH:MM". Mengembalikan '' bila tidak sah. */
export function normalizeHHMM(value: string | null | undefined): string {
  const total = parseHHMM(value);
  if (total === null) return '';
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/**
 * true bila `now` berada di dalam jendela jam kerja.
 *
 * Jendela boleh melewati tengah malam (mis. 22:00–06:00 untuk shift malam).
 * Jam mulai sama dengan jam selesai berarti 24 jam penuh.
 */
export function withinWindow(now: Date, from: string, to: string): boolean {
  const f = parseHHMM(from);
  const t = parseHHMM(to);
  if (f === null || t === null) return true; // belum diatur -> jangan menghalangi
  if (f === t) return true; // 24 jam
  const cur = now.getHours() * 60 + now.getMinutes();
  return f < t ? cur >= f && cur < t : cur >= f || cur < t;
}

/** Interval menit yang sudah dibatasi ke rentang aman. */
export function clampInterval(value: string | number | null | undefined): number {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return 4;
  return Math.min(KEEPALIVE_MAX_INTERVAL, Math.max(KEEPALIVE_MIN_INTERVAL, n));
}
