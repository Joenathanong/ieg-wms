'use client';

import React from 'react';
import Link from 'next/link';
import { ChevronLeft, Loader2 } from 'lucide-react';

/**
 * Komponen UI khusus terminal PDT / RF scanner.
 * Target: layar kecil, sarung tangan, input dari barcode scanner (keyboard wedge).
 * Font besar, tombol tinggi, kontras tinggi.
 */

export function PdtScreen({
  title,
  code,
  back = '/zrf',
  children,
  footer,
}: {
  title: string;
  code: string;
  back?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <div className="mx-auto w-full max-w-[520px]">
      <div className="sap-panel overflow-hidden">
        <div className="flex items-center gap-2 px-3 py-2.5 bg-sap-titlebar border-b border-sap-border">
          <Link href={back} className="text-sap-muted hover:text-sap-blue p-1 -ml-1">
            <ChevronLeft size={18} />
          </Link>
          <span className="font-mono text-sap-blue text-sm">{code}</span>
          <span className="text-sap-border">|</span>
          <span className="text-sm font-semibold truncate">{title}</span>
        </div>
        <div className="p-3 space-y-3">{children}</div>
        {footer && <div className="px-3 py-2 border-t border-sap-border bg-sap-nav">{footer}</div>}
      </div>
    </div>
  );
}

export const PdtInput = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: string }
>(function PdtInput({ label, hint, className = '', ...rest }, ref) {
  return (
    <label className="block">
      <span className="block text-2xs uppercase tracking-wide text-sap-muted mb-1">{label}</span>
      <input
        ref={ref}
        spellCheck={false}
        autoComplete="off"
        autoCapitalize="characters"
        className={`w-full bg-sap-cmd border-2 border-sap-border focus:border-sap-blue outline-none
                    rounded-[3px] px-3 py-2.5 text-base font-mono text-sap-text
                    disabled:opacity-50 ${className}`}
        {...rest}
      />
      {hint && <span className="block text-xxs text-sap-muted/70 mt-1">{hint}</span>}
    </label>
  );
});

export function PdtButton({
  children,
  variant = 'default',
  loading,
  className = '',
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'default' | 'primary' | 'danger';
  loading?: boolean;
}) {
  const v =
    variant === 'primary'
      ? 'bg-sap-blue border-sap-blue text-white hover:bg-sap-bluehover'
      : variant === 'danger'
        ? 'bg-sap-dangerbg border-sap-dangerborder text-sap-dangertext hover:bg-sap-dangerhover'
        : 'bg-sap-btn border-sap-border text-sap-text hover:bg-sap-btnhover';
  return (
    <button
      className={`w-full flex items-center justify-center gap-2 px-3 py-3 rounded-[3px] border-2
                  text-sm font-semibold transition-colors disabled:opacity-40
                  disabled:cursor-not-allowed ${v} ${className}`}
      disabled={loading || rest.disabled}
      {...rest}
    >
      {loading && <Loader2 size={16} className="animate-spin" />}
      {children}
    </button>
  );
}

export function PdtRow({ label, value, accent }: { label: string; value: React.ReactNode; accent?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1 border-b border-sap-border/50 last:border-0">
      <span className="text-2xs uppercase tracking-wide text-sap-muted shrink-0">{label}</span>
      <span className={`font-mono text-sm truncate ${accent ? 'text-sap-blue' : 'text-sap-text'}`}>{value}</span>
    </div>
  );
}

export function PdtMessage({ text, type }: { text: string; type: 'S' | 'E' | 'W' | 'I' }) {
  const style =
    type === 'S'
      ? 'border-sap-okborder bg-sap-okbg text-sap-oktext'
      : type === 'E'
        ? 'border-sap-errborder bg-sap-errbg text-sap-errtext'
        : type === 'W'
          ? 'border-sap-warnborder bg-sap-warnbg text-sap-warntext'
          : 'border-sap-infoborder bg-sap-infobg text-sap-infotext';
  return <div className={`rounded-[3px] border px-3 py-2 text-2xs leading-relaxed ${style}`}>{text}</div>;
}
