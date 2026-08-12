import { NextResponse, type NextRequest } from 'next/server';
import { SESSION_COOKIE, verifySession } from '@/lib/session';

const PUBLIC_PATHS = ['/login', '/api/auth/login', '/api/health'];
const ADMIN_PATHS = ['/su01', '/zset'];
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

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
