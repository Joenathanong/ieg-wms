'use client';

import { api } from './client';

/**
 * Parser barcode PDT.
 *
 * Format yang didukung:
 * 1. Compound dengan separator ';' (jumlah field bebas):
 *      1228050306;D26153;CTN;36.00000;PCS;812601556;N.Co EDP Glacier 100ml x 36 - IEG
 *      1201020711;D26158;CTN;12.00000;PCS;852600153;Hanasui Glow Expert Package 4pack x 12;WH
 *    -> field 1 = kode material, field 2 = batch (langsung dipakai).
 * 2. Barcode EAN/UPC polos (8998824551223)
 *    -> di-lookup ke master data: KODE MATERIAL, barcode B-POM, atau barcode
 *       produk. Kode material yang berupa angka karena itu tetap dikenali.
 * 3. Teks biasa -> dianggap kode material apa adanya.
 */

export interface ParsedScan {
  kind: 'COMPOUND' | 'EAN' | 'PLAIN';
  material_code: string;
  batch_number: string | null;
  raw: string;
}

export function parseScan(raw: string): ParsedScan {
  const s = String(raw ?? '').trim();

  if (s.includes(';')) {
    const parts = s.split(';').map((p) => p.trim());
    return {
      kind: 'COMPOUND',
      material_code: (parts[0] ?? '').toUpperCase(),
      batch_number: (parts[1] ?? '').toUpperCase() || null,
      raw: s,
    };
  }

  if (/^\d{8,14}$/.test(s)) {
    return { kind: 'EAN', material_code: s, batch_number: null, raw: s };
  }

  return { kind: 'PLAIN', material_code: s.toUpperCase(), batch_number: null, raw: s };
}

export type MatchedBy = 'MATERIAL' | 'BPOM' | 'PRODUK' | 'ALIAS';

export interface ResolvedScan {
  ok: boolean;
  material_code: string;
  batch_number: string | null;
  /** deskripsi material bila ditemukan lewat lookup barcode */
  description?: string;
  matched_by?: MatchedBy | null;
  /** kode lama yang discan, bila hasilnya lewat penerjemahan alias */
  alias_of?: string | null;
  message?: string;
}

interface LookupData {
  material_code: string;
  description: string;
  matched_by: MatchedBy;
  alias_of: string | null;
}

function lookup(code: string) {
  return api<LookupData>(`/api/materials/barcode?code=${encodeURIComponent(code)}`);
}

/**
 * Resolve hasil scan menjadi kode material (+ batch bila compound).
 *
 * SEMUA jenis scan di-lookup ke master, bukan hanya EAN polos. Alasannya kode
 * lama: karton yang sudah tercetak tetap membawa kode SKU sebelum penggabungan,
 * dan layar PDT mencari stok dengan pencocokan PERSIS — tanpa diterjemahkan
 * lebih dulu, operator akan melihat "stok tidak ada" padahal barangnya ada di
 * rak.
 */
export async function resolveScan(raw: string): Promise<ResolvedScan> {
  const p = parseScan(raw);
  const r = await lookup(p.material_code);

  if (!r.ok || !r.data) {
    // EAN polos memang tidak berarti apa-apa tanpa master, jadi kegagalannya
    // fatal. Untuk kode yang diketik atau scan compound, kegagalan lookup
    // (mis. jaringan gudang putus sesaat) tidak boleh menghentikan pekerjaan:
    // kode dipakai apa adanya, dan server tetap menerjemahkan alias saat
    // posting sehingga stok tidak mungkin nyasar.
    if (p.kind === 'EAN') {
      return {
        ok: false,
        material_code: p.material_code,
        batch_number: null,
        message:
          r.message ||
          `${p.material_code} tidak dikenali sebagai kode material maupun barcode (MM01).`,
      };
    }
    return {
      ok: true,
      material_code: p.material_code,
      batch_number: p.batch_number,
      message:
        p.kind === 'COMPOUND'
          ? `Scan -> material ${p.material_code}${p.batch_number ? ' / batch ' + p.batch_number : ''}`
          : undefined,
    };
  }

  const d = r.data;
  const batch_number = p.batch_number;
  const tail = batch_number ? ` / batch ${batch_number}` : '';

  return {
    ok: true,
    material_code: d.material_code,
    batch_number,
    description: d.description,
    matched_by: d.matched_by,
    alias_of: d.alias_of,
    message: d.alias_of
      ? `Kode lama ${d.alias_of} dibaca sebagai ${d.material_code} — ${d.description}${tail}`
      : `${d.material_code} — ${d.description}${tail}`,
  };
}
