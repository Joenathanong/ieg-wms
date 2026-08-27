import { Prisma, type PrismaClient } from '@prisma/client';

/**
 * ALIAS KODE MATERIAL
 * =============================================================================
 * Satu barang fisik kadang terlanjur terdaftar dengan lebih dari satu kode SKU
 * — nama produknya sama persis, hanya nomornya berbeda. Membiarkan keduanya
 * hidup berdampingan membuat stok, safety stock, FEFO, dan hasil opname
 * terbelah dua selamanya, dan tidak ada satu laporan pun yang bisa
 * menyatukannya kembali.
 *
 * Karena itu barangnya TIDAK dipecah. Satu kode ditetapkan sebagai utama, kode
 * lainnya didaftarkan sebagai alias yang menunjuk ke sana. Kode alias tetap
 * boleh diketik operator, discan dari kemasan lama, dan tetap muncul di file
 * Excel dari principal — tetapi diterjemahkan lebih dulu sebelum menyentuh
 * stok, jadi semua posting jatuh ke kode utama.
 *
 * Keuntungan lainnya: barcode tetap 1:1 ke satu material, sehingga terminal PDT
 * tidak perlu layar "pilih SKU yang mana" setiap kali operator memindai.
 */

/** Bisa dipanggil dengan PrismaClient biasa maupun di dalam transaction. */
type Db = Prisma.TransactionClient | PrismaClient;

export interface ResolvedCode {
  /** kode yang benar-benar dipakai untuk posting */
  material_code: string;
  /** kode yang diketik/discan operator, bila berbeda dari hasil terjemahan */
  input_code: string;
  /** true bila terjemahan alias benar-benar terjadi */
  redirected: boolean;
}

/**
 * Terjemahkan kode apa pun menjadi kode material yang sah.
 *
 * Material yang benar-benar ada SELALU menang atas alias. Urutan ini penting:
 * kalau suatu hari sebuah kode alias dipakai ulang sebagai material baru, yang
 * berlaku adalah material itu, bukan terjemahan lamanya — kalau tidak, kode
 * yang jelas-jelas ada di master akan diam-diam menunjuk ke barang lain.
 *
 * Mengembalikan null bila kode tidak dikenal sama sekali; pemanggil yang
 * menentukan pesan kesalahannya.
 */
export async function resolveMaterialCode(
  db: Db,
  rawCode: string
): Promise<ResolvedCode | null> {
  const input_code = String(rawCode ?? '').trim().toUpperCase();
  if (!input_code) return null;

  const direct = await db.material.findUnique({
    where: { material_code: input_code },
    select: { material_code: true, is_active: true },
  });
  if (direct?.is_active)
    return { material_code: direct.material_code, input_code, redirected: false };

  const alias = await db.materialAlias.findUnique({
    where: { alias_code: input_code },
    select: { material_code: true },
  });
  if (!alias) return null;

  const target = await db.material.findUnique({
    where: { material_code: alias.material_code },
    select: { material_code: true, is_active: true },
  });
  if (!target?.is_active) return null;

  return { material_code: target.material_code, input_code, redirected: true };
}

/**
 * Terjemahkan banyak kode sekaligus — dipakai jalur upload agar tidak
 * menembakkan dua query per baris.
 *
 * Kunci Map-nya adalah kode masukan dalam huruf besar. Kode yang tidak dikenal
 * tidak muncul di Map, sehingga pemanggil bisa membedakan "tidak ada" dari
 * "ada tetapi menunjuk ke tempat lain".
 */
export async function resolveMaterialCodes(
  db: Db,
  rawCodes: string[]
): Promise<Map<string, ResolvedCode>> {
  const codes = [...new Set(rawCodes.map((c) => String(c ?? '').trim().toUpperCase()).filter(Boolean))];
  const out = new Map<string, ResolvedCode>();
  if (codes.length === 0) return out;

  const materials = await db.material.findMany({
    where: { material_code: { in: codes }, is_active: true },
    select: { material_code: true },
  });
  for (const m of materials)
    out.set(m.material_code.toUpperCase(), {
      material_code: m.material_code,
      input_code: m.material_code,
      redirected: false,
    });

  const missing = codes.filter((c) => !out.has(c));
  if (missing.length === 0) return out;

  const aliases = await db.materialAlias.findMany({
    where: { alias_code: { in: missing } },
    select: { alias_code: true, material_code: true },
  });
  if (aliases.length === 0) return out;

  const targets = await db.material.findMany({
    where: { material_code: { in: aliases.map((a) => a.material_code) }, is_active: true },
    select: { material_code: true },
  });
  const live = new Set(targets.map((t) => t.material_code));

  for (const a of aliases) {
    if (!live.has(a.material_code)) continue;
    out.set(a.alias_code.toUpperCase(), {
      material_code: a.material_code,
      input_code: a.alias_code,
      redirected: true,
    });
  }

  return out;
}

/**
 * Alias yang menunjuk ke satu material. Dipakai layar MM01 dan laporan yang
 * perlu menyebut "kode ini juga dikenal sebagai ...".
 */
export async function listAliases(db: Db, material_code: string) {
  return db.materialAlias.findMany({
    where: { material_code },
    orderBy: { alias_code: 'asc' },
  });
}

/**
 * Periksa apakah sebuah kode boleh dijadikan alias.
 *
 * Aturannya sengaja ketat, karena alias yang salah arah jauh lebih sulit
 * ditemukan daripada alias yang gagal dibuat:
 *   - kode alias tidak boleh sama dengan material tujuannya sendiri
 *   - kode alias tidak boleh sudah terdaftar sebagai alias lain
 *   - material tujuan harus benar-benar ada
 *   - material tujuan tidak boleh berupa kode yang sendirinya sudah jadi alias
 *     (rantai alias A->B->C tidak diizinkan; resolver hanya melangkah sekali)
 */
export async function assertAliasAllowed(
  db: Db,
  alias_code: string,
  material_code: string
): Promise<void> {
  const a = alias_code.trim().toUpperCase();
  const m = material_code.trim().toUpperCase();

  if (!a || !m) throw new Error('Kode alias dan material tujuan wajib diisi.');
  if (a === m) throw new Error('Kode alias tidak boleh sama dengan material tujuannya.');

  const target = await db.material.findUnique({ where: { material_code: m } });
  if (!target) throw new Error(`Material tujuan ${m} tidak ada di master (MM01).`);
  if (!target.is_active)
    throw new Error(`Material tujuan ${m} sudah ditutup — alias tidak boleh menunjuk ke sana.`);

  const targetIsAlias = await db.materialAlias.findUnique({ where: { alias_code: m } });
  if (targetIsAlias)
    throw new Error(
      `Material tujuan ${m} sendiri sudah menjadi alias dari ${targetIsAlias.material_code}. ` +
        `Tunjuk langsung ke ${targetIsAlias.material_code} supaya tidak terbentuk rantai alias.`
    );

  const existing = await db.materialAlias.findUnique({ where: { alias_code: a } });
  if (existing && existing.material_code !== m)
    throw new Error(`Kode ${a} sudah terdaftar sebagai alias dari ${existing.material_code}.`);
}
