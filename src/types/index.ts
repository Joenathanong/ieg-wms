export type UserRole = 'admin' | 'operator_inbound' | 'supervisor';

export interface AppUser {
  uid: string;
  email: string;
  name: string;
  role: UserRole;
  active: boolean;
  createdAt: string;
}

export interface ShiftConfig {
  name: string;
  logoutTime: string;
}

export interface ShiftSettings {
  numShifts: number;
  shifts: ShiftConfig[];
}

export interface MasterItem {
  id: string;
  ocsCode: string;
  sap1: string;
  sap2?: string;
  name: string;
  category?: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

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

export interface POLine {
  noPO: string;
  date: string;
  sku: string;
  sapCode: string;
  qtyPO: number;
  qtyTidakFulfill: number;
  qtyFulfill: number;
  persentasePO: string;
  qtyUpStock?: number;
  dateUpStock?: string;
  received: ReceivedEntry[];
  totalQtyReceived: number;
  persentaseReceived: string;
  remarkPO: string;
  remarkReceived: string;
  today: string;
  leadTimePOOutstanding?: number;
  leadTimeArrivalDate?: number;
  rowIndex: number;
}

export interface ReceivedEntry {
  qty: number | null;
  arrivalDate: string | null;
}

export interface GRRecord {
  id?: string;
  noPO: string;
  date: string;
  noSJ: string;
  shift: string;
  sapCode: string;
  ocsCode: string;
  batch: string;
  qtyCarton: number;
  qtyBox: number;
  totalQty: number;
  operatorUid: string;
  operatorName: string;
  timestamp: string;
  sheetRowIndex?: number;
  receivedSlot?: number;
  arrivalDateSerial?: number;
  editedAt?: string;
  editedBy?: string;
}

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

export type UrgencyLevel = 'stock_minus' | 'stock_empty' | 'stock_low' | 'overdue' | null;

export interface MonitorItem {
  noPO: string;
  date: string;
  sapCode: string;
  ocsCode: string;
  skuName: string;
  qtyPO: number;
  qtyPending: number;
  qtyReceived: number;
  pctFulfill: number;
  remarkPO: string;
  lastArrival: string | null;
  urgency: UrgencyLevel;
  stockOnHand: number | null;
}
