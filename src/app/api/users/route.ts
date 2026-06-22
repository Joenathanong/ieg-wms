import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { adminAuth, adminDb } from '@/lib/firebase/admin';
import type { UserRole } from '@/types';

async function getSessionUser() {
  const cookie = cookies().get('wms_session');
  if (!cookie) return null;
  try {
    const decoded = await adminAuth.verifySessionCookie(cookie.value, true);
    const snap = await adminDb.collection('users').doc(decoded.uid).get();
    if (!snap.exists) return null;
    return snap.data() as { role: UserRole; active: boolean };
  } catch { return null; }
}

export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user || user.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    const body = await req.json();
    const { name, email, password, role, active } = body as {
      name: string; email: string; password: string; role: UserRole; active: boolean;
    };

    if (!name || !email || !password || !role) {
      return NextResponse.json({ error: 'Field tidak lengkap' }, { status: 400 });
    }

    // Create Firebase Auth user
    const authUser = await adminAuth.createUser({ email, password, displayName: name });

    // Save to Firestore
    await adminDb.collection('users').doc(authUser.uid).set({
      name,
      email,
      role,
      active: active ?? true,
      createdAt: new Date().toISOString(),
    });

    return NextResponse.json({ uid: authUser.uid });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Gagal membuat user';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  const user = await getSessionUser();
  if (!user || user.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    const { uid } = await req.json();
    await adminAuth.deleteUser(uid);
    await adminDb.collection('users').doc(uid).delete();
    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Gagal menghapus user';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
