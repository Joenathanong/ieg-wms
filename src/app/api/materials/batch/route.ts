import { NextRequest } from 'next/server';
import prisma from '@/lib/prisma';
import { requireUser } from '@/lib/auth';
import { handle, ok, cleanStr } from '@/lib/api';

export const dynamic = 'force-dynamic';

/**
 * GET /api/materials/batch?material=&batch=
 *
 * Cari tanggal batch yang SUDAH pernah terdaftar, supaya penerimaan ulang batch
 * yang sama tidak perlu mengetik ulang mfg/exp date — dan lebih penting lagi,
 * supaya tidak ada dua tanggal berbeda untuk satu nomor batch.
 *
 * Quant dengan qty 0 tetap dipakai: batch yang stoknya sudah habis tetap
 * merupakan batch yang pernah terdaftar.
 */
export async function GET(req: NextRequest) {
  return handle(async () => {
    await requireUser();
    const sp = req.nextUrl.searchParams;
    const material_code = cleanStr(sp.get('material')).toUpperCase();
    const batch_number = cleanStr(sp.get('batch')).toUpperCase();

    if (!material_code || !batch_number) {
      return ok({ found: false }, 'Material and batch are required');
    }

    const quant = await prisma.stockWM.findFirst({
      where: { material_code, batch_number },
      orderBy: [{ qty: 'desc' }, { updated_at: 'desc' }],
      select: { mfg_date: true, exp_date: true, gr_date: true, qty: true },
    });

    if (!quant) return ok({ found: false }, `Batch ${batch_number} is new for ${material_code}`);

    return ok(
      {
        found: true,
        mfg_date: quant.mfg_date,
        exp_date: quant.exp_date,
        gr_date: quant.gr_date,
        on_hand: quant.qty,
      },
      `Batch ${batch_number} already registered`
    );
  });
}
