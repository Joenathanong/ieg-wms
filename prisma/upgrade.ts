/**
 * Pelengkap skema untuk TiDB / MySQL — dijalankan SETELAH `npm run db:push`.
 *
 *   npm run db:push      <- membentuk seluruh tabel dari schema.prisma
 *   npm run db:upgrade   <- skrip ini
 *
 * Tiga tugasnya:
 *   1. menjalankan prisma/upgrade.sql (isian awal konfigurasi ZSET),
 *   2. menyeragamkan collation seluruh tabel ke utf8mb4_general_ci supaya
 *      pencarian tidak peka huruf besar-kecil,
 *   3. melonggarkan kolom warisan NOT NULL yang tidak dikenal aplikasi.
 *
 * Aman diulang berkali-kali.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PrismaClient, Prisma } from '@prisma/client';

const prisma = new PrismaClient();

/**
 * Collation yang dipakai bila sebuah tabel perlu diperbaiki.
 *
 * PostgreSQL peka huruf besar-kecil dan aplikasi ini dulu mengandalkan
 * `mode: 'insensitive'` milik Prisma — fitur yang TIDAK ada di MySQL/TiDB.
 * Penggantinya adalah collation case-insensitive pada tabelnya, sehingga
 * pencarian material dan barcode tetap berperilaku sama.
 *
 * Yang dibutuhkan aplikasi hanyalah SIFAT case-insensitive, bukan nama
 * collation tertentu. Semua collation berakhiran `_ci` sudah memenuhinya
 * (TiDB memakai utf8mb4_unicode_ci sebagai bawaan), jadi tabel seperti itu
 * DIBIARKAN apa adanya — menulis ulang seluruh tabel tanpa manfaat hanya
 * menambah risiko. Yang diperbaiki hanya tabel yang benar-benar peka huruf
 * besar-kecil, mis. utf8mb4_bin.
 */
const TARGET_COLLATION = 'utf8mb4_general_ci';

function label(sql: string): string {
  const line =
    sql
      .split('\n')
      .map((l) => l.trim())
      .find((l) => l && !l.startsWith('--')) ?? sql.trim();
  return line.replace(/\s+/g, ' ').slice(0, 78);
}

/** Pastikan tidak ada tabel yang peka huruf besar-kecil. */
async function normalizeCollation() {
  const tables = await prisma.$queryRaw<{ TABLE_NAME: string; TABLE_COLLATION: string | null }[]>`
    SELECT TABLE_NAME, TABLE_COLLATION
      FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE'
  `;

  let changed = 0;
  for (const t of tables) {
    const coll = t.TABLE_COLLATION ?? '';
    if (coll.endsWith('_ci')) continue; // sudah case-insensitive, biarkan
    await prisma.$executeRawUnsafe(
      `ALTER TABLE \`${t.TABLE_NAME}\` CONVERT TO CHARACTER SET utf8mb4 COLLATE ${TARGET_COLLATION}`
    );
    console.log(`  ✔ ${t.TABLE_NAME} — ${coll || '?'} -> ${TARGET_COLLATION}`);
    changed++;
  }

  console.log(
    changed === 0
      ? '\n✔ Semua tabel sudah case-insensitive.'
      : `\n✔ ${changed} tabel diperbaiki ke ${TARGET_COLLATION}.`
  );
}

/**
 * Longgarkan kolom yang masih NOT NULL tanpa default tetapi sudah tidak
 * dikenal skema Prisma. Kolom seperti ini memblokir SETIAP INSERT ke tabelnya,
 * karena Prisma tidak pernah mengirim nilainya.
 */
async function relaxLegacyColumns() {
  const found: string[] = [];

  for (const m of Prisma.dmmf.datamodel.models) {
    const table = m.dbName ?? m.name;
    const known = new Set(
      m.fields.filter((f) => f.kind !== 'object').map((f) => f.dbName ?? f.name)
    );

    const cols = await prisma.$queryRaw<
      { COLUMN_NAME: string; IS_NULLABLE: string; COLUMN_DEFAULT: string | null; COLUMN_TYPE: string }[]
    >`
      SELECT COLUMN_NAME, IS_NULLABLE, COLUMN_DEFAULT, COLUMN_TYPE
        FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ${table}
    `;

    for (const c of cols) {
      if (known.has(c.COLUMN_NAME)) continue;
      if (c.IS_NULLABLE !== 'NO' || c.COLUMN_DEFAULT !== null) continue;

      // MySQL butuh definisi tipe lengkap saat mengubah kolom
      await prisma.$executeRawUnsafe(
        `ALTER TABLE \`${table}\` MODIFY \`${c.COLUMN_NAME}\` ${c.COLUMN_TYPE} NULL`
      );
      found.push(`${table}.${c.COLUMN_NAME}`);
      console.log(`  ✔ ${table}.${c.COLUMN_NAME} — kolom warisan dilonggarkan`);
    }
  }

  console.log(
    found.length === 0
      ? '\n✔ Tidak ada kolom warisan yang memblokir INSERT.'
      : `\n✔ ${found.length} kolom warisan dilonggarkan: ${found.join(', ')}`
  );
}

async function main() {
  const file = join(process.cwd(), 'prisma', 'upgrade.sql');
  const statements = readFileSync(file, 'utf8')
    .split(/^--\s*>>>\s*$/m)
    .map((s) => s.trim())
    .filter((s) => s && !/^(--[^\n]*\n?)+$/.test(s));

  // Collation dibereskan lebih dulu supaya statement di upgrade.sql tidak
  // pernah membandingkan teks antar-collation yang berbeda.
  await normalizeCollation();

  console.log(`\n→ Menjalankan ${statements.length} langkah isian awal ...\n`);

  for (const sql of statements) {
    try {
      await prisma.$executeRawUnsafe(sql);
      console.log(`  ✔ ${label(sql)}`);
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      if (/already exists|Duplicate/i.test(m)) {
        console.log(`  · ${label(sql)}  (sudah ada, dilewati)`);
      } else {
        console.error(`\n  ✖ GAGAL: ${label(sql)}`);
        console.error(`    ${m.split('\n')[0]}\n`);
        throw e;
      }
    }
  }

  await relaxLegacyColumns();

  const users = await prisma.user.count();
  if (users === 0) {
    console.log('\n⚠  Belum ada user sama sekali. Jalankan: npm run db:seed');
  }

  console.log('\n✔ Selesai.');
}

main()
  .catch((e) => {
    console.error('\nUpgrade dibatalkan.');
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
