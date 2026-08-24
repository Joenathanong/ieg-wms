import { NextRequest } from 'next/server';
import prisma from '@/lib/prisma';
import { requireUser, requireWrite, HttpError } from '@/lib/auth';
import { handle, ok, cleanStr, toDate } from '@/lib/api';
import { nextDocNumber } from '@/lib/docnum';
import { BinStatus, PhysInvStatus } from '@prisma/client';
import { fromDbList, toDbList } from '@/lib/dblist';

/** jumlah bin dari kolom teks — dipakai pada pesan hasil */
const binCountOf = (v: string) => fromDbList(v).length;

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** GET /api/physinv?status=&bin= — daftar dokumen stock opname */
export async function GET(req: NextRequest) {
  return handle(async () => {
    const user = await requireUser();
    const sp = req.nextUrl.searchParams;
    const status = cleanStr(sp.get('status')).toUpperCase();
    const bin = cleanStr(sp.get('bin')).toUpperCase();
    /**
     * '1' = hanya dokumen yang ada jatahnya untuk pemanggil — dipakai ZRF05.
     *
     * Dokumen tanpa penugasan sama sekali tetap ikut tampil: itu dokumen LI01N
     * biasa yang memang boleh dikerjakan siapa saja.
     */
    const mineOnly = sp.get('mine') === '1';

    const docs = await prisma.physInvDoc.findMany({
      where: {
        AND: [
          status && Object.values(PhysInvStatus).includes(status as PhysInvStatus)
            ? { status: status as PhysInvStatus }
            : {},
          bin ? { items: { some: { bin_code: { contains: bin } } } } : {},
        ],
      },
      include: { items: true, bins: true },
      orderBy: { created_at: 'desc' },
      take: 300,
    });

    const visible = mineOnly
      ? docs.filter((d) => {
          const roundBins = d.bins.filter((b) => b.round === d.current_round);
          const assigned = roundBins.filter((b) => !!b.assigned_to);
          if (assigned.length === 0) return true; // dokumen tanpa penugasan
          return assigned.some((b) => b.assigned_to === user.username);
        })
      : docs;

    const rows = visible.map((d) => {
      const roundBins = d.bins.filter((b) => b.round === d.current_round);
      const myBins = mineOnly
        ? roundBins.filter((b) => !b.assigned_to || b.assigned_to === user.username)
        : roundBins;
      return {
      id: d.id,
      doc_number: d.doc_number,
      scope_type: d.scope_type,
      scope_value: d.scope_value,
      bin_count: mineOnly ? myBins.length : fromDbList(d.frozen_bins).length,
      round: d.current_round,
      /** true = dokumen dikelola ZSO01 (ada penugasan pada ronde berjalan) */
      managed: roundBins.some((b) => !!b.assigned_to),
      status: d.status,
      planned_date: d.planned_date,
      counted_at: d.counted_at,
      posted_at: d.posted_at,
      created_by: d.created_by,
      created_at: d.created_at,
      item_count: d.items.length,
      bins_counted: myBins.filter((b) => b.counted_at !== null).length,
      book_total: d.items.reduce((a, i) => a + i.book_qty, 0),
      counted_total: d.items.reduce((a, i) => a + (i.counted_qty ?? 0), 0),
      diff_total: d.items.reduce((a, i) => a + i.diff_qty, 0),
      };
    });

    return ok(rows, `${rows.length} physical inventory document(s) selected`);
  });
}

/**
 * POST /api/physinv — LI01N Create Physical Inventory Document (multi-bin).
 * Body:
 *   { scope_type: 'BIN_LIST', bins: ['A-01-01-1','A-01-02-1'], planned_date? }
 *   { scope_type: 'ZONE',     zone: 'RACK-FAST' }
 *   { scope_type: 'ALL' }
 *
 * Semua bin dalam cakupan di-freeze (BLOCKED) dan snapshot stok direkam
 * sebagai baris dokumen. Satu nomor dokumen memuat banyak baris lintas bin.
 *
 * Bidang OPSIONAL untuk opname terkelola (ZSO01):
 *   assignments: [{ bin_code, assigned_to }]  — petugas per rak
 *   round_options: { show_book_qty, show_prev_round } — pengaturan blind
 *
 * Tanpa keduanya, dokumen berperilaku persis seperti LI01N selama ini: satu
 * ronde, tanpa penugasan, siapa pun boleh menghitung rak mana pun.
 */
