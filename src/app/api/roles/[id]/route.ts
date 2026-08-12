import { NextRequest } from 'next/server';
import prisma from '@/lib/prisma';
import { requireAdmin, HttpError } from '@/lib/auth';
import { handle, ok, cleanStr } from '@/lib/api';
import { RESTRICTABLE_TCODES } from '@/lib/tcodes';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

function validateTcodes(input: unknown): string[] {
  const list = Array.isArray(input) ? input.map((c) => cleanStr(c).toUpperCase()).filter(Boolean) : [];
  const valid = new Set(RESTRICTABLE_TCODES.map((t) => t.code));
  const unknown = list.filter((c) => !valid.has(c));
  if (unknown.length > 0) throw new HttpError(400, `Unknown T-Code(s): ${unknown.join(', ')}`);
  return [...new Set(list)];
}

/** PATCH /api/roles/:id — ubah deskripsi / daftar T-Code role */
export async function PATCH(req: NextRequest, ctx: Ctx) {
  return handle(async () => {
    await requireAdmin();
    const { id } = await ctx.params;
    const b = await req.json();

    const target = await prisma.authRole.findUnique({ where: { id } });
    if (!target) throw new HttpError(404, 'Role does not exist.');

    const data: Record<string, unknown> = {};
    if (b.description !== undefined) data.description = cleanStr(b.description);
    if (b.tcodes !== undefined) {
      const tcodes = validateTcodes(b.tcodes);
      if (tcodes.length === 0) throw new HttpError(400, 'Select at least one T-Code for this role.');
      data.tcodes = tcodes;
    }
    if (Object.keys(data).length === 0) throw new HttpError(400, 'No changes were made.');

    const role = await prisma.authRole.update({ where: { id }, data });
    return ok(role, `Role ${role.role_name} changed. Berlaku pada login berikutnya user terkait.`);
  });
}

/** DELETE /api/roles/:id — hapus role (user terkait menjadi tanpa pembatasan) */
export async function DELETE(_req: NextRequest, ctx: Ctx) {
  return handle(async () => {
    await requireAdmin();
    const { id } = await ctx.params;

    const target = await prisma.authRole.findUnique({
      where: { id },
      include: { _count: { select: { users: true } } },
    });
    if (!target) throw new HttpError(404, 'Role does not exist.');
    if (target._count.users > 0)
      throw new HttpError(
        400,
        `Role ${target.role_name} is still assigned to ${target._count.users} user(s). Lepaskan dulu di SU01.`
      );

    await prisma.authRole.delete({ where: { id } });
    return ok({ id }, `Role ${target.role_name} deleted`);
  });
}
