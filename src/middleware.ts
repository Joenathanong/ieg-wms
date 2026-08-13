import { NextResponse, type NextRequest } from 'next/server';
import { SESSION_COOKIE, verifySession } from '@/lib/session';
import { pathAllowed } from '@/lib/tcodes';
import { isHandheld, VIEW_COOKIE, VIEW_MAX_AGE } from '@/lib/device';

const PUBLIC_PATHS = ['/login', '/api/auth/login', '/api/health'];
const ADMIN_PATHS = ['/su01', '/zset', '/pfcg'];
const PDT_PATHS = ['/zrf'];

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (
    PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + '/')) ||
    pathname.startsWith('/_next') ||
    pathname.startsWith('/favicon') ||
    pathname.startsWith('/icon')
  ) {
    return NextResponse.next();
  }

  const session = await verifySession(req.cookies.get(SESSION_COOKIE)?.value);

  if (!session) {
    if (pathname.startsWith('/api/')) {
      return NextResponse.json(
        { ok: false, message: 'Session expired. Please log on again.', msgType: 'E' },
        { status: 401 }
      );
    }
    const url = req.nextUrl.clone();
    url.pathname = '/login';
    url.searchParams.set('next', pathname);
    return NextResponse.redirect(url);
  }

  const deny = (message: string) => {
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ ok: false, message, msgType: 'E' }, { status: 403 });
    }
    const url = req.nextUrl.clone();
    url.pathname = '/';
    url.search = '';
    return NextResponse.redirect(url);
  };

  if (ADMIN_PATHS.some((p) => pathname === p || pathname.startsWith(p + '/')) && session.role !== 'ADMIN') {
    return deny('No authorization for this transaction (S_TCODE).');
  }

  if (PDT_PATHS.some((p) => pathname === p || pathname.startsWith(p + '/')) && !session.pdt) {
    return deny('PDT terminal is not enabled for this user. Contact your administrator (SU01).');
  }

  // Pembatasan T-Code per user via role otorisasi (PFCG).
  // Hanya berlaku untuk halaman transaksi (bukan /api) — API tetap dijaga
  // oleh role dasar (ADMIN/OPERATOR/VIEWER) di masing-masing route.
  if (!pathname.startsWith('/api/') && !pathAllowed(pathname, session.role, session.pdt, session.tcodes)) {
    return deny('No authorization for this transaction (S_TCODE). Contact your administrator (PFCG/SU01).');
  }

  /* ------------------------------------------------------------------
   * Deteksi perangkat — HP / terminal PDT langsung masuk menu ZRF.
   *
   *  ?view=desktop  -> paksa tampilan desktop, disimpan di cookie (1 tahun)
   *  ?view=pdt      -> kembalikan perilaku auto-ZRF
   *  Auto-redirect hanya dari halaman utama, sehingga link/T-Code
   *  spesifik (mis. /mb51) tetap bisa dibuka langsung dari HP.
   * ------------------------------------------------------------------ */
  if (!pathname.startsWith('/api/')) {
    const viewParam = req.nextUrl.searchParams.get('view');

    if (viewParam === 'desktop' || viewParam === 'pdt' || viewParam === 'auto') {
      const url = req.nextUrl.clone();
      url.searchParams.delete('view');
      if (viewParam === 'pdt') url.pathname = '/zrf';
      const res = NextResponse.redirect(url);
      if (viewParam === 'auto') {
        // kembali ke deteksi otomatis: preferensi manual dihapus
        res.cookies.set(VIEW_COOKIE, '', { path: '/', maxAge: 0, sameSite: 'lax' });
      } else {
        res.cookies.set(VIEW_COOKIE, viewParam, {
          path: '/',
          maxAge: VIEW_MAX_AGE,
          sameSite: 'lax',
        });
      }
      return res;
    }

    const prefersDesktop = req.cookies.get(VIEW_COOKIE)?.value === 'desktop';
    if (
      pathname === '/' &&
      session.pdt &&
      !prefersDesktop &&
      isHandheld(req.headers.get('user-agent'))
    ) {
      const url = req.nextUrl.clone();
      url.pathname = '/zrf';
      url.search = '';
      return NextResponse.redirect(url);
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
