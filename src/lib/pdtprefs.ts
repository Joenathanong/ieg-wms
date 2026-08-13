'use client';

/**
 * Preferensi perilaku keyboard di layar PDT — disimpan PER PERANGKAT.
 *
 * Kenapa per perangkat dan bukan setting global: perilaku yang benar bergantung
 * pada cara scanner mengirim data, dan itu berbeda antar terminal.
 *
 *  'auto'   — field siap-scan memakai `inputmode="none"` sehingga keyboard
 *             virtual tidak muncul saat fokus berpindah otomatis. Cocok untuk
 *             scanner yang mengirim keystroke biasa.
 *  'always' — inputmode dibiarkan normal. Wajib dipilih bila scanner mengirim
 *             data lewat IME (mis. DataWedge "Enhanced keystroke output"):
 *             `inputmode="none"` membuat Android tidak menyalakan IME sama
 *             sekali, sehingga hasil scan tidak pernah sampai ke field.
 */

export type KeyboardPref = 'auto' | 'always';

export const KBD_COOKIE = 'pdt_kbd';
const MAX_AGE = 60 * 60 * 24 * 365;
/** Event internal supaya seluruh field ikut berubah tanpa reload halaman. */
export const KBD_EVENT = 'pdt-kbd-pref';

export function readKeyboardPref(): KeyboardPref {
  if (typeof document === 'undefined') return 'auto';
  const m = document.cookie.match(new RegExp(`(?:^|; )${KBD_COOKIE}=([^;]*)`));
  return m?.[1] === 'always' ? 'always' : 'auto';
}

export function writeKeyboardPref(v: KeyboardPref) {
  if (typeof document === 'undefined') return;
  document.cookie = `${KBD_COOKIE}=${v}; path=/; max-age=${MAX_AGE}; samesite=lax`;
  window.dispatchEvent(new CustomEvent(KBD_EVENT, { detail: v }));
}
