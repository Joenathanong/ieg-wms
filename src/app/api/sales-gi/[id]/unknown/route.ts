import { NextRequest } from 'next/server';
import prisma from '@/lib/prisma';
import { requireUser, HttpError } from '@/lib/auth';
import { handle, ok } from '@/lib/api';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

type Ctx = { params: Promise<{ id: string }> };

/**
 * GET /api/sales-gi/:id/unknown — SKU penjualan yang tidak dikenali, BESERTA
 * tebakan material yang paling mungkin dimaksud.
 * =============================================================================
 *
 * Validasi hanya melaporkan JUMLAH yang tidak dikenali. Angka itu tidak bisa
 * dikerjakan: lima puluh SKU harus dibuka satu per satu di MM01 hanya untuk
 * mengetahui bahwa sebagian besar sebenarnya sudah ada, cuma beda satu tanda
 * hubung.
 *
 * Dua kemungkinan yang harus dibedakan, karena penanganannya berlawanan:
 *
 *   PENULISAN — deskripsi yang sama persis setelah spasi dan tanda baca
 *               diabaikan. Ini BUKAN barang baru; materialnya sudah ada di
 *               WMS. Yang perlu dilakukan cuma menyambungkan tulisan versi OCS
 *               ke material itu lewat ALIAS — tanpa mengubah master, tanpa
 *               menyentuh stok, dan bisa dibatalkan.
 *   MIRIP     — sebagian besar katanya sama. Ini TEBAKAN, bukan kesimpulan, dan
 *               harus dilihat manusia sebelum dipakai.
 *
 * Sisanya memang belum ada di WMS dan harus dibuat di MM01.
 *
 * SELURUHNYA DIHITUNG DI MEMORI dari dua query. Menerjemahkan 361 baris satu
 * per satu lewat database berarti lebih dari seribu query untuk satu layar —
 * dan master di sini hanya ribuan baris, cukup kecil untuk dibaca sekali.
 */

/** buang segala yang bukan huruf/angka — yang membedakan hanyalah pemisahnya */
const norm = (t: string) => t.toUpperCase().replace(/[^A-Z0-9]+/g, '');

/** pecah jadi kata, dipakai untuk menilai kemiripan */
const tokens = (t: string) =>
  new Set(
    t
      .toUpperCase()
      .split(/[^A-Z0-9]+/)
      .filter((w) => w.length > 1)
  );

function similarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let hit = 0;
  for (const w of a) if (b.has(w)) hit++;
  // Pembaginya himpunan yang LEBIH KECIL, bukan gabungannya. Deskripsi OCS
  // sering merupakan potongan dari deskripsi WMS (atau sebaliknya); memakai
  // gabungan akan menghukum kecocokan yang justru paling meyakinkan.
  return hit / Math.min(a.size, b.size);
}

export async function GET(_req: NextRequest, ctx: Ctx) {
  return handle(async () => {
    await requireUser();
    const { id } = await ctx.params;

    const run = await prisma.salesGiRun.findUnique({
      where: { id: decodeURIComponent(id) },
      include: { items: { orderBy: { line_no: 'asc' } } },
    });
    if (!run) throw new HttpError(404, 'Proses GI penjualan tidak ditemukan.');

    const [materials, aliases] = await Promise.all([
      prisma.material.findMany({
        where: { is_active: true },
        select: { material_code: true, description: true, kode_ocs: true, uom: true },
      }),
      prisma.materialAlias.findMany({ select: { alias_code: true } }),
    ]);

    const byCode = new Set(materials.map((m) => m.material_code.toUpperCase()));
    const byAlias = new Set(aliases.map((a) => a.alias_code.toUpperCase()));
    const byDesc = new Set(materials.map((m) => m.description.trim().toUpperCase()));
    const byOcs = new Set(
      materials.map((m) => (m.kode_ocs ?? '').trim().toUpperCase()).filter(Boolean)
    );

    /** deskripsi ternormalkan -> material yang memakainya */
    const byNorm = new Map<string, typeof materials>();
    for (const m of materials) {
      const k = norm(m.description);
      if (!k) continue;
      const arr = byNorm.get(k);
      if (arr) arr.push(m);
      else byNorm.set(k, [m]);
    }

    const tokenIndex = materials.map((m) => ({ m, t: tokens(m.description) }));

    const unknown = run.items
      .filter((it) => {
        const raw = it.sku.trim().toUpperCase();
        if (!raw) return true;
        return !byCode.has(raw) && !byAlias.has(raw) && !byDesc.has(raw) && !byOcs.has(raw);
      })
      .map((it) => {
        const raw = it.sku.trim();
        const nk = norm(raw);

        const exact = byNorm.get(nk) ?? [];
        if (exact.length > 0)
          return {
            line_no: it.line_no,
            sku: it.sku,
            qty: it.qty,
            reason: 'PENULISAN' as const,
            suggestions: exact.map((m) => ({
              material_code: m.material_code,
              description: m.description,
              uom: m.uom,
              score: 100,
            })),
          };

        const t = tokens(raw);
        const near = tokenIndex
          .map(({ m, t: mt }) => ({ m, score: Math.round(similarity(t, mt) * 100) }))
          .filter((x) => x.score >= 60)
          .sort((a, b) => b.score - a.score)
          .slice(0, 3);

        return {
          line_no: it.line_no,
          sku: it.sku,
          qty: it.qty,
          reason: near.length > 0 ? ('MIRIP' as const) : ('BARU' as const),
          suggestions: near.map((x) => ({
            material_code: x.m.material_code,
            description: x.m.description,
            uom: x.m.uom,
            score: x.score,
          })),
        };
      });

    const penulisan = unknown.filter((u) => u.reason === 'PENULISAN').length;
    const mirip = unknown.filter((u) => u.reason === 'MIRIP').length;
    const baru = unknown.filter((u) => u.reason === 'BARU').length;

    // Kode alias disimpan di kolom unik VARCHAR(191). Deskripsi OCS yang lebih
    // panjang dari itu tidak bisa dijadikan alias, dan lebih baik diketahui di
    // sini daripada saat tombolnya ditekan.
    const too_long = unknown.filter((u) => u.sku.trim().length > 191).map((u) => u.sku);

    return ok(
      { unknown, penulisan, mirip, baru, too_long },
      unknown.length === 0
        ? 'Semua SKU dikenali.'
        : `${unknown.length} SKU tidak dikenali: ${penulisan} hanya beda penulisan (materialnya ` +
          `sudah ada — cukup pasang alias), ${mirip} mirip dengan material yang ada (perlu ` +
          `dilihat dulu), ${baru} tidak mirip dengan apa pun dan harus dibuat di MM01.`
    );
  });
}
