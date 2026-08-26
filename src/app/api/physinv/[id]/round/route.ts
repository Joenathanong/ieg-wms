import { NextRequest } from 'next/server';
import prisma from '@/lib/prisma';
import { requireAdmin, HttpError } from '@/lib/auth';
import { handle, ok, cleanStr } from '@/lib/api';
import { PhysInvStatus } from '@prisma/client';
import { fromDbList } from '@/lib/dblist';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

type Ctx = { params: Promise<{ id: string }> };

/**
 * POST /api/physinv/:id/round — buka ronde penghitungan berikutnya.
 *
 * Body: {
 *   bins: [{ bin_code, assigned_to? }],
 *   material_assignments?: [{ material_code, assigned_to }],
 *   show_book_qty?: boolean,
 *   show_prev_round?: boolean
 * }
 *
 * Dokumen bercakupan material memakai `material_assignments`; satu material
 * tetap dikerjakan satu orang, dan penugasannya bisa berpindah tiap ronde —
 * memang itu tujuannya, supaya hitungan berikutnya dikerjakan orang lain.
 *
 * Hanya ADMIN: membuka ronde berarti menentukan siapa menghitung apa, dan
 * itulah yang membuat aturan konsensus bisa dipercaya.
 *
 * Baris kerja ronde baru disalin dari SELURUH material+batch yang pernah
 * diketahui ada di rak itu — termasuk temuan dari ronde sebelumnya. Kalau
 * hanya snapshot awal yang disalin, barang yang baru ketahuan di ronde 1 tidak
 * punya baris di ronde 2 dan kesepakatan tidak akan pernah terbentuk untuknya.
 */
