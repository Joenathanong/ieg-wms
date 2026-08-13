/**
 * Diagnosa cepat kondisi database vs skema aplikasi.
 *
 *   npm run db:diag
 *
 * Hanya MEMBACA. Satu-satunya operasi tulis adalah percobaan INSERT storage bin
 * di dalam transaksi yang selalu di-rollback, supaya error asli dari PostgreSQL
 * bisa ditampilkan apa adanya. Tidak ada data yang berubah.
 */
import { PrismaClient, Prisma } from '@prisma/client';

const prisma = new PrismaClient();

function head(t: string) {
  console.log(`\n${'─'.repeat(72)}\n${t}\n${'─'.repeat(72)}`);
}

function hostOf(url?: string) {
  if (!url) return '(DATABASE_URL kosong)';
  try {
    const u = new URL(url);
    return `${u.hostname}${u.pathname}`;
  } catch {
    return '(DATABASE_URL tidak bisa dibaca)';
  }
}

async function main() {
  head('TARGET DATABASE');
  console.log('  host   :', hostOf(process.env.DATABASE_URL));

  // ---------------------------------------------------------------- kolom
  head('KOLOM TABEL storage_bins (apa adanya di database)');
  const cols = await prisma.$queryRaw<
    { column_name: string; data_type: string; is_nullable: string; column_default: string | null }[]
  >(Prisma.sql`
    SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns
     WHERE table_name = 'storage_bins'
     ORDER BY ordinal_position
  `);
  if (cols.length === 0) {
    console.log('  ✖ tabel storage_bins TIDAK ADA — jalankan npm run db:upgrade');
  } else {
    for (const c of cols) {
      const nn = c.is_nullable === 'NO' ? 'NOT NULL' : 'null ok ';
      const df = c.column_default ? ` default ${c.column_default}` : '';
      console.log(`  ${c.column_name.padEnd(16)} ${c.data_type.padEnd(26)} ${nn}${df}`);
    }
  }

  // ------------------------------------------------------- kolom warisan
  // Kolom NOT NULL tanpa default yang tidak dikenal skema Prisma akan
  // memblokir SETIAP INSERT ke tabelnya (Prisma P2011). Ini penyebab paling
  // sering setelah aplikasi berganti versi tanpa migrasi resmi.
  head('KOLOM WARISAN YANG MEMBLOKIR INSERT');
  const blockers: string[] = [];
  for (const m of Prisma.dmmf.datamodel.models) {
    const table = m.dbName ?? m.name;
    const known = new Set(
      m.fields.filter((f) => f.kind !== 'object').map((f) => f.dbName ?? f.name)
    );
    const tcols = await prisma.$queryRaw<
      { column_name: string; is_nullable: string; column_default: string | null }[]
    >`
      SELECT column_name, is_nullable, column_default
        FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = ${table}
    `;
    for (const c of tcols) {
      if (known.has(c.column_name)) continue;
      if (c.is_nullable !== 'NO' || c.column_default) continue;
      blockers.push(`${table}.${c.column_name}`);
    }
  }
  if (blockers.length === 0) {
    console.log('  ✔ tidak ada — semua tabel bisa menerima baris baru');
  } else {
    for (const b of blockers) console.log(`  ✖ ${b}  (NOT NULL, tidak dikenal aplikasi)`);
    console.log('\n  Perbaikan: npm run db:upgrade  (kolom dilonggarkan, tidak dihapus)');
  }

  // ---------------------------------------------------------------- tabel
  head('TABEL YANG DIBUTUHKAN');
  const tables = await prisma.$queryRaw<{ table_name: string }[]>(Prisma.sql`
    SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'
  `);
  const have = new Set(tables.map((t) => t.table_name));
  for (const t of [
    'zones',
    'storage_bins',
    'stock_im',
    'stock_wm',
    'materials',
    'packaging_types',
    'transfer_reqs',
    'phys_inv_doc_items',
    'auth_roles',
    'system_settings',
  ]) {
    console.log(`  ${have.has(t) ? '✔' : '✖'} ${t}`);
  }

  // ---------------------------------------------------------------- isi
  head('ISI DATA');
  const binCount = await prisma.storageBin.count();
  console.log('  storage_bins :', binCount);
  if (have.has('zones')) {
    const z = await prisma.$queryRaw<{ n: bigint }[]>(Prisma.sql`SELECT count(*)::bigint AS n FROM "zones"`);
    console.log('  zones        :', Number(z[0]?.n ?? 0));
  } else {
    console.log('  zones        : (tabel belum ada — aplikasi memakai zona bawaan dari kode)');
  }

  const bad = await prisma.$queryRaw<{ n: bigint }[]>(Prisma.sql`
    SELECT count(*)::bigint AS n FROM "storage_bins" WHERE "bin_code" IS NULL OR "zone_id" IS NULL
  `);
  console.log('  baris storage_bins dengan bin_code/zone_id NULL :', Number(bad[0]?.n ?? 0));

  // ---------------------------------------------------------------- uji
  head('UJI INSERT (di dalam transaksi, SELALU dibatalkan)');
  const probe = `ZZ-DIAG-${Date.now()}`;
  try {
    await prisma.$transaction(async (tx) => {
      const row = await tx.storageBin.create({
        data: {
          bin_code: probe,
          zone_id: 'GB-HDR',
          max_weight_kg: 1000,
          is_interim: false,
        },
      });
      console.log(`  ✔ INSERT berhasil (id ${row.id}) — dibatalkan sekarang.`);
      throw new Error('__ROLLBACK__');
    });
  } catch (e) {
    if (e instanceof Error && e.message === '__ROLLBACK__') {
      console.log('  ✔ Rollback OK — tidak ada data tersisa.');
      console.log('\n  Kesimpulan: INSERT storage bin SEHAT di level database.');
      console.log('  Error P2011 kemungkinan berasal dari layar/route lain, bukan dari create bin.');
    } else if (e instanceof Prisma.PrismaClientKnownRequestError) {
      console.log(`  ✖ GAGAL — Prisma ${e.code}`);
      console.log('    meta :', JSON.stringify(e.meta));
      console.log('    pesan:', e.message.split('\n').filter(Boolean).slice(-3).join(' | '));
    } else {
      console.log('  ✖ GAGAL —', e instanceof Error ? e.message.split('\n')[0] : String(e));
    }
  }

  // sisa data uji kalau transaksi ternyata ter-commit sebagian
  const leftover = await prisma.storageBin.count({ where: { bin_code: { startsWith: 'ZZ-DIAG-' } } });
  if (leftover > 0) {
    console.log(`\n  ⚠ Ada ${leftover} bin uji tersisa (ZZ-DIAG-*). Hapus manual di LS01N.`);
  }

  console.log('');
}

main()
  .catch((e) => {
    console.error('\nDIAG GAGAL:', e instanceof Error ? e.message : e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
