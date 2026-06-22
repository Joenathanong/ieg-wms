// ─── User & Auth ─────────────────────────────────────────────────────────────
export type UserRole = 'admin' | 'operator_inbound' | 'supervisor';

export interface AppUser {
  uid: string;
  email: string;
  name: string;
  role: UserRole;
  active: boolean;
  createdAt: string;
}

// ─── Shift Config ─────────────────────────────────────────────────────────────
export interface ShiftConfig {
  name: string;       // "Shift 1", "Shift 2", etc.
  logoutTime: string; // "HH:MM" format, e.g. "15:30"
}

export interface ShiftSettings {
  numShifts: number;
  shifts: ShiftConfig[];
}

// ─── Master Item ──────────────────────────────────────────────────────────────
export interface MasterItem {
  id: string;
  ocsCode: string;  // e.g. "FYNE-EXTRAIT-AMBER-WOOD"
  sap1: string;     // e.g. "1207050305"
  sap2?: string;    // e.g. "1227050305" (optional second SAP code)
  name: string;
  category?: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

// ─── Stock ────────────────────────────────────────────────────────────────────
export interface StockItem {
  ocsCode: string;
  skuName: string;
  category: string;
  qtyRack: number;
  qtySap: number;
  qtyOnHand: number;
  qtyOnOrder: number;
  availableQty: number;
  reserveQty: number;
  status: string;
  uploadedAt: string;
  uploadedBy: string;
}

// ─── Open PO (from Google Sheets) ────────────────────────────────────────────
export interface POLine {
  noPO: string;
  date: string;
  sku: string;          // SKU / OCS code from sheet
  sapCode: string;
  qtyPO: number;
  qtyTidakFulfill: number;
  qtyFulfill: number;
  persentasePO: string;
  qtyUpStock?: number;
  dateUpStock?: string;
  received: ReceivedEntry[];   // up to 10
  totalQtyReceived: number;
  persentaseReceived: string;
  remarkPO: string;
  remarkReceived: string;
  today: string;
  leadTimePOOutstanding?: number;
  leadTimeArrivalDate?: number;
  rowIndex: number; // 1-based row index in sheet for write-back
}

export interface ReceivedEntry {
  qty: number | null;
  arrivalDate: string | null; // Excel serial or formatted string
}

// ─── GR Record ───────────────────────────────────────────────────────────────
export interface GRRecord {
  id?: string;
  noPO: string;
  noSJ: string;       // Surat Jalan
  shift: string;      // "Shift 1" | "Shift 2" | "Shift 3" | "Non Shift"
  sapCode: string;
  ocsCode: string;
  batch: string;
  qtyCarton: number;  // isi per karton (from barcode)
  qtyBox: number;     // jumlah box diinput operator
  totalQty: number;   // qtyCarton × qtyBox
  operatorUid: string;
  operatorName: string;
  timestamp: string;  // ISO string
  sheetRowIndex?: number;
  receivedSlot?: number; // 1-10, which "Received Xth" slot was filled
}

// ─── Dashboard ────────────────────────────────────────────────────────────────
export type DashboardFilter =
  | 'all'
  | 'urgent'
  | 'pending'
  | 'partial'
  | 'fulfilled'
  | 'not_yet';

export interface DashboardSummary {
  totalOpenPO: number;
  pendingCount: number;
  partialCount: number;
  fulfilledCount: number;
  notYetCount: number;
  urgentCount: number;
}

// ─── Monitor (public) ─────────────────────────────────────────────────────────
export interface MonitorItem {
  noPO: string;
  date: string;
  sapCode: string;
  ocsCode: string;
  skuName: string;
  qtyPO: number;
  qtyPending: number;
  qtyReceived: number;   // total already received
  pctFulfill: number;    // 0–100
  remarkPO: string;
  lastArrival: string | null;
}
