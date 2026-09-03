'use client';

/**
 * ZGI01 — Upload Penjualan & Goods Issue 601 (desktop, ADMIN).
 *
 * Dipakai untuk data penjualan yang tidak diambil otomatis dari OCS — terutama
 * susulan 20 Agustus s.d. 2 September, periode saat WMS sudah jalan tetapi
 * penjualannya belum pernah dikeluarkan.
 *
 * SATU TANGGAL = SATU PROSES. Kunci uniknya ada di database, bukan di layar
 * ini: mengunggah tanggal yang sama dua kali akan ditolak, termasuk bila
 * unggahan kedua dilakukan orang lain dari komputer lain pada saat bersamaan.
 * Tanpa itu, stok bisa keluar dua kali untuk penjualan yang sama.
 *
 * Alurnya dua langkah dan sengaja tidak digabung: unggah dulu (belum ada stok
 * yang berubah), lihat ringkasannya, baru posting. Posting berjalan bertahap
 * karena satu hari bisa menyentuh ratusan material.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import {
  Upload,
  FileDown,
  Save,
  RotateCcw,
  Info,
  ShoppingCart,
  AlertTriangle,
  CheckCircle2,
  ShieldCheck,
  RotateCw,
} from 'lucide-react';
import { Panel, Field, Input, Button, Toolbar, Separator, ActionField } from '@/components/sap/ui';
import { useStatus } from '@/components/sap/StatusBar';
import { ConfirmDialog } from '@/components/sap/Confirm';
import { api, post } from '@/lib/client';
import { wibYesterday } from '@/lib/wib';

/**
 * Template hanya berisi apa yang benar-benar ADA di laporan OCS: tanggal,
 * kode OCS, dan jumlah terjual.
 *
 * Kolom lain sengaja tidak diminta. Rak diambil dari Fix Bin material di MM01
 * dan batch dipilih FEFO, jadi memintanya hanya membuka peluang salah isi.
 * Nomor pesanan juga tidak diperlukan — qty dijumlahkan per SKU, dan
 * rinciannya tetap ada di OCS. Bila file Anda kebetulan punya kolom
 * `order_no`, kolom itu diabaikan tanpa menimbulkan galat.
 */
const TEMPLATE_COLUMNS = ['sales_date', 'sku', 'qty'] as const;

/**
 * Contoh memakai DESKRIPSI material, karena itulah bentuk "Kode OCS" di
 * laporan OCS. Kode material WMS dan kode alias juga tetap diterima.
 */
const TEMPLATE_SAMPLE = [
  { sales_date: '20/08/2026', sku: 'POWER-BRIGHT-EXPERT-SERUM', qty: 12 },
  { sales_date: '20/08/2026', sku: 'MOISTURIZER-BRIGHT-EXPERT', qty: 3 },
  { sales_date: '21/08/2026', sku: 'POWER-BRIGHT-EXPERT-SERUM', qty: 6 },
];

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

interface Run {
  id: string;
  sales_date: string;
  source: string;
  status: string;
  document_number: string | null;
  total_lines: number;
  posted_lines: number;
  failed_lines: number;
  total_qty: number;
  posted_qty: number;
  short_qty: number;
  items: RunItem[];
}

const nf = (n: number) => n.toLocaleString('de-DE');

/** dd/mm/yyyy atau yyyy-mm-dd -> ISO. Hari didahulukan, seperti Excel Indonesia. */
function parseDate(raw: unknown): string {
  const s = String(raw ?? '').trim();
  if (!s) return '';
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const m = /^(\d{1,2})[./-](\d{1,2})[./-](\d{4})/.exec(s);
  if (!m) return '';
  return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
}

