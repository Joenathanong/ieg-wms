import { NextRequest } from 'next/server';
import prisma from '@/lib/prisma';
import { requireAdmin, HttpError } from '@/lib/auth';
import { handle, ok, cleanStr, toInt, normBatch } from '@/lib/api';
import { PhysInvStatus } from '@prisma/client';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

type Ctx = { params: Promise<{ id: string }> };

/** Ronde semu untuk angka yang ditetapkan supervisor, di luar ronde hitung. */
const MANUAL_ROUND = 0;

/**
 * PATCH /api/physinv/:id/resolve — tetapkan angka final untuk baris yang
 * rondenya tidak pernah sepakat.
 *
 * Body: { decisions: [{ bin_code, material_code, batch_number?, qty }] }
 *
 * Keputusan supervisor disimpan sebagai baris tersendiri pada "ronde 0", BUKAN
 * dengan menimpa angka salah satu ronde. Alasannya penting: hasil tiap ronde
 * adalah catatan apa yang benar-benar dilaporkan penghitung. Menimpanya berarti
 * menghapus jejak bahwa Joni pernah melaporkan 8 dan Budi 9 — padahal justru
 * itu yang perlu terlihat saat hasil opname dipertanyakan kemudian.
 *
 * Hanya ADMIN: ini keputusan yang menentukan angka mana yang masuk ke stok.
 */
export async function PATCH(req: NextRequest, ctx: Ctx) {
  return handle(async () => {
    const admin = await requireAdmin();
    const { id } = await ctx.params;
    const body = await req.json();
    const decisions = Array.isArray(body.decisions) ? body.decisions : [];
    if (decisions.length === 0) throw new HttpError(400, 'Tidak ada keputusan yang dikirim.');
    if (decisions.length > 500) throw new HttpError(400, 'Maksimum 500 keputusan per permintaan.');

    const result = await prisma.$transaction(
      async (tx) => {
        const key = decodeURIComponent(id);
        const doc = await tx.physInvDoc.findFirst({
          where: { OR: [{ id: key }, { doc_number: key }] },
          include: { items: true },
        });
        if (!doc) throw new HttpError(404, 'Dokumen opname tidak ditemukan.');
        if (doc.status === PhysInvStatus.POSTED)
          throw new HttpError(400, `Dokumen ${doc.doc_number} sudah diposting.`);

        let saved = 0;
        for (const d of decisions) {
          const bin_code = cleanStr(d.bin_code).toUpperCase();
          const material_code = cleanStr(d.material_code).toUpperCase();
          const batch_number = normBatch(d.batch_number);
          const qty = toInt(d.qty, 'jumlah final');
          if (qty < 0) throw new HttpError(400, 'Jumlah final tidak boleh negatif.');
          if (!bin_code || !material_code)
            throw new HttpError(400, 'Rak dan material wajib diisi pada setiap keputusan.');

          // book_qty diambil dari snapshot ronde 1 supaya selisihnya dihitung
          // terhadap catatan sistem, bukan terhadap ronde mana pun.
          const snap = doc.items.find(
            (i) =>
              i.round === 1 &&
              i.bin_code === bin_code &&
              i.material_code === material_code &&
              i.batch_number === batch_number
          );
          const book = snap?.book_qty ?? 0;

          const existing = doc.items.find(
            (i) =>
              i.round === MANUAL_ROUND &&
              i.bin_code === bin_code &&
              i.material_code === material_code &&
              i.batch_number === batch_number
          );

          if (existing) {
            await tx.physInvDocItem.update({
              where: { id: existing.id },
              data: { counted_qty: qty, diff_qty: qty - book, counted_by: admin.username },
            });
          } else {
            await tx.physInvDocItem.create({
              data: {
                doc_id: doc.id,
                bin_code,
                round: MANUAL_ROUND,
                material_code,
                batch_number,
                book_qty: book,
                counted_qty: qty,
                diff_qty: qty - book,
                counted_by: admin.username,
                mfg_date: snap?.mfg_date ?? null,
                exp_date: snap?.exp_date ?? null,
              },
            });
          }
          saved++;
        }

        return { saved };
      },
      { timeout: 30000, maxWait: 10000 }
    );

    return ok(result, `${result.saved} baris ditetapkan oleh ${admin.username}.`);
  });
}
