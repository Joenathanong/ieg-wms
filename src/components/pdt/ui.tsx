'use client';

import React from 'react';
import Link from 'next/link';
import { ChevronLeft, Loader2, Keyboard, KeyboardOff } from 'lucide-react';

/**
 * Komponen UI khusus terminal PDT / RF scanner.
 * Target: layar kecil, sarung tangan, input dari barcode scanner (keyboard wedge).
 * Font besar, tombol tinggi, kontras tinggi, aman terhadap notch (safe-area).
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
    <div className="mx-auto w-full max-w-[520px] pb-[env(safe-area-inset-bottom)]">
      <div className="sap-panel overflow-hidden">
        {/* header tetap terlihat saat layar di-scroll */}
        <div className="sticky top-0 z-20 flex items-center gap-2 px-2.5 sm:px-3 py-2.5 bg-sap-titlebar border-b border-sap-border">
          <Link
            href={back}
            aria-label="Kembali"
            className="text-sap-muted hover:text-sap-blue p-1.5 -ml-1.5 rounded-[3px] active:bg-sap-hover"
          >
            <ChevronLeft size={20} />
          </Link>
          <span className="font-mono text-sap-blue text-sm shrink-0">{code}</span>
          <span className="text-sap-border shrink-0">|</span>
          <span className="text-sm font-semibold truncate">{title}</span>
        </div>

        <div className="p-2.5 sm:p-3 space-y-2.5 sm:space-y-3">{children}</div>

        {footer && (
          <div className="px-2.5 sm:px-3 py-2 border-t border-sap-border bg-sap-nav">{footer}</div>
        )}
      </div>
    </div>
  );
}

/**
 * Tipe input yang punya UI bawaan sendiri (date picker, dsb.) — mekanisme
 * penyembunyian keyboard tidak diterapkan supaya picker tetap muncul.
 */
const NATIVE_PICKER_TYPES = new Set([
  'date',
  'time',
  'datetime-local',
  'month',
  'week',
  'color',
  'file',
  'range',
  'checkbox',
  'radio',
]);

export const PdtInput = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement> & {
    label: string;
    hint?: string;
    /** set false bila field ini memang ingin selalu memunculkan keyboard */
    autoHideKeyboard?: boolean;
  }
>(function PdtInput(
  { label, hint, className = '', autoHideKeyboard = true, inputMode, type, onKeyDown, onBlur, ...rest },
  ref
) {
  const innerRef = React.useRef<HTMLInputElement | null>(null);
  const [typing, setTyping] = React.useState(false);

  const managed = autoHideKeyboard && !NATIVE_PICKER_TYPES.has(String(type ?? 'text'));
  /** mode saat user memang sedang mengetik manual */
  const typeMode = inputMode ?? 'text';

  function attach(el: HTMLInputElement | null) {
    innerRef.current = el;
    if (typeof ref === 'function') ref(el);
    else if (ref) (ref as React.MutableRefObject<HTMLInputElement | null>).current = el;
  }

  /**
   * Keyboard virtual hanya dibuka atas kemauan user (ketuk field / ikon
   * keyboard). Fokus programatik setelah scan TIDAK memunculkannya karena
   * inputmode masih "none" — scanner tetap terbaca sebab ia mengirim
   * keystroke seperti keyboard fisik.
   */
  function openKeyboard() {
    if (!managed || typing) return;
    setTyping(true);
    const el = innerRef.current;
    if (!el || el.disabled || el.readOnly) return;
    // Android/iOS baru menampilkan keyboard bila atribut inputmode sudah
    // berubah lalu elemen difokus ulang.
    requestAnimationFrame(() => {
      el.setAttribute('inputmode', typeMode);
      el.blur();
      el.focus();
    });
  }

  /** Selesai mengetik (Enter / pindah fokus) -> keyboard ditutup lagi. */
  function closeKeyboard() {
    if (!managed) return;
    setTyping(false);
    innerRef.current?.blur();
  }

  return (
    <label className="block">
      <span className="block text-2xs uppercase tracking-wide text-sap-muted mb-1">{label}</span>

      <span className="relative block">
        <input
          ref={attach}
          type={type}
          spellCheck={false}
          autoComplete="off"
          autoCapitalize="characters"
          autoCorrect="off"
          enterKeyHint="done"
          inputMode={managed ? (typing ? typeMode : 'none') : inputMode}
          onPointerDown={managed ? openKeyboard : undefined}
          onKeyDown={(e) => {
            // Enter = selesai; scanner keyboard-wedge juga mengirim Enter di akhir
            if (managed && e.key === 'Enter') closeKeyboard();
            onKeyDown?.(e);
          }}
          onBlur={(e) => {
            if (managed) setTyping(false);
            onBlur?.(e);
          }}
          /* text-base (16px) mencegah iOS auto-zoom saat field difokus */
          className={`w-full bg-sap-cmd border-2 border-sap-border focus:border-sap-blue outline-none
                      rounded-[3px] px-3 py-2.5 text-base font-mono text-sap-text
                      disabled:opacity-50 ${managed ? 'pr-11' : ''} ${className}`}
          {...rest}
        />

        {managed && (
          <button
            type="button"
            tabIndex={-1}
            aria-label={typing ? 'Tutup keyboard' : 'Buka keyboard'}
            title={typing ? 'Tutup keyboard' : 'Buka keyboard untuk ketik manual'}
            onPointerDown={(e) => {
              // cegah label memindahkan fokus lebih dulu
              e.preventDefault();
              e.stopPropagation();
            }}
            onClick={() => (typing ? closeKeyboard() : openKeyboard())}
            className={`absolute right-1 top-1/2 -translate-y-1/2 p-2 rounded-[3px]
                        active:bg-sap-hover ${typing ? 'text-sap-blue' : 'text-sap-muted'}`}
          >
            {typing ? <KeyboardOff size={18} /> : <Keyboard size={18} />}
          </button>
        )}
      </span>

      {hint && <span className="block text-xxs text-sap-muted/70 mt-1 leading-snug">{hint}</span>}
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
      className={`w-full min-h-[46px] flex items-center justify-center gap-2 px-3 py-3 rounded-[3px] border-2
                  text-sm font-semibold transition-colors active:opacity-80 disabled:opacity-40
                  disabled:cursor-not-allowed touch-manipulation ${v} ${className}`}
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
      <span className={`font-mono text-sm truncate text-right ${accent ? 'text-sap-blue' : 'text-sap-text'}`}>
        {value}
      </span>
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
  return (
    <div className={`rounded-[3px] border px-3 py-2 text-2xs leading-relaxed break-words ${style}`}>
      {text}
    </div>
  );
}
