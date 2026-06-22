import { getSheetsClient, SPREADSHEET_ID, SHEET_NAME } from './client';
import type { POLine, ReceivedEntry } from '@/types';

// Column indices (0-based) matching the sheet layout
const COL = {
  NO_PO:            0,
  DATE:             1,
  SKU:              2,
  SAP_CODE:         3,
  QTY_PO:           4,
  QTY_TIDAK:        5,
  QTY_FULFILL:      6,
  PCT_PO:           7,
  QTY_UP_STOCK:     8,
  DATE_UP_STOCK:    9,
  // Received 1–10: pairs of (qty, date) starting at col 10
  REMARK_PO:        30,
  REMARK_RECEIVED:  31,
  TODAY:            32,
  LEAD_TIME_PO:     33,
  LEAD_TIME_ARRIVAL:34,
};

const RECEIVED_START = 10; // col index of QTY Received 1st
// Each received pair = 2 cols (qty, date), 10 pairs = cols 10–29

function parseReceived(row: (string | number | null | undefined)[]): ReceivedEntry[] {
  const entries: ReceivedEntry[] = [];
  for (let i = 0; i < 10; i++) {
    const qtyIdx  = RECEIVED_START + i * 2;
    const dateIdx = qtyIdx + 1;
    const qty  = row[qtyIdx]  != null && row[qtyIdx] !== '' ? Number(row[qtyIdx])  : null;
    const date = row[dateIdx] != null && row[dateIdx] !== '' ? String(row[dateIdx]) : null;
    entries.push({ qty, arrivalDate: date });
  }
  return entries;
}

function toNum(v: unknown): number {
  const n = Number(v);
  return isNaN(n) ? 0 : n;
}

function rowToPOLine(row: (string | number | null | undefined)[], rowIndex: number): POLine {
  const received = parseReceived(row);
  const totalQtyReceived = received.reduce((s, e) => s + (e.qty ?? 0), 0);

  return {
    noPO:               String(row[COL.NO_PO]  ?? ''),
    date:               String(row[COL.DATE]   ?? ''),
    sku:                String(row[COL.SKU]    ?? ''),
    sapCode:            String(row[COL.SAP_CODE] ?? ''),
    qtyPO:              toNum(row[COL.QTY_PO]),
    qtyTidakFulfill:    toNum(row[COL.QTY_TIDAK]),
    qtyFulfill:         toNum(row[COL.QTY_FULFILL]),
    persentasePO:       String(row[COL.PCT_PO] ?? ''),
    qtyUpStock:         row[COL.QTY_UP_STOCK]  ? toNum(row[COL.QTY_UP_STOCK])  : undefined,
    dateUpStock:        row[COL.DATE_UP_STOCK] ? String(row[COL.DATE_UP_STOCK]) : undefined,
    received,
    totalQtyReceived,
    persentaseReceived: String(row[COL.REMARK_RECEIVED + 1] ?? ''),
    remarkPO:           String(row[COL.REMARK_PO]       ?? ''),
    remarkReceived:     String(row[COL.REMARK_RECEIVED]  ?? ''),
    today:              String(row[COL.TODAY]            ?? ''),
    leadTimePOOutstanding: row[COL.LEAD_TIME_PO]
      ? toNum(row[COL.LEAD_TIME_PO]) : undefined,
    leadTimeArrivalDate:   row[COL.LEAD_TIME_ARRIVAL]
      ? toNum(row[COL.LEAD_TIME_ARRIVAL]) : undefined,
    rowIndex,
  };
}

export async function fetchAllPOLines(): Promise<POLine[]> {
  const sheets = getSheetsClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `${SHEET_NAME}!A3:AI`, // skip first 2 header rows
  });

  const rows = res.data.values ?? [];
  const lines: POLine[] = [];

  rows.forEach((row, idx) => {
    // skip empty rows or area header rows
    if (!row[COL.NO_PO] || String(row[COL.NO_PO]).startsWith('Area')) return;
    lines.push(rowToPOLine(row as (string | number | null)[], idx + 3)); // +3 = 1-based + 2 header rows
  });

  return lines;
}

/**
 * Write a received qty+date into the correct "QTY Received Nth / Arrival date Nth" columns.
 * slotIndex: 1–10
 */
export async function writeReceivedToSheet(
  rowIndex: number,
  slotIndex: number,
  qty: number,
  arrivalDate: number | string, // pass Excel serial as-is, or formatted string
): Promise<void> {
  if (slotIndex < 1 || slotIndex > 10) throw new Error('slotIndex must be 1–10');

  const sheets   = getSheetsClient();
  const qtyCol   = RECEIVED_START + (slotIndex - 1) * 2; // 0-based col index
  const dateCol  = qtyCol + 1;

  // Convert 0-based col index to A1 notation
  function colToLetter(col: number): string {
    let letter = '';
    let c = col;
    while (c >= 0) {
      letter = String.fromCharCode((c % 26) + 65) + letter;
      c = Math.floor(c / 26) - 1;
    }
    return letter;
  }

  const qtyA1  = `${SHEET_NAME}!${colToLetter(qtyCol)}${rowIndex}`;
  const dateA1 = `${SHEET_NAME}!${colToLetter(dateCol)}${rowIndex}`;

  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: SPREADSHEET_ID,
    requestBody: {
      valueInputOption: 'RAW',
      data: [
        { range: qtyA1,  values: [[qty]] },
        { range: dateA1, values: [[arrivalDate]] },
      ],
    },
  });
}

/**
 * Update Remark Received column (col AD = index 31)
 */
export async function updateRemarkReceived(
  rowIndex: number,
  remark: string,
): Promise<void> {
  const sheets = getSheetsClient();
  function colToLetter(col: number): string {
    let letter = '';
    let c = col;
    while (c >= 0) {
      letter = String.fromCharCode((c % 26) + 65) + letter;
      c = Math.floor(c / 26) - 1;
    }
    return letter;
  }
  const remarkA1 = `${SHEET_NAME}!${colToLetter(COL.REMARK_RECEIVED)}${rowIndex}`;
  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: remarkA1,
    valueInputOption: 'RAW',
    requestBody: { values: [[remark]] },
  });
}
