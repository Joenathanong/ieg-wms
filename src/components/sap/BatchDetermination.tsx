'use client';

import { useCallback, useEffect, useState } from 'react';
import { Layers, X, RefreshCw, PackageSearch } from 'lucide-react';
import { api, qs, fmtDate } from '@/lib/client';

/**
 * Batch Determination ala SAP.
 *
 * Menampilkan batch yang tersedia untuk satu material, diurutkan **FEFO**
 * (expired terdekat lebih dulu; bila ED sama, qty terkecil didahulukan supaya
 * sisa kecil cepat habis — konsisten dengan ZRF08).
 *
 * Dipakai di MIGO: klik ikon pada kolom Batch untuk memilih batch tanpa
 * perlu mengetik atau membuka LX02 di tab lain.
 */

interface Quant {
  id: string;
  material_code: string;
  description: string;
  uom: string;
  batch_number: string;
  mfg_date: string | null;
  exp_date: string | null;
  gr_date: string | null;
  qty: number;
  bin_code: string;
}

export interface BatchProposal {
  batch_number: string;
  exp_date: string | null;
  mfg_date: string | null;
  total_qty: number;
  uom: string;
  /** rincian bin tempat batch ini berada */
  bins: { bin_code: string; qty: number }[];
}

/** Gabungkan quant per batch lalu urutkan FEFO. */
export function proposeBatches(quants: Quant[]): BatchProposal[] {
  const map = new Map<string, BatchProposal>();

  for (const q of quants) {
    const key = q.batch_number || '(tanpa batch)';
    const cur = map.get(key);
    if (cur) {
      cur.total_qty += q.qty;
      cur.bins.push({ bin_code: q.bin_code, qty: q.qty });
      if (!cur.exp_date && q.exp_date) cur.exp_date = q.exp_date;
    } else {
      map.set(key, {
        batch_number: q.batch_number,
        exp_date: q.exp_date,
        mfg_date: q.mfg_date,
        total_qty: q.qty,
        uom: q.uom,
        bins: [{ bin_code: q.bin_code, qty: q.qty }],
      });
    }
  }

  const out = [...map.values()];
  out.forEach((b) => b.bins.sort((x, y) => y.qty - x.qty));
  out.sort((a, b) => {
    const ea = a.exp_date ? new Date(a.exp_date).getTime() : Infinity;
    const eb = b.exp_date ? new Date(b.exp_date).getTime() : Infinity;
    if (ea !== eb) return ea - eb;
    if (a.total_qty !== b.total_qty) return a.total_qty - b.total_qty;
    return a.batch_number.localeCompare(b.batch_number, 'id', { numeric: true });
  });
  return out;
}

/** Kunci pengecualian: satu batch di satu bin. */
export function quantKey(batch_number: string, bin_code: string): string {
  return `${batch_number || '(tanpa batch)'}|${bin_code}`;
}

/**
 * Buang bin yang sudah dipakai di line lain, lalu buang batch yang jadi kosong.
 *
 * Pengecualian dilakukan per batch DI SATU BIN, bukan per batch. Satu batch
 * bisa tersebar di beberapa rak, dan setiap transfer selalu berasal dari satu
 * rak saja — jadi batch yang sudah diambil dari rak A masih sah diambil dari
 * rak B untuk melengkapi kekurangan.
 */
function applyExclude(rows: BatchProposal[], exclude: string[]): BatchProposal[] {
  if (exclude.length === 0) return rows;
  const skip = new Set(exclude);
  return rows
    .map((b) => {
      const bins = b.bins.filter((x) => !skip.has(quantKey(b.batch_number, x.bin_code)));
      return { ...b, bins, total_qty: bins.reduce((a, x) => a + x.qty, 0) };
    })
    .filter((b) => b.bins.length > 0);
}

