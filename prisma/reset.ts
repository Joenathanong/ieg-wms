/**
 * =====================================================================
 *  RESET DATA — mengosongkan isi database secara terkendali
 * =====================================================================
 *
 * DEFAULT-nya hanya MENAMPILKAN apa yang akan dihapus (dry run).
 * Penghapusan sungguhan baru berjalan bila diberi flag --yes.
 *
 *   npm run db:reset                      # lihat dulu (tidak menghapus apa pun)
 *   npm run db:reset -- --all --yes       # kosongkan semua, user tetap ada
 *
 * Pilihan:
 *   --tx          Transaksi & stok: material document (MB51), transfer
 *                 requirement, dokumen stock opname, Stock IM, Stock WM.
 *                 Semua bin dikembalikan ke status EMPTY.
 *   --demo        Master data CONTOH dari seed (FG-0001..FG-0003, SP-1001,
 *                 SP-1002) beserta palletization-nya.
 *   --master      SELURUH master data: material, palletization, storage bin.
 *                 Otomatis menyertakan --tx.
 *   --counters    Kembalikan penomoran dokumen (MATDOC/TRDOC/TRREQ/PIDOC)
 *                 ke nomor awal.
 *   --users       Hapus user selain ADMIN (ADMIN aktif selalu dipertahankan).
 *   --settings    Kembalikan konfigurasi ZSET ke nilai bawaan.
 *   --all         = --tx --master --counters   (USER TIDAK DIHAPUS)
 *   --no-interim  Jangan membuat ulang bin transit setelah --master.
 *   --yes         Jalankan penghapusan (tanpa ini hanya dry run).
 *
 * Catatan: bin transit (DEFAULT_GR_BIN / DEFAULT_GI_BIN pada ZSET) dibuat
 * ulang otomatis setelah --master, karena MIGO 101/201 menolak posting bila
 * bin interim tidak ada.
 */
import { PrismaClient, BinStatus } from '@prisma/client';
import { SETTING_DEFAULTS } from '../src/lib/settings';

const prisma = new PrismaClient();

/** material contoh yang dibuat oleh prisma/seed.ts */
const DEMO_MATERIALS = ['FG-0001', 'FG-0002', 'FG-0003', 'SP-1001', 'SP-1002'];
/** user contoh yang dibuat oleh prisma/seed.ts */
const DEMO_USERS = ['WHOPR01', 'WHOPR02'];

const argv = process.argv.slice(2);
const has = (f: string) => argv.includes(f);

const OPT = {
  all: has('--all'),
  tx: has('--tx') || has('--all') || has('--master'),
  demo: has('--demo'),
  master: has('--master') || has('--all'),
  counters: has('--counters') || has('--all'),
  users: has('--users'),
  settings: has('--settings'),
  interim: !has('--no-interim'),
  confirm: has('--yes'),
};

function hostOf(url?: string): string {
  if (!url) return '(DATABASE_URL tidak diset)';
  try {
    const u = new URL(url);
    return `${u.host}${u.pathname}`;
  } catch {
    return '(format URL tidak valid)';
  }
}

function line(char = '─', n = 70) {
  console.log(char.repeat(n));
}

async function counts() {
  const [
    materials,
    packagings,
    bins,
    stockIm,
    stockWm,
    docs,
    trs,
    trItems,
    piDocs,
    piItems,
    counters,
    users,
    settings,
  ] = await Promise.all([
    prisma.material.count(),
    prisma.packagingType.count(),
    prisma.storageBin.count(),
    prisma.stockIM.count(),
    prisma.stockWM.count(),
    prisma.migoLog.count(),
    prisma.transferReq.count(),
    prisma.transferReqItem.count(),
    prisma.physInvDoc.count(),
    prisma.physInvDocItem.count(),
    prisma.documentCounter.count(),
    prisma.user.count(),
    prisma.systemSetting.count(),
  ]);
  return {
    materials,
    packagings,
    bins,
    stockIm,
    stockWm,
    docs,
    trs,
    trItems,
    piDocs,
    piItems,
    counters,
    users,
    settings,
  };
}

