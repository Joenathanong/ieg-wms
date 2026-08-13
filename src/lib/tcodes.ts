/**
 * Registry T-Code SAP -> Route Next.js.
 * Dipakai oleh Command Field di top bar (ketik "MIGO" lalu Enter).
 */

export type TCodeGroup = 'TRANSACTION' | 'WAREHOUSE' | 'REPORT' | 'MASTER' | 'PDT' | 'SYSTEM';

export interface TCodeEntry {
  code: string;
  title: string;
  path: string;
  group: TCodeGroup;
  /** hanya ADMIN yang boleh membuka */
  adminOnly?: boolean;
  /** butuh izin PDT (flag user + master switch) */
  pdtOnly?: boolean;
  aliases?: string[];
}

export const TCODES: TCodeEntry[] = [
  // ---------------- TRANSACTIONS (level IM / MM) ----------------
  { code: 'MIGO', title: 'Goods Movement (GR / GI / Adjustment)', path: '/migo', group: 'TRANSACTION' },
  { code: 'LI01N', title: 'Create Physical Inventory Doc (Freeze Bin)', path: '/li01n', group: 'TRANSACTION' },
  { code: 'LI11N', title: 'Enter Physical Inventory Count', path: '/li11n', group: 'TRANSACTION' },

  // ---------------- WAREHOUSE (level WM / bin) ----------------
  { code: 'LB10', title: 'Transfer Requirement List (Work Queue)', path: '/lb10', group: 'WAREHOUSE' },
  { code: 'LB12', title: 'Process Transfer Requirement (Put-away / Pick)', path: '/lb12', group: 'WAREHOUSE' },
  { code: 'LT01', title: 'Create Transfer Order — Single Bin', path: '/lt01', group: 'WAREHOUSE' },
  { code: 'LT10', title: 'Mass Bin Transfer', path: '/lt10', group: 'WAREHOUSE' },

  // ---------------- REPORTS ----------------
  { code: 'MB52', title: 'Display Warehouse Stock (Global / IM)', path: '/mb52', group: 'REPORT' },
  { code: 'LX02', title: 'Stock per Storage Bin (WM Breakdown)', path: '/lx02', group: 'REPORT', aliases: ['LX01'] },
  { code: 'MB51', title: 'Material Document List (History IM)', path: '/mb51', group: 'REPORT' },
  { code: 'LT22', title: 'Display Transfer Order (History Bin Transfer)', path: '/lt22', group: 'REPORT', aliases: ['LT23', 'LT21'] },
  { code: 'LS04', title: 'Display Empty Storage Bins', path: '/ls04', group: 'REPORT' },

  // ---------------- MASTER DATA ----------------
  { code: 'MM01', title: 'Create / Maintain Material Master', path: '/mm01', group: 'MASTER' },
  { code: 'MM02', title: 'Change Material Master', path: '/mm01', group: 'MASTER', aliases: ['MM03'] },
  { code: 'LS01N', title: 'Create Storage Bin', path: '/ls01n', group: 'MASTER' },
  { code: 'LS02N', title: 'Change Storage Bin', path: '/ls01n', group: 'MASTER' },
  { code: 'LS06', title: 'Block / Unblock Storage Bin', path: '/ls01n', group: 'MASTER' },
  { code: 'ZZONE', title: 'Maintain Zone / Storage Section', path: '/zzone', group: 'MASTER', adminOnly: true, aliases: ['LS10', 'ZONE'] },
  { code: 'KS01', title: 'Create / Maintain Cost Center', path: '/ks01', group: 'MASTER', adminOnly: true, aliases: ['KS02', 'KS03', 'KS13', 'COSTCENTER'] },
  { code: 'ZUPLOAD', title: 'Master Data & Initial Stock Upload Center', path: '/zupload', group: 'MASTER' },

  // ---------------- PDT / RF TERMINAL ----------------
  { code: 'ZRF', title: 'PDT Terminal — Main Menu', path: '/zrf', group: 'PDT', pdtOnly: true, aliases: ['LM00', 'RF'] },
  { code: 'ZRF01', title: 'PDT — Goods Receipt (101)', path: '/zrf/gr', group: 'PDT', pdtOnly: true },
  { code: 'ZRF02', title: 'PDT — Put-away (TR PUTAWAY)', path: '/zrf/putaway', group: 'PDT', pdtOnly: true },
  { code: 'ZRF03', title: 'PDT — Picking (TR PICK)', path: '/zrf/pick', group: 'PDT', pdtOnly: true },
  { code: 'ZRF04', title: 'PDT — Bin to Bin Transfer (301)', path: '/zrf/transfer', group: 'PDT', pdtOnly: true },
  { code: 'ZRF05', title: 'PDT — Physical Inventory Count', path: '/zrf/count', group: 'PDT', pdtOnly: true },
  { code: 'ZRF06', title: 'PDT — Bin / Material Inquiry', path: '/zrf/inquiry', group: 'PDT', pdtOnly: true },
  { code: 'ZRF07', title: 'PDT — Goods Issue (201)', path: '/zrf/gi', group: 'PDT', pdtOnly: true },
  { code: 'ZRF08', title: 'PDT — Replenishment (FEFO ke Fix Bin)', path: '/zrf/replenish', group: 'PDT', pdtOnly: true },

  // ---------------- SYSTEM ----------------
  { code: 'SU01', title: 'User Maintenance', path: '/su01', group: 'SYSTEM', adminOnly: true },
  { code: 'PFCG', title: 'Role Maintenance (T-Code Authorization)', path: '/pfcg', group: 'SYSTEM', adminOnly: true },
  { code: 'ZSET', title: 'System Configuration', path: '/zset', group: 'SYSTEM', adminOnly: true },
  { code: 'SESSION_MANAGER', title: 'SAP Easy Access', path: '/', group: 'SYSTEM', aliases: ['MENU', 'HOME'] },
];

