import { NextRequest } from 'next/server';
import prisma from '@/lib/prisma';
import { requireAdmin, requireUser, hashPassword, HttpError } from '@/lib/auth';
import { handle, ok, cleanStr } from '@/lib/api';
import { UserRole } from '@prisma/client';
import { fromDbList, toDbList } from '@/lib/dblist';

export const dynamic = 'force-dynamic';

/** GET /api/users — daftar user (ADMIN only) */
export async function GET() {
  return handle(async () => {
    await requireAdmin();
    const users = await prisma.user.findMany({
      orderBy: [{ role: 'asc' }, { username: 'asc' }],
      select: {
        id: true,
        username: true,
        full_name: true,
        role: true,
        is_active: true,
        pdt_enabled: true,
        so_enabled: true,
        auth_role_id: true,
        auth_role: { select: { role_name: true, tcodes: true } },
        last_login: true,
        created_at: true,
      },
    });
    // tcodes disimpan sebagai teks di database, tetapi API selalu
    // mengembalikannya sebagai array supaya layar tidak perlu berubah.
    const rows = users.map((u) => ({
      ...u,
      auth_role: u.auth_role
        ? { ...u.auth_role, tcodes: fromDbList(u.auth_role.tcodes) }
        : null,
    }));
    return ok(rows, `${rows.length} user(s) selected`);
  });
}

/** POST /api/users — buat user baru (ADMIN only) */
export async function POST(req: NextRequest) {
  return handle(async () => {
    const admin = await requireAdmin();
    const b = await req.json();

    const username = cleanStr(b.username).toUpperCase();
    const full_name = cleanStr(b.full_name);
    const password = String(b.password ?? '');
    const role = (cleanStr(b.role).toUpperCase() || 'OPERATOR') as UserRole;

    if (!/^[A-Z0-9._-]{3,20}$/.test(username))
      throw new HttpError(400, 'User name must be 3–20 chars (A-Z, 0-9, . _ -).');
    if (!full_name) throw new HttpError(400, 'Full name is mandatory.');
    if (password.length < 6) throw new HttpError(400, 'Password must be at least 6 characters.');
    if (!Object.values(UserRole).includes(role))
      throw new HttpError(400, `Invalid role ${role}.`);

    const exists = await prisma.user.findUnique({ where: { username } });
    if (exists) throw new HttpError(409, `User ${username} already exists.`);

    // role otorisasi T-Code (opsional)
    let auth_role_id: string | null = null;
    if (b.auth_role_id) {
      const ar = await prisma.authRole.findUnique({ where: { id: String(b.auth_role_id) } });
      if (!ar) throw new HttpError(400, 'Authorization role does not exist (PFCG).');
      auth_role_id = ar.id;
    }

    const user = await prisma.user.create({
      data: {
        username,
        full_name,
        password_hash: await hashPassword(password),
        role,
        is_active: b.is_active === false ? false : true,
        pdt_enabled: b.pdt_enabled === true,
        so_enabled: b.so_enabled !== false,
        auth_role_id,
      },
      select: { id: true, username: true, full_name: true, role: true, is_active: true, pdt_enabled: true, so_enabled: true, auth_role_id: true },
    });

    return ok(user, `User ${username} created by ${admin.username}`);
  });
}
