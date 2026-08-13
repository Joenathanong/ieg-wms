/**
 * Akses master Zone (tabel `zones`) — SERVER ONLY.
 *
 * Sebelum batch ini, zona hanyalah konstanta di `src/lib/zones.ts`. Sekarang
 * zona jadi master data yang dikelola lewat T-Code ZZONE, sedangkan konstanta
 * lama tetap dipakai sebagai:
 *   - nilai seed saat tabel masih kosong, dan
 *   - cadangan bila `npm run db:upgrade` belum dijalankan (tabel belum ada).
 *
 * JANGAN impor file ini dari komponen client — gunakan endpoint /api/zones.
 */

import prisma from '@/lib/prisma';
import { HttpError } from '@/lib/auth';
import { ZONES, type ZoneGroup } from '@/lib/zones';

export interface ZoneRow {
  zone_code: string;
  label: string;
  zone_group: string;
  bin_pattern: string | null;
  is_interim: boolean;
  is_pick: boolean;
  is_active: boolean;
}

/** Bentuk seed dari konstanta lama — dipakai saat tabel kosong / belum ada. */
export function seedZoneRows(): ZoneRow[] {
  return ZONES.map((z) => ({
    zone_code: z.code,
    label: z.label,
    zone_group: z.group as ZoneGroup as string,
    bin_pattern: z.binPattern ?? null,
    is_interim: !!z.interim,
    is_pick: !!z.pick,
    is_active: true,
  }));
}

/**
 * Baca seluruh zona. Bila tabel belum ada (upgrade belum dijalankan) atau masih
 * kosong, kembalikan konstanta bawaan supaya aplikasi tetap jalan.
 */
export async function listZones(): Promise<ZoneRow[]> {
  try {
    const rows = await prisma.zone.findMany({ orderBy: { zone_code: 'asc' } });
    if (rows.length > 0) {
      return rows.map((z) => ({
        zone_code: z.zone_code,
        label: z.label,
        zone_group: z.zone_group,
        bin_pattern: z.bin_pattern,
        is_interim: z.is_interim,
        is_pick: z.is_pick,
        is_active: z.is_active,
      }));
    }
  } catch {
    /* tabel belum dibuat — pakai konstanta */
  }
  return seedZoneRows();
}

/** Isi tabel zones dari konstanta + zona yang sudah dipakai bin. Idempoten. */
export async function seedZones(): Promise<number> {
  const existing = await prisma.zone.findMany();
  const have = new Set(existing.map((z) => z.zone_code));

  const wanted = seedZoneRows().filter((z) => !have.has(z.zone_code));

  // zona yang terlanjur dipakai bin tetapi tidak ada di konstanta
  const used = await prisma.storageBin.groupBy({
    by: ['zone_id'],
    _count: { _all: true },
  });
  for (const u of used) {
    const code = (u.zone_id ?? '').toUpperCase();
    if (!code || have.has(code) || wanted.some((w) => w.zone_code === code)) continue;
    wanted.push({
      zone_code: code,
      label: `${code} (hasil migrasi)`,
      zone_group: 'LAIN',
      bin_pattern: null,
      is_interim: false,
      is_pick: false,
      is_active: true,
    });
  }

  if (wanted.length === 0) return 0;
  await prisma.zone.createMany({ data: wanted, skipDuplicates: true });
  return wanted.length;
}

/**
 * Validasi zona saat membuat / mengubah bin, sekaligus mengembalikan flag
 * is_interim yang benar. Zona nonaktif ditolak untuk data baru.
 */
export async function resolveZone(code: string, opts: { allowInactive?: boolean } = {}) {
  const zone_code = String(code ?? '').trim().toUpperCase();
  if (!zone_code) throw new HttpError(400, 'Storage section / zone is mandatory.');

  const all = await listZones();
  const z = all.find((x) => x.zone_code === zone_code);
  if (!z) {
    throw new HttpError(
      400,
      `Zone ${zone_code} does not exist in the zone master. Create it in ZZONE first.`
    );
  }
  if (!z.is_active && !opts.allowInactive) {
    throw new HttpError(400, `Zone ${zone_code} is inactive and cannot be used for new bins.`);
  }
  return z;
}

/** Hitung ulang StorageBin.is_interim seluruh bin agar sesuai master zone. */
export async function syncBinInterimFlags(): Promise<{ scanned: number; updated: number }> {
  const zones = await listZones();
  const map = new Map(zones.map((z) => [z.zone_code, z.is_interim]));

  const bins = await prisma.storageBin.findMany({
    select: { bin_code: true, zone_id: true, is_interim: true },
  });

  const toUpdate = bins.filter((b) => {
    const want = map.get((b.zone_id ?? '').toUpperCase());
    return want !== undefined && want !== b.is_interim;
  });

  for (const b of toUpdate) {
    await prisma.storageBin.update({
      where: { bin_code: b.bin_code },
      data: { is_interim: !!map.get((b.zone_id ?? '').toUpperCase()) },
    });
  }

  return { scanned: bins.length, updated: toUpdate.length };
}
