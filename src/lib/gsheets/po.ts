import { getSheetsClient, SPREADSHEET_ID, SHEET_NAME } from './client';
import type { POLine, ReceivedEntry } from '@/types';

/**
 * Column index map (0-based, matching updated sheet layout):
 *
 * A(0)  No PO            B(1)  Date              C(2)  SKU
 * D(3)  SAP Code         E(4)  QTY PO            F(5)  QTY Tidak Fulfill
 * G(6)  QTY Fulfill*     H(7)  Persentase PO*    I(8)  QTY Up Stock
 * J(9)  Date Up Stock
 * K(10)–AD(29)  QTY Received 1–10 / Arrival Date 1–10 (10 pairs, unchanged)
 * AE(30) Total QTY Received*  AF(31) Percentage Received*  [NEW cols]
 * AG(32) Remark PO*      AH(33) Remark Received*
 * AI(34) Today           AJ(35) Lead Time PO Outstanding
 * AK(36) Lead Time Arrival Date
 *
 * (*) formula updated in sheet; we read the sheet's computed value directly.
 */
const COL = {
  NO_PO:              0,
  DATE:               1,
  SKU:                2,
  SAP_CODE:           3,
  QTY_PO:             4,
  QTY_TIDAK:          5,
  QTY_FULFILL:        6,  // G
  PCT_PO:             7,  // H
  QTY_UP_STOCK:       8,  // I
  DATE_UP_STOCK:      9,  // J
  // K(10)–AD(29): received slots
  TOTAL_QTY_RECEIVED: 30, // AE — sheet formula
  PCT_RECEIVED:       31, // AF — sheet formula
  REMARK_PO:          32, // AG
  REMARK_RECEIVED:    33, // AH
  TODAY:              34, // AI
  LEAD_TIME_PO:       35, // AJ
  LEAD_TIME_ARRIVAL:  36, // AK
} as const;

const RECEIVED_START = 10; // K

function parseReceived(row: (string | number | null | undefined)[]): ReceivedEntry[] {
  const entries: ReceivedEntry[] = [];
  for (let i = 0; i < 10; i++) {
    const qtyIdx  = RECEIVED_START + i * 2;
    const dateIdx = qtyIdx + 1;
    const raw     = row[qtyIdx];
    const n       = Number(raw);
    const qty     = raw != null && raw !== '' && Number.isFinite(n) ? n : null;
    const date    = row[dateIdx] != null && row[dateIdx] !== '' ? String(row[dateIdx]) : null;
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

  // Prefer sheet-calculated total (AE); fall back to slot sum
  const sheetTotal  = row[COL.TOTAL_QTY_RECEIVED];
  const totalQtyReceived =
    sheetTotal != null && sheetTotal !== '' && Number.isFinite(Number(sheetTotal))
      ? Number(sheetTotal)
      : received.reduce((s, e) => s + (e.qty ?? 0), 0);

  return {
    noPO:             String(row[COL.NO_PO]   ?? ''),
    date:             String(row[COL.DATE]    ?? ''),
    sku:              String(row[COL.SKU]     ?? ''),
    sapCode:          String(row[COL.SAP_CODE] ?? ''),
    qtyPO:            toNum(row[COL.QTY_PO]),
    qtyTidakFulfill:  toNum(row[COL.QTY_TIDAK]),
    qtyFulfill:       toNum(row[COL.QTY_FULFILL]),
    persentasePO:     String(row[COL.PCT_PO]  ?? ''),
    qtyUpStock:       row[COL.QTY_UP_STOCK]  ? toNum(row[COL.QTY_UP_STOCK])  : undefined,
    dateUpStock:      row[COL.DATE_UP_STOCK] ? String(row[COL.DATE_UP_STOCK]) : undefined,
    received,
    totalQtyReceived,
    persentaseReceived: String(row[COL.PCT_RECEIVED] ?? ''),
    remarkPO:         String(row[COL.REMARK_PO]       ?? ''),
    remarkReceived:   String(row[COL.REMARK_RECEIVED]  ?? ''),
    today:            String(row[COL.TODAY]            ?? ''),
    leadTimePOOutstanding: row[COL.LEAD_TIME_PO]
      ? toNum(row[COL.LEAD_TIME_PO]) : undefined,
    leadTimeArrivalDate: row[COL.LEAD_TIME_ARRIVAL]
      ? toNum(row[COL.LEAD_TIME_ARRIVAL]) : undefined,
    rowIndex,
  };
}

export async function fetchAllPOLines(): Promise<POLine[]> {
  const sheets = getSheetsClient();
  const res    = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `${SHEET_NAME}!A3:AK`, // extended from AI to AK for new cols
  });

  const rows  = res.data.values ?? [];
  const lines: POLine[] = [];

  rows.forEach((row, idx) => {
    if (!row[COL.NO_PO] || String(row[COL.NO_PO]).startsWith('Area')) return;
    lines.push(rowToPOLine(row as (string | number | null)[], idx + 3));
  });

  return lines;
}

// ---------- Sheet write helpers ----------

function colToLetter(col: number): string {
  let letter = '';
  let c = col;
  while (c >= 0) {
    letter = String.fromCharCode((c % 26) + 65) + letter;
    c      = Math.floor(c / 26) - 1;
  }
  return letter;
}

/**
 * Write QTY + date into one of the 10 received slots.
 * slotIndex: 1–10 → maps to cols K–AD (unchanged)
 */
export async function writeReceivedToSheet(
  rowIndex:    number,
  slotIndex:   number,
  qty:         number,
  arrivalDate: number | string,
): Promise<void> {
  if (slotIndex < 1 || slotIndex > 10) throw new Error('slotIndex must be 1–10');

  const sheets  = getSheetsClient();
  const qtyCol  = RECEIVED_START + (slotIndex - 1) * 2;
  const dateCol = qtyCol + 1;

  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: SPREADSHEET_ID,
    requestBody: {
      valueInputOption: 'RAW',
      data: [
        { range: `${SHEET_NAME}!${colToLetter(qtyCol)}${rowIndex}`,  values: [[qty]]         },
        { range: `${SHEET_NAME}!${colToLetter(dateCol)}${rowIndex}`, values: [[arrivalDate]] },
      ],
    },
  });
}

/**
 * Update Remark Received column — now AH (col 33).
 */
export async function updateRemarkReceived(rowIndex: number, remark: string): Promise<void> {
  const sheets = getSheetsClient();
  await sheets.spreadsheets.values.update({
    spreadsheetId:  SPREADSHEET_ID,
    range:          `${SHEET_NAME}!${colToLetter(COL.REMARK_RECEIVED)}${rowIndex}`,
    valueInputOption: 'RAW',
    requestBody:    { values: [[remark]] },
  });
}
