import { NextRequest, NextResponse } from 'next/server';
import { adminAuth } from '@/lib/firebase/admin';

export async function POST(req: NextRequest) {
  try {
    const { idToken } = await req.json();
    const decoded = await adminAuth.verifyIdToken(idToken);
    const expiresIn = 60 * 60 * 24 * 7 * 1000; // 7 days ms
    const sessionCookie = await adminAuth.createSessionCookie(idToken, { expiresIn });

    const res = NextResponse.json({ status: 'ok', uid: decoded.uid });
    res.cookies.set('wms_session', sessionCookie, {
      maxAge: expiresIn / 1000, // seconds
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      sameSite: 'lax',
    });
    return res;
  } catch (err) {
    console.error('Session error:', err);
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
}
