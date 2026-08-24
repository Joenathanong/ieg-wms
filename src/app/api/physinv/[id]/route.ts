import { NextRequest } from 'next/server';
import prisma from '@/lib/prisma';
import { requireUser, requireWrite, HttpError } from '@/lib/auth';
import { handle, ok, cleanStr, toInt, toDate, normBatch } from '@/lib/api';
import { BinStatus, PhysInvStatus } from '@prisma/client';
import { fromDbList, toDbList } from '@/lib/dblist';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

type Ctx = { params: Promise<{ id: string }> };

async function findDoc(idOrNumber: string) {
  const key = decodeURIComponent(idOrNumber);
  return prisma.physInvDoc.findFirst({
    where: { OR: [{ id: key }, { doc_number: key }] },
    include: {
      items: { orderBy: [{ bin_code: 'asc' }, { material_code: 'asc' }] },
      bins: { orderBy: { bin_code: 'asc' } },
      rounds: { orderBy: { round: 'asc' } },
    },
  });
}

/** GET /api/physinv/:id — detail dokumen + seluruh baris (lintas bin) */
export async function GET(req: NextRequest, ctx: Ctx) {
  return handle(async () => {
    const user = await requireUser();
    const { id } = await ctx.params;
    /** '1' = hanya rak yang ditugaskan ke pemanggil (dipakai PDT / ZRF05) */
    const mineOnly = req.nextUrl.searchParams.get('mine') === '1';
    const doc = await findDoc(id);
    if (!doc) throw new HttpError(404, 'Physical inventory document does not exist.');

    const round = doc.current_round;
    const roundRow = doc.rounds.find((r) => r.round === round) ?? null;

    // Rak pada ronde yang sedang berjalan. Ronde lama tetap tersimpan tetapi
    // tidak ditampilkan di layar hitung — hanya dipakai layar perbandingan.
    const binsThisRound = doc.bins.filter((b) => b.round === round);

    /**
     * Penyaringan penugasan.
     *
     * Rak tanpa penugasan tetap terlihat semua orang — itu perilaku LI01N yang
     * lama dan sengaja dipertahankan. Yang disaring hanya rak yang memang sudah
     * bertuan, supaya hitungan ronde berikutnya bisa dijamin dikerjakan orang
     * yang berbeda.
     */
    const visibleBins = mineOnly
      ? binsThisRound.filter((b) => !b.assigned_to || b.assigned_to === user.username)
      : binsThisRound;
    const visibleCodes = new Set(visibleBins.map((b) => b.bin_code));

    /**
     * Blind counting. Bila ronde ini buta, jumlah menurut sistem TIDAK dikirim
     * ke layar — bukan sekadar disembunyikan lewat CSS, karena angka yang
     * terkirim tetap bisa dilihat siapa pun yang membuka panel jaringan.
     *
     * ADMIN dikecualikan: mereka meninjau di desktop, bukan menghitung.
     */
    const hideBook = !!roundRow && !roundRow.show_book_qty && user.role !== 'ADMIN';

    const materials = await prisma.material.findMany({
      where: { material_code: { in: doc.items.map((i) => i.material_code) } },
      select: { material_code: true, description: true, uom: true },
    });
    const mMap = new Map(materials.map((m) => [m.material_code, m]));

    // Baris snapshot menyimpan qty saja; shelf life-nya ada di quant. Diambil
    // supaya layar counting bisa menampilkan Exp/Mfg date apa adanya.
    const quants = await prisma.stockWM.findMany({
      where: { bin_code: { in: fromDbList(doc.frozen_bins) } },
      select: { material_code: true, bin_code: true, batch_number: true, mfg_date: true, exp_date: true },
    });
    const qKey = (m: string, b: string, batch: string | null) => `${m}|${b}|${batch ?? ''}`;
    const qMap = new Map(quants.map((q) => [qKey(q.material_code, q.bin_code, q.batch_number), q]));

    const visibleItems = doc.items
      .filter((i) => i.round === round && (!mineOnly || visibleCodes.has(i.bin_code)))
      .map((i) => {
        const q = qMap.get(qKey(i.material_code, i.bin_code, i.batch_number));
        return {
          ...i,
          book_qty: hideBook ? 0 : i.book_qty,
          diff_qty: hideBook ? 0 : i.diff_qty,
          mfg_date: i.mfg_date ?? q?.mfg_date ?? null,
          exp_date: i.exp_date ?? q?.exp_date ?? null,
          description: mMap.get(i.material_code)?.description ?? '',
          uom: mMap.get(i.material_code)?.uom ?? 'PC',
        };
      });

    return ok(
      {
        ...doc,
        // kolomnya teks di database, tetapi API selalu memberi array
        frozen_bins: mineOnly ? [...visibleCodes] : fromDbList(doc.frozen_bins),
        round,
        /** true = layar TIDAK boleh menampilkan jumlah menurut sistem */
        blind_book: hideBook,
        /** true = dokumen ini dikelola ZSO01 (ada penugasan) */
        managed: binsThisRound.some((b) => !!b.assigned_to),
        bins: visibleBins,
        items: visibleItems,
      },
      `Document ${doc.doc_number} displayed — ${visibleItems.length} line(s) across ${visibleBins.length} bin(s)`
    );
  });
}

