'use client';

import React from 'react';
import { Loader2 } from 'lucide-react';

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
          <span>{title}</span>
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
    <div className={className}>
      <label className={`sap-field-label ${required ? 'sap-required' : ''}`}>{label}</label>
      {children}
      {hint && <p className="mt-1 text-xxs text-sap-muted/70">{hint}</p>}
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
  EMPTY: 'border-[#3f4657] bg-[#2c313d] text-sap-muted',
  OCCUPIED: 'border-[#2c5c3d] bg-[#1e3a29] text-[#8FE0A4]',
  BLOCKED: 'border-[#7f2529] bg-[#3d1a1c] text-[#FF9CA0]',
  CREATED: 'border-[#3f4657] bg-[#2c313d] text-sap-muted',
  FROZEN: 'border-[#2b5480] bg-[#1c3450] text-[#9DC0FF]',
  COUNTED: 'border-[#7a5b1e] bg-[#3b2f14] text-[#F3C77B]',
  POSTED: 'border-[#2c5c3d] bg-[#1e3a29] text-[#8FE0A4]',
  ADMIN: 'border-[#2b5480] bg-[#1c3450] text-[#9DC0FF]',
  OPERATOR: 'border-[#3f4657] bg-[#2c313d] text-sap-muted',
  VIEWER: 'border-[#3f4657] bg-[#2c313d] text-sap-muted',
};

export function Badge({ value, className = '' }: { value: string; className?: string }) {
  return <span className={`sap-badge ${BADGE[value] ?? BADGE.EMPTY} ${className}`}>{value}</span>;
}

/* ------------------------------------------------------------------ */
/* GRID (ALV)                                                          */
/* ------------------------------------------------------------------ */

export interface Column<T> {
  key: string;
  header: string;
  width?: string;
  align?: 'left' | 'right' | 'center';
  mono?: boolean;
  render?: (row: T, index: number) => React.ReactNode;
}

export function Grid<T extends Record<string, any>>({
  columns,
  rows,
  loading,
  emptyText = 'No data exists for the selection criteria',
  rowKey,
  onRowClick,
  maxHeight = 'calc(100vh - 300px)',
  footer,
}: {
  columns: Column<T>[];
  rows: T[];
  loading?: boolean;
  emptyText?: string;
  rowKey?: (row: T, i: number) => string;
  onRowClick?: (row: T) => void;
  maxHeight?: string;
  footer?: React.ReactNode;
}) {
  return (
    <div className="border border-sap-border rounded-[3px] overflow-hidden bg-sap-panelalt">
      <div className="overflow-auto" style={{ maxHeight }}>
        <table className="sap-grid">
          <thead>
            <tr>
              <th className="w-[42px] text-center">#</th>
              {columns.map((c) => (
                <th
                  key={c.key}
                  style={{ width: c.width }}
                  className={c.align === 'right' ? 'text-right' : c.align === 'center' ? 'text-center' : ''}
                >
                  {c.header}
                </th>
              ))}
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
            {!loading && rows.length === 0 && (
              <tr>
                <td colSpan={columns.length + 1} className="py-6 text-center text-sap-muted">
                  {emptyText}
                </td>
              </tr>
            )}
            {!loading &&
              rows.map((row, i) => (
                <tr
                  key={rowKey ? rowKey(row, i) : i}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                  className={onRowClick ? 'cursor-pointer' : undefined}
                >
                  <td className="text-center font-mono text-sap-muted/60">{i + 1}</td>
                  {columns.map((c) => (
                    <td
                      key={c.key}
                      className={[
                        c.mono || c.align === 'right' ? 'font-mono tabular-nums' : '',
                        c.align === 'right' ? 'text-right' : c.align === 'center' ? 'text-center' : '',
                      ].join(' ')}
                    >
                      {c.render ? c.render(row, i) : (row[c.key] ?? '')}
                    </td>
                  ))}
                </tr>
              ))}
          </tbody>
        </table>
      </div>
      <div className="flex items-center justify-between px-2.5 py-1.5 border-t border-sap-border bg-[#20242d] text-xxs text-sap-muted font-mono">
        <span>{loading ? '...' : `${rows.length} entries`}</span>
        {footer}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* TOOLBAR                                                             */
/* ------------------------------------------------------------------ */

export function Toolbar({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={`flex flex-wrap items-center gap-1.5 px-2 py-1.5 bg-[#252a34] border border-sap-border
                  rounded-[3px] ${className}`}
    >
      {children}
    </div>
  );
}

export function Separator() {
  return <span className="w-px h-4 bg-sap-border mx-1" />;
}

/* ------------------------------------------------------------------ */
/* CSV EXPORT (ALV -> spreadsheet)                                     */
/* ------------------------------------------------------------------ */

export function exportCsv<T extends Record<string, any>>(
  filename: string,
  columns: Column<T>[],
  rows: T[]
) {
  const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const head = columns.map((c) => esc(c.header)).join(';');
  const body = rows.map((r) => columns.map((c) => esc(r[c.key])).join(';')).join('\n');
  const blob = new Blob(['﻿' + head + '\n' + body], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
