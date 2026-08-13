import { NextRequest } from 'next/server';
import prisma from '@/lib/prisma';
import { requireAdmin, HttpError } from '@/lib/auth';
import { handle, ok, cleanStr } from '@/lib/api';
import { ZONE_GROUP_CODES } from '@/lib/zones';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ code: string }> };

async function findZone(raw: string) {
  const zone_code = decodeURIComponent(raw ?? '').trim().toUpperCase();
  const zone = await prisma.zone.findUnique({ where: { zone_code } });
  if (!zone) throw new HttpError(404, `Zone ${zone_code} not found.`);
  return zone;
}

/** PATCH /api/zones/[code] — ZZONE Change Zone. Kode zona tidak bisa diubah. */
export async function PATCH(req: NextRequest, ctx: Ctx) {
  return handle(async () => {
    await requireAdmin();
    const { code } = await ctx.params;
    const zone = await findZone(code);
    const b = await req.json();

    let zone_group: string | undefined;
    if (b.zone_group !== undefined) {
      zone_group = cleanStr(b.zone_group).toUpperCase() || 'LAIN';
      if (!ZONE_GROUP_CODES.includes(zone_group)) {
        throw new HttpError(400, `Zone group must be one of: ${ZONE_GROUP_CODES.join(', ')}.`);
      }
    }

    const label = b.label !== undefined ? cleanStr(b.label) : undefined;
    if (label !== undefined && !label) throw new HttpError(400, 'Zone description is mandatory.');

    const updated = await prisma.zone.update({
      where: { zone_code: zone.zone_code },
      data: {
        label,
        zone_group,
        bin_pattern:
          b.bin_pattern !== undefined ? cleanStr(b.bin_pattern).toUpperCase() || null : undefined,
        is_interim: b.is_interim !== undefined ? !!b.is_interim : undefined,
        is_pick: b.is_pick !== undefined ? !!b.is_pick : undefined,
        is_active: b.is_active !== undefined ? !!b.is_active : undefined,
      },
    });

    // Perubahan flag interim harus langsung tercermin di seluruh bin zona ini,
    // kalau tidak alur put-away / picking akan memakai aturan yang salah.
    let synced = 0;
    if (b.is_interim !== undefined && updated.is_interim !== zone.is_interim) {
      const r = await prisma.storageBin.updateMany({
        where: { zone_id: updated.zone_code },
        data: { is_interim: updated.is_interim },
      });
      synced = r.count;
    }

    return ok(
      { ...updated, synced },
      synced > 0
        ? `Zone ${updated.zone_code} changed — ${synced} bin(s) re-flagged as ${updated.is_interim ? 'interim' : 'storage'}`
        : `Zone ${updated.zone_code} changed`
    );
  });
}

/** DELETE /api/zones/[code] — ditolak bila masih ada bin yang memakainya. */
export async function DELETE(_req: NextRequest, ctx: Ctx) {
  return handle(async () => {
    await requireAdmin();
    const { code } = await ctx.params;
    const zone = await findZone(code);

    const used = await prisma.storageBin.count({ where: { zone_id: zone.zone_code } });
    if (used > 0) {
      throw new HttpError(
        409,
        `Zone ${zone.zone_code} is still assigned to ${used} storage bin(s). ` +
          `Reassign those bins in LS01N first, or deactivate the zone instead of deleting it.`
      );
    }

    await prisma.zone.delete({ where: { zone_code: zone.zone_code } });
    return ok({ zone_code: zone.zone_code }, `Zone ${zone.zone_code} deleted`);
  });
}
