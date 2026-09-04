import { NextRequest } from 'next/server';
import prisma from '@/lib/prisma';
import { requireWrite, HttpError } from '@/lib/auth';
import { handle, ok } from '@/lib/api';
import { nextDocNumber } from '@/lib/docnum';
import { applyStockIM, applyStockWM } from '@/lib/wms';
import { BinStatus, MovementType, PhysInvStatus } from '@prisma/client';
import { fromDbList, toDbList } from '@/lib/dblist';
import { judgeLine, lineKey, type RoundValue } from '@/lib/consensus';
import { planReclass, postReclass } from '@/lib/physinvreclass';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

type Ctx = { params: Promise<{ id: string }> };

/**
 * POST /api/physinv/:id/post — LI21 Post Physical Inventory Difference.
 * Seluruh baris (lintas bin) diproses dalam satu transaction:
 * selisih (+) -> movement 701, selisih (-) -> movement 702.
 * Semua bin yang di-freeze dilepas kembali di akhir.
 *
 * DUA PERILAKU, tergantung jenis dokumennya:
 *
 *  - Dokumen LI01N biasa (satu ronde, tanpa penugasan) diposting apa adanya
 *    seperti selama ini — satu hitungan sudah dianggap sah.
 *
 *  - Dokumen terkelola (ZSO01: ada penugasan, atau sudah lebih dari satu ronde)
 *    hanya boleh diposting dari angka FINAL: hasil kesepakatan dua ronde oleh
 *    orang berbeda, atau angka yang ditetapkan supervisor. Baris yang belum
 *    punya angka final memblokir posting, karena memposting angka yang masih
 *    diperselisihkan sama saja meniadakan gunanya menghitung berkali-kali.
 */
