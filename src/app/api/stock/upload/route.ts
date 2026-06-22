import { NextRequest, NextResponse } from 'next/server';
import { adminAuth, adminDb } from '@/lib/firebase/admin';
import { cookies } from 'next/headers';
import { parseStockExcel } from '@/lib/utils/excel';

export async function POST(req: NextRequest) {
  // Verify session + role
  const sessionCookie = cookies().get('wms_session')?.value;
  if (!sessionCookie) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let uid: string;
  try {
    const decoded = await adminAuth.verifySessionCookie(sessionCookie, true);
    uid = decoded.uid;
  } catch {
    return NextResponse.json({ error: 'Invalid session' }, { status: 401 });
  }

  const userDoc = await adminDb.doc(`users/${uid}`).get();
  const role = userDoc.data()?.role;
  if (!['admin', 'supervisor'].includes(role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const form = await req.formData();
  const file = form.get('file') as File | null;
  if (!file) return NextResponse.json({ error: 'No file' }, { status: 400 });

  const buffer = await file.arrayBuffer();
  const items = parseStockExcel(buffer).map((item) => ({
    ...item,
    uploadedBy: userDoc.data()?.name ?? uid,
  }));

  if (items.length === 0) {
    return NextResponse.json({ error: 'File kosong atau format tidak sesuai' }, { status: 400 });
  }

  // Batch write: delete old, insert new
  const batch = adminDb.batch();
  const existing = await adminDb.collection('stock').get();
  existing.docs.forEach((d) => batch.delete(d.ref));
  items.forEach((item) => {
    const ref = adminDb.collection('stock').doc(item.ocsCode);
    batch.set(ref, item);
  });
  await batch.commit();

  // Log upload
  await adminDb.collection('stock_uploads').add({
    uploadedBy: userDoc.data()?.name ?? uid,
    uploadedAt: new Date().toISOString(),
    itemCount: items.length,
    fileName: file.name,
  });

  return NextResponse.json({ success: true, count: items.length });
}
