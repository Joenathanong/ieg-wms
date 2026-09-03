import { NextRequest } from 'next/server';
import prisma from '@/lib/prisma';
import { requireWrite, HttpError } from '@/lib/auth';
import { handle, ok, cleanStr } from '@/lib/api';
import { TrStatus } from '@prisma/client';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/**
 * POST /api/tr/:id/cancel-lines — batalkan BARIS tertentu dari Transfer Requirement.
 * Body: { item_ids: string[], reason?: string }
 *
 * Kenapa perlu ada, padahal sudah ada DELETE /api/tr/:id: pembatalan seluruh
 * dokumen menolak TR yang sudah dikonfirmasi sebagian. Itu masuk akal sebagai
 * pengaman, tetapi meninggalkan jalan buntu yang nyata — TR berisi 23 baris
 * dengan 13 baris selesai dan 2 baris yang barangnya sudah dipindahkan lewat
 * jalur lain tidak bisa dikonfirmasi (stok di bin transit sudah habis) maupun
 * dibatalkan. Barisnya menggantung di LB10 selamanya.
 *
 * Baris yang sudah dikonfirmasi SEBAGIAN tetap boleh dibatalkan: yang dibatalkan
 * adalah sisa yang belum dikonfirmasi, sedangkan qty yang sudah masuk rak tidak
 * disentuh sama sekali. Stok tidak berubah — ini murni menutup pekerjaan.
 */
export async function POST(req: NextRequest, ctx: Ctx) {
  return handle(async () => {
    const user = await requireWrite();
    const { id } = await ctx.params;
    const key = decodeURIComponent(id);
    const body = await req.json();

    const itemIds: string[] = Array.isArray(body.item_ids)
      ? body.item_ids.map((v: unknown) => String(v)).filter(Boolean)
      : [];
    if (itemIds.length === 0) throw new HttpError(400, 'Belum ada baris yang dipilih.');

    const reason = cleanStr(body.reason).slice(0, 120);

    const result = await prisma.$transaction(async (tx) => {
      const tr = await tx.transferReq.findFirst({
        where: { OR: [{ id: key }, { tr_number: key.toUpperCase() }] },
        include: { items: true },
      });
      if (!tr) throw new HttpError(404, 'Transfer requirement tidak ditemukan.');
      if (tr.status === TrStatus.CANCELLED)
        throw new HttpError(400, `${tr.tr_number} sudah dibatalkan seluruhnya.`);

      const targets = tr.items.filter((i) => itemIds.includes(i.id));
      if (targets.length === 0)
        throw new HttpError(400, 'Baris yang dipilih bukan milik transfer requirement ini.');

      for (const t of targets) {
        if (t.status === TrStatus.CLOSED)
          throw new HttpError(
            400,
            `Baris ${t.line_no} sudah selesai dikonfirmasi — tidak ada sisa yang bisa dibatalkan.`
          );
        if (t.status === TrStatus.CANCELLED)
          throw new HttpError(400, `Baris ${t.line_no} sudah dibatalkan sebelumnya.`);
      }

      await tx.transferReqItem.updateMany({
        where: { id: { in: targets.map((t) => t.id) } },
        data: { status: TrStatus.CANCELLED },
      });

      /**
       * Status header dihitung ulang. Baris batal dianggap SELESAI — kalau
       * tidak, TR yang seluruh sisanya dibatalkan akan menggantung PARTIAL
       * selamanya, yang justru masalah yang sedang dibereskan.
       */
      const others = tr.items.filter((i) => !targets.some((t) => t.id === i.id));
      const allDone = others.every(
        (i) => i.status === TrStatus.CLOSED || i.status === TrStatus.CANCELLED
      );
      const anyConfirmed = tr.items.some((i) => i.qty_confirmed > 0);

      if (allDone) {
        await tx.transferReq.update({
          where: { id: tr.id },
          data: {
            status: anyConfirmed ? TrStatus.CLOSED : TrStatus.CANCELLED,
            closed_at: new Date(),
          },
        });
      }

      /**
       * Jejak alasan dititipkan di remarks header.
       *
       * Bukan tempat yang ideal — idealnya ada kolom sendiri di baris TR —
       * tetapi kolom itu belum ada, dan membatalkan pekerjaan tanpa meninggalkan
       * jejak sama sekali lebih buruk daripada jejak yang seadanya. Dipotong di
       * 255 karakter mengikuti lebar kolomnya, catatan terbaru di depan supaya
       * yang terpotong adalah yang paling lama.
       */
      const note =
        `[${new Date().toISOString().slice(0, 10)} ${user.username}] batal baris ` +
        `${targets.map((t) => t.line_no).join(',')}${reason ? `: ${reason}` : ''}`;
      const merged = tr.remarks ? `${note} | ${tr.remarks}` : note;
      await tx.transferReq.update({
        where: { id: tr.id },
        data: { remarks: merged.slice(0, 255) },
      });

      return {
        tr_number: tr.tr_number,
        cancelled: targets.map((t) => ({
          line_no: t.line_no,
          material_code: t.material_code,
          batch_number: t.batch_number,
          open_qty: t.qty - t.qty_confirmed,
        })),
        header_closed: allDone,
      };
    });

    return ok(
      result,
      `${result.cancelled.length} baris ${result.tr_number} dibatalkan (baris ` +
        `${result.cancelled.map((c) => c.line_no).join(', ')}). Stok tidak berubah.` +
        (result.header_closed ? ` Seluruh baris selesai — ${result.tr_number} ditutup.` : '')
    );
  });
}
