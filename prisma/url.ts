/**
 * Periksa DATABASE_URL TANPA menghubungi server.
 *
 *   npm run db:url
 *
 * Dipakai saat `prisma db push` gagal dengan P1000 (authentication failed):
 * penyebab paling sering bukan password yang salah, melainkan URL yang rusak
 * karena karakter khusus di password tidak di-encode.
 */

const RAW = process.env.DATABASE_URL ?? '';

function warn(msg: string) {
  console.log(`  ⚠  ${msg}`);
}

function main() {
  console.log('\n─────────────────────────────────────────────────────────');
  console.log(' PEMERIKSAAN DATABASE_URL (tidak menghubungi server)');
  console.log('─────────────────────────────────────────────────────────\n');

  if (!RAW) {
    console.log('  ✖ DATABASE_URL kosong. Isi di file .env\n');
    process.exit(1);
  }

  let u: URL;
  try {
    u = new URL(RAW);
  } catch {
    console.log('  ✖ URL tidak bisa diurai sama sekali.');
    console.log('    Hampir selalu karena password mengandung @ / : # ? &');
    console.log('    yang belum di-encode. Lihat cara encode di bawah.\n');
    process.exit(1);
  }

  const db = u.pathname.replace(/^\//, '');
  const params = [...u.searchParams.entries()];

  console.log('  protokol :', u.protocol.replace(':', ''));
  console.log('  user     :', decodeURIComponent(u.username) || '(kosong)');
  console.log('  password :', u.password ? `${u.password.length} karakter (tersembunyi)` : '(kosong)');
  console.log('  host     :', u.hostname);
  console.log('  port     :', u.port || '(default)');
  console.log('  database :', db || '(kosong)');
  console.log('  parameter:', params.length ? params.map(([k, v]) => `${k}=${v}`).join(', ') : '(tidak ada)');
  console.log('');

  let problems = 0;

  if (u.protocol !== 'mysql:') {
    warn(`protokol "${u.protocol.replace(':', '')}" — untuk TiDB harus mysql://`);
    problems++;
  }

  if (!db) {
    warn('nama database KOSONG. Tambahkan di akhir host, mis. ...:4000/wms');
    problems++;
  } else if (['sys', 'mysql', 'information_schema', 'performance_schema', 'test'].includes(db)) {
    warn(
      `database "${db}" adalah database bawaan server, bukan milik Anda. ` +
        'Buat database sendiri di TiDB Cloud SQL Editor: CREATE DATABASE wms; ' +
        'lalu ganti bagian akhir URL menjadi /wms'
    );
    problems++;
  }

  if (!u.searchParams.get('sslaccept')) {
    warn('parameter sslaccept=strict tidak ada — TiDB Serverless mewajibkan TLS.');
    problems++;
  }

  // Password yang mengandung karakter ini HARUS di-encode; kalau tidak,
  // URL terpotong atau salah dibaca sehingga user/host ikut kacau.
  const risky = ['@', '/', ':', '#', '?', '&', '%', ' '];
  const rawPwPart = RAW.slice(RAW.indexOf('://') + 3, RAW.lastIndexOf('@'));
  const rawPw = rawPwPart.includes(':') ? rawPwPart.slice(rawPwPart.indexOf(':') + 1) : '';
  const found = risky.filter((c) => rawPw.includes(c));
  if (found.length > 0) {
    warn(
      `password di URL mengandung karakter mentah: ${found.join(' ')} — ` +
        'ini membuat URL salah dibaca. Encode dulu (lihat di bawah).'
    );
    problems++;
  }

  if (!/\.root$/.test(decodeURIComponent(u.username)) && u.hostname.includes('tidbcloud')) {
    warn(`user "${decodeURIComponent(u.username)}" tidak berakhiran ".root" — cek lagi di TiDB Cloud → Connect.`);
    problems++;
  }

  console.log('');
  if (problems === 0) {
    console.log('  ✔ Bentuk URL sudah benar.');
    console.log('    Kalau tetap P1000, passwordnya memang salah — reset di');
    console.log('    TiDB Cloud → Connect → Generate Password (password lama tidak bisa dilihat lagi).\n');
  } else {
    console.log(`  ${problems} hal perlu diperbaiki.\n`);
    console.log('  Cara meng-encode password:');
    console.log("    node -e \"console.log(encodeURIComponent('PASSWORD_ASLI'))\"");
    console.log('  lalu tempel hasilnya ke URL, JANGAN password aslinya.\n');
  }
}

main()
