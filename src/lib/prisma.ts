import { PrismaClient } from '@prisma/client';

/**
 * Singleton Prisma Client.
 * Di serverless (Vercel) modul di-cache antar invocation, sehingga
 * instance disimpan di globalThis agar tidak membuka koneksi baru terus-menerus.
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

/**
 * Batas waktu transaksi — dilonggarkan khusus untuk database serverless.
 *
 * Bawaan Prisma adalah 2 detik menunggu koneksi dan 5 detik menjalankan
 * transaksi interaktif. Angka itu wajar untuk database yang selalu menyala,
 * tetapi TiDB Serverless menidurkan cluster saat menganggur dan permintaan
 * pertama sesudahnya harus menunggu cluster bangun. Dengan bawaan Prisma,
 * penantian itu berakhir sebagai P2028 — transaksinya DIBATALKAN, bukan
 * sekadar lambat. Yang terkena justru operasi paling penting: posting MIGO,
 * posting stock opname, dan ZRF09, karena semuanya transaksi interaktif.
 *
 * Konsekuensinya harus disadari: transaksi yang benar-benar macet kini
 * menahan kunci lebih lama sebelum menyerah. Itu sengaja dipilih — pada beban
 * kerja gudang ini, satu posting yang tertunda 20 detik jauh lebih ringan
 * akibatnya daripada satu posting yang gagal di tengah jalan.
 *
 * Bila keep-alive di ZSET diaktifkan, cluster jarang sempat tidur sehingga
 * angka ini nyaris tidak pernah terpakai. Ini jaring pengaman, bukan
 * pengganti keep-alive.
 */
const TRANSACTION_OPTIONS = {
  /** waktu menunggu giliran koneksi dari pool */
  maxWait: 15_000,
  /** batas jalannya isi transaksi */
  timeout: 30_000,
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
    transactionOptions: TRANSACTION_OPTIONS,
  });

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;

export default prisma;
