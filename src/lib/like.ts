/**
 * Pencarian dengan wildcard "*" ala SAP — dipakai seluruh kolom seleksi.
 *
 *   ABC        -> mengandung "ABC"           (contains, perilaku lama tetap dipertahankan)
 *   ABC*       -> diawali "ABC"              (ABC1 … ABC9)
 *   *BC        -> diakhiri "BC"
 *   *BC*       -> mengandung "BC"            (ABC1 … ABC9, BBC1, …)
 *   A*C1       -> diawali "A" dan diakhiri "C1"
 *   A*B*C      -> diawali "A", mengandung "B", diakhiri "C"
 *
 * Semua perbandingan case-insensitive.
 *
 * CARA case-insensitive-nya berbeda dari versi PostgreSQL. Di sana dipakai
 * `mode: 'insensitive'` milik Prisma — opsi yang HANYA ada untuk PostgreSQL
 * dan MongoDB; di MySQL/TiDB Prisma menolaknya dengan "Unknown argument `mode`".
 *
 * Di MySQL/TiDB sifat itu melekat pada COLLATION tabel, bukan pada query.
 * Database ini memakai collation berakhiran `_ci` (utf8mb4_unicode_ci), yang
 * artinya LIKE dan '=' sudah mengabaikan besar-kecil huruf dengan sendirinya.
 * Jadi opsi `mode` cukup dihapus — perilakunya tetap sama.
 *
 * `npm run db:diag` memeriksa collation ini dan memperingatkan bila ada tabel
 * yang peka huruf besar-kecil; `npm run db:upgrade` yang memperbaikinya.
 */

export interface WildcardPattern {
  /** true bila term memakai '*' */
  wildcard: boolean;
  startsWith?: string;
  endsWith?: string;
  contains: string[];
}

export function parseWildcard(term: string): WildcardPattern | null {
  const t = String(term ?? '').trim();
  if (!t) return null;

  if (!t.includes('*')) return { wildcard: false, contains: [t] };

  // '*' beruntun disederhanakan, lalu dipecah
  const parts = t.replace(/\*{2,}/g, '*').split('*');
  const startsWith = parts[0] || undefined;
  const endsWith = parts.length > 1 ? parts[parts.length - 1] || undefined : undefined;
  const middle = parts.slice(1, -1).filter(Boolean);

  // '*' saja = tampilkan semua
  if (!startsWith && !endsWith && middle.length === 0) return null;

  return { wildcard: true, startsWith, endsWith, contains: middle };
}

/** Kondisi Prisma untuk satu field. Dikembalikan sebagai array agar bisa digabung ke AND. */
export function likeWhere(field: string, term: string): Record<string, unknown>[] {
  const p = parseWildcard(term);
  if (!p) return [];

  // Tanpa `mode: 'insensitive'` — lihat catatan di kepala file.
  if (!p.wildcard) return [{ [field]: { contains: p.contains[0] } }];

  const out: Record<string, unknown>[] = [];
  if (p.startsWith) out.push({ [field]: { startsWith: p.startsWith } });
  if (p.endsWith) out.push({ [field]: { endsWith: p.endsWith } });
  for (const c of p.contains) out.push({ [field]: { contains: c } });
  return out;
}

/**
 * Kondisi Prisma untuk BEBERAPA field sekaligus (OR antar field).
 * Dipakai kolom "Material / Description" yang mencari kode maupun deskripsi.
 */
export function likeWhereAny(fields: string[], term: string): Record<string, unknown> | null {
  const p = parseWildcard(term);
  if (!p) return null;
  const or = fields
    .map((f) => {
      const conds = likeWhere(f, term);
      if (conds.length === 0) return null;
      return conds.length === 1 ? conds[0] : { AND: conds };
    })
    .filter(Boolean) as Record<string, unknown>[];
  return or.length ? { OR: or } : null;
}

/** Pencocokan wildcard sisi klien (dipakai filter kolom tabel & pengujian). */
export function matchesWildcard(text: string, term: string): boolean {
  const p = parseWildcard(term);
  if (!p) return true;
  const s = String(text ?? '').toUpperCase();

  if (!p.wildcard) return s.includes(p.contains[0].toUpperCase());

  let rest = s;
  if (p.startsWith) {
    const sw = p.startsWith.toUpperCase();
    if (!rest.startsWith(sw)) return false;
    rest = rest.slice(sw.length);
  }
  let tail = rest;
  if (p.endsWith) {
    const ew = p.endsWith.toUpperCase();
    if (!tail.endsWith(ew)) return false;
    tail = tail.slice(0, tail.length - ew.length);
  }
  // bagian tengah harus muncul berurutan di sisa teks
  let idx = 0;
  for (const c of p.contains) {
    const found = tail.indexOf(c.toUpperCase(), idx);
    if (found === -1) return false;
    idx = found + c.length;
  }
  return true;
}

/** Teks bantuan seragam untuk field seleksi. */
export const WILDCARD_HINT = 'gunakan * — mis. ABC* / *BC* / *C1';
