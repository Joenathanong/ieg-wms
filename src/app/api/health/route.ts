import prisma from '@/lib/prisma';
import { handle, ok, fail } from '@/lib/api';

export const dynamic = 'force-dynamic';

export async function GET() {
  return handle(async () => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      return ok({ db: 'UP', time: new Date().toISOString() }, 'System check completed');
    } catch {
      return fail('Database connection failed. Check DATABASE_URL.', 503);
    }
  });
}
