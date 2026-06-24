import { NextRequest, NextResponse } from 'next/server';
import { adminAuth, adminDb } from '@/lib/firebase/admin';
import { cookies } from 'next/headers';
import { fetchAllPOLines, writeReceivedToSheet, updateRemarkReceived } from '@/lib/gsheets/po';
import type { GRRecord } from '@/types';

// ---------- helpers ----------

async function verifySession(): Promise<string | null> {
  const sessionCookie = cookies().get('wms_session')?.value;
  if (!sessionCookie) return null;
  try {
    const decoded = await adminAuth.verifySessionCookie(sessionCookie, true);
    return decoded.uid;
  } catch {
    return null;
  }
}

function todaySerial(): number {
  return Math.floor((Date.now() - new Date('1899-12-30').getTime()) / 86400000);
}

// ---------- POST: create GR ----------

export async function POST(req: NextRequest) {
  const uid = await verifySession();
  if (!uid) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json() as GRRecord;
  const { noPO, noSJ, shift, sapCode, batch, qtyCarton, qtyBox, totalQty } = body;

  if (!noPO || !sapCode || !totalQty || totalQty <= 0) {
    return NextResponse.json({ error: 'Data tidak lengkap' }, { status: 400 });
  }

  // Find matching PO line
  const allLines = await fetchAllPOLines();
  const line = allLines.find(
    (l) => l.sapCode === sapCode && String(l.noPO) === String(noPO)
  );
  if (!line) {
    return NextResponse.json(
      { error: `Tidak ada PO dengan SAP ${sapCode} dan No PO ${noPO}` },
      { status: 404 }
    );
  }

  const now    = new Date();
  const today  = now.toISOString().slice(0, 10); // YYYY-MM-DD
  const serial = todaySerial();

  // Check if same noSJ + same date already has a slot for this PO line
  // Query by noPO only, filter in memory (avoids composite index requirement)
  const existingSnap = await adminDb
    .collection('gr_records')
    .where('noPO', '==', String(noPO))
    .get();

  const sameSlotDocs = existingSnap.docs.filter((d) => {
    const data = d.data();
    return (
      data.sapCode  === sapCode &&
      data.noSJ     === noSJ    &&
      data.date     === today
    );
  });

  let slotIndex: number;
  let existingSlotQty = 0;

  if (sameSlotDocs.length > 0) {
    // Same SJ + same date -> use same slot, accumulate
    slotIndex = sameSlotDocs[0].data().receivedSlot as number;
    existingSlotQty = sameSlotDocs.reduce(
      (s, d) => s + (d.data().totalQty as number), 0
    );
  } else {
    // New SJ or new date -> find next empty slot (1–10)
    slotIndex = -1;
    for (let i = 0; i < 10; i++) {
      if (line.received[i].qty == null) { slotIndex = i + 1; break; }
    }
    if (slotIndex === -1) {
      return NextResponse.json({ error: 'Semua slot GR (1–10) sudah terisi' }, { status: 400 });
    }
  }

  const newSlotTotal = existingSlotQty + totalQty;

  // Write total for this slot to Google Sheets
  await writeReceivedToSheet(line.rowIndex, slotIndex, newSlotTotal, serial);

  // Update remark
  const newTotalReceived = line.totalQtyReceived - existingSlotQty + newSlotTotal;
  const pct = Math.round((newTotalReceived / line.qtyPO) * 100);
  const remark = pct >= 100 ? 'Full Received' : 'Partial Received';
  await updateRemarkReceived(line.rowIndex, remark);

  // Resolve OCS code from master_items
  const masterSnap = await adminDb
    .collection('master_items')
    .where('sap1', '==', sapCode)
    .limit(1)
    .get();
  let ocsCode = '';
  if (!masterSnap.empty) {
    ocsCode = masterSnap.docs[0].data().ocsCode ?? '';
  } else {
    const masterSnap2 = await adminDb
      .collection('master_items')
      .where('sap2', '==', sapCode)
      .limit(1)
      .get();
    if (!masterSnap2.empty) ocsCode = masterSnap2.docs[0].data().ocsCode ?? '';
  }

  // Get operator name
  const userDoc = await adminDb.doc(`users/${uid}`).get();
  const operatorName = userDoc.exists ? (userDoc.data()?.name ?? uid) : uid;

  // Save GR record
  const grRecord: GRRecord = {
    noPO: String(noPO),
    date: today,
    noSJ, shift,
    sapCode, ocsCode, batch,
    qtyCarton, qtyBox, totalQty,
    operatorUid:      uid,
    operatorName,
    timestamp:        now.toISOString(),
    sheetRowIndex:    line.rowIndex,
    receivedSlot:     slotIndex,
    arrivalDateSerial: serial,
  };

  const docRef = await adminDb.collection('gr_records').add(grRecord);

  return NextResponse.json({ success: true, id: docRef.id, slot: slotIndex, remark, merged: sameSlotDocs.length > 0 });
}

