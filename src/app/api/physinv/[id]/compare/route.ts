import { NextRequest } from 'next/server';
import prisma from '@/lib/prisma';
import { requireUser, HttpError } from '@/lib/auth';
import { handle, ok } from '@/lib/api';
import { judgeLine, lineKey, type RoundValue } from '@/lib/consensus';
import { fromDbList } from '@/lib/dblist';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

type Ctx = { params: Promise<{ id: string }> };

/** Ronde khusus untuk angka yang ditetapkan supervisor, di luar ronde hitung. */
const MANUAL_ROUND = 0;

/**
 * GET /api/physinv/:id/compare — perbandingan antar ronde.
 *
 * Untuk setiap baris (rak + material + batch) ditampilkan angka tiap ronde
 * beserta penghitungnya, lalu diputuskan nasibnya lewat aturan konsensus di
 * src/lib/consensus.ts.
 *
 * Endpoint ini hanya MEMBACA. Penetapan `is_final` di database dikerjakan saat
 * posting, supaya perbandingan bisa dibuka berkali-kali tanpa mengubah apa pun.
 */
export async function GET(_req: NextRequest, ctx: Ctx) {
  return handle(async () => {
    await requireUser();
    const { id } = await ctx.params;
    const key = decodeURIComponent(id);

    const doc = await prisma.physInvDoc.findFirst({
      where: { OR: [{ id: key }, { doc_number: key }] },
      include: {
        items: { orderBy: [{ bin_code: 'asc' }, { material_code: 'asc' }, { round: 'asc' }] },
        bins: true,
        rounds: { orderBy: { round: 'asc' } },
        assigns: true,
      },
    });
    if (!doc) throw new HttpError(404, 'Physical inventory document does not exist.');

    const materials = await prisma.material.findMany({
      where: { material_code: { in: [...new Set(doc.items.map((i) => i.material_code))] } },
      select: { material_code: true, description: true, uom: true },
    });
    const mMap = new Map(materials.map((m) => [m.material_code, m]));

    // ---- kelompokkan baris per (rak + material + batch) ----
    interface Group {
      bin_code: string;
      material_code: string;
      batch_number: string;
      book_qty: number;
      rounds: RoundValue[];
      manual: { round: number; qty: number } | null;
    }
    const groups = new Map<string, Group>();

    for (const i of doc.items) {
      const k = lineKey(i.bin_code, i.material_code, i.batch_number);
      let g = groups.get(k);
      if (!g) {
        g = {
          bin_code: i.bin_code,
          material_code: i.material_code,
          batch_number: i.batch_number ?? '',
          book_qty: 0,
          rounds: [],
          manual: null,
        };
        groups.set(k, g);
      }
      // book_qty hanya bermakna dari snapshot ronde 1; baris temuan bernilai 0.
      if (i.round === 1) g.book_qty = i.book_qty;
      if (i.round === MANUAL_ROUND) {
        if (i.counted_qty !== null) g.manual = { round: MANUAL_ROUND, qty: i.counted_qty };
        continue;
      }
      g.rounds.push({ round: i.round, counted_qty: i.counted_qty, counted_by: i.counted_by });
    }

    const lines = [...groups.values()]
      .map((g) => {
        const verdict = judgeLine(g.book_qty, g.rounds, g.manual);
        return {
          ...g,
          description: mMap.get(g.material_code)?.description ?? '',
          uom: mMap.get(g.material_code)?.uom ?? 'PC',
          ...verdict,
          diff_qty: verdict.final_qty === null ? null : verdict.final_qty - g.book_qty,
        };
      })
      .sort(
        (a, b) =>
          a.bin_code.localeCompare(b.bin_code, 'id', { numeric: true }) ||
          a.material_code.localeCompare(b.material_code)
      );

    // ---- rak mana yang perlu ronde berikutnya ----
    const binNeeds = new Map<string, number>();
    const matNeeds = new Map<string, number>();
    for (const l of lines) {
      if (!l.needs_recount) continue;
      binNeeds.set(l.bin_code, (binNeeds.get(l.bin_code) ?? 0) + 1);
      matNeeds.set(l.material_code, (matNeeds.get(l.material_code) ?? 0) + 1);
    }

    /**
     * Untuk dokumen bercakupan material, satuan pemilihan ronde berikutnya
     * adalah MATERIAL, bukan rak — karena satu material wajib dikerjakan satu
     * orang di seluruh rak tempat ia berada. Memilih per rak di sini akan
     * membuka jalan bagi material yang sama dipegang dua orang.
     */
    const scopeMaterials = fromDbList(doc.scope_materials);
    const assignsNow = doc.assigns.filter((a) => a.round === doc.current_round);

    const roundInfo = doc.rounds.map((r) => ({
      round: r.round,
      show_book_qty: r.show_book_qty,
      show_prev_round: r.show_prev_round,
      opened_at: r.opened_at,
      opened_by: r.opened_by,
      /** true = ronde ini TIDAK buta, jadi bobot kesepakatannya lebih lemah */
      not_blind: r.show_book_qty,
      bins: doc.bins.filter((b) => b.round === r.round).length,
      counted: doc.bins.filter((b) => b.round === r.round && b.counted_at !== null).length,
    }));

    return ok(
      {
        doc_number: doc.doc_number,
        status: doc.status,
        current_round: doc.current_round,
        rounds: roundInfo,
        lines,
        scope_materials: scopeMaterials,
        by_material: assignsNow.length > 0 || scopeMaterials.length > 0,
        /** penugasan material pada ronde berjalan — dipakai layar sebagai isian awal */
        assigns: assignsNow.map((a) => ({
          material_code: a.material_code,
          assigned_to: a.assigned_to,
        })),
        materials_need_recount: [...matNeeds.entries()]
          .map(([material_code, open_lines]) => ({ material_code, open_lines }))
          .sort((a, b) => b.open_lines - a.open_lines),
        bins_need_recount: [...binNeeds.entries()]
          .map(([bin_code, open_lines]) => ({ bin_code, open_lines }))
          .sort((a, b) => a.bin_code.localeCompare(b.bin_code, 'id', { numeric: true })),
        summary: {
          total: lines.length,
          consensus: lines.filter((l) => l.status === 'CONSENSUS').length,
          settled: lines.filter((l) => l.status === 'SETTLED_NO_DIFF').length,
          manual: lines.filter((l) => l.status === 'MANUAL').length,
          unresolved: lines.filter((l) => l.status === 'UNRESOLVED').length,
          not_counted: lines.filter((l) => l.status === 'NOT_COUNTED').length,
        },
      },
      `Document ${doc.doc_number} — ${lines.length} line(s) across ${doc.rounds.length} round(s)`
    );
  });
}