export function BatchDetermination({
  open,
  material,
  description,
  /** true = ikut menampilkan stok di bin interim (transit) */
  includeInterim = false,
  /** batasi ke kelompok gudang tertentu, mis. 'BESAR' */
  zoneGroup,
  /** daftar kunci batch|bin yang sudah dipakai line lain — lihat quantKey() */
  exclude,
  onPick,
  onClose,
}: {
  open: boolean;
  material: string;
  description?: string;
  includeInterim?: boolean;
  zoneGroup?: string;
  exclude?: string[];
  onPick: (b: BatchProposal) => void;
  onClose: () => void;
}) {
  const [rows, setRows] = useState<BatchProposal[]>([]);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState('');

  // Array baru setiap render akan memicu useCallback terus-menerus; dijadikan
  // string dulu supaya identitas dependensinya stabil.
  const excludeKey = (exclude ?? []).join(',');

  const load = useCallback(async () => {
    if (!material) return;
    setLoading(true);
    setMsg('');
    const r = await api<Quant[]>(
      '/api/stock/quants' +
        qs({ material, exclInterim: includeInterim ? '' : 1, zoneGroup: zoneGroup ?? '' })
    );
    setLoading(false);
    if (!r.ok) {
      setRows([]);
      setMsg(r.message);
      return;
    }
    const proposals = applyExclude(proposeBatches(r.data ?? []), exclude ?? []);
    setRows(proposals);
    if (proposals.length === 0) {
      setMsg(
        (exclude?.length ?? 0) > 0
          ? `Tidak ada sisa batch lain untuk material ${material} — seluruh stok yang tersedia sudah dipakai di line lain.`
          : `Tidak ada stok untuk material ${material}.`
      );
    }
  }, [material, includeInterim, zoneGroup, excludeKey]);

  useEffect(() => {
    if (open) load();
  }, [open, load]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const today = Date.now();

  return (
    <div data-modal className="fixed inset-0 z-[85] flex items-center justify-center p-3">
      <button type="button" aria-label="Tutup" onClick={onClose} className="absolute inset-0 bg-black/50" />

      <div className="relative w-full max-w-[720px] max-h-[85dvh] flex flex-col sap-panel shadow-sap">
        <div className="sap-panel-title">
          <Layers size={13} className="text-sap-blue" />
          <span className="min-w-0 truncate">
            Batch Determination — {material}
            {description ? ` · ${description}` : ''}
          </span>
          <button type="button" onClick={load} title="Muat ulang" className="ml-auto sap-btn sap-btn-ghost !px-1.5 !py-1">
            <RefreshCw size={13} />
          </button>
          <button type="button" onClick={onClose} aria-label="Tutup" className="sap-btn sap-btn-ghost !px-1.5 !py-1">
            <X size={14} />
          </button>
        </div>

        <div className="p-3 overflow-auto">
          {loading && (
            <p className="text-2xs text-sap-muted py-4 text-center">Mencari batch yang tersedia …</p>
          )}

          {!loading && msg && (
            <div className="rounded-[3px] border border-sap-warnborder bg-sap-warnbg text-sap-warntext px-3 py-2 text-2xs">
              {msg}
            </div>
          )}

          {!loading && rows.length > 0 && (
            <table className="sap-grid">
              <thead>
                <tr>
                  <th className="w-[40px] text-center">#</th>
                  <th className="w-[150px]">Batch</th>
                  <th className="w-[110px]">Exp. Date</th>
                  <th className="w-[90px]">Shelf Life</th>
                  <th className="w-[110px] text-right">Tersedia</th>
                  <th>Lokasi (bin · qty)</th>
                  <th className="w-[90px]"></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((b, i) => {
                  const days = b.exp_date
                    ? Math.ceil((new Date(b.exp_date).getTime() - today) / 86400000)
                    : null;
                  const cls =
                    days === null
                      ? 'text-sap-muted'
                      : days < 0
                        ? 'text-sap-errtext font-semibold'
                        : days <= 30
                          ? 'text-sap-warntext font-semibold'
                          : 'text-sap-muted';
                  return (
                    <tr key={b.batch_number || i}>
                      <td className="text-center font-mono text-sap-muted/60">{i + 1}</td>
                      <td className="font-mono">
                        {b.batch_number || <span className="text-sap-muted">(tanpa batch)</span>}
                        {i === 0 && (
                          <span className="ml-1.5 sap-badge border-sap-okborder bg-sap-okbg text-sap-oktext">
                            FEFO
                          </span>
                        )}
                      </td>
                      <td className="font-mono">{fmtDate(b.exp_date) || '—'}</td>
                      <td className={`font-mono ${cls}`}>{days === null ? '—' : `${days} d`}</td>
                      <td className="text-right font-mono tabular-nums">
                        {b.total_qty.toLocaleString('de-DE')} {b.uom}
                      </td>
                      <td className="font-mono text-xxs text-sap-muted truncate">
                        {b.bins.map((x) => `${x.bin_code}·${x.qty}`).join('  ')}
                      </td>
                      <td className="text-center">
                        <button
                          type="button"
                          onClick={() => {
                            onPick(b);
                            onClose();
                          }}
                          className="sap-btn sap-btn-primary !py-[3px] !px-2"
                        >
                          Pilih
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        <div className="px-3 py-2 border-t border-sap-border bg-sap-nav text-xxs text-sap-muted flex items-center gap-1.5">
          <PackageSearch size={12} />
          Urut FEFO — expired terdekat di atas; bila ED sama, qty terkecil didahulukan.
          {!includeInterim && ' Stok di bin transit tidak ditampilkan.'}
        </div>
      </div>
    </div>
  );
}
