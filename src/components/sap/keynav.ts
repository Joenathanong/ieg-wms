'use client';

import { useEffect } from 'react';

/**
 * Navigasi papan ketik ala ALV SAP.
 *
 * 1. Panah ATAS / BAWAH di dalam sel tabel = pindah baris pada kolom yang sama.
 *    Sebelumnya panah pada input angka menaikkan/menurunkan nilai — perilaku itu
 *    dimatikan karena berbahaya saat entri massal (qty bisa berubah tanpa sadar).
 * 2. Roda mouse di atas input angka juga tidak lagi mengubah nilai.
 * 3. Di luar tabel, panah pada input angka tetap dinetralkan agar konsisten.
 *
 * Dipasang satu kali di Shell, sehingga berlaku untuk SELURUH T-Code tanpa
 * perlu mengubah masing-masing halaman.
 */

const FOCUSABLE = 'input:not([type=hidden]):not([disabled]), select:not([disabled]), textarea:not([disabled])';

function isTypingField(el: Element | null): el is HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement {
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA';
}

/** Cari elemen fokusabel pada kolom ke-`idx` dari sebuah baris. */
function focusableInCell(row: HTMLTableRowElement, idx: number): HTMLElement | null {
  const cell = row.cells?.[idx];
  if (!cell) return null;
  return cell.querySelector<HTMLElement>(FOCUSABLE);
}

/**
 * Pindah fokus ke baris sebelum/sesudah pada kolom yang sama.
 * Melompati baris yang selnya tidak bisa difokus (mis. baris pemisah).
 */
function moveRow(from: HTMLElement, dir: 1 | -1): boolean {
  const cell = from.closest('td') as HTMLTableCellElement | null;
  const row = from.closest('tr') as HTMLTableRowElement | null;
  if (!cell || !row) return false;

  const idx = cell.cellIndex;
  let next = (dir === 1 ? row.nextElementSibling : row.previousElementSibling) as HTMLTableRowElement | null;

  while (next) {
    const target = focusableInCell(next, idx);
    if (target) {
      target.focus();
      if (target instanceof HTMLInputElement && target.type !== 'date' && target.type !== 'checkbox') {
        try {
          target.select();
        } catch {
          /* input type tertentu tidak mendukung select() */
        }
      }
      return true;
    }
    next = (dir === 1 ? next.nextElementSibling : next.previousElementSibling) as HTMLTableRowElement | null;
  }
  return false;
}

export function useTableKeyNav() {
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
      if (e.altKey || e.ctrlKey || e.metaKey) return;

      const el = e.target as HTMLElement | null;
      if (!isTypingField(el)) return;

      // Textarea: panah dipakai untuk berpindah baris teks — biarkan.
      if (el.tagName === 'TEXTAREA') return;

      // Select/combobox: panah dipakai memilih opsi — biarkan.
      if (el.tagName === 'SELECT') return;

      const input = el as HTMLInputElement;

      // Datalist (search help F4) sedang terbuka: panah dipakai memilih usulan.
      if (input.getAttribute('list')) return;

      const inCell = !!input.closest('td');

      if (inCell) {
        // Cegah nilai angka berubah, lalu pindah baris.
        e.preventDefault();
        moveRow(input, e.key === 'ArrowDown' ? 1 : -1);
        return;
      }

      // Di luar tabel: cukup netralkan spinner input angka.
      if (input.type === 'number') e.preventDefault();
    }

    /** Roda mouse tidak boleh mengubah nilai input angka yang sedang fokus. */
    function onWheel(e: WheelEvent) {
      const el = e.target as HTMLElement | null;
      if (!el || el.tagName !== 'INPUT') return;
      const input = el as HTMLInputElement;
      if (input.type !== 'number') return;
      if (document.activeElement !== input) return;
      e.preventDefault();
    }

    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('wheel', onWheel);
    };
  }, []);
}

/**
 * Enter / F8 = Execute, seperti tombol Execute (F8) pada layar seleksi SAP.
 *
 * Tidak aktif ketika:
 *  - fokus ada di TEXTAREA atau tombol (Enter di tombol = klik tombol itu)
 *  - ada dialog terbuka (elemen ber-atribut data-modal)
 *  - berada di dalam area ber-atribut data-no-execute
 */
export function useExecuteKey(handler: () => void, enabled = true) {
  useEffect(() => {
    if (!enabled) return;

    function onKeyDown(e: KeyboardEvent) {
      const isEnter = e.key === 'Enter' && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey;
      const isF8 = e.key === 'F8';
      if (!isEnter && !isF8) return;

      // dialog / popup sedang terbuka -> biarkan dialog yang menangani
      if (document.querySelector('[data-modal]')) return;

      const el = e.target as HTMLElement | null;
      if (el) {
        const tag = el.tagName;
        if (tag === 'TEXTAREA') return;
        if (isEnter && (tag === 'BUTTON' || tag === 'A')) return;
        if (el.closest('[data-no-execute]')) return;
      }

      e.preventDefault();
      handler();
    }

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [handler, enabled]);
}