/**
 * Daftar T-Code yang dapat dibatasi lewat role otorisasi (PFCG).
 * SESSION_MANAGER (home) dan alias tidak termasuk — selalu boleh.
 */
export const RESTRICTABLE_TCODES: TCodeEntry[] = TCODES.filter(
  (t) => t.code !== 'SESSION_MANAGER'
);

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

/**
 * Cek apakah satu entry T-Code boleh dibuka oleh user.
 * `allowed` = daftar T-Code dari role otorisasi (PFCG); null = tidak dibatasi.
 */
export function canAccessTcode(
  t: TCodeEntry,
  role: string,
  pdtAllowed: boolean,
  allowed: string[] | null | undefined
): boolean {
  if (t.adminOnly && role !== 'ADMIN') return false;
  if (t.pdtOnly && !pdtAllowed) return false;
  if (t.code === 'SESSION_MANAGER' || t.code === 'LOGOUT') return true;
  if (!allowed || role === 'ADMIN') return true; // ADMIN & user tanpa role: full access
  if (allowed.includes(t.code)) return true;
  // menu utama ZRF boleh dibuka bila punya minimal satu T-Code ZRF
  if (t.code === 'ZRF') return allowed.some((c) => c.startsWith('ZRF') && c !== 'ZRF');
  return false;
}

/** Filter T-Code sesuai hak akses user. */
export function visibleTCodes(
  role: string,
  pdtAllowed: boolean,
  allowed?: string[] | null
): TCodeEntry[] {
  return TCODES.filter((t) => canAccessTcode(t, role, pdtAllowed, allowed ?? null));
}

/**
 * Cek akses berdasarkan pathname (dipakai middleware).
 * Path yang tidak terdaftar sebagai T-Code (mis. /help) selalu boleh.
 */
export function pathAllowed(
  pathname: string,
  role: string,
  pdtAllowed: boolean,
  allowed: string[] | null | undefined
): boolean {
  // cocokkan entry paling spesifik (path terpanjang) supaya /zrf/transfer
  // dinilai sebagai ZRF04, bukan menu ZRF.
  const matches = TCODES.filter(
    (t) => t.path !== '/' && (pathname === t.path || pathname.startsWith(t.path + '/'))
  ).sort((a, b) => b.path.length - a.path.length);
  if (matches.length === 0) return true;
  const bestPath = matches[0].path;
  const best = matches.filter((t) => t.path === bestPath);
  // boleh bila SALAH SATU t-code pada path tsb diizinkan (MM01/MM02 share /mm01)
  return best.some((t) => canAccessTcode(t, role, pdtAllowed, allowed));
}
