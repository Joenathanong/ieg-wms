import { NextRequest } from 'next/server';
import prisma from '@/lib/prisma';
import { requireWrite, requireAdmin, HttpError } from '@/lib/auth';
import { handle, ok, cleanStr } from '@/lib/api';
import { planMerge, mergeMaterial } from '@/lib/merge';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * POST /api/materials/merge — gabungkan SKU kembar.
 *
 * Body: { from_code, into_code, remarks?, dry_run?: boolean }
 *
 * `dry_run: true` hanya mengembalikan rencana (quant yang akan pindah, hal yang
 * ikut dibawa, dan penghalangnya) TANPA mengubah apa pun. Layar wajib
 * menampilkan rencana itu lebih dulu: penggabungan memindahkan stok sungguhan
 * dan menutup sebuah kode master, jadi tidak boleh terjadi karena satu klik
 * yang tidak sengaja.
 */
export async function POST(req: NextRequest) {
  return handle(async () => {
    const body = await req.json();
    const from_code = cleanStr(body.from_code).toUpperCase();
    const into_code = cleanStr(body.into_code).toUpperCase();
    const dry_run = body.dry_run === true;

    if (!from_code || !into_code)
      throw new HttpError(400, 'Kode duplikat dan kode utama wajib diisi.');

    if (dry_run) {
      await requireWrite();
      const plan = await prisma.$transaction((tx) => planMerge(tx, from_code, into_code));
      return ok(
        plan,
        plan.blockers.length > 0
          ? `Penggabungan belum bisa dijalankan: ${plan.blockers.length} hal perlu dibereskan.`
          : `Siap digabung — ${plan.lines.length} quant (${plan.total_qty}) akan pindah dari ${from_code} ke ${into_code}.`
      );
    }

    // Penggabungan sungguhan menutup satu kode master dan memindahkan seluruh
    // stoknya. Itu bukan pekerjaan operator harian.
    const user = await requireAdmin();

    const result = await prisma.$transaction(
      (tx) =>
        mergeMaterial(tx, {
          from_code,
          into_code,
          user_id: user.username,
          remarks: cleanStr(body.remarks) || null,
        }),
      { timeout: 60000, maxWait: 15000 }
    );

    return ok(
      result,
      `${result.from_code} digabung ke ${result.into_code} — ` +
        `${result.moved_lines} quant (${result.moved_qty}) dipindahkan` +
        (result.document_number ? ` lewat material document ${result.document_number}` : ' (tidak ada stok)') +
        `. Kode ${result.from_code} ditutup dan kini menjadi alias.`
    );
  });
}
