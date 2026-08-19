import { NextRequest } from 'next/server';
import prisma from '@/lib/prisma';
import { requireUser, requireAdmin, HttpError } from '@/lib/auth';
import { handle, ok, cleanStr } from '@/lib/api';
import { getSettings, SETTING_DEFAULTS, type SettingKey } from '@/lib/settings';
import { normalizeHHMM, clampInterval } from '@/lib/keepalive';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** GET /api/settings — ZSET */
export async function GET() {
  return handle(async () => {
    await requireUser();
    const settings = await getSettings(prisma);
    return ok(settings, 'System configuration displayed');
  });
}

/** PATCH /api/settings — hanya ADMIN. Body: { KEY: value, ... } */
export async function PATCH(req: NextRequest) {
  return handle(async () => {
    const admin = await requireAdmin();
    const body = await req.json();

    const keys = Object.keys(SETTING_DEFAULTS) as SettingKey[];
    const changes: { key: string; value: string }[] = [];

    for (const k of keys) {
      if (body[k] === undefined) continue;
      let value = cleanStr(body[k]);
      if (SETTING_DEFAULTS[k] === '1' || SETTING_DEFAULTS[k] === '0') {
        value = body[k] === true || value === '1' || value.toUpperCase() === 'TRUE' ? '1' : '0';
      }
      if (k === 'KEEPALIVE_FROM' || k === 'KEEPALIVE_TO') {
        const hhmm = normalizeHHMM(value);
        if (!hhmm) throw new HttpError(400, `${k} must be a time in HH:MM format, e.g. 07:00.`);
        value = hhmm;
      }
      // Interval dibulatkan ke rentang aman, bukan ditolak: salah ketik di sini
      // paling parah membuat ping terlalu sering, bukan merusak data.
      if (k === 'KEEPALIVE_INTERVAL') {
        value = String(clampInterval(value));
      }
      if (k === 'DEFAULT_GR_BIN' || k === 'DEFAULT_GI_BIN') {
        value = value.toUpperCase();
        const bin = await prisma.storageBin.findUnique({ where: { bin_code: value } });
        if (!bin) throw new HttpError(400, `Storage bin ${value} does not exist (LS01N).`);
        if (!bin.is_interim)
          throw new HttpError(400, `Storage bin ${value} is not flagged as an interim bin.`);
      }
      changes.push({ key: k, value });
    }

    if (changes.length === 0) throw new HttpError(400, 'No changes were made.');

    await prisma.$transaction(
      changes.map((c) =>
        prisma.systemSetting.upsert({
          where: { key: c.key },
          create: { key: c.key, value: c.value, updated_by: admin.username },
          update: { value: c.value, updated_by: admin.username },
        })
      )
    );

    const settings = await getSettings(prisma);
    return ok(settings, `${changes.length} setting(s) changed by ${admin.username}`);
  });
}
