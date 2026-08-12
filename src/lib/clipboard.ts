'use client';

/**
 * Salin teks ke clipboard.
 *
 * Catatan penting: `navigator.clipboard` HANYA tersedia pada secure context
 * (https atau localhost). Banyak instalasi gudang berjalan lewat http di
 * jaringan lokal, karena itu selalu disediakan fallback execCommand.
 */
export async function copyText(text: string): Promise<boolean> {
  const value = String(text ?? '');
  if (!value) return false;

  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch {
    /* lanjut ke fallback */
  }

  try {
    const ta = document.createElement('textarea');
    ta.value = value;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.top = '-1000px';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    ta.setSelectionRange(0, value.length);
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

/** Potong teks panjang untuk ditampilkan di pesan status. */
export function shorten(text: string, max = 40): string {
  const s = String(text ?? '');
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

/**
 * Cari nomor dokumen di dalam teks pesan status.
 * Format yang dipakai aplikasi ini:
 *   MATDOC 5000000101 · TRDOC 0000000101 · TRREQ TR00000101 · PIDOC 100000101
 */
export function findDocNumbers(text: string): string[] {
  const s = String(text ?? '');
  const out = new Set<string>();
  const rx = /\b(?:TR\d{6,}|PI\d{6,}|\d{8,12})\b/g;
  let m: RegExpExecArray | null;
  while ((m = rx.exec(s)) !== null) out.add(m[0]);
  return [...out];
}
