'use client';

import React, { useEffect, useRef } from 'react';
import { AlertTriangle, HelpCircle, X } from 'lucide-react';

/**
 * Dialog konfirmasi ala SAP GUI ("Do you want to post the document?").
 *
 * Dipakai sebelum aksi yang mengubah stok — terutama posting MIGO — supaya
 * penekanan Enter tidak langsung menerbitkan dokumen.
 *
 * Atribut `data-modal` dibaca oleh useExecuteKey agar tombol Enter di layar
 * belakang tidak ikut terpicu selagi dialog terbuka.
 */
export function ConfirmDialog({
  open,
  title = 'Konfirmasi',
  question,
  details,
  confirmLabel = 'Ya',
  cancelLabel = 'Tidak',
  danger,
  busy,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title?: string;
  question: React.ReactNode;
  /** ringkasan data yang akan diposting — pasangan label & nilai */
  details?: { label: string; value: React.ReactNode }[];
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const okRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    // fokus ke tombol utama supaya Enter berikutnya = konfirmasi
    const t = setTimeout(() => okRef.current?.focus(), 30);

    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        onCancel();
      }
    }
    document.addEventListener('keydown', onKey);
    return () => {
      clearTimeout(t);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, onCancel]);

  if (!open) return null;

  return (
    <div data-modal className="fixed inset-0 z-[90] flex items-center justify-center p-3">
      <button type="button" aria-label="Batal" onClick={onCancel} className="absolute inset-0 bg-black/50" />

      <div
        role="dialog"
        aria-modal="true"
        className="relative w-full max-w-[440px] sap-panel shadow-sap"
      >
        <div className="sap-panel-title">
          {danger ? (
            <AlertTriangle size={13} className="text-sap-warntext" />
          ) : (
            <HelpCircle size={13} className="text-sap-blue" />
          )}
          <span>{title}</span>
          <button
            type="button"
            onClick={onCancel}
            aria-label="Tutup"
            className="ml-auto sap-btn sap-btn-ghost !px-1.5 !py-1"
          >
            <X size={14} />
          </button>
        </div>

        <div className="p-4 space-y-3">
          <p className="text-2xs leading-relaxed">{question}</p>

          {details && details.length > 0 && (
            <div className="border border-sap-border rounded-sappanel divide-y divide-sap-border">
              {details.map((d) => (
                <div key={d.label} className="flex items-baseline gap-3 px-2.5 py-1.5">
                  <span className="text-xxs uppercase tracking-wide text-sap-muted w-[120px] shrink-0">
                    {d.label}
                  </span>
                  <span className="text-2xs font-mono min-w-0 break-words">{d.value}</span>
                </div>
              ))}
            </div>
          )}

          <div className="flex items-center gap-1.5 pt-1">
            <button
              ref={okRef}
              type="button"
              onClick={onConfirm}
              disabled={busy}
              className={`sap-btn ${danger ? 'sap-btn-danger' : 'sap-btn-primary'} !px-4`}
            >
              {confirmLabel}
            </button>
            <button type="button" onClick={onCancel} disabled={busy} className="sap-btn !px-4">
              {cancelLabel}
            </button>
            <span className="ml-auto text-xxs text-sap-muted font-mono">Enter = {confirmLabel} · Esc = batal</span>
          </div>
        </div>
      </div>
    </div>
  );
}
