/**
 * Seed data awal:
 *  - user ADMIN / admin123, operator dengan akses PDT
 *  - konfigurasi sistem (ZSET)
 *  - contoh material + master pallet, storage bin (termasuk GR/GI interim), dan saldo awal
 *
 * Jalankan:  npm run db:seed
 */
import { PrismaClient, BinStatus, MovementType } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { ZONES } from '../src/lib/zones';
import { SETTING_DEFAULTS } from '../src/lib/settings';

/**
 * `npm run db:seed -- --minimal`
 *
 * Mode untuk database SUNGGUHAN: hanya menanam yang memang dibutuhkan supaya
 * aplikasi bisa dipakai — user, konfigurasi, master zona, dan bin transit.
 * Material contoh, master pallet contoh, operator contoh, dan saldo awal
 * contoh TIDAK dibuat. Tanpa ini, database produksi lahir berisi barang
 * karangan yang harus dibersihkan satu per satu.
 */
const MINIMAL = process.argv.slice(2).includes('--minimal');

/**
 * Password ADMIN awal. Wajib diisi pada mode --minimal: 'admin123' tertulis
 * di repositori ini, jadi memakainya di sistem yang bisa diakses publik sama
 * saja dengan tidak memasang password.
 */
const ADMIN_PASSWORD = process.env.BOOTSTRAP_ADMIN_PASSWORD ?? '';
if (MINIMAL && ADMIN_PASSWORD.length < 8) {
  console.error(
    '\n✖ Mode --minimal butuh BOOTSTRAP_ADMIN_PASSWORD minimal 8 karakter.\n' +
      '  Contoh:  BOOTSTRAP_ADMIN_PASSWORD="..." npm run db:seed -- --minimal\n'
  );
  process.exit(1);
}

const prisma = new PrismaClient();

const MATERIALS = [
  {
    material_code: 'FG-0001',
    description: 'Sabun Cair Botol 500ml',
    uom: 'PC',
    is_batch_managed: true,
    min_safety_stock: 100,
    barcode_produk: '8998824551223',
    barcode_bpom: 'NA18201234567',
    kode_ocs: 'GIMMICK-CONTOH-SABUN-CAIR-BOTOL-500ML',
    fix_bin: 'GB-PICK-A-01',
  },
  { material_code: 'FG-0002', description: 'Shampoo Sachet 12ml x 12', uom: 'BOX', is_batch_managed: true, min_safety_stock: 50 },
  { material_code: 'FG-0003', description: 'Hand Sanitizer 100ml', uom: 'PC', is_batch_managed: true, min_safety_stock: 80 },
  { material_code: 'SP-1001', description: 'Karton Box 40x30x25', uom: 'PC', is_batch_managed: false, min_safety_stock: 200 },
  { material_code: 'SP-1002', description: 'Lakban Bening 2 inch', uom: 'ROL', is_batch_managed: false, min_safety_stock: 30 },
];

/** Tabel palletization: material x SU type x kelompok gudang */
const PACKAGINGS = [
  { material_code: 'FG-0001', pack_code: 'PAL-GB', su_type: 'PAL', zone_group: 'BESAR', description: 'Pallet Gudang Besar (10 layer)', qty_per_unit: 1000, is_default: true },
  { material_code: 'FG-0001', pack_code: 'PAL-GB-HALF', su_type: 'PAL', zone_group: 'BESAR', description: 'Setengah pallet', qty_per_unit: 500, is_default: false },
  { material_code: 'FG-0001', pack_code: 'BOX-GK', su_type: 'BINBOX', zone_group: 'KECIL', description: 'Bin box Gudang Kecil', qty_per_unit: 100, is_default: true },
  { material_code: 'FG-0002', pack_code: 'PAL-GB', su_type: 'PAL', zone_group: 'BESAR', description: 'Pallet standar', qty_per_unit: 120, is_default: true },
  { material_code: 'FG-0003', pack_code: 'PAL-GB', su_type: 'PAL', zone_group: 'BESAR', description: 'Pallet standar', qty_per_unit: 600, is_default: true },
  { material_code: 'FG-0003', pack_code: 'BOX-GK', su_type: 'BINBOX', zone_group: 'KECIL', description: 'Bin box', qty_per_unit: 60, is_default: true },
  { material_code: 'SP-1001', pack_code: 'PAL-GB', su_type: 'PAL', zone_group: null as string | null, description: 'Pallet karton (semua gudang)', qty_per_unit: 500, is_default: true },
];

