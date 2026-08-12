import type React from 'react';

/**
 * Logika murni untuk tabel ALV (sort, filter, nilai export).
 * Dipisah dari komponen React agar bisa diuji sendiri dan dipakai ulang.
 */

export type CellValue = string | number | boolean | Date | null | undefined;

export interface Column<T> {
  key: string;
  header: string;
  width?: string;
  align?: 'left' | 'right' | 'center';
  mono?: boolean;
  render?: (row: T, index: number) => React.ReactNode;
  /** Nilai mentah untuk sort / filter (default: row[key]). */
  value?: (row: T) => CellValue;
  /** Nilai untuk export CSV & pencocokan filter alternatif (default: value()). */
  exportValue?: (row: T) => string | number;
  /** default: true bila header tidak kosong */
  sortable?: boolean;
  /** default: true bila header tidak kosong */
  filterable?: boolean;
}

/** Operator seleksi ala SAP (mirip ranges: EQ / NE / CP / NP / GT / GE / LT / LE). */
export type FilterOp = 'CP' | 'NP' | 'EQ' | 'NE' | 'GT' | 'GE' | 'LT' | 'LE';

export const FILTER_OPS: { op: FilterOp; label: string; sign: string }[] = [
  { op: 'CP', label: 'Contains (mengandung)', sign: '≈' },
  { op: 'NP', label: 'Not contains (tidak mengandung)', sign: '≉' },
  { op: 'EQ', label: 'Equal (sama dengan)', sign: '=' },
  { op: 'NE', label: 'Not equal (tidak sama dengan)', sign: '≠' },
  { op: 'GT', label: 'Greater than (lebih besar)', sign: '>' },
  { op: 'GE', label: 'Greater or equal', sign: '≥' },
  { op: 'LT', label: 'Less than (lebih kecil)', sign: '<' },
  { op: 'LE', label: 'Less or equal', sign: '≤' },
];

export interface FilterState {
  op: FilterOp;
  val: string;
}

export function rawOf<T>(c: Column<T>, r: T): CellValue {
  if (c.value) return c.value(r);
  return (r as Record<string, unknown>)[c.key] as CellValue;
}

export function textOf(v: CellValue): string {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return isNaN(v.getTime()) ? '' : v.toISOString();
  if (typeof v === 'boolean') return v ? 'X' : '';
  return String(v);
}

/** Kandidat teks saat mencocokkan filter: nilai mentah + nilai export (mis. tanggal terformat). */
export function candidates<T>(c: Column<T>, r: T): string[] {
  const out = [textOf(rawOf(c, r))];
  if (c.exportValue) {
    const e = c.exportValue(r);
    const s = e === null || e === undefined ? '' : String(e);
    if (s && s !== out[0]) out.push(s);
  }
  return out;
}

export function numOf(v: CellValue): number {
  if (typeof v === 'number') return v;
  if (v instanceof Date) return v.getTime();
  const s = String(v ?? '').replace(/\s/g, '');
  if (s === '') return NaN;
  // dukung format id/de (1.234,5) maupun en (1,234.5)
  const norm = /,\d{1,3}$/.test(s) ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  if (!/^[+-]?\d*\.?\d+$/.test(norm)) return NaN;
  const n = parseFloat(norm);
  return Number.isFinite(n) ? n : NaN;
}

/** Pembanding untuk sort: angka & tanggal numerik, teks pakai natural sort, kosong di bawah. */
export function compare(a: CellValue, b: CellValue): number {
  const ea = a === null || a === undefined || a === '';
  const eb = b === null || b === undefined || b === '';
  if (ea && eb) return 0;
  if (ea) return 1;
  if (eb) return -1;
  if (a instanceof Date || b instanceof Date) return numOf(a) - numOf(b);
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  if (typeof a === 'boolean' && typeof b === 'boolean') return (a ? 1 : 0) - (b ? 1 : 0);
  return String(a).localeCompare(String(b), 'id', { numeric: true, sensitivity: 'base' });
}

export function wildcardMatch(hay: string, term: string): boolean {
  if (!term.includes('*')) return hay.includes(term);
  const rx = new RegExp(
    '^' + term.split('*').map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$'
  );
  return rx.test(hay);
}

/**
 * Apakah satu sel lolos filter?
 * `cands` = daftar teks kandidat (nilai mentah + nilai export), `raw` = nilai mentah.
 * Beberapa nilai dipisah ";" — CP/EQ = salah satu cocok, NP/NE = tidak ada yang cocok.
 */
export function matchFilter(cands: string[], raw: CellValue, f: FilterState): boolean {
  const q = f.val.trim();
  if (!q) return true;
  const HAY = cands.map((c) => c.toUpperCase());
  const terms = q
    .toUpperCase()
    .split(';')
    .map((t) => t.trim())
    .filter(Boolean);
  if (terms.length === 0) return true;

  const anyCp = () => terms.some((t) => HAY.some((h) => wildcardMatch(h, t)));
  const anyEq = () =>
    terms.some((t) => {
      if (HAY.some((h) => h === t)) return true;
      const n = numOf(raw);
      const qn = numOf(t);
      return Number.isFinite(n) && Number.isFinite(qn) && n === qn;
    });

  const n = numOf(raw);
  const qn = numOf(terms[0]);
  const bothNum = Number.isFinite(n) && Number.isFinite(qn);
  const H = HAY[0] ?? '';

  switch (f.op) {
    case 'CP':
      return anyCp();
    case 'NP':
      return !anyCp();
    case 'EQ':
      return anyEq();
    case 'NE':
      return !anyEq();
    case 'GT':
      return bothNum ? n > qn : H > terms[0];
    case 'GE':
      return bothNum ? n >= qn : H >= terms[0];
    case 'LT':
      return bothNum ? n < qn : H < terms[0];
    case 'LE':
      return bothNum ? n <= qn : H <= terms[0];
    default:
      return true;
  }
}

/** Terapkan filter kolom + quick search + sort ke sekumpulan baris. */
export function applyView<T>(
  rows: T[],
  columns: Column<T>[],
  filters: Record<string, FilterState>,
  search: string,
  sort: { key: string; dir: 'asc' | 'desc' } | null
): T[] {
  const active = Object.entries(filters).filter(([, f]) => f.val.trim() !== '');
  const q = search.trim().toUpperCase();

  let out = rows;

  if (active.length > 0 || q) {
    out = rows.filter((r) => {
      for (const [key, f] of active) {
        const c = columns.find((x) => x.key === key);
        if (!c) continue;
        if (!matchFilter(candidates(c, r), rawOf(c, r), f)) return false;
      }
      if (q) {
        const hit = columns.some((c) => candidates(c, r).some((s) => s.toUpperCase().includes(q)));
        if (!hit) return false;
      }
      return true;
    });
  }

  if (sort) {
    const c = columns.find((x) => x.key === sort.key);
    if (c) {
      const dir = sort.dir === 'asc' ? 1 : -1;
      out = [...out].sort((a, b) => dir * compare(rawOf(c, a), rawOf(c, b)));
    }
  }
  return out;
}
