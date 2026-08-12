import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'WMS Lite — SAP S/4HANA Style',
  description:
    'Lightweight Warehouse Management System (WM / IM) — SAP GUI Quartz Dark & Morning Horizon',
};

/**
 * Set tema sebelum paint (anti-flash). Preferensi per browser di localStorage:
 * 'dark' = Quartz Dark (default), 'light' = SAP Morning Horizon.
 */
const themeInit = `
try {
  var t = localStorage.getItem('wms-theme');
  if (t !== 'light' && t !== 'dark') t = 'dark';
  document.documentElement.setAttribute('data-theme', t);
} catch (e) {
  document.documentElement.setAttribute('data-theme', 'dark');
}
`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="id" data-theme="dark" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInit }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
