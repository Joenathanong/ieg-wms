/**
 * Diagnosa kondisi database TiDB / MySQL vs skema aplikasi.
 *
 *   npm run db:diag
 *
 * Hanya MEMBACA. Satu-satunya operasi tulis adalah percobaan INSERT storage bin
 * di dalam transaksi yang selalu di-rollback, supaya error asli dari database
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

  const ver = await prisma.$queryRaw<{ v: string }[]>`SELECT VERSION() AS v`;
  console.log('  versi  :', ver[0]?.v ?? '(tidak terbaca)');

  const dbinfo = await prisma.$queryRaw<{ db: string; coll: string }[]>`
    SELECT DATABASE() AS db, @@collation_database AS coll
  `;
  console.log('  schema :', dbinfo[0]?.db ?? '-');
  console.log('  collation:', dbinfo[0]?.coll ?? '-');
  if (dbinfo[0]?.coll && !dbinfo[0].coll.endsWith('_ci')) {
    console.log(
      '  ⚠ collation PEKA huruf besar-kecil — pencarian material/barcode bisa meleset.'
    );
    console.log('    Perbaikan: npm run db:upgrade');
  }

  // ---------------------------------------------------------------- kolom
  head('KOLOM TABEL storage_bins (apa adanya di database)');
  const cols = await prisma.$queryRaw<
    { COLUMN_NAME: string; COLUMN_TYPE: string; IS_NULLABLE: string; COLUMN_DEFAULT: string | null }[]
  >`
    SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT
      FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'storage_bins'
     ORDER BY ORDINAL_POSITION
  `;
  if (cols.length === 0) {
    console.log('  ✖ tabel storage_bins TIDAK ADA — jalankan npm run db:push');
  } else {
    for (const c of cols) {
      const nn = c.IS_NULLABLE === 'NO' ? 'NOT NULL' : 'null ok ';
      const df = c.COLUMN_DEFAULT ? ` default ${c.COLUMN_DEFAULT}` : '';
      console.log(`  ${c.COLUMN_NAME.padEnd(16)} ${c.COLUMN_TYPE.padEnd(26)} ${nn}${df}`);
    }
  }

  // ---------------------------------------------------------------- tabel
  head('TABEL YANG DIBUTUHKAN');
  const tables = await prisma.$queryRaw<{ TABLE_NAME: string }[]>`
    SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE()
  `;
  const have = new Set(tables.map((t) => t.TABLE_NAME));
  for (const t of [
    'zones',
    'cost_centers',
    'storage_bins',
    'stock_im',
    'stock_wm',
    'materials',
    'packaging_types',
    'transfer_reqs',
    'phys_inv_docs',
    'phys_inv_bins',
    'phys_inv_doc_items',
    'sales_take_docs',
    'sales_take_items',
    'auth_roles',
    'system_settings',
  ]) {
    console.log(`  ${have.has(t) ? '✔' : '✖'} ${t}`);
  }

  // ---------------------------------------------------------------- isi
  head('ISI DATA');
  console.log('  storage_bins :', await prisma.storageBin.count());
  console.log('  zones        :', await prisma.zone.count());
  console.log('  materials    :', await prisma.material.count());
  console.log('  users        :', await prisma.user.count());

  // ------------------------------------------------------- kolom warisan
  head('KOLOM WARISAN YANG MEMBLOKIR INSERT');
  const blockers: string[] = [];
  for (const m of Prisma.dmmf.datamodel.models) {
    const table = m.dbName ?? m.name;
    const known = new Set(
      m.fields.filter((f) => f.kind !== 'object').map((f) => f.dbName ?? f.name)
    );
    const tcols = await prisma.$queryRaw<
      { COLUMN_NAME: string; IS_NULLABLE: string; COLUMN_DEFAULT: string | null }[]
    >`
      SELECT COLUMN_NAME, IS_NULLABLE, COLUMN_DEFAULT
        FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ${table}
    `;
    for (const c of tcols) {
      if (known.has(c.COLUMN_NAME)) continue;
      if (c.IS_NULLABLE !== 'NO' || c.COLUMN_DEFAULT !== null) continue;
      blockers.push(`${table}.${c.COLUMN_NAME}`);
    }
  }
  if (blockers.length === 0) {
    console.log('  ✔ tidak ada — semua tabel bisa menerima baris baru');
  } else {
    for (const b of blockers) console.log(`  ✖ ${b}  (NOT NULL, tidak dikenal aplikasi)`);
    console.log('\n  Perbaikan: npm run db:upgrade');
  }

  // ---------------------------------------------------------------- uji
  head('UJI INSERT (di dalam transaksi, SELALU dibatalkan)');
  const probe = `ZZ-DIAG-${Date.now()}`;
  try {
    await prisma.$transaction(async (tx) => {
      const row = await tx.storageBin.create({
        data: { bin_code: probe, zone_id: 'GB-HDR', max_weight_kg: 1000, is_interim: false },
      });
      console.log(`  ✔ INSERT berhasil (id ${row.id}) — dibatalkan sekarang.`);
      throw new Error('__ROLLBACK__');
    });
  } catch (e) {
    if (e instanceof Error && e.message === '__ROLLBACK__') {
      console.log('  ✔ Rollback OK — tidak ada data tersisa.');
    } else if (e instanceof Prisma.PrismaClientKnownRequestError) {
      console.log(`  ✖ GAGAL — Prisma ${e.code}`);
      console.log('    meta :', JSON.stringify(e.meta));
      console.log('    pesan:', e.message.split('\n').filter(Boolean).slice(-3).join(' | '));
    } else {
      console.log('  ✖ GAGAL —', e instanceof Error ? e.message.split('\n')[0] : String(e));
    }
  }

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
