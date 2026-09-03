'use client';

/**
 * ZGI02 — Monitor Goods Issue Penjualan (desktop).
 *
 * Menjawab tiga pertanyaan yang muncul setiap pagi:
 *   1. Apakah proses semalam berjalan? — daftar proses per tanggal beserta
 *      statusnya, termasuk tanggal yang TIDAK ada prosesnya sama sekali.
 *   2. Apa yang berhasil dan apa yang tidak? — rincian per material dengan
 *      alasan kegagalannya, bisa diekspor.
 *   3. Berapa yang menggantung? — saldo minus Gudang Kecil beserta umurnya.
 *
 * Pertanyaan ketiga yang paling mudah terlupa dan paling mahal akibatnya:
 * saldo minus hanya impas kalau replenishment-nya benar-benar diposting.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  Activity,
  RefreshCw,
  Download,
  TrendingDown,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Clock,
} from 'lucide-react';
import { Panel, Button, Toolbar, Separator, exportCsv, type Column } from '@/components/sap/ui';
import { useStatus } from '@/components/sap/StatusBar';
import { useExecuteKey } from '@/components/sap/keynav';
import { api, fmtDate, fmtDateTime } from '@/lib/client';

interface Run {
  id: string;
  sales_date: string;
  source: string;
  status: 'PENDING' | 'RUNNING' | 'DONE' | 'PARTIAL' | 'FAILED';
  document_number: string | null;
  total_lines: number;
  posted_lines: number;
  failed_lines: number;
  total_qty: number;
  posted_qty: number;
  short_qty: number;
  error: string | null;
  finished_at: string | null;
  created_by: string;
  created_at: string;
}

interface RunItem {
  line_no: number;
  sku: string;
  material_code: string | null;
  description: string;
  uom: string;
  qty: number;
  order_count: number;
  status: string;
  message: string | null;
  picked: string | null;
  short_qty: number;
}

interface Negative {
  id: string;
  material_code: string;
  description: string;
  uom: string;
  no_fix_bin: boolean;
  bin_code: string;
  zone_id: string;
  batch_number: string | null;
  shortage: number;
  age_days: number;
  updated_at: string;
}

const nf = (n: number) => n.toLocaleString('de-DE');

const BADGE: Record<Run['status'], string> = {
  DONE: 'border-sap-okborder bg-sap-okbg text-sap-oktext',
  PARTIAL: 'border-sap-warnborder bg-sap-warnbg text-sap-warntext',
  FAILED: 'border-sap-errborder bg-sap-errbg text-sap-errtext',
  RUNNING: 'border-sap-infoborder bg-sap-infobg text-sap-infotext',
  PENDING: 'border-sap-neutralborder bg-sap-neutralbg text-sap-muted',
};

export default function Zgi02Page() {
  const { setStatus } = useStatus();
  const [runs, setRuns] = useState<Run[]>([]);
  const [items, setItems] = useState<RunItem[] | null>(null);
  const [openRun, setOpenRun] = useState<Run | null>(null);
  const [negatives, setNegatives] = useState<Negative[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingNeg, setLoadingNeg] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const r = await api<Run[]>('/api/sales-gi');
    setLoading(false);
    if (!r.ok) return setStatus(r.message, 'E');
    setRuns(r.data ?? []);
    setStatus(r.message, (r.data?.length ?? 0) > 0 ? 'S' : 'W');
  }, [setStatus]);

  useExecuteKey(load);
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function openDetail(run: Run) {
    setOpenRun(run);
    setItems(null);
    const r = await api<{ items: RunItem[] }>(`/api/sales-gi/${run.id}`);
    if (r.ok && r.data) setItems(r.data.items);
    else setStatus(r.message, 'E');
  }

  async function loadNegatives() {
    setLoadingNeg(true);
    const r = await api<{ rows: Negative[]; total_qty: number }>('/api/sales-gi/negatives');
    setLoadingNeg(false);
    setStatus(r.message, r.ok ? (r.data?.rows.length ? 'W' : 'S') : 'E');
    if (r.ok && r.data) setNegatives(r.data.rows);
  }

  /**
   * Tanggal yang TIDAK punya proses sama sekali.
   *
   * Ini yang paling penting dan paling mudah luput: proses yang gagal terlihat
   * merah, tetapi proses yang tidak pernah jalan tidak meninggalkan baris apa
   * pun — layarnya terlihat bersih justru saat ada yang salah.
   */
  const missingDates = (() => {
    if (runs.length === 0) return [];
    const have = new Set(runs.map((r) => r.sales_date.slice(0, 10)));
    const out: string[] = [];
    const newest = new Date(runs[0].sales_date);
    const oldest = new Date(runs[runs.length - 1].sales_date);
    for (let d = new Date(oldest); d <= newest; d.setUTCDate(d.getUTCDate() + 1)) {
      const iso = d.toISOString().slice(0, 10);
      if (!have.has(iso)) out.push(iso);
    }
    return out;
  })();

  function exportItems() {
    if (!items || !openRun) return;
    const cols: Column<RunItem>[] = [
      { key: 'line_no', header: 'Baris' },
      { key: 'sku', header: 'SKU' },
      { key: 'material_code', header: 'Material' },
      { key: 'description', header: 'Deskripsi' },
      { key: 'qty', header: 'Qty' },
      { key: 'order_count', header: 'Jml Pesanan' },
      { key: 'status', header: 'Status' },
      { key: 'short_qty', header: 'Minus' },
      { key: 'picked', header: 'Pengambilan' },
      { key: 'message', header: 'Keterangan' },
    ];
    exportCsv(`gi-penjualan-${openRun.sales_date.slice(0, 10)}.csv`, cols, items);
    setStatus(`${items.length} baris diekspor`, 'S');
  }

  return (
    <div className="space-y-3">
      <Panel
        title="ZGI02 — Monitor Goods Issue Penjualan"
        icon={<Activity size={13} className="text-sap-blue" />}
        bodyClassName="p-0"
        actions={
          <>
            <Button onClick={load} loading={loading}>
              <RefreshCw size={12} /> Muat ulang
            </Button>
            <Button onClick={loadNegatives} loading={loadingNeg}>
              <TrendingDown size={12} /> Saldo minus
            </Button>
          </>
        }
      >
        {missingDates.length > 0 && (
          <div className="p-3 border-b border-sap-border bg-sap-warnbg/40">
            <p className="text-2xs text-sap-warntext flex items-start gap-1.5">
              <AlertTriangle size={12} className="mt-[2px] shrink-0" />
              <span>
                <b>{missingDates.length} tanggal tidak punya proses sama sekali</b> di rentang yang
                sudah terisi: {missingDates.slice(0, 10).join(', ')}
                {missingDates.length > 10 ? ` … +${missingDates.length - 10}` : ''}. Proses yang
                gagal terlihat merah; yang tidak pernah jalan tidak meninggalkan jejak apa pun —
                periksa apakah memang tidak ada penjualan, atau job-nya yang tidak berjalan.
              </span>
            </p>
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="sap-grid">
            <thead>
              <tr>
                <th className="w-[110px]">Tgl. Penjualan</th>
                <th className="w-[90px]">Status</th>
                <th className="w-[80px]">Sumber</th>
                <th className="w-[140px]">Material Doc.</th>
                <th className="w-[90px] text-right">Material</th>
                <th className="w-[80px] text-right">Berhasil</th>
                <th className="w-[70px] text-right">Gagal</th>
                <th className="w-[90px] text-right">Total Qty</th>
                <th className="w-[90px] text-right">Minus</th>
                <th className="w-[150px]">Selesai</th>
                <th className="w-[110px]">Oleh</th>
              </tr>
            </thead>
            <tbody>
              {runs.length === 0 && !loading && (
                <tr>
                  <td colSpan={11} className="text-center text-sap-muted py-4">
                    Belum ada proses GI penjualan.
                  </td>
                </tr>
              )}
              {runs.map((r) => (
                <tr
                  key={r.id}
                  className="cursor-pointer"
                  onClick={() => openDetail(r)}
                  title="Klik untuk melihat rinciannya"
                >
                  <td className="font-mono">{fmtDate(r.sales_date)}</td>
                  <td>
                    <span className={`sap-badge ${BADGE[r.status]}`}>{r.status}</span>
                  </td>
                  <td className="font-mono text-sap-muted">{r.source}</td>
                  <td className="font-mono text-sap-oktext">{r.document_number ?? '—'}</td>
                  <td className="text-right font-mono tabular-nums">{r.total_lines}</td>
                  <td className="text-right font-mono tabular-nums text-sap-oktext">
                    {r.posted_lines}
                  </td>
                  <td className="text-right font-mono tabular-nums">
                    {r.failed_lines > 0 ? (
                      <span className="text-sap-errtext">{r.failed_lines}</span>
                    ) : (
                      '0'
                    )}
                  </td>
                  <td className="text-right font-mono tabular-nums">{nf(r.total_qty)}</td>
                  <td className="text-right font-mono tabular-nums">
                    {r.short_qty > 0 ? (
                      <span className="text-sap-warntext">{nf(r.short_qty)}</span>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="font-mono text-xxs text-sap-muted">
                    {r.finished_at ? fmtDateTime(r.finished_at) : '—'}
                  </td>
                  <td className="font-mono text-xxs text-sap-muted">{r.created_by}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      {openRun && (
        <Panel
          title={`Rincian ${fmtDate(openRun.sales_date)} — dokumen ${openRun.document_number ?? '(belum diposting)'}`}
          icon={
            openRun.failed_lines === 0 ? (
              <CheckCircle2 size={13} className="text-sap-oktext" />
            ) : (
              <XCircle size={13} className="text-sap-errtext" />
            )
          }
          bodyClassName="p-0"
          actions={
            <>
              <Button onClick={exportItems} disabled={!items?.length}>
                <Download size={12} /> Export CSV
              </Button>
              <Button onClick={() => setOpenRun(null)}>Tutup</Button>
            </>
          }
        >
          {openRun.error && (
            <p className="p-3 text-2xs text-sap-errtext border-b border-sap-border">
              {openRun.error}
            </p>
          )}
          {!items ? (
            <p className="p-3 text-2xs text-sap-muted">Memuat rincian…</p>
          ) : (
            <div className="overflow-x-auto max-h-[420px]">
              <table className="sap-grid">
                <thead>
                  <tr>
                    <th className="w-[45px]">Ln</th>
                    <th className="w-[130px]">SKU</th>
                    <th className="w-[130px]">Material</th>
                    <th>Deskripsi</th>
                    <th className="w-[80px] text-right">Qty</th>
                    <th className="w-[70px] text-right">Minus</th>
                    <th className="w-[80px]">Status</th>
                    <th className="w-[220px]">Pengambilan</th>
                    <th>Keterangan</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((i) => (
                    <tr key={i.line_no} className={i.status === 'ERROR' ? 'bg-sap-errbg/40' : ''}>
                      <td className="font-mono text-sap-muted">{i.line_no}</td>
                      <td className="font-mono">{i.sku}</td>
                      <td className="font-mono">{i.material_code ?? '—'}</td>
                      <td className="truncate max-w-[200px]">{i.description}</td>
                      <td className="text-right font-mono tabular-nums">{nf(i.qty)}</td>
                      <td className="text-right font-mono tabular-nums text-sap-warntext">
                        {i.short_qty > 0 ? nf(i.short_qty) : '—'}
                      </td>
                      <td>
                        <span
                          className={`sap-badge ${
                            i.status === 'OK'
                              ? 'border-sap-okborder bg-sap-okbg text-sap-oktext'
                              : i.status === 'ERROR'
                                ? 'border-sap-errborder bg-sap-errbg text-sap-errtext'
                                : 'border-sap-neutralborder bg-sap-neutralbg text-sap-muted'
                          }`}
                        >
                          {i.status}
                        </span>
                      </td>
                      <td className="font-mono text-xxs text-sap-muted truncate max-w-[220px]">
                        {i.picked ?? '—'}
                      </td>
                      <td className="text-xxs text-sap-muted truncate max-w-[260px]">
                        {i.message ?? '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      )}

      {negatives && (
        <Panel
          title={
            negatives.length === 0
              ? 'Saldo minus — tidak ada'
              : `Saldo minus Gudang Kecil — ${negatives.length} baris, ${nf(negatives.reduce((a, n) => a + n.shortage, 0))} pcs`
          }
          icon={<TrendingDown size={13} className="text-sap-warntext" />}
          bodyClassName={negatives.length === 0 ? 'p-3' : 'p-0'}
          actions={<Button onClick={() => setNegatives(null)}>Tutup</Button>}
        >
          {negatives.length === 0 ? (
            <p className="text-2xs text-sap-oktext">
              Tidak ada saldo minus — seluruh penjualan sudah tertutup stok.
            </p>
          ) : (
            <>
              <div className="p-3 border-b border-sap-border">
                <p className="text-xxs text-sap-muted leading-relaxed">
                  Setiap baris berarti replenishment Gudang Besar → Gudang Kecil yang belum
                  diposting. Saldonya impas sendiri begitu replenishment-nya masuk. Yang{' '}
                  <b>umurnya makin tua</b> makin patut dicurigai: kemungkinan replenishment-nya
                  memang tidak akan pernah datang dan perlu ditindaklanjuti manual. Baris bertanda{' '}
                  <b>tanpa fix bin</b> punya sebab yang bisa langsung diperbaiki — isi Fix Bin
                  materialnya di MM01 supaya penjualan berikutnya tidak menumpuk di GI-PENJUALAN.
                </p>
              </div>
              <div className="overflow-x-auto max-h-[420px]">
                <table className="sap-grid">
                  <thead>
                    <tr>
                      <th className="w-[130px]">Material</th>
                      <th>Deskripsi</th>
                      <th className="w-[130px]">Bin</th>
                      <th className="w-[110px]">Batch</th>
                      <th className="w-[90px] text-right">Kurang</th>
                      <th className="w-[80px] text-right">Umur</th>
                      <th className="w-[150px]">Terakhir berubah</th>
                    </tr>
                  </thead>
                  <tbody>
                    {negatives.map((n) => (
                      <tr key={n.id}>
                        <td className="font-mono">{n.material_code}</td>
                        <td className="truncate max-w-[220px]">
                          {n.description}
                          {n.no_fix_bin && (
                            <span className="ml-1.5 sap-badge border-sap-warnborder bg-sap-warnbg text-sap-warntext">
                              tanpa fix bin
                            </span>
                          )}
                        </td>
                        <td className="font-mono">{n.bin_code}</td>
                        <td className="font-mono">{n.batch_number ?? '—'}</td>
                        <td className="text-right font-mono tabular-nums text-sap-errtext">
                          {nf(n.shortage)} {n.uom}
                        </td>
                        <td className="text-right font-mono tabular-nums">
                          <span
                            className={
                              n.age_days >= 7 ? 'text-sap-errtext' : n.age_days >= 3 ? 'text-sap-warntext' : ''
                            }
                          >
                            {n.age_days} hr
                          </span>
                        </td>
                        <td className="font-mono text-xxs text-sap-muted">
                          {fmtDateTime(n.updated_at)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </Panel>
      )}

      <Toolbar>
        <span className="text-xxs text-sap-muted flex items-center gap-1.5">
          <Clock size={12} />
          Klik baris untuk melihat rincian per material. Proses otomatis dari OCS belum aktif —
          untuk sekarang penjualan dimuat lewat ZGI01.
        </span>
        <Separator />
        <span className="text-xxs text-sap-muted">Enter / F8 = muat ulang</span>
      </Toolbar>
    </div>
  );
}
