import * as XLSX from 'xlsx';
import type { StockItem } from '@/types';

export function parseStockExcel(buffer: ArrayBuffer): StockItem[] {
  const wb = XLSX.read(buffer, { type: 'array' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<(string | number)[]>(ws, {
    header: 1,
    defval: null,
  }) as (string | number | null)[][];

  const items: StockItem[] = [];
  const now = new Date().toISOString();

  for (const row of rows) {
    // Skip header row, area rows, or empty rows
    const ocsCode = row[0] != null ? String(row[0]).trim() : '';
    if (!ocsCode || ocsCode === 'SKU' || ocsCode.startsWith('Area:')) continue;

    items.push({
      ocsCode,
      skuName:      String(row[1] ?? ''),
      category:     String(row[2] ?? ''),
      qtyRack:      Number(row[3]) || 0,
      qtySap:       Number(row[4]) || 0,
      qtyOnHand:    Number(row[5]) || 0,
      qtyOnOrder:   Number(row[6]) || 0,
      availableQty: Number(row[7]) || 0,
      reserveQty:   Number(row[8]) || 0,
      status:       String(row[9] ?? 'Aktif'),
      uploadedAt:   now,
      uploadedBy:   '', // filled by caller
    });
  }

  return items;
}
