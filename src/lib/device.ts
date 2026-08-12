/**
 * Deteksi perangkat dari User-Agent (edge-safe, dipakai middleware).
 *
 * Tujuan: operator yang membuka aplikasi dari HP atau terminal PDT
 * langsung diarahkan ke menu ZRF, tanpa harus mengetik T-Code.
 */

/** Handheld/PDT industri yang umum dipakai di gudang (semuanya berbasis Android). */
const PDT_HINT =
  /Zebra|TC5\d|TC7\d|MC3\d|MC9\d|Honeywell|Datalogic|CipherLab|Unitech|Urovo|Chainway|Symbol|Motorola Solutions|EDA5\d|EDA6\d/i;

/** Pola umum perangkat mobile. */
const MOBILE_HINT =
  /Android|webOS|iPhone|iPod|BlackBerry|BB10|IEMobile|Opera Mini|Windows Phone|Mobile Safari|Mobi/i;

/** Tablet — diperlakukan sebagai desktop (layar cukup lebar untuk layar ALV). */
const TABLET_HINT = /iPad|Tablet|Nexus 7|Nexus 10|SM-T|Kindle|Silk/i;

export type DeviceKind = 'PDT' | 'MOBILE' | 'TABLET' | 'DESKTOP';

export function detectDevice(userAgent?: string | null): DeviceKind {
  const ua = userAgent ?? '';
  if (!ua) return 'DESKTOP';
  if (PDT_HINT.test(ua)) return 'PDT';
  if (TABLET_HINT.test(ua)) return 'TABLET';
  if (MOBILE_HINT.test(ua)) return 'MOBILE';
  return 'DESKTOP';
}

/** true untuk HP & terminal PDT — kandidat auto-masuk ke ZRF. */
export function isHandheld(userAgent?: string | null): boolean {
  const d = detectDevice(userAgent);
  return d === 'PDT' || d === 'MOBILE';
}

/** Cookie preferensi tampilan: 'desktop' = jangan auto-redirect ke ZRF. */
export const VIEW_COOKIE = 'sap_view';
export const VIEW_MAX_AGE = 60 * 60 * 24 * 365;
