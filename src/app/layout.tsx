import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import { ThemeProvider } from '@/components/ui/ThemeProvider';
import { Toaster } from 'react-hot-toast';

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'WMS Dashboard – IEG',
  description: 'Warehouse Management System – PT. INOVASI EKA GEMILANG',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="id" suppressHydrationWarning>
      <body className={inter.className}>
        <ThemeProvider>
          {children}
          <Toaster
            toastOptions={{
              className: '!bg-[rgb(var(--surface))] !text-[rgb(var(--text))] !border !border-[rgb(var(--border))]',
            }}
          />
        </ThemeProvider>
      </body>
    </html>
  );
}
