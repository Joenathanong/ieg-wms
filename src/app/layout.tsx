import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'WMS Lite — SAP S/4HANA Style',
  description: 'Lightweight Warehouse Management System (WM / IM) — SAP GUI 8.0 Quartz Dark',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="id" className="dark">
      <body>{children}</body>
    </html>
  );
}
