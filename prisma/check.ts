/**
 * Diagnosa koneksi database — menjelaskan penyebab kegagalan dengan bahasa manusia.
 *
 *   npm run db:check
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

function hostOf(url?: string): string {
  if (!url) return '(tidak diset)';
  try {
    return new URL(url).host;
  } catch {
    return '(format URL tidak valid)';
  }
}

async function main() {
  console.log('→ DATABASE_URL host :', hostOf(process.env.DATABASE_URL));
  console.log('');

  const t0 = Date.now();
  try {
    await prisma.$queryRaw`SELECT 1`;
    console.log(`✔ Koneksi database OK (${Date.now() - t0} ms)\n`);
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    console.error('✖ Tidak bisa terhubung ke database.\n');
    if (/Can't reach database server|P1001/i.test(m)) {
      console.error('  Penyebab yang paling sering, berurutan:');
      console.error('   1. Cluster TiDB Serverless sedang di-scale-to-zero / kuota bulan ini habis.');
      console.error('      Buka https://console.neon.tech → pilih project → lihat status Compute.');
      console.error('   2. Jaringan kantor memblokir port 5432 keluar.');
      console.error('   3. Endpoint berubah setelah branch di-reset — salin ulang connection string.');
    } else if (/password authentication failed|P1000/i.test(m)) {
      console.error('  Username / password di .env salah. Salin ulang dari TiDB Cloud (Connect).');
    } else if (/does not exist/i.test(m)) {
      console.error('  Nama database di connection string tidak ditemukan.');
    }
    console.error('\n  Pesan asli:', m.split('\n')[0]);
    process.exit(1);
  }

  // ringkasan isi database
  const tables = await prisma.$queryRaw<{ TABLE_NAME: string }[]>`
    SELECT TABLE_NAME FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE() ORDER BY TABLE_NAME`;
  console.log(
    `Tabel terpasang (${tables.length}):`,
    tables.map((t) => t.TABLE_NAME).join(', ') || '(kosong)'
  );

  const missing: string[] = [];
  const need = [
    ['users', 'pdt_enabled'],
    ['users', 'auth_role_id'],
    ['auth_roles', 'tcodes'],
    ['packaging_types', 'su_type'],
    ['packaging_types', 'zone_group'],
    ['storage_bins', 'is_interim'],
    ['phys_inv_doc_items', 'bin_code'],
    ['migo_logs', 'tr_number'],
    ['migo_logs', 'reversal_of'],
    ['stock_wm', 'gr_date'],
    ['materials', 'barcode_bpom'],
    ['materials', 'fix_bin'],
  ];
  for (const [t, c] of need) {
    const r = await prisma.$queryRaw<{ n: bigint }[]>`
      SELECT COUNT(*) AS n FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME=${t} AND COLUMN_NAME=${c}`;
    if (Number(r[0]?.n ?? 0) === 0) missing.push(`${t}.${c}`);
  }

  if (missing.length) {
    console.log('\n⚠  Skema tertinggal. Kolom yang belum ada:', missing.join(', '));
    console.log('   Perbaiki dengan:  npm run db:push  lalu  npm run db:upgrade');
  } else {
    console.log('\n✔ Skema sudah sesuai versi terbaru.');
    const u = await prisma.user.count();
    const b = await prisma.storageBin.count();
    const m = await prisma.material.count();
    console.log(`  Isi: ${u} user · ${m} material · ${b} storage bin`);
    if (u === 0) console.log('  ⚠ Belum ada user — jalankan: npm run db:seed');
  }
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
