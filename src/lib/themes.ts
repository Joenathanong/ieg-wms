/**
 * TEMA APLIKASI
 * =============================================================================
 * Tema di sini bukan sekadar pergantian warna. Setiap tema juga membawa
 * "geometri"-nya sendiri — radius sudut, tinggi kontrol, kerapatan baris tabel,
 * ada tidaknya garis vertikal pada tabel, dan gaya judul panel. Semuanya
 * dituangkan sebagai CSS variable di `globals.css`, sehingga menambah tema baru
 * tidak menyentuh satu pun layar.
 *
 * Dua keluarga tema:
 *
 *   QUARTZ  — padat, bersudut tajam, garis tabel penuh. Ini bahasa visual SAP
 *             GUI klasik: sebanyak mungkin baris muat di layar, cocok untuk
 *             pekerjaan entri yang berjam-jam.
 *
 *   HORIZON — mengikuti SAP Fiori Horizon. Lebih lapang, sudut membulat, panel
 *             melayang dengan bayangan tipis, dan tabel tanpa garis vertikal
 *             sehingga mata mengikuti baris, bukan kotak. Lebih mudah dibaca
 *             untuk pekerjaan yang berpindah-pindah layar.
 *
 * Preferensi disimpan DUA tempat, dan itu disengaja:
 *   - kolom `users.theme` — supaya tema ikut ke perangkat mana pun user masuk;
 *   - cookie `wms-theme`  — supaya server bisa menuliskan atribut data-theme
 *     sebelum halaman digambar. Tanpa cookie, tema baru menempel setelah
 *     JavaScript jalan, dan setiap perpindahan halaman berkedip putih.
 */

export type ThemeScheme = 'light' | 'dark';
export type ThemeFamily = 'QUARTZ' | 'HORIZON';

export interface ThemeDef {
  id: string;
  label: string;
  family: ThemeFamily;
  scheme: ThemeScheme;
  /** satu kalimat: kapan tema ini masuk akal dipakai */
  hint: string;
  /**
   * Tiga warna untuk contoh di pemilih tema: latar, permukaan, aksen.
   * Sengaja hardcode, bukan dibaca dari CSS: contoh warna harus terlihat
   * bersamaan padahal hanya satu tema yang sedang aktif.
   */
  swatch: [string, string, string];
  /** warna bilah alamat browser di HP (meta theme-color) */
  browser: string;
}

export const THEMES: ThemeDef[] = [
  {
    id: 'quartz-dark',
    label: 'Quartz Dark',
    family: 'QUARTZ',
    scheme: 'dark',
    hint: 'Padat dan bersudut tajam — paling banyak baris muat di layar.',
    swatch: ['#1E232A', '#2A2F3B', '#367BF5'],
    browser: '#181C24',
  },
  {
    id: 'quartz-light',
    label: 'Quartz Light',
    family: 'QUARTZ',
    scheme: 'light',
    hint: 'Versi terang dari tampilan padat — untuk ruang kerja yang benderang.',
    swatch: ['#F5F6F7', '#FFFFFF', '#0070F2'],
    browser: '#FFFFFF',
  },
  {
    id: 'horizon-evening',
    label: 'Evening Horizon',
    family: 'HORIZON',
    scheme: 'dark',
    hint: 'Biru malam yang lapang, sudut membulat — nyaman untuk shift panjang.',
    swatch: ['#111820', '#1A222C', '#4EA5FF'],
    browser: '#0C1219',
  },
  {
    id: 'horizon-morning',
    label: 'Morning Horizon',
    family: 'HORIZON',
    scheme: 'light',
    hint: 'Putih bersih ala Fiori terbaru, panel melayang, tabel tanpa kisi.',
    swatch: ['#F5F6F7', '#FFFFFF', '#0070F2'],
    browser: '#FFFFFF',
  },
];

export const DEFAULT_THEME = 'quartz-dark';
export const THEME_COOKIE = 'wms-theme';
/** setahun — tema bukan data sensitif dan tidak perlu sering ditanya ulang */
export const THEME_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

const IDS = new Set(THEMES.map((t) => t.id));

/**
 * Nama tema lama dari pemasangan sebelum ada manajer tema.
 *
 * Cookie dan localStorage yang sudah tersimpan di browser operator berisi
 * 'dark' / 'light'. Tanpa pemetaan ini mereka akan dilempar ke tema bawaan
 * pada login berikutnya — perubahan yang tidak mereka minta.
 */
const LEGACY: Record<string, string> = {
  dark: 'quartz-dark',
  light: 'quartz-light',
};

export function normalizeTheme(value: unknown): string {
  const v = String(value ?? '').trim();
  if (IDS.has(v)) return v;
  return LEGACY[v] ?? DEFAULT_THEME;
}

export function themeById(id: string): ThemeDef {
  return THEMES.find((t) => t.id === normalizeTheme(id)) ?? THEMES[0];
}

/** Tema dikelompokkan per keluarga — dipakai pemilih tema agar tidak jadi daftar panjang. */
export function themesByFamily(): { family: ThemeFamily; label: string; items: ThemeDef[] }[] {
  return [
    {
      family: 'QUARTZ',
      label: 'Quartz — padat, ala SAP GUI',
      items: THEMES.filter((t) => t.family === 'QUARTZ'),
    },
    {
      family: 'HORIZON',
      label: 'Horizon — lapang, ala SAP Fiori',
      items: THEMES.filter((t) => t.family === 'HORIZON'),
    },
  ];
}