/**
 * PATCH /api/physinv/:id — LI11N Enter Count Result (multi-line).
 * Body: { items: [{ id?, bin_code, material_code, batch_number?, counted_qty }] }
 * Baris yang tidak ada di snapshot (barang ditemukan di bin) otomatis ditambahkan.
 */
export async function PATCH(req: NextRequest, ctx: Ctx) {
  return handle(async () => {
    const user = await requireWrite();
    const { id } = await ctx.params;
    const b = await req.json();
    const items = Array.isArray(b.items) ? b.items : [];
    /** bin yang dinyatakan selesai dihitung — termasuk bin yang ternyata kosong */
    const countedBins: string[] = (Array.isArray(b.counted_bins) ? b.counted_bins : [])
      .map((x: unknown) => cleanStr(x).toUpperCase())
      .filter(Boolean);

    if (items.length === 0 && countedBins.length === 0)
      throw new HttpError(400, 'No count results were entered.');
    if (items.length > 500) throw new HttpError(400, 'Maximum 500 count lines per request.');

    const doc = await prisma.$transaction(
      async (tx) => {
        const d = await tx.physInvDoc.findFirst({
          where: { OR: [{ id: decodeURIComponent(id) }, { doc_number: decodeURIComponent(id) }] },
          include: { items: true, bins: true },
        });
        if (!d) throw new HttpError(404, 'Physical inventory document does not exist.');
        if (d.status === PhysInvStatus.POSTED)
          throw new HttpError(400, `Document ${d.doc_number} is already posted.`);

        const round = d.current_round;
        const roundBins = d.bins.filter((x) => x.round === round);

        /**
         * Rak yang bertuan hanya boleh dihitung oleh pemiliknya.
         *
         * Ini bukan sekadar tata tertib. Aturan konsensus menyatakan sebuah
         * angka sah ketika dua ronde sepakat — dan itu hanya bermakna bila
         * kedua ronde dikerjakan orang berbeda. Kalau siapa pun boleh
         * menghitung rak siapa pun, dua hitungan yang tampak independen bisa
         * berasal dari tangan yang sama.
         *
         * Jalan keluar bila petugasnya berhalangan adalah MENUGASKAN ULANG di
         * ZSO01, bukan menembus dari layar hitung — supaya perubahannya
         * tercatat.
         */
        const owner = new Map(roundBins.map((x) => [x.bin_code, x.assigned_to]));
        function assertMine(bin_code: string) {
          const who = owner.get(bin_code);
          if (!who || who === user.username) return;
          throw new HttpError(
            403,
            `Rak ${bin_code} ditugaskan ke ${who} pada ronde ${round}. Minta admin menugaskan ulang di ZSO01 bila perlu.`
          );
        }

        for (const raw of items) {
          const counted = toInt(raw.counted_qty ?? 0, 'counted quantity');
          if (counted < 0) throw new HttpError(400, 'Counted quantity cannot be negative.');

          const material_code = cleanStr(raw.material_code).toUpperCase();
          const bin_code = cleanStr(raw.bin_code).toUpperCase();
          const batch_number = normBatch(raw.batch_number);

          if (bin_code) assertMine(bin_code);

          const existing = raw.id
            ? d.items.find((i) => i.id === raw.id)
            : d.items.find(
                (i) =>
                  i.material_code === material_code &&
                  i.bin_code === bin_code &&
                  i.batch_number === batch_number
              );

          if (existing) {
            await tx.physInvDocItem.update({
              where: { id: existing.id },
              data: {
                counted_qty: counted,
                counted_by: user.username,
                diff_qty: counted - existing.book_qty,
                ...(raw.mfg_date !== undefined ? { mfg_date: toDate(raw.mfg_date) } : {}),
                ...(raw.exp_date !== undefined ? { exp_date: toDate(raw.exp_date) } : {}),
              },
            });
          } else {
            if (!material_code) throw new HttpError(400, 'Material number is mandatory for new count item.');
            if (!bin_code) throw new HttpError(400, 'Storage bin is mandatory for new count item.');
            if (!fromDbList(d.frozen_bins).includes(bin_code))
              throw new HttpError(400, `Bin ${bin_code} is not part of document ${d.doc_number}.`);

            const mat = await tx.material.findUnique({ where: { material_code } });
            if (!mat) throw new HttpError(400, `Material ${material_code} does not exist in master data.`);
            if (mat.is_batch_managed && !batch_number)
              throw new HttpError(400, `Material ${material_code} is batch managed. Batch is mandatory.`);

            // Batch temuan belum punya quant pembanding, jadi tanggalnya harus
            // ikut disimpan di sini supaya posting 701 nanti menghasilkan quant
            // dengan shelf life yang benar (FEFO).
            await tx.physInvDocItem.create({
              data: {
                doc_id: d.id,
                bin_code,
                material_code,
                batch_number: mat.is_batch_managed ? batch_number : null,
                mfg_date: toDate(raw.mfg_date),
                exp_date: toDate(raw.exp_date),
                book_qty: 0,
                counted_qty: counted,
                diff_qty: counted,
                round,
                counted_by: user.username,
              },
            });
          }
        }

        // ---- tandai bin yang selesai dihitung ----
        // Sebuah bin dianggap selesai bila operator menyatakannya (tombol
        // "selesai" / "bin kosong" di ZRF05) ATAU seluruh barisnya sudah terisi.
        for (const c of countedBins) assertMine(c);

        const fresh = await tx.physInvDocItem.findMany({ where: { doc_id: d.id, round } });
        const byBin = new Map<string, { total: number; filled: number }>();
        for (const i of fresh) {
          const e = byBin.get(i.bin_code) ?? { total: 0, filled: 0 };
          e.total++;
          if (i.counted_qty !== null) e.filled++;
          byBin.set(i.bin_code, e);
        }

        const frozen = fromDbList(d.frozen_bins);
        const done = new Set(countedBins.filter((c) => frozen.includes(c)));
        for (const [bin, e] of byBin) {
          if (e.total > 0 && e.total === e.filled) done.add(bin);
        }

        if (done.size > 0) {
          await tx.physInvBin.updateMany({
            where: { doc_id: d.id, round, bin_code: { in: [...done] }, counted_at: null },
            data: { counted_at: new Date(), counted_by: user.username },
          });
        }

        return tx.physInvDoc.update({
          where: { id: d.id },
          data: { status: PhysInvStatus.COUNTED, counted_at: new Date() },
          include: { items: true, bins: true },
        });
      },
      { timeout: 30000, maxWait: 10000 }
    );

    const diff = doc.items.reduce((a, i) => a + i.diff_qty, 0);
    const counted = doc.items.filter((i) => i.counted_qty !== null).length;
    const binsDone = doc.bins.filter((x) => x.counted_at !== null).length;
    return ok(
      { ...doc, frozen_bins: fromDbList(doc.frozen_bins) },
      `Count saved for ${doc.doc_number} — ${binsDone}/${doc.bins.length} bin(s) done, ` +
        `${counted}/${doc.items.length} line(s) counted, net difference ${diff > 0 ? '+' : ''}${diff}`
    );
  });
}

