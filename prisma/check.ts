/**
 * Diagnosa koneksi database — menjelaskan penyebab kegagalan dengan bahasa manusia.
 *
 *   npm run db:check
 *
 * Memeriksa tiga lapis berurutan: koneksi, kelengkapan skema, lalu isi data.
 * Berhenti di lapis pertama yang gagal, karena lapis berikutnya tidak mungkin
 * dinilai kalau yang sebelumnya belum beres.
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
    const code = (e as { errorCode?: string; code?: string })?.errorCode ?? (e as { code?: string })?.code ?? '';
    console.error('✖ Tidak bisa terhubung ke database.\n');

    if (/Can't reach database server|P1001/i.test(m) || code === 'P1001') {
      console.error('  Server tidak menjawab sama sekali. Penyebab paling sering, berurutan:\n');
      console.error('   1. Cluster TiDB Serverless sedang tidur atau disuspend.');
      console.error('      Buka https://tidbcloud.com → pilih cluster → lihat status.');
      console.error('      - "Paused"/"Resuming" : koneksi pertama membangunkannya, tetapi sering');
      console.error('        gagal lebih dulu. Ulangi perintah 1-2 kali dengan jeda ±30 detik.');
      console.error('      - "Suspended"          : kuota Request Unit bulan ini habis. Tidak ada');
      console.error('        yang bisa diperbaiki dari sisi aplikasi sampai kuotanya pulih.\n');
      console.error('   2. Jaringan memblokir port 4000 keluar (TiDB memakai 4000, bukan 3306).');
      console.error('      Uji dari komputer ini:  Test-NetConnection <host> -Port 4000\n');
      console.error('   3. Endpoint berubah setelah cluster dibuat ulang — salin ulang connection');
      console.error('      string dari TiDB Cloud → Connect, lalu periksa bentuknya: npm run db:url');
    } else if (/authentication failed|Access denied|P1000/i.test(m) || code === 'P1000') {
      console.error('  Server terjangkau, tetapi user/password ditolak.');
      console.error('  Salin ulang dari TiDB Cloud → Connect (password lama tidak bisa dilihat lagi),');
      console.error('  lalu periksa bentuk URL-nya: npm run db:url');
    } else if (/Unknown database|does not exist/i.test(m)) {
      console.error('  Server & kredensial oke, tetapi nama database di URL tidak ditemukan.');
      console.error('  Periksa bagian akhir DATABASE_URL: npm run db:url');
    } else if (/timeout|ETIMEDOUT/i.test(m)) {
      console.error('  Koneksi habis waktu. Bila cluster baru bangun dari tidur, ulangi sekali lagi.');
    }

    /**
     * Prisma memformat pesannya dengan baris kosong di depan, jadi mengambil
     * `split('\n')[0]` begitu saja menghasilkan string KOSONG — persis
     * kesalahan yang membuat diagnosa ini dulu tidak berguna. Diambil baris
     * pertama yang benar-benar berisi.
     */
    const firstLine = m.split('\n').map((l) => l.trim()).find(Boolean) ?? '(tidak ada pesan)';
    console.error(`\n  Pesan asli${code ? ` [${code}]` : ''}: ${firstLine}`);
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
    ['materials', 'is_active'],
    ['material_aliases', 'alias_code'],
    ['users', 'theme'],
    ['users', 'so_enabled'],
    ['migo_logs', 'line_no'],
    ['migo_logs', 'reversal_of_line'],
    ['transfer_req_items', 'src_line'],
    ['transfer_req_items', 'suggested_bin'],
    ['phys_inv_assigns', 'material_code'],
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
