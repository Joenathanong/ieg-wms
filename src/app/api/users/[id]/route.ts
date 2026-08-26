import { NextRequest } from 'next/server';
import prisma from '@/lib/prisma';
import { requireAdmin, hashPassword, HttpError } from '@/lib/auth';
import { handle, ok, cleanStr } from '@/lib/api';
import { UserRole } from '@prisma/client';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/** PATCH /api/users/:id — ubah nama, role, status aktif, reset password */
export async function PATCH(req: NextRequest, ctx: Ctx) {
  return handle(async () => {
    const admin = await requireAdmin();
    const { id } = await ctx.params;
    const b = await req.json();

    const target = await prisma.user.findUnique({ where: { id } });
    if (!target) throw new HttpError(404, 'User does not exist.');

    const data: Record<string, unknown> = {};

    if (b.full_name !== undefined) {
      const fn = cleanStr(b.full_name);
      if (!fn) throw new HttpError(400, 'Full name is mandatory.');
      data.full_name = fn;
    }

    if (b.role !== undefined) {
      const role = cleanStr(b.role).toUpperCase() as UserRole;
      if (!Object.values(UserRole).includes(role)) throw new HttpError(400, `Invalid role ${role}.`);
      if (target.id === admin.uid && role !== 'ADMIN')
        throw new HttpError(400, 'You cannot remove your own administrator authorization.');
      data.role = role;
    }

    if (b.is_active !== undefined) {
      if (target.id === admin.uid && b.is_active === false)
        throw new HttpError(400, 'You cannot lock your own user.');
      data.is_active = Boolean(b.is_active);
    }

    if (b.so_enabled !== undefined) {
      data.so_enabled = Boolean(b.so_enabled);
    }
    if (b.pdt_enabled !== undefined) {
      data.pdt_enabled = Boolean(b.pdt_enabled);
    }

    if (b.auth_role_id !== undefined) {
      if (b.auth_role_id === null || b.auth_role_id === '') {
        data.auth_role_id = null;
      } else {
        const ar = await prisma.authRole.findUnique({ where: { id: String(b.auth_role_id) } });
        if (!ar) throw new HttpError(400, 'Authorization role does not exist (PFCG).');
        data.auth_role_id = ar.id;
      }
    }

    if (b.password) {
      const pw = String(b.password);
      if (pw.length < 6) throw new HttpError(400, 'Password must be at least 6 characters.');
      data.password_hash = await hashPassword(pw);
    }

    if (Object.keys(data).length === 0) throw new HttpError(400, 'No changes were made.');

    const user = await prisma.user.update({
      where: { id },
      data,
      select: { id: true, username: true, full_name: true, role: true, is_active: true, pdt_enabled: true, so_enabled: true, auth_role_id: true },
    });

    return ok(user, `User ${user.username} changed. Perubahan otorisasi berlaku pada login berikutnya.`);
  });
}

/** DELETE /api/users/:id */
export async function DELETE(_req: NextRequest, ctx: Ctx) {
  return handle(async () => {
    const admin = await requireAdmin();
    const { id } = await ctx.params;

    if (id === admin.uid) throw new HttpError(400, 'You cannot delete your own user.');

    const target = await prisma.user.findUnique({ where: { id } });
    if (!target) throw new HttpError(404, 'User does not exist.');

    if (target.role === 'ADMIN') {
      const admins = await prisma.user.count({ where: { role: 'ADMIN', is_active: true } });
      if (admins <= 1) throw new HttpError(400, 'At least one active administrator must remain.');
    }

    await prisma.user.delete({ where: { id } });
    return ok({ id }, `User ${target.username} deleted`);
  });
}