export async function POST(req: NextRequest) {
  return handle(async () => {
    const user = await requireWrite();
    const b = await req.json();

    const scope_type = (cleanStr(b.scope_type).toUpperCase() || 'BIN_LIST') as
      | 'BIN_LIST'
      | 'ZONE'
      | 'ALL';

    const result = await prisma.$transaction(
      async (tx) => {
        // ---- tentukan daftar bin dalam cakupan ----
        let bins: { bin_code: string }[] = [];
        let scope_value = '';

        if (scope_type === 'ZONE') {
          const zone = cleanStr(b.zone).toUpperCase();
          if (!zone) throw new HttpError(400, 'Zone is mandatory for scope type ZONE.');
          bins = await tx.storageBin.findMany({
            where: { zone_id: zone, is_interim: false },
            select: { bin_code: true },
            orderBy: { bin_code: 'asc' },
          });
          scope_value = zone;
        } else if (scope_type === 'ALL') {
          bins = await tx.storageBin.findMany({
            where: { is_interim: false },
            select: { bin_code: true },
            orderBy: { bin_code: 'asc' },
          });
          scope_value = 'ALL STORAGE BINS';
        } else {
          const list: string[] = (Array.isArray(b.bins) ? b.bins : [])
            .map((x: unknown) => cleanStr(x).toUpperCase())
            .filter(Boolean);
          if (list.length === 0) throw new HttpError(400, 'At least one storage bin must be selected.');
          bins = await tx.storageBin.findMany({
            where: { bin_code: { in: list } },
            select: { bin_code: true },
            orderBy: { bin_code: 'asc' },
          });
          const missing = list.filter((c) => !bins.some((x) => x.bin_code === c));
          if (missing.length > 0)
            throw new HttpError(400, `Storage bin ${missing.join(', ')} does not exist (LS01N).`);
          scope_value = list.join(', ');
        }

        if (bins.length === 0) throw new HttpError(400, 'No storage bin found for the selected scope.');
        if (bins.length > 500) throw new HttpError(400, 'Maximum 500 storage bins per physical inventory document.');

        const binCodes = bins.map((x) => x.bin_code);

        // ---- pastikan tidak ada dokumen lain yang masih terbuka untuk bin ini ----
        const open = await tx.physInvDoc.findMany({
          where: {
            status: { in: [PhysInvStatus.CREATED, PhysInvStatus.FROZEN, PhysInvStatus.COUNTED] },
          },
          select: { doc_number: true, frozen_bins: true },
        });
        for (const o of open) {
          const clash = fromDbList(o.frozen_bins).filter((x) => binCodes.includes(x));
          if (clash.length > 0)
            throw new HttpError(
              400,
              `Document ${o.doc_number} is still open for bin ${clash.slice(0, 5).join(', ')}${clash.length > 5 ? ' …' : ''}.`
            );
        }

        // ---- snapshot stok ----
        const quants = await tx.stockWM.findMany({
          where: { bin_code: { in: binCodes } },
          orderBy: [{ bin_code: 'asc' }, { material_code: 'asc' }],
        });

        // ---- penugasan per rak (opsional) ----
        const rawAssign: { bin_code: string; assigned_to: string }[] = Array.isArray(b.assignments)
          ? b.assignments
              .map((a: { bin_code?: unknown; assigned_to?: unknown }) => ({
                bin_code: cleanStr(a?.bin_code).toUpperCase(),
                assigned_to: cleanStr(a?.assigned_to).toUpperCase(),
              }))
              .filter((a: { bin_code: string; assigned_to: string }) => a.bin_code && a.assigned_to)
          : [];

        const assignOf = new Map(rawAssign.map((a) => [a.bin_code, a.assigned_to]));

        for (const code of assignOf.keys()) {
          if (!binCodes.includes(code))
            throw new HttpError(400, `Storage bin ${code} is not part of this document.`);
        }

        if (assignOf.size > 0) {
          // Petugas harus benar-benar ada dan aktif: penugasan ke username yang
          // salah ketik akan menghasilkan rak yang tidak muncul di PDT siapa pun,
          // dan itu baru ketahuan saat opname sudah berjalan.
          const names = [...new Set(assignOf.values())];
          const users = await tx.user.findMany({
            where: { username: { in: names } },
            select: { username: true, is_active: true },
          });
          for (const n of names) {
            const u = users.find((x) => x.username === n);
            if (!u) throw new HttpError(400, `User ${n} does not exist (SU01).`);
            if (!u.is_active) throw new HttpError(400, `User ${n} is locked.`);
          }
        }

        const roundOpts = (b.round_options ?? {}) as {
          show_book_qty?: unknown;
          show_prev_round?: unknown;
        };

        const doc_number = await nextDocNumber(tx, 'PIDOC');
        const doc = await tx.physInvDoc.create({
          data: {
            doc_number,
            scope_type,
            scope_value: scope_value.slice(0, 500),
            frozen_bins: toDbList(binCodes),
            status: PhysInvStatus.FROZEN,
            planned_date: toDate(b.planned_date) ?? new Date(),
            created_by: user.username,
            items: {
              create: quants.map((q) => ({
                bin_code: q.bin_code,
                round: 1,
                material_code: q.material_code,
                batch_number: q.batch_number,
                book_qty: q.qty,
                counted_qty: null,
                diff_qty: 0,
              })),
            },
            // satu baris status per bin — dipakai penghitung paralel untuk tahu
            // rak mana yang belum tersentuh, termasuk rak yang memang kosong
            bins: {
              create: binCodes.map((bin_code) => ({
                bin_code,
                round: 1,
                assigned_to: assignOf.get(bin_code) ?? null,
              })),
            },
            // Ronde 1 selalu dibuat, juga untuk dokumen LI01N biasa — supaya
            // pengaturan blind punya satu tempat tetap dan layar hitung tidak
            // perlu menangani kasus "dokumen tanpa ronde".
            rounds: {
              create: [
                {
                  round: 1,
                  show_book_qty: roundOpts.show_book_qty === true,
                  show_prev_round: roundOpts.show_prev_round === true,
                  opened_by: user.username,
                },
              ],
            },
          },
          include: { items: true, bins: true, rounds: true },
        });

        // ---- freeze semua bin ----
        await tx.storageBin.updateMany({
          where: { bin_code: { in: binCodes } },
          data: { status: BinStatus.BLOCKED },
        });

        return doc;
      },
      { timeout: 30000, maxWait: 10000 }
    );

    return ok(
      { ...result, frozen_bins: fromDbList(result.frozen_bins) },
      `Physical inventory document ${result.doc_number} created — ${binCountOf(result.frozen_bins)} bin(s) frozen, ${result.items.length} line(s) snapshot`
    );
  });
}
