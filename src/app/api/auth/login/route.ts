import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { comparePassword, hashPassword } from '@/lib/auth';
import { signSession, SESSION_COOKIE, SESSION_MAX_AGE } from '@/lib/session';
import { handle, fail, cleanStr } from '@/lib/api';
import { THEME_COOKIE, THEME_COOKIE_MAX_AGE, normalizeTheme } from '@/lib/themes';
import { isTrue } from '@/lib/settings';
import { fromDbList, toDbList } from '@/lib/dblist';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  return handle(async () => {
    const body = await req.json();
    const username = cleanStr(body.username).toUpperCase();
    const password = String(body.password ?? '');

    if (!username || !password) return fail('User name and password are required.', 400);

    /**
     * Bootstrap: kalau belum ada user sama sekali, buat ADMIN.
     *
     * Passwordnya diambil dari BOOTSTRAP_ADMIN_PASSWORD. Di production TIDAK
     * ADA nilai cadangan: alamat deployment bersifat publik, dan password
     * bawaan yang tertulis di repositori sama saja dengan tidak ada password.
     * Bila variabelnya belum diisi, bootstrap ditolak dan admin diminta
     * menjalankan `npm run db:seed` dari tempat yang terkendali.
     */
    const count = await prisma.user.count();
    if (count === 0) {
      const bootstrapPassword = process.env.BOOTSTRAP_ADMIN_PASSWORD ?? '';
      if (!bootstrapPassword) {
        if (process.env.NODE_ENV === 'production') {
          return fail(
            'Sistem belum memiliki user. Isi BOOTSTRAP_ADMIN_PASSWORD lalu deploy ulang, ' +
              'atau jalankan npm run db:seed terhadap database ini.',
            503
          );
        }
      }
      await prisma.user.create({
        data: {
          username: 'ADMIN',
          full_name: 'System Administrator',
          password_hash: await hashPassword(bootstrapPassword || 'admin123'),
          role: 'ADMIN',
          pdt_enabled: true,
        },
      });
    }

    const user = await prisma.user.findUnique({ where: { username }, include: { auth_role: true } });
    if (!user) return fail('Name or password is incorrect (repeat logon).', 401);
    if (!user.is_active) return fail('User is locked. Contact your system administrator.', 403);

    const valid = await comparePassword(password, user.password_hash);
    if (!valid) return fail('Name or password is incorrect (repeat logon).', 401);

    await prisma.user.update({ where: { id: user.id }, data: { last_login: new Date() } });

    // izin PDT = flag user DAN master switch sistem
    const pdtGlobal = await isTrue(prisma, 'PDT_ENABLED');
    const pdt = pdtGlobal && user.pdt_enabled;

    // pembatasan T-Code dari role otorisasi (PFCG). ADMIN tidak pernah dibatasi.
    const tcodes =
      user.role !== 'ADMIN' && user.auth_role ? fromDbList(user.auth_role.tcodes) : null;

    const token = await signSession({
      uid: user.id,
      username: user.username,
      name: user.full_name,
      role: user.role,
      pdt,
      tcodes,
      auth_role: user.auth_role?.role_name ?? null,
    });

    const res = NextResponse.json({
      ok: true,
      msgType: 'S',
      message: `Welcome, ${user.full_name}`,
      data: { username: user.username, role: user.role, name: user.full_name, pdt },
    });

    res.cookies.set(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: SESSION_MAX_AGE,
    });

    /**
     * Tema mengikuti user, bukan browser.
     *
     * Cookie-nya ditulis ulang di setiap login supaya orang yang memakai
     * komputer gudang bersama tidak mewarisi tema rekan sebelumnya. Nilainya
     * diambil dari master user, jadi pilihan yang pernah dibuat di HP langsung
     * berlaku juga di desktop.
     */
    res.cookies.set(THEME_COOKIE, normalizeTheme(user.theme), {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: THEME_COOKIE_MAX_AGE,
    });

    return res;
  });
}
