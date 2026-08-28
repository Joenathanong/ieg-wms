'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  type Column,
  type FilterOp,
  type FilterState,
  COL_MIN_W,
  FILTER_OPS,
  applyView,
  autoFitWidths,
  cellText,
  initialWidths,
  maxFitWidths,
  rawOf,
} from '@/lib/grid';
import { copyText, shorten } from '@/lib/clipboard';
import { useStatus } from './StatusBar';
import {
  Loader2,
  ArrowUp,
  ArrowDown,
  Filter,
  FilterX,
  X,
  Search,
  ChevronsUpDown,
  Columns3,
  Maximize2,
} from 'lucide-react';

/* ------------------------------------------------------------------ */
/* PANEL                                                               */
/* ------------------------------------------------------------------ */

export function Panel({
  title,
  icon,
  actions,
  children,
  className = '',
  bodyClassName = 'p-3',
}: {
  title?: string;
  icon?: React.ReactNode;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section className={`sap-panel ${className}`}>
      {title && (
        <div className="sap-panel-title">
          {icon}
          <span className="min-w-0 truncate">{title}</span>
          {actions && <div className="ml-auto flex items-center gap-1.5">{actions}</div>}
        </div>
      )}
      <div className={bodyClassName}>{children}</div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* FORM FIELDS                                                         */
/* ------------------------------------------------------------------ */

/**
 * Satu kolom pada layar seleksi: label (tinggi tetap) + kontrol + keterangan.
 *
 * Label selalu memakan satu baris — walau kosong — sehingga seluruh kontrol
 * dalam satu baris grid berada pada garis yang sama, baik field itu punya
 * `hint` maupun tidak. Gunakan `items-start` pada grid pembungkusnya.
 */
export function Field({
  label,
  required,
  hint,
  children,
  className = '',
}: {
  label: string;
  required?: boolean;
  hint?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`min-w-0 ${className}`}>
      <label className={`sap-field-label ${required ? 'sap-required' : ''}`}>
        {label || ' '}
      </label>
      {children}
      {hint && <p className="sap-field-hint">{hint}</p>}
    </div>
  );
}

/**
 * Kolom berisi tombol (mis. Execute) di dalam grid layar seleksi.
 * Label kosong dipertahankan agar tombol sejajar dengan input di sebelahnya.
 */
export function ActionField({
  label,
  hint,
  children,
  className = '',
}: {
  label?: string;
  hint?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`min-w-0 ${className}`}>
      <span className="sap-field-label" aria-hidden="true">
        {label || ' '}
      </span>
      <div className="sap-control-row">{children}</div>
      {hint && <p className="sap-field-hint">{hint}</p>}
    </div>
  );
}

/** Checkbox sebagai kontrol layar seleksi — tingginya sama dengan field lain. */
export function CheckField({
  label,
  checked,
  onChange,
  hint,
  disabled,
  className = '',
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  hint?: string;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <div className={`min-w-0 ${className}`}>
      <span className="sap-field-label" aria-hidden="true">
        &nbsp;
      </span>
      <label
        className={`sap-control-row text-2xs text-sap-muted ${
          disabled ? 'opacity-50' : 'cursor-pointer'
        }`}
      >
        <input
          type="checkbox"
          className="accent-sap-blue w-[13px] h-[13px] shrink-0"
          checked={checked}
          disabled={disabled}
          onChange={(e) => onChange(e.target.checked)}
        />
        <span className="min-w-0 truncate">{label}</span>
      </label>
      {hint && <p className="sap-field-hint">{hint}</p>}
    </div>
  );
}

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  function Input(props, ref) {
    const { className = '', ...rest } = props;
    return <input ref={ref} spellCheck={false} autoComplete="off" className={`sap-field ${className}`} {...rest} />;
  }
);

export const Select = React.forwardRef<
  HTMLSelectElement,
  React.SelectHTMLAttributes<HTMLSelectElement>
>(function Select(props, ref) {
  const { className = '', children, ...rest } = props;
  return (
    <select ref={ref} className={`sap-field ${className}`} {...rest}>
      {children}
    </select>
  );
});

