import * as XLSX from 'xlsx';
import type { StockItem } from '@/types';

/**
 * New OCS "Stock View" format (12 columns, has header row):
 *   A: SKU        B: Sku Name       C: Sap Code    D: Category
 *   E: Qty Rack   F: Qty Sap        G: Qty On Hand H: Qty On Order
 *   I: Available  J: Reserve Qty    K: Is Under Reserve  L: Status
 *
 * Old format (10 columns, no header):
 *   A: OCS Code   B: Sku Name       C: Category    D: Qty Rack
 *   E: Qty Sap    F: Qty On Hand    G: Qty On Order H: Available
 *   I: Reserve    J: Status
 *
 * We auto-detect by checking whether col C looks like a SAP code (numeric/empty)
 * vs a category word ("Sku", "Bundle", etc.).
 */

function isNewFormat(rows: (string | number | null)[][]): boolean {
  // If first data row (skipping header / Area rows) has a numeric-looking col 2
  // or the header row contains "Sap Code", it's the new format.
  const headerRow = rows[0];
  if (headerRow && String(headerRow[2] ?? '').toLowerCase().includes('sap')) return true;
  // Fallback: count columns
  const firstData = rows.find(r => r[0] && !String(r[0]).startsWith('Area:') && String(r[0]) !== 'SKU');
  if (!firstData) return false;
  return firstData.length >= 12;
}

export function parseStockExcel(buffer: ArrayBuffer): StockItem[] {
  const wb   = XLSX.read(buffer, { type: 'array' });
  const ws   = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<(string | number | null)[]>(ws, {
    header: 1,
    defval: null,
  }) as (string | number | null)[][];

  const newFmt = isNewFormat(rows);
  const items: StockItem[] = [];
  const now = new Date().toISOString();

  for (const row of rows) {
    const ocsCode = row[0] != null ? String(row[0]).trim() : '';
    // Skip header row, area separators, empty rows
    if (!ocsCode || ocsCode === 'SKU' || ocsCode.toLowerCase().startsWith('area:')) continue;

    if (newFmt) {
      // New 12-column format
      items.push({
        ocsCode,
        skuName:       String(row[1]  ?? ''),
        sapCode:       String(row[2]  ?? ''),
        category:      String(row[3]  ?? ''),
        qtyRack:       Number(row[4])  || 0,
        qtySap:        Number(row[5])  || 0,
        qtyOnHand:     Number(row[6])  || 0,
        qtyOnOrder:    Number(row[7])  || 0,
        availableQty:  Number(row[8])  || 0,
        reserveQty:    Number(row[9])  || 0,
        isUnderReserve: String(row[10] ?? 'Tidak'),
        status:        String(row[11] ?? 'Aktif'),
        uploadedAt:    now,
        uploadedBy:    '',
      });
    } else {
      // Old 10-column format (no Sap Code, no Is Under Reserve)
      items.push({
        ocsCode,
        skuName:       String(row[1] ?? ''),
        sapCode:       '',
        category:      String(row[2] ?? ''),
        qtyRack:       Number(row[3]) || 0,
        qtySap:        Number(row[4]) || 0,
        qtyOnHand:     Number(row[5]) || 0,
        qtyOnOrder:    Number(row[6]) || 0,
        availableQty:  Number(row[7]) || 0,
        reserveQty:    Number(row[8]) || 0,
        isUnderReserve: 'Tidak',
        status:        String(row[9] ?? 'Aktif'),
        uploadedAt:    now,
        uploadedBy:    '',
      });
    }
  }

  return items;
}

/**
 * Build a downloadable template workbook (new format).
 * Returns a base64 string that the client can trigger as a download.
 */
export function buildStockTemplate(): string {
  const wb = XLSX.utils.book_new();

  const header = [
    'SKU', 'Sku Name', 'Sap Code', 'Category',
    'Qty Rack', 'Qty Sap', 'Qty On Hand', 'Qty On Order',
    'Available Qty', 'Reserve Qty', 'Is Under Reserve', 'Status',
  ];

  const examples = [
    ['ACNE-CLEANSER', 'Hanasui Acne Cleanser', '1201010408', 'Sku', 555, 0, 555, 0, 555, 0, 'Tidak', 'Aktif'],
    ['ACNE-ESSENCE',  'Hanasui Acne Essence',  '1201010407', 'Sku', 246, 415, 661, 0, 661, 0, 'Tidak', 'Aktif'],
    ['EXAMPLE-SKU',   'Nama Produk Di Sini',   '1201012345', 'Sku', 100, 50, 150, 10, 140, 0, 'Tidak', 'Aktif'],
  ];

  const ws = XLSX.utils.aoa_to_sheet([header, ...examples]);

  // Column widths
  ws['!cols'] = [
    { wch: 20 }, { wch: 50 }, { wch: 14 }, { wch: 10 },
    { wch: 10 }, { wch: 10 }, { wch: 13 }, { wch: 13 },
    { wch: 13 }, { wch: 12 }, { wch: 16 }, { wch: 10 },
  ];

  XLSX.utils.book_append_sheet(wb, ws, 'Stock');
  return XLSX.write(wb, { type: 'base64', bookType: 'xlsx' });
}