export default function Zgi01Page() {
  const { setStatus } = useStatus();
  const fileRef = useRef<HTMLInputElement>(null);

  const [salesDate, setSalesDate] = useState('');
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [fileName, setFileName] = useState('');
  const [run, setRun] = useState<Run | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  /** Baris file yang tanggalnya cocok dengan tanggal yang dipilih. */
  const selected = useMemo(() => {
    if (!salesDate) return [];
    return rows.filter((r) => parseDate(r.sales_date ?? r.SALES_DATE ?? r.tanggal) === salesDate);
  }, [rows, salesDate]);

  /** Tanggal-tanggal yang ada di file, untuk memandu proses susulan hari demi hari. */
  const datesInFile = useMemo(() => {
    const m = new Map<string, { lines: number; qty: number }>();
    for (const r of rows) {
      const d = parseDate(r.sales_date ?? r.SALES_DATE ?? r.tanggal);
      if (!d) continue;
      const qty = Number(String(r.qty ?? r.QTY ?? '').replace(/[, ]/g, '')) || 0;
      const cur = m.get(d) ?? { lines: 0, qty: 0 };
      m.set(d, { lines: cur.lines + 1, qty: cur.qty + qty });
    }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [rows]);

  function downloadTemplate() {
    const ws = XLSX.utils.json_to_sheet(TEMPLATE_SAMPLE, { header: [...TEMPLATE_COLUMNS] });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'DATA');
    XLSX.writeFile(wb, 'template_penjualan.xlsx');
    setStatus('Template penjualan diunduh', 'S');
  }

  async function readFile(f: File) {
    const buf = await f.arrayBuffer();
    const wb = XLSX.read(buf, { cellDates: false });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const json = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: '', raw: false });
    setRows(json);
    setFileName(f.name);
    // `run` sengaja TIDAK dikosongkan: bila tanggal yang dipilih sudah punya
    // proses, panelnya harus tetap terlihat supaya orang melanjutkannya alih-alih
    // mengunggah ulang. Server tetap menolak unggahan ganda, tapi layar yang
    // menyembunyikan keadaan sebenarnya hanya membuat orang mencoba.
    setStatus(`${json.length} baris dibaca dari ${f.name}`, 'S');
  }

  const loadRun = useCallback(async (id: string) => {
    const r = await api<Run>(`/api/sales-gi/${id}`);
    if (r.ok && r.data) setRun(r.data);
  }, []);

  /** Langkah 1 — muat ke sistem. Belum ada stok yang berubah. */
  async function upload() {
    if (!salesDate) return setStatus('Pilih tanggal penjualan terlebih dahulu', 'E');
    if (selected.length === 0)
      return setStatus(`Tidak ada baris bertanggal ${salesDate} di file ini`, 'E');

    setBusy(true);
    const r = await post<{ id: string }>('/api/sales-gi', {
      sales_date: salesDate,
      source: 'UPLOAD',
      rows: selected.map((x) => ({
        sku: x.sku ?? x.SKU ?? x.material_code,
        qty: x.qty ?? x.QTY,
      })),
    });
    setBusy(false);
    setStatus(r.message, r.ok ? 'S' : 'E');
    if (r.ok && r.data) await loadRun(r.data.id);
  }

  /** Langkah 2 — posting bertahap sampai habis. */
  async function postAll() {
    if (!run) return;
    setConfirmOpen(false);
    setBusy(true);
    setProgress({ done: 0, total: run.total_lines });

    // Batas putaran mencegah gelung tak berujung bila server terus melaporkan
    // sisa yang sama — lebih baik berhenti dan melapor daripada berputar diam.
    const maxRounds = Math.ceil(run.total_lines / 10) + 20;
    for (let i = 0; i < maxRounds; i++) {
      const r = await post<{ remaining: number; posted_lines: number; failed_lines: number }>(
        `/api/sales-gi/${run.id}/post`,
        {}
      );
      if (!r.ok) {
        setBusy(false);
        setProgress(null);
        setStatus(r.message, 'E');
        await loadRun(run.id);
        return;
      }
      const d = r.data!;
      setProgress({ done: d.posted_lines + d.failed_lines, total: run.total_lines });
      setStatus(r.message, d.remaining > 0 ? 'I' : 'S');
      if (d.remaining === 0) break;
    }

    setBusy(false);
    setProgress(null);
    await loadRun(run.id);
  }

  useEffect(() => {
    /**
     * Bawaannya kemarin MENURUT WIB, bukan menurut jam server.
     *
     * Server berjalan UTC. Operator yang membuka layar ini pukul 06:00 WIB
     * berada di pukul 23:00 UTC hari sebelumnya, sehingga "kemarin" versi UTC
     * meleset satu hari — dan tanggal yang meleset satu hari adalah tepat
     * jenis kesalahan yang tidak terlihat sampai stoknya kacau.
     */
    setSalesDate(wibYesterday());
  }, []);

  /**
   * Cari proses yang SUDAH ADA untuk tanggal ini.
   *
   * Dipanggil setiap tanggal berubah supaya pekerjaan yang terputus — browser
   * ditutup di tengah posting, jaringan putus — bisa dilanjutkan, bukan
   * diulang dari awal. Mengulang dari awal untuk tanggal yang separuh
   * terposting adalah cara tercepat mengeluarkan stok dua kali.
   */
  useEffect(() => {
    if (!salesDate) return;
    let cancelled = false;
    (async () => {
      const r = await api<Run[]>(`/api/sales-gi?from=${salesDate}&to=${salesDate}`);
      if (cancelled) return;
      const found = r.ok && r.data?.length ? r.data[0] : null;
      if (found) {
        await loadRun(found.id);
        setStatus(
          `Tanggal ${salesDate} sudah punya proses (${found.status}) — ` +
            `${found.posted_lines}/${found.total_lines} material terposting. Lanjutkan, jangan unggah ulang.`,
          found.status === 'DONE' ? 'S' : 'W'
        );
      } else {
        setRun(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [salesDate, loadRun, setStatus]);

  /** Periksa seluruh SKU tanpa menyentuh stok. */
  async function validate() {
    if (!run) return;
    setBusy(true);

    // Pemeriksaan berhenti sendiri sebelum batas waktu fungsi dan melaporkan
    // baris berikutnya. Diteruskan di sini supaya hari dengan ratusan material
    // tetap selesai tanpa perlu ditekan berulang kali.
    let from_line: number | undefined;
    let checked = 0;
    let unknown = 0;
    let ambiguous = 0;

    for (let i = 0; i < 40; i++) {
      const r = await post<{
        checked: number;
        unknown: number;
        ambiguous: number;
        next_line: number | null;
      }>(`/api/sales-gi/${run.id}/validate`, from_line ? { from_line } : {});
      if (!r.ok) {
        setBusy(false);
        setStatus(r.message, 'E');
        await loadRun(run.id);
        return;
      }
      const d = r.data!;
      // Dijumlahkan di sini, bukan diambil dari potongan terakhir: potongan
      // terakhir bisa saja bersih sementara potongan pertama penuh masalah.
      checked += d.checked;
      unknown += d.unknown;
      ambiguous += d.ambiguous;
      setStatus(r.message, 'I');
      if (d.next_line === null) break;
      from_line = d.next_line;
    }

    setBusy(false);
    const bad = unknown + ambiguous;
    setStatus(
      bad === 0
        ? `${checked} material diperiksa — semuanya dikenali. Siap diposting.`
        : `${checked} material diperiksa: ${unknown} tidak dikenali` +
          (ambiguous > 0 ? `, ${ambiguous} deskripsinya dipakai lebih dari satu material` : '') +
          `. Betulkan di MM01 / ZMATDUP lalu validasi ulang.`,
      bad === 0 ? 'S' : 'W'
    );
    await loadRun(run.id);
  }

  /** Kembalikan baris gagal ke antrean setelah masternya dibetulkan. */
  async function resetFailed() {
    if (!run) return;
    setBusy(true);
    const r = await post(`/api/sales-gi/${run.id}/reset-failed`, {});
    setBusy(false);
    setStatus(r.message, r.ok ? 'S' : 'E');
    if (r.ok) await loadRun(run.id);
  }

  const posted = run?.items.filter((i) => i.status === 'OK') ?? [];
  const failed = run?.items.filter((i) => i.status === 'ERROR') ?? [];
  const pending = run?.items.filter((i) => i.status === 'PENDING') ?? [];
  const shortRows = posted.filter((i) => i.short_qty > 0);

  return (
    <div className="space-y-3">
      <Panel
        title="ZGI01 — Upload Penjualan & Goods Issue (601)"
        icon={<ShoppingCart size={13} className="text-sap-blue" />}
      >
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3 items-start">
          <Field label="File penjualan (.xlsx / .csv)" hint={fileName || 'belum ada file dipilih'}>
            <input
              ref={fileRef}
              type="file"
              accept=".xlsx,.xls,.csv"
              className="sap-field !py-[3px] file:mr-2 file:border-0 file:bg-transparent file:text-sap-blue"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void readFile(f);
              }}
            />
          </Field>
          <Field
            label="Tanggal Penjualan"
            required
            hint="satu proses = satu tanggal; diproses hari demi hari"
          >
            <Input type="date" value={salesDate} onChange={(e) => setSalesDate(e.target.value)} />
          </Field>
          <ActionField>
            <Button variant="primary" onClick={upload} loading={busy} disabled={rows.length === 0}>
              <Upload size={12} /> Muat ke sistem
            </Button>
          </ActionField>
          <ActionField>
            <Button onClick={downloadTemplate}>
              <FileDown size={12} /> Template
            </Button>
          </ActionField>
        </div>

        <div className="mt-3 rounded-sappanel border border-sap-border bg-sap-infobg p-2">
          <p className="text-xxs text-sap-infotext leading-relaxed">
            Cukup tiga kolom: <b className="font-mono">sales_date</b>,{' '}
            <b className="font-mono">sku</b>, <b className="font-mono">qty</b>. Tanggal boleh{' '}
            <span className="font-mono">dd/mm/yyyy</span> atau{' '}
            <span className="font-mono">yyyy-mm-dd</span>. Kolom <b className="font-mono">sku</b>{' '}
            diisi <b>Kode OCS</b> — yaitu deskripsi material di WMS; kode material dan kode alias
            juga tetap dikenali. Batch dan rak <b>tidak perlu diisi</b>: rak diambil dari Fix Bin
            material di MM01 dan batch dipilih FEFO. Qty dijumlahkan per SKU, jadi satu SKU boleh
            muncul di banyak baris.
          </p>
          <p className="mt-1.5 text-xxs text-sap-warntext leading-relaxed">
            Karena pencocokannya lewat deskripsi, deskripsi yang dipakai lebih dari satu material
            akan <b>ditolak</b> — bukan ditebak. Tekan <b>Validasi SKU</b> lebih dulu; yang bentrok
            dirapikan di ZMATDUP.
          </p>
        </div>

        {datesInFile.length > 0 && (
          <div className="mt-3">
            <p className="text-xxs text-sap-muted mb-1">
              Tanggal yang ada di file ini — klik untuk memilih:
            </p>
            <div className="flex flex-wrap gap-1.5">
              {datesInFile.map(([d, v]) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => setSalesDate(d)}
                  className={`sap-badge ${
                    d === salesDate
                      ? 'border-sap-blue bg-sap-blue/15 text-sap-blue'
                      : 'border-sap-border bg-sap-neutralbg text-sap-muted hover:bg-sap-btnhover'
                  }`}
                >
                  {d} · {v.lines} baris · {nf(v.qty)} pcs
                </button>
              ))}
            </div>
          </div>
        )}
      </Panel>

      {run && (
        <Panel
          title={`Proses ${run.sales_date.slice(0, 10)} — ${run.status}`}
          icon={
            run.status === 'DONE' ? (
              <CheckCircle2 size={13} className="text-sap-oktext" />
            ) : (
              <AlertTriangle size={13} className="text-sap-warntext" />
            )
          }
        >
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3 items-start">
            <Field label="Material">
              <Input disabled value={`${run.total_lines}`} className="font-mono" />
            </Field>
            <Field label="Total Qty">
              <Input disabled value={nf(run.total_qty)} className="font-mono" />
            </Field>
            <Field label="Berhasil">
              <Input disabled value={`${run.posted_lines}`} className="font-mono" />
            </Field>
            <Field label="Gagal">
              <Input disabled value={`${run.failed_lines}`} className="font-mono" />
            </Field>
            <Field label="Material Document">
              <Input disabled value={run.document_number ?? '—'} className="font-mono" />
            </Field>
          </div>

          {progress && (
            <p className="mt-2 text-2xs text-sap-infotext">
              Memproses {progress.done} / {progress.total} material…
            </p>
          )}

          {run.short_qty > 0 && (
            <p className="mt-2 text-2xs text-sap-warntext">
              {nf(run.short_qty)} pcs tidak tertutup stok Gudang Kecil dan menjadi saldo minus —
              menunggu replenishment dari Gudang Besar. Lihat rinciannya di bawah.
            </p>
          )}

          {failed.length > 0 && (
            <div className="mt-3">
              <p className="text-2xs font-medium text-sap-errtext mb-1">
                {failed.length} material gagal:
              </p>
              <ul className="list-disc pl-4 text-xxs text-sap-errtext space-y-0.5 max-h-40 overflow-auto">
                {failed.map((i) => (
                  <li key={i.line_no}>
                    {i.sku} (qty {i.qty}) — {i.message}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {shortRows.length > 0 && (
            <div className="mt-3 border border-sap-border rounded-sappanel overflow-x-auto max-h-56">
              <table className="sap-grid">
                <thead>
                  <tr>
                    <th className="w-[140px]">Material</th>
                    <th>Deskripsi</th>
                    <th className="w-[80px] text-right">Keluar</th>
                    <th className="w-[80px] text-right">Minus</th>
                    <th>Rincian pengambilan</th>
                  </tr>
                </thead>
                <tbody>
                  {shortRows.map((i) => (
                    <tr key={i.line_no}>
                      <td className="font-mono">{i.material_code ?? i.sku}</td>
                      <td className="truncate max-w-[220px]">{i.description}</td>
                      <td className="text-right font-mono tabular-nums">{nf(i.qty)}</td>
                      <td className="text-right font-mono tabular-nums text-sap-warntext">
                        {nf(i.short_qty)}
                      </td>
                      <td className="font-mono text-xxs text-sap-muted truncate max-w-[280px]">
                        {i.picked ?? '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      )}

      <Toolbar>
        <Button
          variant="danger"
          onClick={() => setConfirmOpen(true)}
          loading={busy}
          disabled={!run || pending.length === 0}
        >
          <Save size={13} /> Posting Goods Issue
        </Button>
        <Button onClick={validate} loading={busy} disabled={!run}>
          <ShieldCheck size={13} /> Validasi SKU
        </Button>
        <Button onClick={resetFailed} loading={busy} disabled={!run || failed.length === 0}>
          <RotateCw size={13} /> Ulangi baris gagal
        </Button>
        <Button
          onClick={() => {
            setRows([]);
            setRun(null);
            setFileName('');
            if (fileRef.current) fileRef.current.value = '';
            setStatus('Layar direset', 'I');
          }}
        >
          <RotateCcw size={13} /> Reset
        </Button>
        <Separator />
        <span className="text-xxs text-sap-muted flex items-center gap-1.5">
          <Info size={12} />
          Urutan yang aman: muat → <b>Validasi SKU</b> → betulkan yang bermasalah di MM01/ZMATDUP →
          Posting. Memuat dan memvalidasi tidak mengubah stok sama sekali. Satu tanggal hanya bisa
          diposting sekali; yang terputus di tengah dilanjutkan, bukan diunggah ulang.
        </span>
      </Toolbar>

      <ConfirmDialog
        open={confirmOpen}
        title="Konfirmasi Goods Issue Penjualan"
        danger
        busy={busy}
        confirmLabel="Ya, keluarkan stok"
        question="Stok Gudang Kecil akan benar-benar berkurang, dan rak yang stoknya tidak cukup akan menjadi MINUS. Satu tanggal hanya bisa diposting sekali."
        details={
          run
            ? [
                { label: 'Tanggal penjualan', value: run.sales_date.slice(0, 10) },
                { label: 'Material', value: `${pending.length} belum diproses` },
                { label: 'Total qty', value: nf(run.total_qty) },
                { label: 'Movement', value: '601 — Goods Issue Penjualan' },
              ]
            : []
        }
        onConfirm={postAll}
        onCancel={() => setConfirmOpen(false)}
      />
    </div>
  );
}
