import type { Metadata, Viewport } from 'next';
import { cookies } from 'next/headers';
import './globals.css';
import { DEFAULT_THEME, THEME_COOKIE, normalizeTheme, themeById } from '@/lib/themes';

export const metadata: Metadata = {
  title: 'WMS Lite — SAP S/4HANA Style',
  description: 'Lightweight Warehouse Management System (WM / IM) — tema Quartz & Fiori Horizon',
  // tampil sebagai aplikasi saat di-"Add to Home Screen" pada HP / PDT
  appleWebApp: { capable: true, title: 'WMS Lite', statusBarStyle: 'black-translucent' },
  formatDetection: { telephone: false },
};

/** Tema aktif dari cookie — dipakai layout maupun viewport. */
async function activeTheme(): Promise<string> {
  const jar = await cookies();
  return normalizeTheme(jar.get(THEME_COOKIE)?.value ?? DEFAULT_THEME);
}

/**
 * Warna bilah alamat HP mengikuti tema yang sedang dipakai.
 *
 * Dulu nilainya ditentukan `prefers-color-scheme`, yang keliru sejak tema bisa
 * dipilih sendiri: pengguna bertema gelap di HP bermode terang akan melihat
 * bilah alamat putih menempel pada aplikasi gelap.
 */
export async function generateViewport(): Promise<Viewport> {
  const theme = themeById(await activeTheme());
  return {
    width: 'device-width',
    initialScale: 1,
    // hormati area notch pada HP modern
    viewportFit: 'cover',
    themeColor: theme.browser,
  };
}

/**
 * Tema ditulis SERVER-SIDE ke <html data-theme>.
 *
 * Sebelumnya ini dikerjakan skrip inline yang membaca localStorage. Cara itu
 * berjalan setelah HTML sampai di browser, jadi selalu ada satu bingkai dengan
 * tema bawaan — terlihat sebagai kedipan gelap/terang di setiap perpindahan
 * halaman. Karena preferensinya kini juga tersimpan sebagai cookie, server
 * sudah tahu jawabannya sejak awal dan kedipan itu hilang sepenuhnya.
 */
export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const theme = await activeTheme();

  return (
    <html lang="id" data-theme={theme} suppressHydrationWarning>
      {/* suppressHydrationWarning: ekstensi browser (Grammarly dkk) menyuntikkan
          atribut seperti data-gr-ext-installed ke <body> sebelum React sempat
          hydrate. Itu di luar kendali aplikasi dan tidak perlu jadi error. */}
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}
