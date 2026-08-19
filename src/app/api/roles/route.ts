import { NextRequest } from 'next/server';
import prisma from '@/lib/prisma';
import { requireAdmin, HttpError } from '@/lib/auth';
import { handle, ok, cleanStr } from '@/lib/api';
import { RESTRICTABLE_TCODES } from '@/lib/tcodes';
import { fromDbList, toDbList } from '@/lib/dblist';

export const dynamic = 'force-dynamic';

function validateTcodes(input: unknown): string[] {
  const list = Array.isArray(input) ? input.map((c) => cleanStr(c).toUpperCase()).filter(Boolean) : [];
  const valid = new Set(RESTRICTABLE_TCODES.map((t) => t.code));
  const unknown = list.filter((c) => !valid.has(c));
  if (unknown.length > 0) throw new HttpError(400, `Unknown T-Code(s): ${unknown.join(', ')}`);
  return [...new Set(list)];
}

/** GET /api/roles — daftar role otorisasi (ADMIN only) */
export async function GET() {
  return handle(async () => {
    await requireAdmin();
    const roles = await prisma.authRole.findMany({
      orderBy: { role_name: 'asc' },
      include: { _count: { select: { users: true } } },
    });
    return ok(
      roles.map((r) => ({
        id: r.id,
        role_name: r.role_name,
        description: r.description,
        tcodes: fromDbList(r.tcodes),
        user_count: r._count.users,
        updated_at: r.updated_at,
      })),
      `${roles.length} role(s) selected`
    );
  });
}

/** POST /api/roles — buat role baru (PFCG) */
export async function POST(req: NextRequest) {
  return handle(async () => {
    const admin = await requireAdmin();
    const b = await req.json();

    const role_name = cleanStr(b.role_name).toUpperCase();
    if (!/^[A-Z0-9._-]{3,30}$/.test(role_name))
      throw new HttpError(400, 'Role name must be 3–30 chars (A-Z, 0-9, . _ -).');

    const tcodes = validateTcodes(b.tcodes);
    if (tcodes.length === 0) throw new HttpError(400, 'Select at least one T-Code for this role.');

    const exists = await prisma.authRole.findUnique({ where: { role_name } });
    if (exists) throw new HttpError(409, `Role ${role_name} already exists.`);

    const role = await prisma.authRole.create({
      data: { role_name, description: cleanStr(b.description), tcodes: toDbList(tcodes) },
    });

    return ok(role, `Role ${role_name} created by ${admin.username}`);
  });
}