function buildBins() {
  const bins: { bin_code: string; zone_id: string; max_weight_kg: number; is_interim?: boolean }[] = [];

  // Gudang Besar — Heavy Duty Racking: GB-<Aisle>-<Rack>-<Level>-<Posisi>
  for (const aisle of ['A', 'B']) {
    for (let rack = 1; rack <= 4; rack++) {
      for (let lvl = 1; lvl <= 3; lvl++) {
        bins.push({
          bin_code: `GB-${aisle}-${String(rack).padStart(2, '0')}-${String(lvl).padStart(2, '0')}-1`,
          zone_id: 'GB-HDR',
          max_weight_kg: 1500,
        });
      }
    }
  }

  // Pick Bin Gudang Besar: GB-PICK-<Aisle>-<NN>
  for (let i = 1; i <= 4; i++) {
    bins.push({ bin_code: `GB-PICK-A-${String(i).padStart(2, '0')}`, zone_id: 'GB-PICK', max_weight_kg: 300 });
  }

  // Gudang Kecil — Bin Box: GK-<Aisle>-<Rack>-<Level>-<Box>
  for (const aisle of ['B', 'C']) {
    for (let rack = 1; rack <= 3; rack++) {
      for (let lvl = 1; lvl <= 2; lvl++) {
        for (let box = 1; box <= 2; box++) {
          bins.push({
            bin_code: `GK-${aisle}-${String(rack).padStart(2, '0')}-${String(lvl).padStart(2, '0')}-${box}`,
            zone_id: 'GK-BIN',
            max_weight_kg: 60,
          });
        }
      }
    }
  }

  // Pick Bin Gudang Kecil: GK-PICK-<Aisle>-<NN>
  for (let i = 1; i <= 4; i++) {
    bins.push({ bin_code: `GK-PICK-B-${String(i).padStart(2, '0')}`, zone_id: 'GK-PICK', max_weight_kg: 80 });
  }

  // Staging & reject
  bins.push({ bin_code: 'STG-01', zone_id: 'STAGING', max_weight_kg: 5000 });
  bins.push({ bin_code: 'RJ-01', zone_id: 'REJECT', max_weight_kg: 800 });

  // Transit in/out — wajib untuk alur 2-step
  bins.push({ bin_code: 'TRN-IN-01', zone_id: 'TRANSIT-IN', max_weight_kg: 10000, is_interim: true });
  bins.push({ bin_code: 'TRN-IN-02', zone_id: 'TRANSIT-IN', max_weight_kg: 10000, is_interim: true });
  bins.push({ bin_code: 'TRN-OUT-01', zone_id: 'TRANSIT-OUT', max_weight_kg: 10000, is_interim: true });
  bins.push({ bin_code: 'TRN-OUT-02', zone_id: 'TRANSIT-OUT', max_weight_kg: 10000, is_interim: true });

  return bins;
}

const INITIAL = [
  { material_code: 'FG-0001', bin_code: 'GB-A-01-01-1', batch: 'B2608A', mfg: '2026-08-01', exp: '2028-08-01', qty: 480 },
  { material_code: 'FG-0001', bin_code: 'GB-A-01-02-1', batch: 'B2607C', mfg: '2026-07-05', exp: '2026-09-05', qty: 120 },
  { material_code: 'FG-0002', bin_code: 'GB-A-02-01-1', batch: 'B2608B', mfg: '2026-08-05', exp: '2028-02-05', qty: 240 },
  { material_code: 'FG-0003', bin_code: 'GB-PICK-A-01', batch: 'B2606X', mfg: '2026-06-10', exp: '2026-08-25', qty: 60 },
  { material_code: 'SP-1001', bin_code: 'GK-B-01-01-1', batch: null, mfg: null, exp: null, qty: 1000 },
  { material_code: 'SP-1002', bin_code: 'GK-B-01-02-1', batch: null, mfg: null, exp: null, qty: 25 },
];

// Diturunkan dari SETTING_DEFAULTS supaya tidak pernah ketinggalan saat ada
// setting baru — dulu daftar ini ditulis manual dan sempat tertinggal ZRF09.
const SETTINGS = (Object.keys(SETTING_DEFAULTS) as (keyof typeof SETTING_DEFAULTS)[]).map((key) => ({
  key,
  value: SETTING_DEFAULTS[key],
}));

