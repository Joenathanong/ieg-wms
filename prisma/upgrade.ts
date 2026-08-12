/**
 * Menjalankan prisma/upgrade.sql — upgrade skema TANPA menghapus data.
 * Aman diulang berkali-kali.
 *
 *   npm run db:upgrade
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

function label(sql: string): string {
  const line =
    sql
      .split('\n')
      .map((l) => l.trim())
      .find((l) => l && !l.startsWith('--')) ?? sql.trim();
  return line.replace(/\s+/g, ' ').slice(0, 78);
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
