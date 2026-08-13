'use client';

import { useEffect, useRef } from 'react';

/**
 * Penangkap barcode tingkat DOKUMEN.
 *
 * Masalah yang dipecahkan: supaya scanner terbaca, biasanya sebuah field harus
 * difokuskan lebih dulu — dan begitu field difokuskan, Android memunculkan
 * keyboard virtual yang menutupi separuh layar PDT. Padahal operator tidak
 * sedang mengetik apa pun.
 *
 * PENTING: sebagian wedge Android (mis. DataWedge mode keystroke) hanya
 * mengirim karakter ke field yang SEDANG difokuskan. Di perangkat seperti itu
 * penangkap dokumen ini tidak akan menerima apa pun — karena itu field material
 * tetap difokuskan, dan hook ini hanya berfungsi sebagai CADANGAN untuk
 * perangkat yang mengirim karakter secara global.
 *
 * Pembeda scanner vs manusia adalah KECEPATAN: scanner mengirim seluruh barcode
 * dalam hitungan milidetik, sedangkan manusia jauh lebih lambat. Karena itu
 * buffer di-reset bila jeda antar karakter terlalu panjang.
 */

/** Jeda maksimum antar karakter yang masih dianggap satu barcode (ms). */
const MAX_GAP_MS = 120;
/** Jeda setelah karakter terakhir sebelum barcode dianggap selesai (ms). */
const FLUSH_MS = 140;
/** Barcode terpendek yang diproses — mencegah ketikan nyasar ikut terbaca. */
const MIN_LENGTH = 3;

/**
 * Bila ADA field yang sedang difokuskan, biarkan field itu yang menangani
 * karakternya. Penangkap dokumen ini murni cadangan untuk keadaan tanpa fokus —
 * kalau keduanya aktif bersamaan, satu barcode akan terbaca dua kali.
 */
function isTypingTarget(el: EventTarget | null): boolean {
  const t = el as HTMLElement | null;
  if (!t) return false;
  const tag = t.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  return t.isContentEditable === true;
}

export function useScanGun(onScan: (code: string) => void, enabled = true) {
  const cb = useRef(onScan);
  cb.current = onScan;

  useEffect(() => {
    if (!enabled || typeof document === 'undefined') return;

    let buf = '';
    let last = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const flush = () => {
      const value = buf.trim();
      buf = '';
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      if (value.length >= MIN_LENGTH) cb.current(value);
    };

    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.altKey || e.metaKey) return;
      if (isTypingTarget(e.target)) return;

      const now = Date.now();
      if (now - last > MAX_GAP_MS) buf = '';
      last = now;

      if (e.key === 'Enter') {
        if (buf.length >= MIN_LENGTH) e.preventDefault();
        flush();
        return;
      }

      // hanya karakter tercetak yang masuk buffer
      if (e.key.length === 1) buf += e.key;
      else return;

      if (timer) clearTimeout(timer);
      timer = setTimeout(flush, FLUSH_MS);
    };

    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      if (timer) clearTimeout(timer);
    };
  }, [enabled]);
}