/** DELETE /api/physinv/:id — batalkan dokumen & release semua bin */
export async function DELETE(_req: NextRequest, ctx: Ctx) {
  return handle(async () => {
    await requireWrite();
    const { id } = await ctx.params;

    const doc = await prisma.$transaction(async (tx) => {
      const d = await tx.physInvDoc.findFirst({
        where: { OR: [{ id: decodeURIComponent(id) }, { doc_number: decodeURIComponent(id) }] },
      });
      if (!d) throw new HttpError(404, 'Physical inventory document does not exist.');
      if (d.status === PhysInvStatus.POSTED)
        throw new HttpError(400, 'Posted document cannot be deleted.');

      await tx.physInvDoc.delete({ where: { id: d.id } });

      // release semua bin sesuai stok aktual
      for (const bin_code of fromDbList(d.frozen_bins)) {
        const agg = await tx.stockWM.aggregate({ where: { bin_code }, _sum: { qty: true } });
        await tx.storageBin.updateMany({
          where: { bin_code },
          data: { status: (agg._sum.qty ?? 0) > 0 ? BinStatus.OCCUPIED : BinStatus.EMPTY },
        });
      }
      return d;
    }, { timeout: 30000, maxWait: 10000 });

    return ok(
      { id: doc.id },
      `Document ${doc.doc_number} deleted — ${fromDbList(doc.frozen_bins).length} bin(s) released`
    );
  });
}
