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

export interface ResolvedScan {
  ok: boolean;
  material_code: string;
  batch_number: string | null;
  /** deskripsi material bila ditemukan lewat lookup barcode */
  description?: string;
  matched_by?: 'MATERIAL' | 'BPOM' | 'PRODUK' | null;
  message?: string;
}

/**
 * Resolve hasil scan menjadi kode material (+ batch bila compound).
 * Barcode EAN polos di-lookup ke /api/materials/barcode.
 */
export async function resolveScan(raw: string): Promise<ResolvedScan> {
  const p = parseScan(raw);

  if (p.kind === 'EAN') {
    const r = await api<{
      material_code: string;
      description: string;
      matched_by: 'MATERIAL' | 'BPOM' | 'PRODUK';
    }>(
      `/api/materials/barcode?code=${encodeURIComponent(p.material_code)}`
    );
    if (!r.ok || !r.data) {
      return {
        ok: false,
        material_code: p.material_code,
        batch_number: null,
        message: r.message || `${p.material_code} tidak dikenali sebagai kode material maupun barcode (MM01).`,
      };
    }
    return {
      ok: true,
      material_code: r.data.material_code,
      batch_number: null,
      description: r.data.description,
      matched_by: r.data.matched_by,
      message: `${r.data.material_code} — ${r.data.description}`,
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
