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
  console.log('→ DIRECT_URL host   :', hostOf(process.env.DIRECT_URL));
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
      console.error('   1. Compute Neon sedang suspend / kuota jam-compute bulan ini habis.');
      console.error('      Buka https://console.neon.tech → pilih project → lihat status Compute.');
      console.error('   2. Jaringan kantor memblokir port 5432 keluar.');
      console.error('   3. Endpoint berubah setelah branch di-reset — salin ulang connection string.');
    } else if (/password authentication failed|P1000/i.test(m)) {
      console.error('  Username / password di .env salah. Salin ulang dari Neon console.');
    } else if (/does not exist/i.test(m)) {
      console.error('  Nama database di connection string tidak ditemukan.');
    }
    console.error('\n  Pesan asli:', m.split('\n')[0]);
    process.exit(1);
  }

  // ringkasan isi database
  const tables = await prisma.$queryRaw<{ table_name: string }[]>`
    SELECT table_name FROM information_schema.tables
     WHERE table_schema = 'public' ORDER BY table_name`;
  console.log(`Tabel terpasang (${tables.length}):`, tables.map((t) => t.table_name).join(', ') || '(kosong)');

  const missing: string[] = [];
  const need = [
    ['users', 'pdt_enabled'],
    ['packaging_types', 'su_type'],
    ['packaging_types', 'zone_group'],
    ['storage_bins', 'is_interim'],
    ['phys_inv_doc_items', 'bin_code'],
    ['migo_logs', 'tr_number'],
  ];
  for (const [t, c] of need) {
    const r = await prisma.$queryRaw<{ n: bigint }[]>`
      SELECT COUNT(*)::bigint AS n FROM information_schema.columns
       WHERE table_schema='public' AND table_name=${t} AND column_name=${c}`;
    if (Number(r[0]?.n ?? 0) === 0) missing.push(`${t}.${c}`);
  }

  if (missing.length) {
    console.log('\n⚠  Skema tertinggal. Kolom yang belum ada:', missing.join(', '));
    console.log('   Perbaiki tanpa kehilangan data dengan:  npm run db:upgrade');
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
