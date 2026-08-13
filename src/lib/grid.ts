import type React from 'react';
import { matchesWildcard } from './like';

/**
 * Logika murni untuk tabel ALV (sort, filter, lebar kolom, nilai export).
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

/** Pencocokan teks dengan wildcard '*' — semantik sama dengan kolom seleksi. */
export function wildcardMatch(hay: string, term: string): boolean {
  return matchesWildcard(hay, term);
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

/* ------------------------------------------------------------------ */
/* LEBAR KOLOM — auto-fit berdasarkan RATA-RATA isi                     */
/* ------------------------------------------------------------------ */

export const COL_MIN_W = 58;
/** batas lebar untuk mode rata-rata (tombol "Lebar otomatis") */
export const COL_MAX_W = 320;
/** batas lebar untuk mode isi terpanjang (lebar awal tabel) */
export const COL_MAX_W_FULL = 420;
/** padding sel kiri+kanan (px 8+8) + border + ruang ikon sort/filter di header */
const CELL_PAD = 18;
const HEAD_PAD = 42;
/** jumlah baris yang dijadikan sampel pengukuran */
const SAMPLE = 300;

let measureCtx: CanvasRenderingContext2D | null | undefined;

function ctx2d(): CanvasRenderingContext2D | null {
  if (measureCtx !== undefined) return measureCtx;
  try {
    measureCtx = typeof document === 'undefined' ? null : document.createElement('canvas').getContext('2d');
  } catch {
    measureCtx = null;
  }
  return measureCtx;
}

/** Lebar teks dalam px. Memakai canvas bila tersedia, jika tidak pakai perkiraan per karakter. */
export function textWidth(text: string, opts?: { mono?: boolean; bold?: boolean }): number {
  const s = String(text ?? '');
  if (!s) return 0;
  const c = ctx2d();
  if (!c) return s.length * (opts?.mono ? 6.4 : 6.0) * (opts?.bold ? 1.06 : 1);
  c.font = `${opts?.bold ? '600 ' : ''}11px ${
    opts?.mono ? '"JetBrains Mono", Consolas, monospace' : '"Segoe UI", Arial, sans-serif'
  }`;
  return c.measureText(s).width;
}

/** Teks yang mewakili isi sel untuk pengukuran lebar (pakai nilai export bila ada). */
export function cellText<T>(c: Column<T>, r: T): string {
  if (c.exportValue) {
    const v = c.exportValue(r);
    return v === null || v === undefined ? '' : String(v);
  }
  return textOf(rawOf(c, r));
}

/**
 * Hitung lebar optimal tiap kolom.
 *
 * Sesuai permintaan: memakai **rata-rata** lebar isi (bukan yang terpanjang),
 * sehingga satu deskripsi yang sangat panjang tidak membuat kolom melebar
 * berlebihan. Header selalu dijamin muat, dan hasil dibatasi COL_MIN_W..COL_MAX_W.
 */
export function autoFitWidths<T>(columns: Column<T>[], rows: T[]): Record<string, number> {
  const sample = rows.length > SAMPLE ? rows.slice(0, SAMPLE) : rows;
  const out: Record<string, number> = {};

  for (const c of columns) {
    const headW = textWidth(c.header, { bold: true }) + HEAD_PAD;

    let sum = 0;
    let n = 0;
    for (const r of sample) {
      const t = cellText(c, r);
      if (!t) continue; // sel kosong tidak menarik rata-rata ke bawah
      sum += textWidth(t, { mono: c.mono || c.align === 'right' });
      n++;
    }
    const avg = n > 0 ? sum / n : 0;

    const w = Math.max(c.header ? headW : COL_MIN_W, avg + CELL_PAD);
    out[c.key] = Math.round(Math.min(COL_MAX_W, Math.max(COL_MIN_W, w)));
  }
  return out;
}

/**
 * Lebar kolom berdasarkan isi **TERPANJANG** — dipakai sebagai lebar awal tabel
 * supaya tidak ada isi yang terpotong sejak awal. Tetap dibatasi COL_MAX_W_FULL
 * agar satu deskripsi ekstra panjang tidak mendorong kolom lain keluar layar.
 */
export function maxFitWidths<T>(columns: Column<T>[], rows: T[]): Record<string, number> {
  const sample = rows.length > SAMPLE ? rows.slice(0, SAMPLE) : rows;
  const out: Record<string, number> = {};

  for (const c of columns) {
    const headW = textWidth(c.header, { bold: true }) + HEAD_PAD;

    let widest = 0;
    for (const r of sample) {
      const t = cellText(c, r);
      if (!t) continue;
      const w = textWidth(t, { mono: c.mono || c.align === 'right' });
      if (w > widest) widest = w;
    }

    const w = Math.max(c.header ? headW : COL_MIN_W, widest + CELL_PAD);
    out[c.key] = Math.round(Math.min(COL_MAX_W_FULL, Math.max(COL_MIN_W, w)));
  }
  return out;
}

/**
 * Lebar awal tabel = isi terpanjang (maxFitWidths).
 * `width` eksplisit pada definisi kolom hanya dipakai sebagai cadangan
 * ketika kolom belum punya data sama sekali (mis. hasil pencarian kosong).
 *
 * Catatan: tombol "Lebar otomatis" di toolbar memakai autoFitWidths
 * (rata-rata isi) — dua perilaku yang memang sengaja berbeda.
 */
export function initialWidths<T>(columns: Column<T>[], rows: T[]): Record<string, number> {
  const full = maxFitWidths(columns, rows);
  if (rows.length > 0) return full;

  const out: Record<string, number> = {};
  for (const c of columns) {
    const px = c.width && /^\d+px$/.test(c.width) ? parseInt(c.width, 10) : null;
    out[c.key] = px ? Math.min(COL_MAX_W_FULL, Math.max(COL_MIN_W, px)) : full[c.key];
  }
  return out;
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