function report(c: Awaited<ReturnType<typeof counts>>, title: string) {
  console.log(`\n${title}`);
  line();
  const row = (label: string, n: number, hit: boolean) =>
    console.log(`  ${hit ? '✗' : '·'} ${label.padEnd(38)} ${String(n).padStart(8)}`);

  row('Material document (MB51)', c.docs, OPT.tx);
  row('Transfer requirement (header)', c.trs, OPT.tx);
  row('Transfer requirement (item)', c.trItems, OPT.tx);
  row('Dokumen stock opname (header)', c.piDocs, OPT.tx);
  row('Dokumen stock opname (item)', c.piItems, OPT.tx);
  row('Stock IM (global)', c.stockIm, OPT.tx);
  row('Stock WM (quant per bin)', c.stockWm, OPT.tx);
  row('Material master', c.materials, OPT.master || OPT.demo);
  row('Palletization', c.packagings, OPT.master || OPT.demo);
  row('Storage bin', c.bins, OPT.master);
  row('Number range (document_counters)', c.counters, OPT.counters);
  row('User', c.users, OPT.users);
  row('Konfigurasi ZSET', c.settings, OPT.settings);
  line();
}

async function main() {
  console.log('\n╔══════════════════════════════════════════════════════════════════╗');
  console.log('║  WMS LITE — RESET DATA                                           ║');
  console.log('╚══════════════════════════════════════════════════════════════════╝');
  console.log(`  Database : ${hostOf(process.env.DATABASE_URL)}`);
  console.log(
    `  Sistem   : ${process.env.NEXT_PUBLIC_SAP_SYSTEM ?? 'PRD'} / client ${
      process.env.NEXT_PUBLIC_SAP_CLIENT ?? '100'
    }`
  );
  console.log(`  Mode     : ${OPT.confirm ? '⚠  HAPUS SUNGGUHAN' : 'dry run (tidak menghapus)'}`);

  if (!OPT.tx && !OPT.demo && !OPT.master && !OPT.counters && !OPT.users && !OPT.settings) {
    console.log(
      '\n  Tidak ada pilihan yang diberikan. Contoh pemakaian:\n' +
        '    npm run db:reset -- --tx                 (lihat dampak hapus transaksi)\n' +
        '    npm run db:reset -- --all --yes          (kosongkan semua, user tetap)\n' +
        '    npm run db:reset -- --tx --counters --yes\n'
    );
    const c = await counts();
    report(c, 'Isi database saat ini:');
    return;
  }

  const before = await counts();
  report(before, OPT.confirm ? 'Akan DIHAPUS (tanda ✗):' : 'Rencana penghapusan (tanda ✗) — DRY RUN:');

  if (!OPT.confirm) {
    console.log(
      '\n  Ini baru simulasi. Tambahkan --yes untuk benar-benar menghapus.\n' +
        '  Disarankan backup dulu (Neon: buat branch/snapshot sebelum reset).\n'
    );
    return;
  }

  console.log('\n→ Menghapus ...');

  await prisma.$transaction(async (tx) => {
    /* ---------- transaksi & stok ---------- */
    if (OPT.tx) {
      await tx.physInvDocItem.deleteMany({});
      await tx.physInvDoc.deleteMany({});
      await tx.transferReqItem.deleteMany({});
      await tx.transferReq.deleteMany({});
      await tx.migoLog.deleteMany({});
      await tx.stockWM.deleteMany({});
      await tx.stockIM.deleteMany({});
      console.log('  ✔ transaksi, dokumen, dan stok dikosongkan');
    }

    /* ---------- master data ---------- */
    if (OPT.master) {
      await tx.packagingType.deleteMany({});
      await tx.material.deleteMany({});
      await tx.storageBin.deleteMany({});
      console.log('  ✔ seluruh master data dihapus');
    } else if (OPT.demo) {
      await tx.packagingType.deleteMany({ where: { material_code: { in: DEMO_MATERIALS } } });
      await tx.stockWM.deleteMany({ where: { material_code: { in: DEMO_MATERIALS } } });
      await tx.stockIM.deleteMany({ where: { material_code: { in: DEMO_MATERIALS } } });
      await tx.material.deleteMany({ where: { material_code: { in: DEMO_MATERIALS } } });
      console.log(`  ✔ material contoh dihapus (${DEMO_MATERIALS.join(', ')})`);
    }

    /* ---------- bin transit dibuat ulang ---------- */
    if (OPT.master && OPT.interim) {
      const grBin = (
        await tx.systemSetting.findUnique({ where: { key: 'DEFAULT_GR_BIN' } })
      )?.value ?? SETTING_DEFAULTS.DEFAULT_GR_BIN;
      const giBin = (
        await tx.systemSetting.findUnique({ where: { key: 'DEFAULT_GI_BIN' } })
      )?.value ?? SETTING_DEFAULTS.DEFAULT_GI_BIN;

      for (const [code, zone] of [
        [grBin.toUpperCase(), 'TRANSIT-IN'],
        [giBin.toUpperCase(), 'TRANSIT-OUT'],
      ] as const) {
        await tx.storageBin.upsert({
          where: { bin_code: code },
          create: {
            bin_code: code,
            zone_id: zone,
            max_weight_kg: 10000,
            is_interim: true,
            status: BinStatus.EMPTY,
          },
          update: { is_interim: true, status: BinStatus.EMPTY },
        });
      }
      console.log(`  ✔ bin transit dibuat ulang (${grBin}, ${giBin}) agar MIGO tetap bisa posting`);
    }

    /* ---------- status bin ---------- */
    if (OPT.tx && !OPT.master) {
      await tx.storageBin.updateMany({
        where: { status: { not: BinStatus.BLOCKED } },
        data: { status: BinStatus.EMPTY },
      });
      console.log('  ✔ status bin dikembalikan ke EMPTY (bin BLOCKED dibiarkan)');
    }

    /* ---------- penomoran dokumen ---------- */
    if (OPT.counters) {
      await tx.documentCounter.deleteMany({});
      console.log('  ✔ penomoran dokumen direset ke nomor awal');
    }

    /* ---------- user ---------- */
    if (OPT.users) {
      await tx.user.deleteMany({ where: { role: { not: 'ADMIN' } } });
      console.log('  ✔ user non-ADMIN dihapus');
    }

    /* ---------- konfigurasi ---------- */
    if (OPT.settings) {
      for (const [key, value] of Object.entries(SETTING_DEFAULTS)) {
        await tx.systemSetting.upsert({
          where: { key },
          create: { key, value, updated_by: 'RESET' },
          update: { value, updated_by: 'RESET' },
        });
      }
      console.log('  ✔ konfigurasi ZSET dikembalikan ke nilai bawaan');
    }
  }, { timeout: 120000, maxWait: 20000 });

  const after = await counts();
  report(after, 'Isi database setelah reset:');

  const users = await prisma.user.findMany({
    select: { username: true, role: true, is_active: true },
    orderBy: { username: 'asc' },
  });
  console.log('  User yang tersisa:');
  users.forEach((u) => console.log(`    · ${u.username.padEnd(12)} ${u.role}${u.is_active ? '' : ' (locked)'}`));
  if (users.length === 0) {
    console.log('    (kosong — ADMIN/admin123 akan dibuat otomatis saat login pertama)');
  }

  console.log('\n  Langkah berikutnya:');
  if (OPT.master) {
    console.log('    1. Upload master data lewat ZUPLOAD dengan urutan:');
    console.log('       Material → Pallet → Storage Bin → Initial Stock → Safety Stock');
    console.log('    2. Periksa bin transit di ZSET (DEFAULT_GR_BIN / DEFAULT_GI_BIN).');
  } else {
    console.log('    1. Periksa MB52 & LX02 — seharusnya sudah kosong.');
  }
  console.log('    3. Ganti password ADMIN di SU01 sebelum dipakai produksi.\n');
}

main()
  .catch((e) => {
    console.error('\n✖ Reset dibatalkan:', e instanceof Error ? e.message : e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
