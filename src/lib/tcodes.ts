/**
 * Registry T-Code SAP -> Route Next.js.
 * Dipakai oleh Command Field di top bar (ketik "MIGO" lalu Enter).
 */

export type TCodeGroup = 'TRANSACTION' | 'REPORT' | 'MASTER' | 'SYSTEM';

export interface TCodeEntry {
  code: string;
  title: string;
  path: string;
  group: TCodeGroup;
  /** hanya ADMIN yang boleh membuka */
  adminOnly?: boolean;
  aliases?: string[];
}

export const TCODES: TCodeEntry[] = [
  // ---------------- TRANSACTIONS ----------------
  { code: 'MIGO', title: 'Goods Movement (GR / GI / Adjustment)', path: '/migo', group: 'TRANSACTION' },
  { code: 'LT01', title: 'Create Transfer Order — Single Bin', path: '/lt01', group: 'TRANSACTION' },
  { code: 'LT10', title: 'Mass Bin Transfer', path: '/lt10', group: 'TRANSACTION' },
  { code: 'LI01N', title: 'Create Physical Inventory Doc (Freeze Bin)', path: '/li01n', group: 'TRANSACTION' },
  { code: 'LI11N', title: 'Enter Physical Inventory Count', path: '/li11n', group: 'TRANSACTION' },

  // ---------------- REPORTS ----------------
  { code: 'MB52', title: 'Display Warehouse Stock (Global / IM)', path: '/mb52', group: 'REPORT' },
  { code: 'LX02', title: 'Stock per Storage Bin (WM Breakdown)', path: '/lx02', group: 'REPORT' },
  { code: 'MB51', title: 'Material Document List (History)', path: '/mb51', group: 'REPORT' },
  { code: 'LS04', title: 'Display Empty Storage Bins', path: '/ls04', group: 'REPORT' },

  // ---------------- MASTER DATA ----------------
  { code: 'MM01', title: 'Create / Maintain Material Master', path: '/mm01', group: 'MASTER' },
  { code: 'MM02', title: 'Change Material Master', path: '/mm01', group: 'MASTER', aliases: ['MM03'] },
  { code: 'LS01N', title: 'Create Storage Bin', path: '/ls01n', group: 'MASTER' },
  { code: 'LS02N', title: 'Change Storage Bin', path: '/ls01n', group: 'MASTER' },
  { code: 'LS06', title: 'Block / Unblock Storage Bin', path: '/ls01n', group: 'MASTER' },
  { code: 'ZUPLOAD', title: 'Master Data & Initial Stock Upload Center', path: '/zupload', group: 'MASTER' },

  // ---------------- SYSTEM ----------------
  { code: 'SU01', title: 'User Maintenance', path: '/su01', group: 'SYSTEM', adminOnly: true },
  { code: 'SESSION_MANAGER', title: 'SAP Easy Access', path: '/', group: 'SYSTEM', aliases: ['MENU', 'HOME'] },
];

/** Normalisasi input command field: "/nMIGO", "/n migo", "migo" -> "MIGO" */
export function normalizeCommand(raw: string): string {
  return raw
    .trim()
    .toUpperCase()
    .replace(/^\/N\s*/, '')
    .replace(/^\/O\s*/, '')
    .replace(/\s+/g, '');
}

export function resolveTCode(raw: string): TCodeEntry | null {
  const cmd = normalizeCommand(raw);
  if (!cmd) return null;
  if (cmd === '/EXIT' || cmd === '/I' || cmd === 'LOGOUT') {
    return { code: 'LOGOUT', title: 'Log Off', path: '/logout', group: 'SYSTEM' };
  }
  return (
    TCODES.find((t) => t.code === cmd) ??
    TCODES.find((t) => t.aliases?.includes(cmd)) ??
    null
  );
}

export function tcodeByPath(path: string): TCodeEntry | undefined {
  return TCODES.find((t) => t.path === path);
}
