import { NextRequest, NextResponse } from 'next/server';
import { adminAuth, adminDb } from '@/lib/firebase/admin';
import { cookies } from 'next/headers';
import { fetchAllPOLines, writeReceivedToSheet, updateRemarkReceived } from '@/lib/gsheets/po';
import type { GRRecord } from '@/types';

export async function POST(req: NextRequest) {
  // Verify session
  const sessionCookie = cookies().get('wms_session')?.value;
  if (!sessionCookie) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let uid: string;
  try {
    const decoded = await adminAuth.verifySessionCookie(sessionCookie, true);
    uid = decoded.uid;
  } catch {
    return NextResponse.json({ error: 'Invalid session' }, { status: 401 });
  }

  const body = await req.json() as GRRecord;
  const { noPO, noSJ, shift, sapCode, ocsCode, batch, qtyCarton, qtyBox, totalQty } = body;

  // Validate
  if (!noPO || !sapCode || !totalQty || totalQty <= 0) {
    return NextResponse.json({ error: 'Data tidak lengkap' }, { status: 400 });
  }

  // Find matching PO line
  const allLines = await fetchAllPOLines();
  const matchingLines = allLines.filter(
    (l) => l.sapCode === sapCode && String(l.noPO) === String(noPO)
  );

  if (matchingLines.length === 0) {
    return NextResponse.json({ error: `Tidak ada PO dengan SAP ${sapCode} dan No PO ${noPO}` }, { status: 404 });
  }

  const line = matchingLines[0];

  // Find next empty received slot (1–10)
  let slotIndex = -1;
  for (let i = 0; i < 10; i++) {
    if (line.received[i].qty == null) { slotIndex = i + 1; break; }
  }
  if (slotIndex === -1) {
    return NextResponse.json({ error: 'Semua slot GR (1–10) sudah terisi' }, { status: 400 });
  }

  // Write to Google Sheets
  // Use Excel serial date for today (days since 1900-01-00)
  const now = new Date();
  const excelSerial = Math.floor((now.getTime() - new Date('1899-12-30').getTime()) / 86400000);

  await writeReceivedToSheet(line.rowIndex, slotIndex, totalQty, excelSerial);

  // Update remark received
  const newTotalReceived = line.totalQtyReceived + totalQty;
  const pct = Math.round((newTotalReceived / line.qtyPO) * 100);
  let remark = 'Partial Received';
  if (pct >= 100) remark = 'Full Received';
  await updateRemarkReceived(line.rowIndex, remark);

  // Get operator name
  const userDoc = await adminDb.doc(`users/${uid}`).get();
  const operatorName = userDoc.exists ? (userDoc.data()?.name ?? uid) : uid;

  // Save to Firestore
  const grRecord: GRRecord = {
    noPO, noSJ, shift, sapCode, ocsCode, batch,
    qtyCarton, qtyBox, totalQty,
    operatorUid: uid,
    operatorName,
    timestamp: now.toISOString(),
    sheetRowIndex: line.rowIndex,
    receivedSlot: slotIndex,
  };

  const docRef = await adminDb.collection('gr_records').add(grRecord);

  return NextResponse.json({ success: true, id: docRef.id, slot: slotIndex, remark });
}

export async function GET(req: NextRequest) {
  // Return last 50 GR records (for history)
  const sessionCookie = cookies().get('wms_session')?.value;
  if (!sessionCookie) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    await adminAuth.verifySessionCookie(sessionCookie, true);
  } catch {
    return NextResponse.json({ error: 'Invalid session' }, { status: 401 });
  }

  const snap = await adminDb
    .collection('gr_records')
    .orderBy('timestamp', 'desc')
    .limit(50)
    .get();

  const records = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  return NextResponse.json(records);
}
