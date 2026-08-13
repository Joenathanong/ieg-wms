import { NextRequest } from 'next/server';
import prisma from '@/lib/prisma';
import { requireUser, requireAdmin, HttpError } from '@/lib/auth';
import { handle, ok, cleanStr } from '@/lib/api';
import { likeWhereAny } from '@/lib/like';
import type { Prisma } from '@prisma/client';

export const dynamic = 'force-dynamic';

const CODE_RE = /^[A-Z0-9][A-Z0-9._-]{1,19}$/;

/** GET /api/costcenters?q=&activeOnly=1 — KS01 / search help MIGO */
export async function GET(req: NextRequest) {
  return handle(async () => {
    await requireUser();
    const sp = req.nextUrl.searchParams;
    const q = cleanStr(sp.get('q'));
    const activeOnly = sp.get('activeOnly') === '1';

    const rows = await prisma.costCenter.findMany({
      where: {
        AND: [
          (likeWhereAny(['cost_center', 'description', 'department'], q) ??
            {}) as Prisma.CostCenterWhereInput,
          activeOnly ? { is_active: true } : {},
        ],
      },
      orderBy: { cost_center: 'asc' },
      take: 1000,
    });

    return ok(rows, `${rows.length} cost center(s) selected`);
  });
}

/** POST /api/costcenters — KS01 Create Cost Center */
export async function POST(req: NextRequest) {
  return handle(async () => {
    await requireAdmin();
    const b = await req.json();

    const cost_center = cleanStr(b.cost_center).toUpperCase();
    if (!CODE_RE.test(cost_center)) {
      throw new HttpError(400, 'Cost center: 2–20 characters, A–Z, 0–9 and . _ - only.');
    }
    const description = cleanStr(b.description);
    if (!description) throw new HttpError(400, 'Cost center description is mandatory.');

    const exists = await prisma.costCenter.findUnique({ where: { cost_center } });
    if (exists) throw new HttpError(409, `Cost center ${cost_center} already exists.`);

    const row = await prisma.costCenter.create({
      data: {
        cost_center,
        description,
        department: cleanStr(b.department).toUpperCase() || null,
        is_active: b.is_active === undefined ? true : !!b.is_active,
      },
    });

    return ok(row, `Cost center ${cost_center} created`);
  });
}
