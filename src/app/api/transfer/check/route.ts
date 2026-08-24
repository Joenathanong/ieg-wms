import { NextRequest } from 'next/server';
import prisma from '@/lib/prisma';
import { requireUser, HttpError } from '@/lib/auth';
import { handle, ok, cleanStr, normBatch } from '@/lib/api';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * POST /api/transfer/check — simulasi bin transfer, TANPA memposting apa pun.
 *
 * Alasannya keberadaannya: POST /api/transfer memposting seluruh line dalam
 * SATU transaksi, sehingga line pertama yang bermasalah membatalkan semuanya
 * dan hanya satu pesan error yang sampai ke layar. Untuk dokumen berisi
 * belasan line, itu berarti petugas memperbaiki satu kesalahan, posting lagi,
 * lalu bertemu kesalahan berikutnya — berulang-ulang.
 *
 * Endpoint ini memeriksa SELURUH line dan mengembalikan semua temuan
 * sekaligus, sehingga bisa diperbaiki dalam sekali jalan. Sifatnya hanya
 * membaca; keputusan akhir tetap ada pada POST /api/transfer, yang memeriksa
 * ulang segalanya di dalam transaksi. Pemeriksaan di sini adalah kenyamanan,
 * BUKAN pengganti pemeriksaan saat posting — stok bisa saja berubah di sela
 * keduanya.
 */

interface LineResult {
  line: number;
  material_code: string;
  batch_number: string;
  source_bin: string;
  target_bin: string;
  qty: number;
  /** stok yang benar-benar tersedia pada material+bin+batch ini */
  available: number;
  status: 'OK' | 'ERROR';
  message?: string;
}

export async function POST(req: NextRequest) {
  return handle(async () => {
    await requireUser();
    const body = await req.json();
    const items = Array.isArray(body.items) ? body.items : [];
    if (items.length === 0) throw new HttpError(400, 'No transfer items were entered.');
    if (items.length > 200) throw new HttpError(400, 'Maximum 200 transfer items per run.');

    /**
     * Beberapa line boleh mengambil dari quant yang sama. Sisa stok karena itu
     * dihitung berjalan: setiap line mengurangi jatah quant yang dipakainya,
     * supaya dua line yang sama-sama mengambil 8 dari stok 10 ketahuan sebagai
     * kekurangan di sini — bukan baru gagal saat posting.
     */
    const consumed = new Map<string, number>();
    const results: LineResult[] = [];

    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      const line = i + 1;
      const material_code = cleanStr(it.material_code).toUpperCase();
      const batch_number = normBatch(it.batch_number);
      const source_bin = cleanStr(it.source_bin).toUpperCase();
      const target_bin = cleanStr(it.target_bin).toUpperCase();
      const qty = Math.trunc(Number(it.qty));

      const base: LineResult = {
        line,
        material_code,
        batch_number: batch_number ?? '',
        source_bin,
        target_bin,
        qty: Number.isFinite(qty) ? qty : 0,
        available: 0,
        status: 'OK',
      };
      const bad = (message: string) => results.push({ ...base, status: 'ERROR', message });

      if (!material_code) { bad('Material belum diisi.'); continue; }
      if (!Number.isFinite(qty) || qty <= 0) { bad('Quantity harus lebih besar dari nol.'); continue; }
      if (!source_bin) { bad('Bin asal belum diisi.'); continue; }
      if (!target_bin) { bad('Bin tujuan belum diisi — isi Fix Bin material di MM01 atau ketik manual.'); continue; }
      if (source_bin === target_bin) { bad('Bin asal dan bin tujuan sama.'); continue; }

      const mat = await prisma.material.findUnique({
        where: { material_code },
        select: { material_code: true, is_batch_managed: true },
      });
      if (!mat) { bad(`Material ${material_code} tidak ada di master data (MM01).`); continue; }
      if (mat.is_batch_managed && !batch_number) { bad(`Material ${material_code} dikelola per batch — batch wajib dipilih.`); continue; }

      const src = await prisma.storageBin.findUnique({
        where: { bin_code: source_bin },
        select: { bin_code: true, status: true },
      });
      if (!src) { bad(`Bin asal ${source_bin} tidak terdaftar (LS01N).`); continue; }
      if (src.status === 'BLOCKED') { bad(`Bin asal ${source_bin} berstatus BLOCKED.`); continue; }

      const dst = await prisma.storageBin.findUnique({
        where: { bin_code: target_bin },
        select: { bin_code: true, status: true },
      });
      if (!dst) { bad(`Bin tujuan ${target_bin} tidak terdaftar (LS01N).`); continue; }
      if (dst.status === 'BLOCKED') { bad(`Bin tujuan ${target_bin} berstatus BLOCKED.`); continue; }

      const quant = await prisma.stockWM.findFirst({
        where: { material_code, bin_code: source_bin, batch_number: batch_number ?? null },
        select: { qty: true },
      });

      const key = `${material_code}|${source_bin}|${batch_number ?? ''}`;
      const already = consumed.get(key) ?? 0;
      const available = (quant?.qty ?? 0) - already;

      if (!quant || quant.qty <= 0) {
        results.push({ ...base, available: 0, status: 'ERROR', message: `Tidak ada stok ${material_code}${batch_number ? ` batch ${batch_number}` : ''} di bin ${source_bin}.` });
        continue;
      }
      if (qty > available) {
        results.push({
          ...base,
          available,
          status: 'ERROR',
          message:
            already > 0
              ? `Kekurangan stok: tersisa ${available} setelah ${already} dipakai line sebelumnya (stok bin ${quant.qty}).`
              : `Kekurangan stok: diminta ${qty}, tersedia ${available} di bin ${source_bin}.`,
        });
        continue;
      }

      consumed.set(key, already + qty);
      results.push({ ...base, available, status: 'OK' });
    }

    const errors = results.filter((r) => r.status === 'ERROR');
    return ok(
      { results, ok_count: results.length - errors.length, error_count: errors.length },
      errors.length === 0
        ? `Simulasi selesai — ${results.length} line siap diposting.`
        : `Simulasi selesai — ${errors.length} dari ${results.length} line bermasalah.`
    );
  });
}
