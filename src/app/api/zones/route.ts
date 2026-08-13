import { NextRequest } from 'next/server';
import prisma from '@/lib/prisma';
import { requireUser, requireAdmin, HttpError } from '@/lib/auth';
import { handle, ok, cleanStr } from '@/lib/api';
import { listZones, seedZones } from '@/lib/zonemaster';
import { ZONE_GROUP_CODES } from '@/lib/zones';

export const dynamic = 'force-dynamic';

const CODE_RE = /^[A-Z0-9][A-Z0-9-]{1,19}$/;

function normGroup(v: unknown): string {
  const g = cleanStr(v).toUpperCase() || 'LAIN';
  if (!ZONE_GROUP_CODES.includes(g)) {
    throw new HttpError(400, `Zone group must be one of: ${ZONE_GROUP_CODES.join(', ')}.`);
  }
  return g;
}

/**
 * GET /api/zones?activeOnly=1
 * Dipakai LS01N / ZUPLOAD / ZZONE. Menyertakan jumlah bin per zona supaya
 * layar ZZONE bisa memblokir penghapusan zona yang masih terpakai.
 */
export async function GET(req: NextRequest) {
  return handle(async () => {
    await requireUser();
    const activeOnly = req.nextUrl.searchParams.get('activeOnly') === '1';

    const zones = await listZones();
    const counts = await prisma.storageBin.groupBy({ by: ['zone_id'], _count: { _all: true } });
    const cmap = new Map(counts.map((c) => [(c.zone_id ?? '').toUpperCase(), c._count._all]));

    const rows = zones
      .filter((z) => !activeOnly || z.is_active)
      .map((z) => ({ ...z, bin_count: cmap.get(z.zone_code) ?? 0 }));

    return ok(rows, `${rows.length} zone(s) selected`);
  });
}

/** POST /api/zones — ZZONE Create Zone. Body `{ seed: true }` mengisi zona bawaan. */
export async function POST(req: NextRequest) {
  return handle(async () => {
    await requireAdmin();
    const b = await req.json();

    if (b?.seed === true) {
      const n = await seedZones();
      return ok({ inserted: n }, n > 0 ? `${n} default zone(s) created` : 'Zone master is already complete');
    }

    const zone_code = cleanStr(b.zone_code).toUpperCase();
    if (!CODE_RE.test(zone_code)) {
      throw new HttpError(400, 'Zone code: 2–20 characters, A–Z, 0–9 and hyphen only.');
    }
    const label = cleanStr(b.label);
    if (!label) throw new HttpError(400, 'Zone description is mandatory.');

    const exists = await prisma.zone.findUnique({ where: { zone_code } });
    if (exists) throw new HttpError(409, `Zone ${zone_code} already exists.`);

    const zone = await prisma.zone.create({
      data: {
        zone_code,
        label,
        zone_group: normGroup(b.zone_group),
        bin_pattern: cleanStr(b.bin_pattern).toUpperCase() || null,
        is_interim: !!b.is_interim,
        is_pick: !!b.is_pick,
        is_active: b.is_active === undefined ? true : !!b.is_active,
      },
    });

    return ok(zone, `Zone ${zone_code} created`);
  });
}
