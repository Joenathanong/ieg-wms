import { NextRequest } from 'next/server';
import prisma from '@/lib/prisma';
import { requireUser } from '@/lib/auth';
import { handle, ok, cleanStr, toDate } from '@/lib/api';
import { judgeLine, lineKey, type RoundValue } from '@/lib/consensus';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * GET /api/physinv/dashboard?from=&to=&user=
 *
 * Ringkasan opname yang sedang berjalan: progres tiap petugas terhadap rak yang
 * ditugaskan kepadanya, dan pemilahan temuan.
 *
 * Temuan sengaja dipilah menjadi TIGA angka yang berbeda maknanya:
 *
 *  - selisih stok     : barang yang benar-benar lebih atau kurang
 *  - tertukar batch   : kuantitas yang hanya berpindah antar batch, barangnya utuh
 *  - temuan baru      : material yang sama sekali tidak ada di snapshot
 *
 * Tanpa pemilahan ini, satu kekeliruan batch terhitung dua kali — sekali sebagai
 * kekurangan dan sekali sebagai kelebihan — sehingga akurasi absolut terlihat
 * dua kali lebih buruk daripada kenyataannya. Padahal tidak ada satu barang pun
 * yang hilang; yang bermasalah adalah disiplin pencatatan batch, dan itu risiko
 * FEFO, bukan risiko kehilangan.
 */
export async function GET(req: NextRequest) {
  return handle(async () => {
    await requireUser();
    const sp = req.nextUrl.searchParams;
    const from = toDate(sp.get('from'));
    const to = toDate(sp.get('to'));
    const userFilter = cleanStr(sp.get('user')).toUpperCase();

    const docs = await prisma.physInvDoc.findMany({
      where: {
        AND: [
          from ? { created_at: { gte: from } } : {},
          to ? { created_at: { lte: new Date(to.getTime() + 86_399_000) } } : {},
        ],
      },
      include: { items: true, bins: true, rounds: true },
      orderBy: { created_at: 'desc' },
      take: 100,
    });

    // ---------------- progres per petugas ----------------
    interface Prog {
      username: string;
      assigned: number;
      counted: number;
      docs: Set<string>;
    }
    const progress = new Map<string, Prog>();

    for (const d of docs) {
      for (const b of d.bins) {
        if (!b.assigned_to) continue;
        if (userFilter && b.assigned_to !== userFilter) continue;
        let p = progress.get(b.assigned_to);
        if (!p) {
          p = { username: b.assigned_to, assigned: 0, counted: 0, docs: new Set() };
          progress.set(b.assigned_to, p);
        }
        p.assigned++;
        if (b.counted_at) p.counted++;
        p.docs.add(d.doc_number);
      }
    }

    const counters = [...progress.values()]
      .map((p) => ({
        username: p.username,
        assigned: p.assigned,
        counted: p.counted,
        docs: p.docs.size,
        pct: p.assigned === 0 ? 0 : Math.round((p.counted / p.assigned) * 100),
      }))
      .sort((a, b) => b.assigned - a.assigned);

    // ---------------- temuan, dipilah ----------------
    let diffPlus = 0;
    let diffMinus = 0;
    let swapQty = 0;
    let newFound = 0;
    let linesUnresolved = 0;
    let linesTotal = 0;

    for (const d of docs) {
      interface G {
        book_qty: number;
        rounds: RoundValue[];
        manual: { round: number; qty: number } | null;
        swap: boolean;
        isNew: boolean;
      }
      const groups = new Map<string, G>();
      for (const i of d.items) {
        const k = lineKey(i.bin_code, i.material_code, i.batch_number);
        let g = groups.get(k);
        if (!g) {
          g = { book_qty: 0, rounds: [], manual: null, swap: false, isNew: true };
          groups.set(k, g);
        }
        if (i.round === 1) {
          g.book_qty = i.book_qty;
          g.isNew = false;
        }
        if (i.swap_group) g.swap = true;
        if (i.round === 0) {
          if (i.counted_qty !== null) g.manual = { round: 0, qty: i.counted_qty };
        } else {
          g.rounds.push({ round: i.round, counted_qty: i.counted_qty, counted_by: i.counted_by });
        }
      }

      for (const g of groups.values()) {
        linesTotal++;
        const v = judgeLine(g.book_qty, g.rounds, g.manual);
        if (v.status === 'UNRESOLVED') linesUnresolved++;
        if (v.final_qty === null) continue;
        const diff = v.final_qty - g.book_qty;
        if (diff === 0) continue;

        if (g.swap) {
          // Bagian yang saling menutup dianggap tertukar batch; ini menghitung
          // sisi positifnya saja supaya satu pertukaran tidak dihitung dua kali.
          if (diff > 0) swapQty += diff;
          continue;
        }
        if (g.isNew && diff > 0) {
          newFound += diff;
          continue;
        }
        if (diff > 0) diffPlus += diff;
        else diffMinus += -diff;
      }
    }

    const openDocs = docs.filter((d) => d.status !== 'POSTED');

    return ok(
      {
        doc_count: docs.length,
        open_docs: openDocs.length,
        bins_assigned: counters.reduce((a, c) => a + c.assigned, 0),
        bins_counted: counters.reduce((a, c) => a + c.counted, 0),
        counters,
        rounds_open: openDocs.map((d) => ({
          doc_number: d.doc_number,
          round: d.current_round,
          bins: d.bins.filter((b) => b.round === d.current_round).length,
          counted: d.bins.filter((b) => b.round === d.current_round && b.counted_at !== null).length,
        })),
        findings: {
          diff_plus: diffPlus,
          diff_minus: diffMinus,
          swap_qty: swapQty,
          new_found: newFound,
          lines_total: linesTotal,
          lines_unresolved: linesUnresolved,
        },
      },
      `${docs.length} dokumen opname dalam rentang ini`
    );
  });
}
