import { NextResponse } from 'next/server';
import { fetchAllPOLines } from '@/lib/gsheets/po';
import { adminDb } from '@/lib/firebase/admin';
import type { MonitorItem } from '@/types';

export const revalidate = 120;

export async function GET() {
  try {
    const [poLines, masterSnap] = await Promise.all([
      fetchAllPOLines(),
      adminDb.collection('master_items').get(),
    ]);

    // Build SAP → OCS + name lookup
    const sapMap: Record<string, { ocsCode: string; name: string }> = {};
    masterSnap.docs.forEach((d) => {
      const data = d.data();
      if (data.sap1) sapMap[data.sap1] = { ocsCode: data.ocsCode, name: data.name };
      if (data.sap2) sapMap[data.sap2] = { ocsCode: data.ocsCode, name: data.name };
    });

    const items: MonitorItem[] = poLines
      .filter((p) => {
        // Only show lines with pending qty (QtyPO > totalReceived)
        const pending = p.qtyPO - p.totalQtyReceived;
        return pending > 0 && p.remarkPO !== 'Not yet fulfilled'; // include all pending
      })
      .map((p) => {
        const meta = sapMap[p.sapCode] ?? { ocsCode: p.sku, name: p.sku };
        const pending = p.qtyPO - p.totalQtyReceived;
        const pct = p.qtyPO > 0 ? Math.round((p.totalQtyReceived / p.qtyPO) * 100) : 0;

        // Find last non-null arrival date
        const lastArrival = [...p.received]
          .reverse()
          .find((r) => r.arrivalDate != null)?.arrivalDate ?? null;

        return {
          noPO:        p.noPO,
          date:        p.date,
          sapCode:     p.sapCode,
          ocsCode:     meta.ocsCode,
          skuName:     meta.name,
          qtyPO:       p.qtyPO,
          qtyPending:  pending,
          qtyReceived: p.totalQtyReceived,
          pctFulfill:  pct,
          remarkPO:    p.remarkPO,
          lastArrival,
        };
      });

    return NextResponse.json(items);
  } catch (err) {
    console.error('Monitor error:', err);
    return NextResponse.json({ error: 'Failed to load' }, { status: 500 });
  }
}
