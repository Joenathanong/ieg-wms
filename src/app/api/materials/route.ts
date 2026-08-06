import { NextRequest } from 'next/server';
import prisma from '@/lib/prisma';
import { requireUser, requireWrite, HttpError } from '@/lib/auth';
import { handle, ok, cleanStr, toInt } from '@/lib/api';

export const dynamic = 'force-dynamic';

/** GET /api/materials?q=&limit= — MM03 / search help (F4) */
export async function GET(req: NextRequest) {
  return handle(async () => {
    await requireUser();
    const sp = req.nextUrl.searchParams;
    const q = cleanStr(sp.get('q'));
    const limit = Math.min(Number(sp.get('limit') ?? 500), 2000);

    const materials = await prisma.material.findMany({
      where: q
        ? {
            OR: [
              { material_code: { contains: q, mode: 'insensitive' } },
              { description: { contains: q, mode: 'insensitive' } },
            ],
          }
        : undefined,
      orderBy: { material_code: 'asc' },
      take: limit,
    });

    return ok(materials, `${materials.length} material(s) selected`);
  });
}

/** POST /api/materials — MM01 Create Material */
export async function POST(req: NextRequest) {
  return handle(async () => {
    await requireWrite();
    const b = await req.json();

    const material_code = cleanStr(b.material_code).toUpperCase();
    const description = cleanStr(b.description);
    if (!material_code) throw new HttpError(400, 'Material number is mandatory.');
    if (!description) throw new HttpError(400, 'Material description is mandatory.');

    const exists = await prisma.material.findUnique({ where: { material_code } });
    if (exists) throw new HttpError(409, `Material ${material_code} already exists.`);

    const m = await prisma.material.create({
      data: {
        material_code,
        description,
        uom: (cleanStr(b.uom) || 'PC').toUpperCase(),
        is_batch_managed: b.is_batch_managed === false ? false : true,
        min_safety_stock: b.min_safety_stock ? toInt(b.min_safety_stock, 'min_safety_stock') : 0,
      },
    });

    return ok(m, `Material ${material_code} created`);
  });
}