export function Button({
  variant = 'default',
  loading,
  children,
  className = '',
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'default' | 'primary' | 'danger' | 'ghost';
  loading?: boolean;
}) {
  const v =
    variant === 'primary'
      ? 'sap-btn-primary'
      : variant === 'danger'
        ? 'sap-btn-danger'
        : variant === 'ghost'
          ? 'sap-btn-ghost'
          : '';
  return (
    <button className={`sap-btn ${v} ${className}`} disabled={loading || rest.disabled} {...rest}>
      {loading && <Loader2 size={13} className="animate-spin" />}
      {children}
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* BADGE / STATUS                                                      */
/* ------------------------------------------------------------------ */

const BADGE: Record<string, string> = {
  EMPTY: 'border-sap-neutralborder bg-sap-neutralbg text-sap-muted',
  OCCUPIED: 'border-sap-okborder bg-sap-okbg text-sap-oktext',
  BLOCKED: 'border-sap-errborder bg-sap-errbg text-sap-errtext',
  CREATED: 'border-sap-neutralborder bg-sap-neutralbg text-sap-muted',
  FROZEN: 'border-sap-infoborder bg-sap-infobg text-sap-infotext',
  COUNTED: 'border-sap-warnborder bg-sap-warnbg text-sap-warntext',
  POSTED: 'border-sap-okborder bg-sap-okbg text-sap-oktext',
  ADMIN: 'border-sap-infoborder bg-sap-infobg text-sap-infotext',
  OPERATOR: 'border-sap-neutralborder bg-sap-neutralbg text-sap-muted',
  VIEWER: 'border-sap-neutralborder bg-sap-neutralbg text-sap-muted',
};

export function Badge({ value, className = '' }: { value: string; className?: string }) {
  return <span className={`sap-badge ${BADGE[value] ?? BADGE.EMPTY} ${className}`}>{value}</span>;
}

/* ================================================================== */
/* GRID (ALV) — sortable & filterable                                  */
/*                                                                     */
/* Logika sort/filter ada di src/lib/grid.ts (bebas React, mudah diuji) */
/* ================================================================== */

export type { CellValue, Column, FilterOp, FilterState } from '@/lib/grid';
export { FILTER_OPS } from '@/lib/grid';

/* ---------------- popover filter kolom ---------------- */

function FilterPopover({
  title,
  anchor,
  state,
  onApply,
  onClear,
  onClose,
}: {
  title: string;
  anchor: DOMRect;
  state: FilterState | undefined;
  onApply: (f: FilterState) => void;
  onClear: () => void;
  onClose: () => void;
}) {
  const [op, setOp] = useState<FilterOp>(state?.op ?? 'CP');
  const [val, setVal] = useState(state?.val ?? '');
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onClose, true);
    window.addEventListener('resize', onClose);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onClose, true);
      window.removeEventListener('resize', onClose);
    };
  }, [onClose]);

  const width = 250;
  const vw = typeof window !== 'undefined' ? window.innerWidth : 900;
  const left = Math.max(6, Math.min(anchor.left, vw - width - 6));
  const top = anchor.bottom + 2;

  return (
    <div
      ref={boxRef}
      style={{ position: 'fixed', left, top, width }}
      className="z-[60] sap-panel shadow-sap p-2 space-y-2"
    >
      <p className="text-xxs uppercase tracking-wide text-sap-muted truncate">Filter · {title}</p>
      <Select value={op} onChange={(e) => setOp(e.target.value as FilterOp)} autoFocus>
        {FILTER_OPS.map((o) => (
          <option key={o.op} value={o.op}>
            {o.sign} {o.label}
          </option>
        ))}
      </Select>
      <Input
        value={val}
        placeholder="nilai …"
        onChange={(e) => setVal(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            onApply({ op, val });
          }
        }}
      />
      <p className="text-xxs text-sap-muted/70 leading-snug">
        Beberapa nilai dipisah <b>;</b> · wildcard <b>*</b> didukung
      </p>
      <div className="flex gap-1.5">
        <Button variant="primary" className="flex-1 justify-center" onClick={() => onApply({ op, val })}>
          Terapkan
        </Button>
        <Button onClick={onClear} title="Hapus filter kolom ini">
          <FilterX size={13} />
        </Button>
      </div>
    </div>
  );
}

