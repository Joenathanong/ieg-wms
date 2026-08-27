import { NextRequest } from 'next/server';
import prisma from '@/lib/prisma';
import { requireAdmin, HttpError } from '@/lib/auth';
import { handle, ok, cleanStr } from '@/lib/api';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

interface RowResult {
  row: number;
  key: string;
  status: 'DELETED' | 'ERROR';
  message?: string;
}

/**
 * POST /api/upload/delete-materials
 * Body: { rows: [{ material_code }], offset?: number }
 *
 * Hapus master material secara massal — pembersih untuk unggahan yang salah.
 *
 * Hanya ADMIN, bukan requireWrite seperti unggahan lain: unggahan lain
 * menambah atau memperbaiki data, yang ini menghilangkannya.
 *
 * Tiga pengaman, dan semuanya menolak PER BARIS, bukan membatalkan seluruh
 * berkas. Satu material yang ternyata sudah dipakai tidak boleh menggagalkan
 * pembersihan ratusan baris lain yang memang salah:
 *
 *   1. material harus ada          — supaya salah ketik tidak lewat diam-diam
 *   2. tidak boleh punya stok      — sama seperti tombol hapus di MM01
 *   3. tidak boleh punya riwayat   — dokumen MB51 menyimpan kode material
 *      sebagai teks biasa, bukan relasi. Menghapus materialnya tidak akan
 *      menghapus dokumennya, tetapi membuat riwayat itu menunjuk ke master
 *      yang sudah tidak ada. Untuk membersihkan salah unggah, material yang
 *      baru dibuat memang belum punya riwayat, jadi pengaman ini tidak
 *      menghalangi — ia hanya menahan penghapusan yang merusak jejak audit.
 *
 * Master palletization ikut terhapus mengikuti relasi material.
 */
export async function POST(req: NextRequest) {
  return handle(async () => {
    await requireAdmin();
    const body = await req.json();
    const rows = Array.isArray(body.rows) ? body.rows : [];
    const offset = Number(body.offset ?? 0);

    if (rows.length === 0) throw new HttpError(400, 'No rows received.');
    if (rows.length > 200) throw new HttpError(400, 'Chunk size too large. Maximum 200 rows per request.');

    const results: RowResult[] = [];

    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const lineNo = offset + i + 1;
      const material_code = cleanStr(r.material_code ?? r.MATERIAL_CODE).toUpperCase();

      try {
        if (!material_code) throw new Error('Column material_code is empty.');

        const mat = await prisma.material.findUnique({
          where: { material_code },
          select: { material_code: true },
        });
        if (!mat) throw new Error(`Material ${material_code} does not exist in master data.`);

        const im = await prisma.stockIM.findUnique({ where: { material_code } });
        if ((im?.total_qty ?? 0) !== 0)
          throw new Error(`Material ${material_code} still has stock (${im?.total_qty}). Deletion refused.`);

        const wm = await prisma.stockWM.count({ where: { material_code } });
        if (wm > 0)
          throw new Error(`Material ${material_code} still has ${wm} warehouse quant(s). Deletion refused.`);

        const docs = await prisma.migoLog.count({ where: { material_code } });
        if (docs > 0)
          throw new Error(
            `Material ${material_code} has ${docs} document(s) in MB51. Deleting it would leave that history without a master record.`
          );

        const trItems = await prisma.transferReqItem.count({ where: { material_code } });
        if (trItems > 0)
          throw new Error(`Material ${material_code} is still referenced by ${trItems} transfer requirement line(s).`);

        // Menghapus material yang menjadi TUJUAN alias akan ikut menghapus
        // aliasnya (cascade), sehingga kode lama pada karton mendadak tidak
        // dikenali lagi — dan tidak ada apa pun di layar yang menjelaskan
        // kenapa. Lebih baik ditolak.
        const aliasCount = await prisma.materialAlias.count({ where: { material_code } });
        if (aliasCount > 0)
          throw new Error(
            `Material ${material_code} masih menjadi tujuan ${aliasCount} kode alias. ` +
              `Lepas aliasnya di MM01 lebih dulu.`
          );

        await prisma.$transaction([
          prisma.stockIM.deleteMany({ where: { material_code } }),
          prisma.material.delete({ where: { material_code } }),
        ]);

        results.push({ row: lineNo, key: material_code, status: 'DELETED' });
      } catch (e) {
        results.push({
          row: lineNo,
          key: material_code || '(empty)',
          status: 'ERROR',
          message: e instanceof Error ? e.message : 'Unknown error',
        });
      }
    }

    const deleted = results.filter((r) => r.status === 'DELETED').length;
    const errors = results.filter((r) => r.status === 'ERROR');

    return ok(
      { results, deleted, error_count: errors.length },
      `Chunk processed: ${deleted} material(s) deleted, ${errors.length} refused`
    );
  });
}
