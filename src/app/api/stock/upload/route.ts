import { NextRequest, NextResponse } from 'next/server';
import { adminAuth, adminDb } from '@/lib/firebase/admin';
import { cookies } from 'next/headers';
import { parseStockExcel } from '@/lib/utils/excel';

const BATCH_SIZE = 400;

function chunkArr<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

export async function POST(req: NextRequest) {
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

  const existing = await adminDb.collection('stock').get();
  for (const ch of chunkArr(existing.docs.map(d => d.ref), BATCH_SIZE)) {
    const b = adminDb.batch();
    ch.forEach(ref => b.delete(ref));
    await b.commit();
  }

  for (const ch of chunkArr(items, BATCH_SIZE)) {
    const b = adminDb.batch();
    ch.forEach(item => {
      const ref = adminDb.collection('stock').doc(item.ocsCode);
      b.set(ref, item);
    });
    await b.commit();
  }

  await adminDb.collection('stock_uploads').add({
    uploadedBy: userDoc.data()?.name ?? uid,
    uploadedAt: new Date().toISOString(),
    itemCount: items.length,
    fileName: file.name,
  });

  return NextResponse.json({ success: true, count: items.length });
}
