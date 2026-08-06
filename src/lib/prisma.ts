import { PrismaClient } from '@prisma/client';

/**
 * Singleton Prisma Client.
 * Di serverless (Vercel) modul di-cache antar invocation, sehingga
 * instance disimpan di globalThis agar tidak membuka koneksi baru terus-menerus.
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;

export default prisma;
