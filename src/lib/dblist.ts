/**
 * Daftar teks yang disimpan dalam SATU kolom.
 *
 * PostgreSQL punya tipe array (`text[]`) dan Prisma mendukungnya lewat scalar
 * list. MySQL — dan karenanya TiDB — TIDAK punya padanannya, dan Prisma tidak
 * mendukung scalar list di luar PostgreSQL.
 *
 * Solusinya: kolomnya disimpan sebagai teks dipisah koma, sementara seluruh
 * API dan layar TETAP bekerja dengan array biasa. Konversinya hanya terjadi di
 * lapisan akses database, sehingga tidak ada satu pun halaman yang perlu tahu.
 *
 * Nilai yang disimpan selalu berupa kode pendek tanpa koma (T-Code, kode bin),
 * jadi pemisah koma aman. `toDbList` menolak nilai yang mengandung koma supaya
 * data tidak pernah rusak diam-diam.
 */

/** Teks di database -> array. Aman untuk null / string kosong. */
export function fromDbList(value: string | null | undefined): string[] {
  if (!value) return [];
  return value
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
}

/** Array -> teks untuk disimpan. Duplikat dibuang, urutan dipertahankan. */
export function toDbList(values: readonly string[] | null | undefined): string {
  if (!values || values.length === 0) return '';
  const out: string[] = [];
  for (const raw of values) {
    const v = String(raw ?? '').trim();
    if (!v) continue;
    if (v.includes(',')) {
      throw new Error(`Nilai "${v}" mengandung koma dan tidak bisa disimpan dalam daftar.`);
    }
    if (!out.includes(v)) out.push(v);
  }
  return out.join(',');
}

/** true bila `needle` ada di dalam daftar tersimpan. */
export function dbListHas(value: string | null | undefined, needle: string): boolean {
  return fromDbList(value).includes(needle);
}