// ---------- PATCH: edit GR qty ----------

export async function PATCH(req: NextRequest) {
  const uid = await verifySession();
  if (!uid) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id, qtyBox, qtyCarton, totalQty } = await req.json() as {
    id: string; qtyBox: number; qtyCarton: number; totalQty: number;
  };
  if (!id || !totalQty || totalQty <= 0) {
    return NextResponse.json({ error: 'Data tidak valid' }, { status: 400 });
  }

  const docRef  = adminDb.collection('gr_records').doc(id);
  const docSnap = await docRef.get();
  if (!docSnap.exists) return NextResponse.json({ error: 'Record tidak ditemukan' }, { status: 404 });

  const existing = docSnap.data() as GRRecord;
  const slotIndex = existing.receivedSlot!;

  // Sum all records for same slot (replace edited one with new value)
  const slotSnap = await adminDb
    .collection('gr_records')
    .where('noPO', '==', existing.noPO)
    .get();

  const sameSlotDocs = slotSnap.docs.filter((d) => {
    const data = d.data();
    return data.sapCode === existing.sapCode && data.receivedSlot === slotIndex;
  });

  const newSlotTotal = sameSlotDocs.reduce(
    (s, d) => s + (d.id === id ? totalQty : (d.data().totalQty as number)),
    0
  );

  // Update sheet
  await writeReceivedToSheet(
    existing.sheetRowIndex!,
    slotIndex,
    newSlotTotal,
    existing.arrivalDateSerial ?? todaySerial()
  );

  // Recalculate remark
  const allLines = await fetchAllPOLines();
  const line = allLines.find((l) => l.rowIndex === existing.sheetRowIndex);
  if (line) {
    const oldSlotTotal = sameSlotDocs.reduce((s, d) => s + (d.data().totalQty as number), 0);
    const newTotalReceived = line.totalQtyReceived - oldSlotTotal + newSlotTotal;
    const pct = Math.round((newTotalReceived / line.qtyPO) * 100);
    await updateRemarkReceived(line.rowIndex, pct >= 100 ? 'Full Received' : 'Partial Received');
  }

  // Get editor name
  const userDoc = await adminDb.doc(`users/${uid}`).get();
  const editorName = userDoc.exists ? (userDoc.data()?.name ?? uid) : uid;

  await docRef.update({
    qtyBox,
    qtyCarton,
    totalQty,
    editedAt: new Date().toISOString(),
    editedBy: editorName,
  });

  return NextResponse.json({ success: true, newSlotTotal });
}

// ---------- GET: history ----------

export async function GET(req: NextRequest) {
  const uid = await verifySession();
  if (!uid) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const limitN  = Math.min(parseInt(searchParams.get('limit') ?? '100'), 200);
  const dateFilter = searchParams.get('date'); // optional YYYY-MM-DD filter

  let query = adminDb
    .collection('gr_records')
    .orderBy('timestamp', 'desc')
    .limit(limitN);

  const snap = await query.get();
  let records = snap.docs.map((d) => ({ id: d.id, ...d.data() }));

  if (dateFilter) {
    records = records.filter((r: Record<string, unknown>) => r['date'] === dateFilter);
  }

  return NextResponse.json(records);
}