export async function POST(_req: NextRequest, ctx: Ctx) {
  return handle(async () => {
    const user = await requireWrite();
    const { id } = await ctx.params;

    const result = await prisma.$transaction(
      async (tx) => {
        const doc = await tx.physInvDoc.findFirst({
          where: { OR: [{ id: decodeURIComponent(id) }, { doc_number: decodeURIComponent(id) }] },
          include: { items: true },
        });
        if (!doc) throw new HttpError(404, 'Physical inventory document does not exist.');
        if (doc.status === PhysInvStatus.POSTED)
          throw new HttpError(400, `Document ${doc.doc_number} is already posted.`);
        if (doc.status !== PhysInvStatus.COUNTED)
          throw new HttpError(400, 'Count results must be entered before posting (LI11N).');

        const bins = await tx.physInvBin.findMany({ where: { doc_id: doc.id } });
        const managed = doc.current_round > 1 || bins.some((x) => !!x.assigned_to);

        /** Baris yang benar-benar akan menghasilkan pergerakan stok. */
        let pending: typeof doc.items = [];
        /** Baris yang dilewati karena tidak pernah dihitung ronde mana pun. */
        let skipped = 0;

        if (!managed) {
          pending = doc.items.filter(
            (i) => i.counted_qty !== null && i.diff_qty !== 0 && !i.posted
          );
        } else {
          // ---- kumpulkan hasil tiap ronde per baris ----
          interface G {
            book_qty: number;
            rounds: RoundValue[];
            manual: { round: number; qty: number } | null;
            items: typeof doc.items;
          }
          const groups = new Map<string, G>();
          for (const i of doc.items) {
            const k = lineKey(i.bin_code, i.material_code, i.batch_number);
            let g = groups.get(k);
            if (!g) {
              g = { book_qty: 0, rounds: [], manual: null, items: [] };
              groups.set(k, g);
            }
            g.items.push(i);
            if (i.round === 1) g.book_qty = i.book_qty;
            if (i.round === 0) {
              if (i.counted_qty !== null) g.manual = { round: 0, qty: i.counted_qty };
            } else {
              g.rounds.push({ round: i.round, counted_qty: i.counted_qty, counted_by: i.counted_by });
            }
          }

          const blocked: string[] = [];
          for (const [k, g] of groups) {
            const v = judgeLine(g.book_qty, g.rounds, g.manual);
            if (v.status === 'NOT_COUNTED') {
              skipped++;
              continue;
            }
            if (v.status === 'UNRESOLVED') {
              blocked.push(k.replace(/\|/g, ' · '));
              continue;
            }
            // Baris pembawa angka final ditandai, dan hanya baris itu yang
            // menghasilkan pergerakan stok.
            const carrier =
              g.items.find((i) => i.round === (v.final_round ?? -99)) ?? g.items[0];
            const diff = (v.final_qty ?? 0) - g.book_qty;
            if (!carrier.posted && diff !== 0) {
              pending.push({ ...carrier, diff_qty: diff });
            }
          }

          if (blocked.length > 0) {
            throw new HttpError(
              400,
              `${blocked.length} baris belum punya angka final. Selesaikan dulu di ZSO02 — buka ronde berikutnya atau tetapkan angkanya. Contoh: ${blocked.slice(0, 3).join('; ')}${blocked.length > 3 ? ' …' : ''}`
            );
          }
        }

        /**
         * TERTUKAR SKU, BUKAN SELISIH.
         *
         * Sebelum satu pun 701/702 dibuat, pasangan yang saling meniadakan
         * dalam satu rak / batch / deskripsi dikeluarkan lebih dulu dan
         * diposting sebagai 309. Urutannya penting: kalau 701/702 dibuat lebih
         * dulu, selisih fabrikasi itu sudah terlanjur masuk jurnal dan statistik
         * akurasi opname, dan tidak ada cara membedakannya dari selisih asli.
         */
        const plan = await planReclass(
          tx,
          pending.map((i) => ({
            id: i.id,
            bin_code: i.bin_code,
            batch_number: i.batch_number,
            material_code: i.material_code,
            diff_qty: i.diff_qty,
          }))
        );
        const reclass = await postReclass(tx, plan.pairs, {
          reference: doc.doc_number,
          user_id: user.username,
        });

        const docs: {
          document_number: string;
          bin_code: string;
          material_code: string;
          batch_number: string | null;
          diff: number;
        }[] = [];

        for (const item of pending) {
          const diff = plan.residual.get(item.id) ?? item.diff_qty;

          // Seluruh selisihnya ternyata tertukar SKU dan sudah direklasifikasi.
          // Barisnya tetap ditutup supaya tidak tertinggal seolah belum digarap.
          if (diff === 0) {
            await tx.physInvDocItem.update({
              where: { id: item.id },
              data: { posted: true, is_final: true },
            });
            continue;
          }

          const movement = diff > 0 ? MovementType.ADJ_701_PLUS : MovementType.ADJ_702_MIN;

          const material = await tx.material.findUnique({
            where: { material_code: item.material_code },
          });
          if (!material) throw new HttpError(400, `Material ${item.material_code} does not exist.`);

          const quant = await tx.stockWM.findFirst({
            where: {
              material_code: item.material_code,
              bin_code: item.bin_code,
              batch_number: item.batch_number,
            },
          });

          // Tanggal quant hasil selisih:
          //   - utamakan yang direkam saat menghitung (baris temuan),
          //   - kalau tidak ada, ikuti quant yang sudah ada di bin itu,
          //   - GR date untuk stok yang baru muncul = tanggal posting opname,
          //     karena dari sudut pandang gudang barang ini "diterima" hari ini.
          const postedAt = new Date();
          await applyStockWM(
            tx,
            {
              material_code: item.material_code,
              bin_code: item.bin_code,
              batch_number: item.batch_number,
            },
            diff,
            {
              mfg_date: item.mfg_date ?? quant?.mfg_date ?? null,
              exp_date: item.exp_date ?? quant?.exp_date ?? null,
              gr_date: quant?.gr_date ?? postedAt,
            }
          );

          await applyStockIM(tx, item.material_code, diff);

          const document_number = await nextDocNumber(tx, 'MATDOC');
          await tx.migoLog.create({
            data: {
              document_number,
              movement_type: movement,
              material_code: item.material_code,
              source_bin: diff > 0 ? null : item.bin_code,
              target_bin: diff > 0 ? item.bin_code : null,
              batch_number: item.batch_number,
              qty: Math.abs(diff),
              uom: material.uom,
              reference: doc.doc_number,
              remarks:
                `Physical inventory clearance (book ${item.book_qty} / counted ${item.counted_qty})` +
                (diff !== item.diff_qty
                  ? ` — sisa setelah reklasifikasi SKU (${item.diff_qty} → ${diff})`
                  : ''),
              doc_date: new Date(),
              user_id: user.username,
            },
          });

          // Baris pembawa angka final ditandai sekaligus sebagai is_final,
          // supaya laporan sesudah posting bisa menunjuk angka mana yang dipakai
          // tanpa perlu menghitung ulang aturan konsensus.
          await tx.physInvDocItem.update({
            where: { id: item.id },
            data: { posted: true, is_final: true },
          });
          docs.push({
            document_number,
            bin_code: item.bin_code,
            material_code: item.material_code,
            batch_number: item.batch_number,
            diff,
          });
        }

        // release semua bin yang di-freeze
        for (const bin_code of fromDbList(doc.frozen_bins)) {
          const agg = await tx.stockWM.aggregate({ where: { bin_code }, _sum: { qty: true } });
          await tx.storageBin.updateMany({
            where: { bin_code },
            data: { status: (agg._sum.qty ?? 0) > 0 ? BinStatus.OCCUPIED : BinStatus.EMPTY },
          });
        }

        await tx.physInvDoc.update({
          where: { id: doc.id },
          data: { status: PhysInvStatus.POSTED, posted_at: new Date() },
        });

        return {
          doc_number: doc.doc_number,
          bins: fromDbList(doc.frozen_bins).length,
          documents: docs,
          reclass,
          managed,
          skipped,
        };
      },
      { timeout: 60000, maxWait: 15000 }
    );

    const n = result.documents.length;
    // Baris yang tidak pernah dihitung sengaja dilaporkan, bukan didiamkan:
    // rak yang terlewat adalah temuan tersendiri, dan tanpa disebut di sini
    // tidak ada yang akan menyadarinya setelah dokumen tertutup.
    const skip = result.skipped > 0 ? `, ${result.skipped} baris tidak pernah dihitung dan dilewati` : '';
    // Reklasifikasi dilaporkan TERPISAH dari selisih. Menjumlahkannya jadi satu
    // angka akan mengembalikan persis kekeliruan yang hendak dihindari: barang
    // yang cuma tertukar kodenya terbaca sebagai masalah akurasi gudang.
    const rc = result.reclass.length;
    const rcMsg =
      rc > 0
        ? `, ${rc} pasang tertukar SKU direklasifikasi lewat 309 (bukan selisih: ` +
          `${result.reclass.map((r) => `${r.from_code}→${r.to_code} ${r.qty}`).join(', ')})`
        : '';
    return ok(
      result,
      n === 0
        ? `Document ${result.doc_number} posted — no differences found, ${result.bins} bin(s) released${rcMsg}${skip}`
        : `Document ${result.doc_number} posted — ${n} difference document(s) created, ${result.bins} bin(s) released${rcMsg}${skip}`
    );
  });
}
