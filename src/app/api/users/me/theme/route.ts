import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { requireUser } from '@/lib/auth';
import { cleanStr } from '@/lib/api';
import {
  THEME_COOKIE,
  THEME_COOKIE_MAX_AGE,
  normalizeTheme,
  themeById,
} from '@/lib/themes';

export const dynamic = 'force-dynamic';

/**
 * POST /api/users/me/theme — simpan tema pilihan user yang sedang login.
 * Body: { theme: "horizon-evening" }
 *
 * Ditulis ke DUA tempat sekaligus:
 *   - kolom users.theme — supaya pilihan ikut ke perangkat lain;
 *   - cookie wms-theme  — supaya server bisa menulis atribut data-theme
 *     sebelum halaman digambar, tanpa kedipan.
 *
 * Sengaja TIDAK memakai `handle()` seperti route lain: jawabannya perlu
 * membawa Set-Cookie, jadi NextResponse-nya dirakit sendiri.
 */
export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    const body = await req.json().catch(() => ({}));

    // Nilai yang tidak dikenal dinormalkan ke tema bawaan, bukan ditolak:
    // tema hanyalah tampilan, dan menolak permintaannya hanya membuat layar
    // pengguna macet di tema lama tanpa penjelasan.
    const theme = normalizeTheme(cleanStr(body.theme));
    const def = themeById(theme);

    await prisma.user.update({ where: { id: user.uid }, data: { theme } });

    const res = NextResponse.json({
      ok: true,
      msgType: 'S',
      message: `Tema ${def.label} diterapkan dan disimpan untuk user ${user.username}.`,
      data: { theme },
    });

    res.cookies.set(THEME_COOKIE, theme, {
      // httpOnly aman: yang membacanya cuma server saat merender <html>.
      // Sisi klien tidak perlu membacanya — ia sudah tahu tema yang baru saja
      // dipilihnya sendiri.
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: THEME_COOKIE_MAX_AGE,
    });

    return res;
  } catch (e) {
    const status = (e as { status?: number })?.status ?? 500;
    const message = e instanceof Error ? e.message : 'Tema gagal disimpan.';
    return NextResponse.json({ ok: false, msgType: 'E', message }, { status });
  }
}