async function main() {
  console.log('→ Seeding users ...');
  await prisma.user.upsert({
    where: { username: 'ADMIN' },
    create: {
      username: 'ADMIN',
      full_name: 'System Administrator',
      password_hash: await bcrypt.hash(ADMIN_PASSWORD || 'admin123', 10),
      role: 'ADMIN',
      pdt_enabled: true,
    },
    update: { pdt_enabled: true },
  });
  if (!MINIMAL) await prisma.user.upsert({
    where: { username: 'WHOPR01' },
    create: {
      username: 'WHOPR01',
      full_name: 'Warehouse Operator 01',
      password_hash: await bcrypt.hash('operator123', 10),
      role: 'OPERATOR',
      pdt_enabled: true,
    },
    update: { pdt_enabled: true },
  });
  if (!MINIMAL) await prisma.user.upsert({
    where: { username: 'WHOPR02' },
    create: {
      username: 'WHOPR02',
      full_name: 'Warehouse Operator 02 (tanpa PDT)',
      password_hash: await bcrypt.hash('operator123', 10),
      role: 'OPERATOR',
      pdt_enabled: false,
    },
    update: {},
  });

  console.log('→ Seeding system settings ...');
  for (const s of SETTINGS) {
    await prisma.systemSetting.upsert({
      where: { key: s.key },
      create: { ...s, updated_by: 'SEED' },
      update: {},
    });
  }

  console.log(MINIMAL ? '· Material contoh dilewati (--minimal)' : '→ Seeding materials ...');
  for (const m of MINIMAL ? [] : MATERIALS) {
    await prisma.material.upsert({ where: { material_code: m.material_code }, create: m, update: m });
  }

  console.log(MINIMAL ? '· Master pallet contoh dilewati (--minimal)' : '→ Seeding palletization master ...');
  for (const p of MINIMAL ? [] : PACKAGINGS) {
    await prisma.packagingType.upsert({
      where: { material_code_pack_code: { material_code: p.material_code, pack_code: p.pack_code } },
      create: p,
      update: p,
    });
  }

  // Zona harus ada SEBELUM bin: bin menunjuk zone_id, dan LS01N menolak bin
  // yang zonanya tidak terdaftar di master.
  console.log('→ Seeding zones ...');
  for (const z of ZONES) {
    await prisma.zone.upsert({
      where: { zone_code: z.code },
      create: {
        zone_code: z.code,
        label: z.label,
        zone_group: z.group,
        bin_pattern: z.binPattern ?? null,
        is_interim: !!z.interim,
        is_pick: !!z.pick,
        is_active: true,
      },
      // Zona yang sudah ada tidak ditimpa — perubahan admin di ZZONE
      // (mis. ganti label atau menonaktifkan zona) harus bertahan.
      update: {},
    });
  }

  // Pada --minimal hanya bin TRANSIT yang dibuat: MIGO 101/201 menolak posting
  // bila bin interim tidak ada, sedangkan rak sungguhan diunggah lewat ZUPLOAD
  // sesuai denah gudang — bukan memakai contoh dari skrip ini.
  const binsToSeed = MINIMAL ? buildBins().filter((b) => b.is_interim) : buildBins();
  console.log(`→ Seeding storage bins (${binsToSeed.length}) ...`);
  for (const b of binsToSeed) {
    await prisma.storageBin.upsert({
      where: { bin_code: b.bin_code },
      create: { ...b, is_interim: b.is_interim ?? false, status: BinStatus.EMPTY },
      update: { zone_id: b.zone_id, max_weight_kg: b.max_weight_kg, is_interim: b.is_interim ?? false },
    });
  }

  console.log(MINIMAL ? '· Saldo awal contoh dilewati (--minimal)' : '→ Seeding initial stock (561) ...');
  await prisma.documentCounter.upsert({
    where: { key: 'MATDOC' },
    create: { key: 'MATDOC', last_num: 100 },
    update: {},
  });

  for (const s of MINIMAL ? [] : INITIAL) {
    const exists = await prisma.stockWM.findFirst({
      where: { material_code: s.material_code, bin_code: s.bin_code, batch_number: s.batch },
    });
    if (exists) continue;

    await prisma.$transaction(async (tx) => {
      await tx.stockWM.create({
        data: {
          material_code: s.material_code,
          bin_code: s.bin_code,
          batch_number: s.batch,
          mfg_date: s.mfg ? new Date(s.mfg) : null,
          exp_date: s.exp ? new Date(s.exp) : null,
          qty: s.qty,
        },
      });

      const im = await tx.stockIM.findUnique({ where: { material_code: s.material_code } });
      await tx.stockIM.upsert({
        where: { material_code: s.material_code },
        create: { material_code: s.material_code, total_qty: s.qty },
        update: { total_qty: (im?.total_qty ?? 0) + s.qty },
      });

      await tx.storageBin.update({ where: { bin_code: s.bin_code }, data: { status: BinStatus.OCCUPIED } });

      const c = await tx.documentCounter.update({
        where: { key: 'MATDOC' },
        data: { last_num: { increment: 1 } },
      });

      await tx.migoLog.create({
        data: {
          document_number: String(5_000_000_000 + c.last_num),
          movement_type: MovementType.INIT_561,
          material_code: s.material_code,
          target_bin: s.bin_code,
          batch_number: s.batch,
          qty: s.qty,
          reference: 'SEED',
          remarks: 'Initial stock from seed script',
          user_id: 'ADMIN',
        },
      });
    });
  }

  console.log('\n✔ Seed selesai.');
  if (MINIMAL) {
    console.log('  Mode          : --minimal (tanpa data contoh)');
    console.log('  Login admin   : ADMIN / (BOOTSTRAP_ADMIN_PASSWORD)');
    console.log('  Berikutnya    : buat user di SU01, unggah master & bin lewat ZUPLOAD.');
  } else {
    console.log('  Login admin    : ADMIN / admin123        (PDT aktif)');
    console.log('  Login operator : WHOPR01 / operator123   (PDT aktif)');
    console.log('  Login operator : WHOPR02 / operator123   (PDT nonaktif)');
    console.log('\n  ⚠ Berisi data CONTOH. Untuk database sungguhan pakai: npm run db:seed -- --minimal');
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
