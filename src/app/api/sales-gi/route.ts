import { NextRequest } from 'next/server';
import prisma from '@/lib/prisma';
import { requireUser, requireWrite, HttpError } from '@/lib/auth';
import { handle, ok, cleanStr, toDate } from '@/lib/api';
import { SalesGiStatus } from '@prisma/client';
import { isSalesGiLocked } from '@/lib/salesgilock';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * GET  /api/sales-gi        — daftar proses GI penjualan (ZGI02)
 * POST /api/sales-gi        — buat proses baru dari baris penjualan (belum diposting)
 *
 * Pemisahan "buat" dan "posting" disengaja. Membuat proses hanya menyimpan
 * angkanya dan menerjemahkan SKU; postingnya berjalan bertahap lewat
 * /api/sales-gi/[id]/post. Dengan begitu file besar tetap bisa diunggah dalam
 * satu permintaan singkat, dan bila postingnya terputus di tengah, yang sudah
 * masuk tidak perlu diulang.
 */

export async function GET(req: NextRequest) {
  return handle(async () => {
    await requireUser();
    const sp = req.nextUrl.searchParams;
    const from = toDate(sp.get('from'));
    const to = toDate(sp.get('to'));
    const status = cleanStr(sp.get('status')).toUpperCase();

    const runs = await prisma.salesGiRun.findMany({
      where: {
        ...(from || to
          ? { sales_date: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } }
          : {}),
        ...(status && status in SalesGiStatus ? { status: status as SalesGiStatus } : {}),
      },
      orderBy: { sales_date: 'desc' },
      take: 200,
    });

    return ok(runs, `${runs.length} proses GI penjualan`);
  });
}

export async function POST(req: NextRequest) {
  return handle(async () => {
    const user = await requireWrite();
    const body = await req.json();

    const sales_date = toDate(body.sales_date);
    if (!sales_date) throw new HttpError(400, 'Tanggal penjualan wajib diisi.');

    // Tanggal disimpan sebagai tanggal murni. Tanpa ini, dua unggahan untuk
    // hari yang sama pada jam berbeda akan lolos sebagai dua proses berbeda —
    // dan stok keluar dua kali.
    const day = new Date(
      Date.UTC(sales_date.getUTCFullYear(), sales_date.getUTCMonth(), sales_date.getUTCDate())
    );

    const source = cleanStr(body.source).toUpperCase() === 'OCS' ? 'OCS' : 'UPLOAD';
    const rawRows = Array.isArray(body.rows) ? body.rows : [];
    if (rawRows.length === 0) throw new HttpError(400, 'Tidak ada baris penjualan.');

    /**
     * Baris pesanan dijumlahkan per SKU lebih dulu.
     *
     * Satu hari bisa berisi ribuan baris pesanan untuk beberapa ratus material.
     * Menyimpan semuanya berarti ribuan baris database yang tidak menambah satu
     * pun keputusan gudang — yang dibutuhkan adalah berapa yang keluar per
     * material, bukan pesanan mana saja.
     */
    const agg = new Map<string, { qty: number; orders: number }>();
    for (const r of rawRows) {
      const sku = cleanStr(r.sku ?? r.material_code ?? r.SKU).toUpperCase();
      if (!sku) continue;
      const qty = Number(String(r.qty ?? r.QTY ?? '').replace(/[, ]/g, '')) || 0;
      if (qty <= 0) continue;
      const cur = agg.get(sku) ?? { qty: 0, orders: 0 };
      agg.set(sku, { qty: cur.qty + Math.trunc(qty), orders: cur.orders + 1 });
    }
    if (agg.size === 0) throw new HttpError(400, 'Tidak ada baris dengan SKU dan quantity yang sah.');

    const rows = [...agg.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    const total_qty = rows.reduce((a, [, v]) => a + v.qty, 0);

    const existing = await prisma.salesGiRun.findUnique({ where: { sales_date: day } });
    if (existing) {
      // Proses yang GAGAL total boleh diulang; yang sudah menyentuh stok tidak.
      if (await isSalesGiLocked(existing.id))
        throw new HttpError(
          409,
          `Tanggal ${day.toISOString().slice(0, 10)} sedang diproses. Tunggu sampai selesai ` +
            `sebelum memuat ulang.`
        );
      /**
       * Syaratnya adalah STOK, bukan status.
       *
       * Sebelumnya proses berstatus FAILED dikecualikan — dengan alasan bahwa
       * FAILED berarti tidak ada yang terposting. Itu benar hari ini karena
       * finalizeSalesGiRun hanya memberi FAILED saat posted_lines nol, tetapi
       * itu kebetulan yang bisa berubah kapan saja oleh perubahan di tempat
       * lain. Dan bila berubah, akibatnya adalah menghapus catatan satu-satunya
       * milik dokumen 601 yang stoknya sudah keluar, lalu memuat ulang hari yang
       * sama dan mengeluarkannya sekali lagi.
       *
       * Angka posted_lines adalah fakta tentang stok. Itulah yang diperiksa.
       */
      if (existing.posted_lines > 0)
        throw new HttpError(
          409,
          `Penjualan tanggal ${day.toISOString().slice(0, 10)} sudah pernah diproses ` +
            `(${existing.status}, ${existing.posted_lines} material terposting, dokumen ` +
            `${existing.document_number ?? '-'}). Buka ZGI02 untuk melihatnya. ` +
            `Memprosesnya lagi akan mengeluarkan stok dua kali.`
        );
      await prisma.salesGiRun.delete({ where: { id: existing.id } });
    }

    const run = await prisma.salesGiRun.create({
      data: {
        sales_date: day,
        source,
        status: SalesGiStatus.PENDING,
        total_lines: rows.length,
        total_qty,
        created_by: user.username,
        items: {
          create: rows.map(([sku, v], i) => ({
            line_no: i + 1,
            sku,
            qty: v.qty,
            order_count: v.orders,
            status: 'PENDING',
          })),
        },
      },
    });

    return ok(
      { id: run.id, sales_date: day, total_lines: rows.length, total_qty },
      `Penjualan ${day.toISOString().slice(0, 10)} dimuat: ${rows.length} material, total ${total_qty} pcs ` +
        `dari ${rawRows.length} baris. Belum ada stok yang berubah — jalankan posting untuk mengeluarkannya.`
    );
  });
}
