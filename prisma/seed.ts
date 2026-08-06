/**
 * Seed data awal:
 *  - user ADMIN / admin123
 *  - contoh material, storage bin, dan saldo awal
 *
 * Jalankan:  npm run db:seed
 */
import { PrismaClient, BinStatus, MovementType } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

const MATERIALS = [
  { material_code: 'FG-0001', description: 'Sabun Cair Botol 500ml', uom: 'PC', is_batch_managed: true, min_safety_stock: 100 },
  { material_code: 'FG-0002', description: 'Shampoo Sachet 12ml x 12', uom: 'BOX', is_batch_managed: true, min_safety_stock: 50 },
  { material_code: 'FG-0003', description: 'Hand Sanitizer 100ml', uom: 'PC', is_batch_managed: true, min_safety_stock: 80 },
  { material_code: 'SP-1001', description: 'Karton Box 40x30x25', uom: 'PC', is_batch_managed: false, min_safety_stock: 200 },
  { material_code: 'SP-1002', description: 'Lakban Bening 2 inch', uom: 'ROL', is_batch_managed: false, min_safety_stock: 30 },
];

function buildBins() {
  const bins: { bin_code: string; zone_id: string; max_weight_kg: number }[] = [];
  for (const aisle of ['A', 'B']) {
    for (let rack = 1; rack <= 4; rack++) {
      for (let lvl = 1; lvl <= 3; lvl++) {
        bins.push({
          bin_code: `${aisle}-${String(rack).padStart(2, '0')}-${String(lvl).padStart(2, '0')}-1`,
          zone_id: aisle === 'A' ? 'RACK-FAST' : 'RACK-SLOW',
          max_weight_kg: 1200,
        });
      }
    }
  }
  bins.push({ bin_code: 'STG-01', zone_id: 'STAGING', max_weight_kg: 5000 });
  bins.push({ bin_code: 'STG-02', zone_id: 'STAGING', max_weight_kg: 5000 });
  bins.push({ bin_code: 'RJ-01', zone_id: 'REJECT', max_weight_kg: 800 });
  return bins;
}

const INITIAL = [
  { material_code: 'FG-0001', bin_code: 'A-01-01-1', batch: 'B2608A', mfg: '2026-08-01', exp: '2028-08-01', qty: 480 },
  { material_code: 'FG-0001', bin_code: 'A-01-02-1', batch: 'B2607C', mfg: '2026-07-05', exp: '2026-09-05', qty: 120 },
  { material_code: 'FG-0002', bin_code: 'A-02-01-1', batch: 'B2608B', mfg: '2026-08-05', exp: '2028-02-05', qty: 240 },
  { material_code: 'FG-0003', bin_code: 'A-02-02-1', batch: 'B2606X', mfg: '2026-06-10', exp: '2026-08-25', qty: 60 },
  { material_code: 'SP-1001', bin_code: 'B-01-01-1', batch: null, mfg: null, exp: null, qty: 1000 },
  { material_code: 'SP-1002', bin_code: 'B-01-02-1', batch: null, mfg: null, exp: null, qty: 25 },
];

async function main() {
  console.log('→ Seeding users ...');
  await prisma.user.upsert({
    where: { username: 'ADMIN' },
    create: {
      username: 'ADMIN',
      full_name: 'System Administrator',
      password_hash: await bcrypt.hash('admin123', 10),
      role: 'ADMIN',
    },
    update: {},
  });
  await prisma.user.upsert({
    where: { username: 'WHOPR01' },
    create: {
      username: 'WHOPR01',
      full_name: 'Warehouse Operator 01',
      password_hash: await bcrypt.hash('operator123', 10),
      role: 'OPERATOR',
    },
    update: {},
  });

  console.log('→ Seeding materials ...');
  for (const m of MATERIALS) {
    await prisma.material.upsert({ where: { material_code: m.material_code }, create: m, update: m });
  }

  console.log('→ Seeding storage bins ...');
  for (const b of buildBins()) {
    await prisma.storageBin.upsert({
      where: { bin_code: b.bin_code },
      create: { ...b, status: BinStatus.EMPTY },
      update: { zone_id: b.zone_id, max_weight_kg: b.max_weight_kg },
    });
  }

  console.log('→ Seeding initial stock (561) ...');
  await prisma.documentCounter.upsert({
    where: { key: 'MATDOC' },
    create: { key: 'MATDOC', last_num: 100 },
    update: {},
  });

  for (const s of INITIAL) {
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

  console.log('✔ Seed selesai. Login: ADMIN / admin123');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
