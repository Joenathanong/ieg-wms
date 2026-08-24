import { NextRequest } from 'next/server';
import prisma from '@/lib/prisma';
import { requireUser } from '@/lib/auth';
import { handle, ok, cleanStr } from '@/lib/api';
import { PhysInvStatus } from '@prisma/client';

export const dynamic = 'force-dynamic';

/**
 * GET /api/physinv/monitor?user=
 *
 * Ringkasan RINGAN untuk layar pantau yang menyegarkan diri tiap menit.
 *
 * Sengaja dipisah dari /api/physinv/dashboard. Endpoint dashboard membaca
 * SELURUH baris item untuk memilah temuan — pada opname besar itu ribuan baris,
 * dan menariknya tiap menit sepanjang hari adalah pemborosan yang nyata pada
 * database yang ditagih per baris terbaca.
 *
 * Yang dibaca di sini hanya tabel rak: jumlahnya ratusan, bukan ribuan, dan
 * hanya untuk dokumen yang belum diposting. Progres — satu-satunya angka yang
 * benar-benar berubah dari menit ke menit — seluruhnya bisa dihitung dari situ.
 * Angka temuan berubah lambat dan tetap diambil dari endpoint yang berat, pada
 * irama yang jauh lebih jarang.
 */
export async function GET(req: NextRequest) {
  return handle(async () => {
    await requireUser();
    const userFilter = cleanStr(req.nextUrl.searchParams.get('user')).toUpperCase();

    const docs = await prisma.physInvDoc.findMany({
      where: { status: { not: PhysInvStatus.POSTED } },
      select: { id: true, doc_number: true, current_round: true, status: true },
      orderBy: { created_at: 'desc' },
      take: 30,
    });

    if (docs.length === 0) {
      return ok(
        { docs: [], counters: [], zones: [], daily: [], totals: { assigned: 0, counted: 0 } },
        'Tidak ada opname yang sedang berjalan'
      );
    }

    const roundOf = new Map(docs.map((d) => [d.id, d.current_round]));

    const bins = await prisma.physInvBin.findMany({
      where: { doc_id: { in: docs.map((d) => d.id) } },
      select: {
        doc_id: true,
        bin_code: true,
        round: true,
        assigned_to: true,
        counted_at: true,
        counted_by: true,
      },
    });
    // Hanya ronde yang sedang berjalan pada tiap dokumen.
    const live = bins.filter((b) => b.round === roundOf.get(b.doc_id));

    const zoneRows = await prisma.storageBin.findMany({
      where: { bin_code: { in: [...new Set(live.map((b) => b.bin_code))] } },
      select: { bin_code: true, zone_id: true },
    });
    const zoneOf = new Map(zoneRows.map((z) => [z.bin_code, z.zone_id]));

    // ---------------- per petugas ----------------
    const byUser = new Map<string, { assigned: number; counted: number }>();
    for (const b of live) {
      if (!b.assigned_to) continue;
      if (userFilter && b.assigned_to !== userFilter) continue;
      const e = byUser.get(b.assigned_to) ?? { assigned: 0, counted: 0 };
      e.assigned++;
      if (b.counted_at) e.counted++;
      byUser.set(b.assigned_to, e);
    }

    // ---------------- per zona ----------------
    const byZone = new Map<string, { assigned: number; counted: number }>();
    for (const b of live) {
      if (userFilter && b.assigned_to !== userFilter) continue;
      const z = zoneOf.get(b.bin_code) ?? '(tanpa zona)';
      const e = byZone.get(z) ?? { assigned: 0, counted: 0 };
      e.assigned++;
      if (b.counted_at) e.counted++;
      byZone.set(z, e);
    }

    // ---------------- per hari ----------------
    const byDay = new Map<string, number>();
    for (const b of live) {
      if (!b.counted_at) continue;
      if (userFilter && b.counted_by !== userFilter) continue;
      const day = b.counted_at.toISOString().slice(0, 10);
      byDay.set(day, (byDay.get(day) ?? 0) + 1);
    }

    const filtered = userFilter ? live.filter((b) => b.assigned_to === userFilter) : live;

    return ok(
      {
        docs: docs.map((d) => {
          const own = live.filter((b) => b.doc_id === d.id);
          return {
            doc_number: d.doc_number,
            round: d.current_round,
            status: d.status,
            assigned: own.length,
            counted: own.filter((b) => b.counted_at).length,
          };
        }),
        counters: [...byUser.entries()]
          .map(([username, v]) => ({
            username,
            ...v,
            pct: v.assigned === 0 ? 0 : Math.round((v.counted / v.assigned) * 100),
          }))
          .sort((a, b) => b.assigned - a.assigned),
        zones: [...byZone.entries()]
          .map(([zone, v]) => ({
            zone,
            ...v,
            pct: v.assigned === 0 ? 0 : Math.round((v.counted / v.assigned) * 100),
          }))
          .sort((a, b) => a.pct - b.pct),
        daily: [...byDay.entries()].map(([day, n]) => ({ day, counted: n })).sort((a, b) => a.day.localeCompare(b.day)),
        totals: {
          assigned: filtered.length,
          counted: filtered.filter((b) => b.counted_at).length,
        },
      },
      `${docs.length} opname berjalan · ${live.length} rak pada ronde aktif`
    );
  });
}