/* ---------------- GRID ---------------- */

export function Grid<T extends Record<string, any>>({
  columns,
  rows,
  loading,
  emptyText = 'No data exists for the selection criteria',
  rowKey,
  onRowClick,
  maxHeight = 'calc(100vh - 300px)',
  footer,
  /** dipanggil tiap hasil sort/filter berubah — dipakai halaman untuk Export CSV */
  onViewChange,
  toolbar = true,
}: {
  columns: Column<T>[];
  rows: T[];
  loading?: boolean;
  emptyText?: string;
  rowKey?: (row: T, i: number) => string;
  onRowClick?: (row: T) => void;
  maxHeight?: string;
  footer?: React.ReactNode;
  onViewChange?: (rows: T[]) => void;
  toolbar?: boolean;
}) {
  const [sort, setSort] = useState<{ key: string; dir: 'asc' | 'desc' } | null>(null);
  const [filters, setFilters] = useState<Record<string, FilterState>>({});
  const [search, setSearch] = useState('');
  const [popover, setPopover] = useState<{ key: string; rect: DOMRect } | null>(null);
  const { setStatus } = useStatus();

  /* ---- lebar kolom: auto-fit rata-rata isi + bisa digeser manual ---- */
  const [widths, setWidths] = useState<Record<string, number>>({});
  /** kolom yang lebarnya sudah diatur manual — tidak ikut auto-fit lagi */
  const manual = useRef<Set<string>>(new Set());
  const drag = useRef<{ key: string; startX: number; startW: number } | null>(null);

  const canSort = (c: Column<T>) => c.sortable ?? c.header !== '';
  const canFilter = (c: Column<T>) => c.filterable ?? c.header !== '';

  /**
   * Halaman membuat array `columns` baru pada setiap render, sehingga identitas
   * array tidak boleh dipakai sebagai dependency effect (akan memicu render
   * berulang tanpa henti). Dipakai "tanda tangan" kolom yang stabil + ref.
   */
  const colSig = columns.map((c) => c.key).join('|');
  const colsRef = useRef(columns);
  colsRef.current = columns;

  const view = useMemo(
    () => applyView(rows, colsRef.current, filters, search, sort),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows, colSig, filters, search, sort]
  );

  useEffect(() => {
    onViewChange?.(view);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);

  // hitung ulang lebar saat data / susunan kolom berubah (kolom manual dipertahankan)
  useEffect(() => {
    const cols = colsRef.current;
    const auto = initialWidths(cols, rows);
    setWidths((prev) => {
      const next: Record<string, number> = {};
      for (const c of cols) {
        next[c.key] = manual.current.has(c.key) && prev[c.key] ? prev[c.key] : auto[c.key];
      }
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [colSig, rows]);

  /** tombol toolbar: lebar mengikuti RATA-RATA isi (lebih padat) */
  const autoFitAll = useCallback(() => {
    manual.current.clear();
    setWidths(autoFitWidths(colsRef.current, view));
    setStatus('Lebar kolom disesuaikan dengan rata-rata isi', 'I');
  }, [view, setStatus]);

  /** kembalikan ke lebar awal: mengikuti isi TERPANJANG */
  const fullFitAll = useCallback(() => {
    manual.current.clear();
    setWidths(initialWidths(colsRef.current, view));
    setStatus('Lebar kolom disesuaikan dengan isi terpanjang', 'I');
  }, [view, setStatus]);

  /** klik ganda garis pemisah: lebar kolom itu mengikuti isi TERPANJANG */
  const autoFitOne = useCallback(
    (key: string) => {
      const c = colsRef.current.find((x) => x.key === key);
      if (!c) return;
      manual.current.delete(key);
      const w = maxFitWidths([c], view)[key];
      setWidths((s) => ({ ...s, [key]: w }));
    },
    [view]
  );

  const startResize = useCallback(
    (key: string, e: React.PointerEvent<HTMLElement>) => {
      e.preventDefault();
      e.stopPropagation();
      const startW = widths[key] ?? COL_MIN_W;
      drag.current = { key, startX: e.clientX, startW };
      const el = e.currentTarget;
      try {
        el.setPointerCapture(e.pointerId);
      } catch {
        /* abaikan */
      }

      const onMove = (ev: PointerEvent) => {
        const d = drag.current;
        if (!d) return;
        const w = Math.max(COL_MIN_W, Math.min(900, d.startW + (ev.clientX - d.startX)));
        setWidths((s) => ({ ...s, [d.key]: w }));
      };
      const onUp = () => {
        if (drag.current) manual.current.add(drag.current.key);
        drag.current = null;
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    },
    [widths]
  );

  /* ---- double-click sel: salin isi ke clipboard ---- */
  const clickTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleCellClick = useCallback(
    (row: T) => {
      if (!onRowClick) return;
      // tunda sedikit supaya double-click (copy) tidak ikut memicu klik baris
      if (clickTimer.current) clearTimeout(clickTimer.current);
      clickTimer.current = setTimeout(() => {
        clickTimer.current = null;
        onRowClick(row);
      }, 220);
    },
    [onRowClick]
  );

  const handleCellCopy = useCallback(
    async (c: Column<T>, row: T) => {
      if (clickTimer.current) {
        clearTimeout(clickTimer.current);
        clickTimer.current = null;
      }
      const text = cellText(c, row).trim();
      if (!text) return;
      const ok = await copyText(text);
      setStatus(
        ok ? `Disalin ke clipboard: ${shorten(text, 60)}` : 'Browser menolak akses clipboard',
        ok ? 'S' : 'W'
      );
    },
    [setStatus]
  );

  useEffect(() => {
    return () => {
      if (clickTimer.current) clearTimeout(clickTimer.current);
    };
  }, []);

  const activeFilters = Object.entries(filters).filter(([, f]) => f.val.trim() !== '');
  const filtering = activeFilters.length > 0 || search.trim() !== '';

  /** lebar total tabel = kolom nomor + seluruh kolom data */
  const totalWidth = 42 + columns.reduce((a, c) => a + (widths[c.key] ?? COL_MIN_W), 0);

  const toggleSort = useCallback((key: string) => {
    setSort((s) => {
      if (!s || s.key !== key) return { key, dir: 'asc' };
      if (s.dir === 'asc') return { key, dir: 'desc' };
      return null;
    });
  }, []);

  const clearAll = useCallback(() => {
    setFilters({});
    setSearch('');
  }, []);

  const popCol = popover ? columns.find((c) => c.key === popover.key) : null;

  return (
    <div className="border border-sap-border rounded-sappanel overflow-hidden bg-sap-panelalt">
      {toolbar && (
        <div className="flex flex-wrap items-center gap-1.5 px-2 py-1.5 border-b border-sap-border bg-sap-toolbar">
          <div className="relative">
            <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-sap-muted" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Cari di semua kolom …"
              spellCheck={false}
              className="sap-field !w-[160px] sm:!w-[220px] pl-7"
            />
          </div>

          {activeFilters.map(([key, f]) => {
            const c = columns.find((x) => x.key === key);
            const sign = FILTER_OPS.find((o) => o.op === f.op)?.sign ?? '';
            return (
              <span
                key={key}
                className="inline-flex items-center gap-1 px-1.5 py-[2px] rounded-sap border border-sap-infoborder
                           bg-sap-infobg text-sap-infotext text-xxs font-mono max-w-[220px]"
                title={`${c?.header ?? key}: ${sign} ${f.val}`}
              >
                <span className="truncate">
                  {c?.header ?? key} {sign} {f.val}
                </span>
                <button
                  type="button"
                  onClick={() =>
                    setFilters((s) => {
                      const n = { ...s };
                      delete n[key];
                      return n;
                    })
                  }
                  className="hover:text-sap-error shrink-0"
                >
                  <X size={11} />
                </button>
              </span>
            );
          })}

          {filtering && (
            <Button className="!py-[3px]" onClick={clearAll}>
              <FilterX size={12} /> Hapus filter
            </Button>
          )}

          <Button
            className="!py-[3px]"
            onClick={autoFitAll}
            title="Rapatkan kolom mengikuti RATA-RATA isi (lebih padat)"
          >
            <Columns3 size={12} /> Lebar otomatis
          </Button>
          <Button
            className="!py-[3px]"
            onClick={fullFitAll}
            title="Kembalikan lebar mengikuti isi TERPANJANG (lebar awal tabel)"
          >
            <Maximize2 size={12} /> Lebar penuh
          </Button>

          {sort && (
            <span className="inline-flex items-center gap-1 text-xxs font-mono text-sap-muted">
              {sort.dir === 'asc' ? <ArrowUp size={11} /> : <ArrowDown size={11} />}
              <span className="max-w-[110px] truncate">{columns.find((c) => c.key === sort.key)?.header}</span>
              <button type="button" onClick={() => setSort(null)} className="hover:text-sap-error">
                <X size={11} />
              </button>
            </span>
          )}

          <span className="ml-auto text-xxs font-mono text-sap-muted">
            {filtering ? `${view.length} / ${rows.length}` : `${rows.length}`} entries
          </span>
        </div>
      )}

      <div className="overflow-auto" style={{ maxHeight, WebkitOverflowScrolling: 'touch' }}>
        <table className="sap-grid" style={{ tableLayout: 'fixed', width: totalWidth }}>
          <colgroup>
            <col style={{ width: 42 }} />
            {columns.map((c) => (
              <col key={c.key} style={{ width: widths[c.key] ?? COL_MIN_W }} />
            ))}
          </colgroup>
          <thead>
            <tr>
              <th className="text-center">#</th>
              {columns.map((c) => {
                const sorted = sort?.key === c.key;
                const hasFilter = !!filters[c.key]?.val?.trim();
                return (
                  <th
                    key={c.key}
                    className={`relative ${
                      c.align === 'right' ? 'text-right' : c.align === 'center' ? 'text-center' : ''
                    }`}
                  >
                    <div
                      className={`flex items-center gap-1 ${
                        c.align === 'right' ? 'justify-end' : c.align === 'center' ? 'justify-center' : ''
                      }`}
                    >
                      {canSort(c) ? (
                        <button
                          type="button"
                          onClick={() => toggleSort(c.key)}
                          title="Klik untuk sort (asc → desc → tanpa sort)"
                          className={`inline-flex items-center gap-1 min-w-0 hover:text-sap-blue ${
                            sorted ? 'text-sap-blue' : ''
                          }`}
                        >
                          <span className="truncate">{c.header}</span>
                          {sorted ? (
                            sort.dir === 'asc' ? (
                              <ArrowUp size={11} className="shrink-0" />
                            ) : (
                              <ArrowDown size={11} className="shrink-0" />
                            )
                          ) : (
                            <ChevronsUpDown size={10} className="shrink-0 opacity-25" />
                          )}
                        </button>
                      ) : (
                        <span className="truncate">{c.header}</span>
                      )}

                      {canFilter(c) && (
                        <button
                          type="button"
                          title="Filter kolom (=, ≠, contains, >, <)"
                          onClick={(e) => {
                            const rect = e.currentTarget.getBoundingClientRect();
                            setPopover((p) => (p?.key === c.key ? null : { key: c.key, rect }));
                          }}
                          className={`shrink-0 p-[2px] rounded-sap hover:text-sap-blue ${
                            hasFilter ? 'text-sap-blue bg-sap-blue/15' : 'opacity-35 hover:opacity-100'
                          }`}
                        >
                          <Filter size={10} />
                        </button>
                      )}
                    </div>

                    {/* garis pemisah — tarik untuk mengubah lebar, klik ganda = lebar otomatis */}
                    <span
                      onPointerDown={(e) => startResize(c.key, e)}
                      onDoubleClick={(e) => {
                        e.stopPropagation();
                        autoFitOne(c.key);
                      }}
                      title="Tarik untuk mengubah lebar · klik ganda = lebar otomatis"
                      className="absolute top-0 right-0 h-full w-[7px] translate-x-[3px] cursor-col-resize
                                 select-none touch-none z-20 hover:bg-sap-blue/40 active:bg-sap-blue/60"
                    />
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={columns.length + 1} className="py-6 text-center text-sap-muted">
                  <Loader2 size={15} className="inline animate-spin mr-2" />
                  Retrieving data ...
                </td>
              </tr>
            )}
            {!loading && view.length === 0 && (
              <tr>
                <td colSpan={columns.length + 1} className="py-6 text-center text-sap-muted">
                  {rows.length > 0 && filtering ? (
                    <span className="inline-flex items-center gap-2">
                      Tidak ada baris yang cocok dengan filter.
                      <button type="button" onClick={clearAll} className="text-sap-blue hover:underline">
                        Hapus filter
                      </button>
                    </span>
                  ) : (
                    emptyText
                  )}
                </td>
              </tr>
            )}
            {!loading &&
              view.map((row, i) => (
                <tr key={rowKey ? rowKey(row, i) : i} className={onRowClick ? 'cursor-pointer' : undefined}>
                  <td className="text-center font-mono text-sap-muted/60">{i + 1}</td>
                  {columns.map((c) => {
                    const txt = cellText(c, row);
                    return (
                      <td
                        key={c.key}
                        title={txt || undefined}
                        onClick={onRowClick ? () => handleCellClick(row) : undefined}
                        onDoubleClick={() => handleCellCopy(c, row)}
                        className={[
                          'overflow-hidden text-ellipsis',
                          c.mono || c.align === 'right' ? 'font-mono tabular-nums' : '',
                          c.align === 'right' ? 'text-right' : c.align === 'center' ? 'text-center' : '',
                        ].join(' ')}
                      >
                        {c.render ? c.render(row, i) : (row[c.key] ?? '')}
                      </td>
                    );
                  })}
                </tr>
              ))}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between gap-2 px-2.5 py-1.5 border-t border-sap-border bg-sap-nav text-xxs text-sap-muted font-mono">
        <span className="shrink-0">
          {loading ? '...' : filtering ? `${view.length} of ${rows.length} entries` : `${view.length} entries`}
          <span className="hidden md:inline text-sap-muted/60"> · klik ganda sel = salin</span>
        </span>
        {footer && <span className="min-w-0 truncate text-right">{footer}</span>}
      </div>

      {popover && popCol && (
        <FilterPopover
          title={popCol.header}
          anchor={popover.rect}
          state={filters[popover.key]}
          onApply={(f) => {
            setFilters((s) => ({ ...s, [popover.key]: f }));
            setPopover(null);
          }}
          onClear={() => {
            setFilters((s) => {
              const n = { ...s };
              delete n[popover.key];
              return n;
            });
            setPopover(null);
          }}
          onClose={() => setPopover(null)}
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* TOOLBAR                                                             */
/* ------------------------------------------------------------------ */

export function Toolbar({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={`flex flex-wrap items-center gap-1.5 px-2 py-1.5 bg-sap-toolbar border border-sap-border
                  rounded-sappanel ${className}`}
    >
      {children}
    </div>
  );
}

export function Separator() {
  return <span className="w-px h-4 bg-sap-border mx-1 hidden sm:inline-block" />;
}

/* ------------------------------------------------------------------ */
/* CSV EXPORT (ALV -> spreadsheet)                                     */
/* ------------------------------------------------------------------ */

/**
 * Export ke CSV (pemisah ";" agar langsung terbaca Excel lokal id/de).
 * Nilai diambil dari `exportValue` bila ada, lalu `value`, lalu row[key] —
 * sehingga tanda minus, tanggal terformat, dan penanda pembatalan ikut terbawa.
 * Kolom aksi (header kosong) tidak diexport.
 */
export function exportCsv<T extends Record<string, any>>(
  filename: string,
  columns: Column<T>[],
  rows: T[]
) {
  const cols = columns.filter((c) => c.header !== '');
  const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const cell = (c: Column<T>, r: T) => {
    if (c.exportValue) return c.exportValue(r);
    const raw = rawOf(c, r);
    if (raw instanceof Date) return isNaN(raw.getTime()) ? '' : raw.toISOString().slice(0, 10);
    if (typeof raw === 'boolean') return raw ? 'X' : '';
    return raw ?? '';
  };
  const head = cols.map((c) => esc(c.header)).join(';');
  const body = rows.map((r) => cols.map((c) => esc(cell(c, r))).join(';')).join('\n');
  const blob = new Blob(['﻿' + head + '\n' + body], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