export async function POST(req: NextRequest, ctx: Ctx) {
  return handle(async () => {
    const admin = await requireAdmin();
    const { id } = await ctx.params;
    const b = await req.json();

    const wanted: { bin_code: string; assigned_to: string }[] = (Array.isArray(b.bins) ? b.bins : [])
      .map((x: { bin_code?: unknown; assigned_to?: unknown }) => ({
        bin_code: cleanStr(x?.bin_code).toUpperCase(),
        assigned_to: cleanStr(x?.assigned_to).toUpperCase(),
      }))
      .filter((x: { bin_code: string }) => x.bin_code);

    if (wanted.length === 0) throw new HttpError(400, 'Pilih minimal satu rak untuk ronde berikutnya.');

    const result = await prisma.$transaction(
      async (tx) => {
        const key = decodeURIComponent(id);
        const doc = await tx.physInvDoc.findFirst({
          where: { OR: [{ id: key }, { doc_number: key }] },
          include: { items: true, bins: true, assigns: true },
        });
        if (!doc) throw new HttpError(404, 'Physical inventory document does not exist.');
        if (doc.status === PhysInvStatus.POSTED)
          throw new HttpError(400, `Dokumen ${doc.doc_number} sudah diposting.`);

        const frozen = fromDbList(doc.frozen_bins);
        for (const w of wanted) {
          if (!frozen.includes(w.bin_code))
            throw new HttpError(400, `Rak ${w.bin_code} bukan bagian dokumen ${doc.doc_number}.`);
        }

        const nextRound = doc.current_round + 1;
        const prevRound = doc.current_round;

        const exists = await tx.physInvRound.findFirst({
          where: { doc_id: doc.id, round: nextRound },
        });
        if (exists) throw new HttpError(409, `Ronde ${nextRound} sudah pernah dibuka.`);

        // ---- peringatan penghitung berulang ----
        // Tidak memblokir: petugas bisa terbatas, dan admin yang memutuskan.
        // Tetapi kesepakatan dari orang yang sama TIDAK dianggap konsensus
        // (lihat src/lib/consensus.ts), jadi peringatannya perlu jelas.
        const prevBins = doc.bins.filter((x) => x.round === prevRound);
        const repeats: string[] = [];
        for (const w of wanted) {
          if (!w.assigned_to) continue;
          const before = doc.bins.find(
            (x) => x.bin_code === w.bin_code && x.counted_by === w.assigned_to
          );
          if (before) repeats.push(`${w.bin_code} (${w.assigned_to}, ronde ${before.round})`);
        }

        const names = [...new Set(wanted.map((w) => w.assigned_to).filter(Boolean))];
        if (names.length > 0) {
          const users = await tx.user.findMany({
            where: { username: { in: names } },
            select: { username: true, is_active: true, so_enabled: true },
          });
          for (const n of names) {
            const u = users.find((x) => x.username === n);
            if (!u) throw new HttpError(400, `User ${n} tidak ada (SU01).`);
            if (!u.is_active) throw new HttpError(400, `User ${n} sedang dikunci.`);
            if (!u.so_enabled)
              throw new HttpError(400, `User ${n} tidak diizinkan menerima tugas opname (SU01).`);
          }
        }

        await tx.physInvRound.create({
          data: {
            doc_id: doc.id,
            round: nextRound,
            show_book_qty: b.show_book_qty === true,
            show_prev_round: b.show_prev_round === true,
            opened_by: admin.username,
          },
        });

        // ---- penugasan per material untuk ronde baru ----
        const scope = fromDbList(doc.scope_materials);
        const matAssign = new Map<string, string>();
        for (const a of Array.isArray(b.material_assignments) ? b.material_assignments : []) {
          const code = cleanStr(a?.material_code).toUpperCase();
          const who = cleanStr(a?.assigned_to).toUpperCase();
          if (!code || !who) continue;
          if (scope.length > 0 && !scope.includes(code))
            throw new HttpError(400, `Material ${code} bukan bagian cakupan dokumen ini.`);
          const prev = matAssign.get(code);
          if (prev && prev !== who)
            throw new HttpError(
              400,
              `Material ${code} tidak boleh dibagi ke dua petugas (${prev} dan ${who}).`
            );
          matAssign.set(code, who);
        }

        if (matAssign.size > 0) {
          const matNames = [...new Set(matAssign.values())];
          const mu = await tx.user.findMany({
            where: { username: { in: matNames } },
            select: { username: true, is_active: true, so_enabled: true },
          });
          for (const n of matNames) {
            const u = mu.find((x) => x.username === n);
            if (!u) throw new HttpError(400, `User ${n} tidak ada (SU01).`);
            if (!u.is_active) throw new HttpError(400, `User ${n} sedang dikunci.`);
            if (!u.so_enabled)
              throw new HttpError(400, `User ${n} tidak diizinkan menerima tugas opname (SU01).`);
          }
          await tx.physInvAssign.createMany({
            data: [...matAssign.entries()].map(([material_code, assigned_to]) => ({
              doc_id: doc.id,
              round: nextRound,
              material_code,
              assigned_to,
            })),
          });
        }

        await tx.physInvBin.createMany({
          data: wanted.map((w) => ({
            doc_id: doc.id,
            bin_code: w.bin_code,
            round: nextRound,
            assigned_to: w.assigned_to || null,
          })),
        });

        // ---- salin baris kerja ----
        const binCodes = wanted.map((w) => w.bin_code);
        const known = new Map<string, { material_code: string; batch_number: string | null; book_qty: number }>();
        for (const i of doc.items) {
          if (!binCodes.includes(i.bin_code)) continue;
          const k = `${i.bin_code}|${i.material_code}|${i.batch_number ?? ''}`;
          const cur = known.get(k);
          if (!cur) {
            known.set(k, {
              material_code: i.material_code,
              batch_number: i.batch_number,
              book_qty: i.round === 1 ? i.book_qty : 0,
            });
          } else if (i.round === 1) {
            cur.book_qty = i.book_qty;
          }
        }

        const rows = [...known.entries()].map(([k, v]) => ({
          doc_id: doc.id,
          bin_code: k.split('|')[0],
          round: nextRound,
          material_code: v.material_code,
          batch_number: v.batch_number,
          book_qty: v.book_qty,
          counted_qty: null,
          diff_qty: 0,
        }));
        if (rows.length > 0) await tx.physInvDocItem.createMany({ data: rows });

        const updated = await tx.physInvDoc.update({
          where: { id: doc.id },
          data: { current_round: nextRound, status: PhysInvStatus.FROZEN },
        });

        /**
         * Peringatan penghitung berulang pada satuan MATERIAL.
         *
         * Aturan sepakat menghitung ORANG yang berbeda, bukan jumlah hitungan —
         * jadi menugaskan kembali orang yang sama untuk material yang sama tidak
         * menambah bukti apa pun, dan ronde itu terbuang percuma.
         */
        for (const [code, who] of matAssign) {
          const before = doc.items.find(
            (i) => i.material_code === code && i.counted_by === who && i.round > 0
          );
          if (before) repeats.push(`${code} (${who}, ronde ${before.round})`);
        }

        return { doc: updated, round: nextRound, bins: wanted.length, lines: rows.length, repeats, prevBins: prevBins.length };
      },
      { timeout: 30000, maxWait: 10000 }
    );

    const warn =
      result.repeats.length > 0
        ? ` — perhatian: ${result.repeats.join(', ')} akan dihitung orang yang sama; kesepakatannya tidak akan dianggap konsensus.`
        : '';

    return ok(
      result,
      `Ronde ${result.round} dibuka — ${result.bins} rak, ${result.lines} baris kerja.${warn}`
    );
  });
}
