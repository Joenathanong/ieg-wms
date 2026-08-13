/**
 * Menjalankan prisma/upgrade.sql — upgrade skema TANPA menghapus data.
 * Aman diulang berkali-kali.
 *
 *   npm run db:upgrade
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PrismaClient, Prisma } from '@prisma/client';

const prisma = new PrismaClient();

function label(sql: string): string {
  const line =
    sql
      .split('\n')
      .map((l) => l.trim())
      .find((l) => l && !l.startsWith('--')) ?? sql.trim();
  return line.replace(/\s+/g, ' ').slice(0, 78);
}

/**
 * Longgarkan "kolom warisan": kolom yang masih NOT NULL tanpa default di
 * database, tetapi sudah tidak dikenal oleh skema Prisma saat ini.
 *
 * Kolom seperti ini muncul kalau sebuah field pernah dihapus/dipindah pada
 * versi aplikasi berikutnya (mis. `phys_inv_docs.bin_code` yang dulu menyimpan
 * satu bin per dokumen). Aplikasi tidak pernah mengisinya lagi, sementara
 * PostgreSQL tetap mewajibkannya — akibatnya SETIAP INSERT ke tabel itu ditolak
 * dengan "Null constraint violation" (Prisma P2011).
 *
 * Kolomnya sengaja TIDAK dihapus supaya data lama tetap bisa dibaca; cukup
 * dijadikan nullable agar tidak lagi memblokir baris baru.
 */
async function relaxLegacyColumns() {
  const models = Prisma.dmmf.datamodel.models;
  const found: string[] = [];

  for (const m of models) {
    const table = m.dbName ?? m.name;
    const known = new Set(
      m.fields.filter((f) => f.kind !== 'object').map((f) => f.dbName ?? f.name)
    );

    const cols = await prisma.$queryRaw<
      { column_name: string; is_nullable: string; column_default: string | null }[]
    >`
      SELECT column_name, is_nullable, column_default
        FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = ${table}
    `;

    for (const c of cols) {
      if (known.has(c.column_name)) continue;
      if (c.is_nullable !== 'NO' || c.column_default) continue;

      await prisma.$executeRawUnsafe(
        `ALTER TABLE "${table}" ALTER COLUMN "${c.column_name}" DROP NOT NULL`
      );
      found.push(`${table}.${c.column_name}`);
      console.log(`  ✔ ${table}.${c.column_name} — kolom warisan dilonggarkan (DROP NOT NULL)`);
    }
  }

  if (found.length === 0) {
    console.log('\n✔ Tidak ada kolom warisan yang memblokir INSERT.');
  } else {
    console.log(
      `\n✔ ${found.length} kolom warisan dilonggarkan: ${found.join(', ')}\n` +
        `   Kolom tidak dihapus — isi lamanya tetap tersimpan. Hapus manual bila sudah yakin tidak dibutuhkan.`
    );
  }
}

async function main() {
  const file = join(process.cwd(), 'prisma', 'upgrade.sql');
  const statements = readFileSync(file, 'utf8')
    .split(/^--\s*>>>\s*$/m)
    .map((s) => s.trim())
    .filter((s) => s && !/^(--[^\n]*\n?)+$/.test(s));

  console.log(`→ Menjalankan ${statements.length} langkah upgrade ...\n`);

  let done = 0;
  for (const sql of statements) {
    try {
      await prisma.$executeRawUnsafe(sql);
      done++;
      console.log(`  ✔ ${label(sql)}`);
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      // beberapa langkah memang boleh gagal bila objek sudah ada
      if (/already exists|duplicate/i.test(m)) {
        done++;
        console.log(`  · ${label(sql)}  (sudah ada, dilewati)`);
      } else {
        console.error(`\n  ✖ GAGAL: ${label(sql)}`);
        console.error(`    ${m.split('\n')[0]}\n`);
        throw e;
      }
    }
  }

  console.log(`\n✔ Upgrade selesai — ${done}/${statements.length} langkah.`);

  await relaxLegacyColumns();

  const placeholder = await prisma.physInvDocItem.count({ where: { bin_code: '*MIGRASI*' } });
  if (placeholder > 0) {
    console.log(
      `\n⚠  ${placeholder} baris stock opname lama tidak bisa ditebak bin-nya dan diberi kode '*MIGRASI*'.\n` +
        `   Dokumen PI lama tersebut sebaiknya dibatalkan lalu dibuat ulang di LI01N.`
    );
  }

  const users = await prisma.user.count();
  if (users === 0) {
    console.log('\n⚠  Belum ada user sama sekali. Jalankan: npm run db:seed');
  }
}

main()
  .catch((e) => {
    console.error('\nUpgrade dibatalkan. Tidak ada data yang dihapus.');
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
