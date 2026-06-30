import { NextResponse } from 'next/server';
import { fetchAllPOLines } from '@/lib/gsheets/po';
import { adminDb } from '@/lib/firebase/admin';
import type { MonitorItem, UrgencyLevel } from '@/types';

export const revalidate = 120;

// Lower = more urgent
const URGENCY_ORDER: Record<string, number> = {
  stock_minus: 0,
  stock_empty: 1,
  stock_low:   2,
  overdue:     3,
};

function calcUrgency(
  stockOnHand: number | null,
  qtyPending: number,
  leadTime: number,
): UrgencyLevel {
  if (stockOnHand !== null) {
    if (stockOnHand < 0)  return 'stock_minus'; // oversell
    if (stockOnHand === 0) return 'stock_empty';
    if (qtyPending > 0 && stockOnHand <= qtyPending * 0.5) return 'stock_low';
  }
  if (leadTime > 0) return 'overdue';
  return null;
}

export async function GET() {
  try {
    const [poLines, masterSnap, stockSnap] = await Promise.all([
      fetchAllPOLines(),
      adminDb.collection('master_items').get(),
      adminDb.collection('stock').get(),
    ]);

    // SAP -> { ocsCode, name }
    const sapMap: Record<string, { ocsCode: string; name: string }> = {};
    masterSnap.docs.forEach((d) => {
      const data = d.data();
      const entry = { ocsCode: data.ocsCode, name: data.name };
      if (data.sap1) sapMap[String(data.sap1).trim()] = entry;
      if (data.sap2) sapMap[String(data.sap2).trim()] = entry;
    });

    // OCS -> qtyOnHand (can be negative = oversell)
    const stockMap: Record<string, number> = {};
    stockSnap.docs.forEach((d) => {
      const data = d.data();
      if (data.ocsCode) stockMap[String(data.ocsCode).trim()] = Number(data.qtyOnHand ?? 0);
    });
    const hasStock = stockSnap.size > 0;

    const items: MonitorItem[] = poLines
      .filter((p) => {
        // Show lines with outstanding qty that have been activated (qtyFulfill > 0
        // OR some qty already received). Pure "not yet" lines are excluded.
        const pending = p.qtyPO - p.totalQtyReceived;
        if (pending <= 0) return false;
        // Exclude lines where nothing has been sent yet (sheet formula keeps these as "not started")
        if (p.qtyFulfill === 0 && p.totalQtyReceived === 0) return false;
        return true;
      })
      .map((p) => {
        const meta        = sapMap[p.sapCode] ?? { ocsCode: p.sku, name: p.sku };
        const pending     = p.qtyPO - p.totalQtyReceived;
        const pct         = p.qtyPO > 0 ? Math.round((p.totalQtyReceived / p.qtyPO) * 100) : 0;
        const lastArrival = [...p.received].reverse().find((r) => r.arrivalDate != null)?.arrivalDate ?? null;
        const ocsCode     = meta.ocsCode;

        const stockOnHand: number | null = hasStock
          ? (stockMap[ocsCode] !== undefined ? stockMap[ocsCode] : null)
          : null;

        const urgency = calcUrgency(stockOnHand, pending, p.leadTimePOOutstanding ?? 0);

        return {
          noPO:        p.noPO,
          date:        p.date,
          sapCode:     p.sapCode,
          ocsCode,
          skuName:     meta.name,
          qtyPO:       p.qtyPO,
          qtyPending:  pending,
          qtyReceived: p.totalQtyReceived,
          pctFulfill:  pct,
          remarkPO:    p.remarkPO,
          lastArrival,
          urgency,
          stockOnHand,
        };
      })
      .sort((a, b) => {
        const sa = a.urgency ? (URGENCY_ORDER[a.urgency] ?? 9) : 9;
        const sb = b.urgency ? (URGENCY_ORDER[b.urgency] ?? 9) : 9;
        if (sa !== sb) return sa - sb;
        return b.qtyPending - a.qtyPending;
      });

    return NextResponse.json(items);
  } catch (err) {
    console.error('Monitor error:', err);
    return NextResponse.json({ error: 'Failed to load' }, { status: 500 });
  }
}
