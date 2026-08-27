'use client';

import { useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import {
  Upload,
  FileSpreadsheet,
  Download,
  Play,
  CheckCircle2,
  XCircle,
  FileWarning,
  Boxes,
  Grid3x3,
  PackagePlus,
  Package,
  ShieldAlert,
  Trash2,
} from 'lucide-react';
import { Panel, Field, ActionField, Select, Button, Toolbar, Separator } from '@/components/sap/ui';
import { useStatus } from '@/components/sap/StatusBar';
import { invalidateMasterData } from '@/components/sap/hooks';
import { post } from '@/lib/client';

/* ------------------------------------------------------------------ */
/* Definisi 3 tipe upload                                              */
/* ------------------------------------------------------------------ */

type UploadKind =
  | 'materials'
  | 'packaging'
  | 'bins'
  | 'initial-stock'
  | 'safety-stock'
  | 'delete-materials';

interface KindDef {
  id: UploadKind;
  title: string;
  endpoint: string;
  file: string;
  Icon: typeof Boxes;
  columns: string[];
  sample: Record<string, string | number>[];
  note: string;
  /** menghapus data — ditandai merah dan tombol eksekusinya bergaya danger */
  destructive?: boolean;
}

const KINDS: Record<UploadKind, KindDef> = {
  materials: {
    id: 'materials',
    title: '1. Master Material (MM01)',
    endpoint: '/api/upload/materials',
    file: 'master_materials.xlsx',
    Icon: Boxes,
    columns: ['material_code', 'description', 'uom', 'is_batch_managed', 'min_safety_stock', 'barcode_bpom', 'barcode_produk', 'kode_ocs', 'fix_bin'],
    sample: [
      { material_code: 'FG-0001', description: 'Sabun Cair Botol 500ml', uom: 'PC', is_batch_managed: 'TRUE', min_safety_stock: 100, barcode_bpom: 'NA18201234567', barcode_produk: '8998824551223', kode_ocs: 'GIMMICK-CONTOH-SABUN-CAIR-BOTOL-500ML', fix_bin: 'GK-PICK-B-03' },
      { material_code: 'FG-0002', description: 'Shampoo Sachet 12ml x 12', uom: 'BOX', is_batch_managed: 'TRUE', min_safety_stock: 50, barcode_bpom: '', barcode_produk: '', kode_ocs: '', fix_bin: '' },
      { material_code: 'SP-1001', description: 'Karton Box 40x30x25', uom: 'PC', is_batch_managed: 'FALSE', min_safety_stock: 0, barcode_bpom: '', barcode_produk: '', kode_ocs: '', fix_bin: '' },
    ],
    note: 'is_batch_managed: TRUE / FALSE. Kolom barcode_bpom / barcode_produk / kode_ocs / fix_bin opsional. fix_bin = rak tetap material: jadi tujuan replenishment (ZRF08) sekaligus saran rak put-away untuk retur (MIGO 501). Barcode wajib unik antar material. Material yang sudah ada akan di-update (upsert).',
  },
  packaging: {
    id: 'packaging',
    title: '2. Palletization (MM01)',
    endpoint: '/api/upload/packaging',
    file: 'master_packaging.xlsx',
    Icon: Package,
    columns: ['material_code', 'pack_code', 'su_type', 'zone_group', 'description', 'qty_per_unit', 'is_default'],
    sample: [
      { material_code: 'FG-0001', pack_code: 'PAL-GB', su_type: 'PAL', zone_group: 'BESAR', description: 'Pallet Gudang Besar', qty_per_unit: 1000, is_default: 'TRUE' },
      { material_code: 'FG-0001', pack_code: 'BOX-GK', su_type: 'BINBOX', zone_group: 'KECIL', description: 'Bin box Gudang Kecil', qty_per_unit: 100, is_default: 'TRUE' },
      { material_code: 'FG-0002', pack_code: 'PAL-GB', su_type: 'PAL', zone_group: 'BESAR', description: 'Pallet standar', qty_per_unit: 480, is_default: 'TRUE' },
    ],
    note: 'Tabel palletization: material × SU type × kelompok gudang. su_type: PAL / BINBOX / CTN. zone_group: BESAR / KECIL (kosongkan bila berlaku semua gudang). Satu baris default per kelompok gudang.',
  },
  bins: {
    id: 'bins',
    title: '3. Master Storage Bin (LS01N)',
    endpoint: '/api/upload/bins',
    file: 'master_storage_bins.xlsx',
    Icon: Grid3x3,
    columns: ['bin_code', 'zone_id', 'max_weight_kg', 'status'],
    sample: [
      { bin_code: 'A-01-01-1', zone_id: 'RACK-FAST', max_weight_kg: 1200, status: 'EMPTY' },
      { bin_code: 'A-01-02-1', zone_id: 'RACK-FAST', max_weight_kg: 1200, status: 'EMPTY' },
      { bin_code: 'STG-01', zone_id: 'STAGING', max_weight_kg: 5000, status: 'EMPTY' },
      { bin_code: 'RJ-01', zone_id: 'REJECT', max_weight_kg: 800, status: 'EMPTY' },
    ],
    note: 'Format bin: Aisle-Rack-Level. status: EMPTY / OCCUPIED / BLOCKED (opsional).',
  },
  'initial-stock': {
    id: 'initial-stock',
    title: '4. Initial Stock / Saldo Awal (Movement 561)',
    endpoint: '/api/upload/initial-stock',
    file: 'initial_stock.xlsx',
    Icon: PackagePlus,
    columns: ['material_code', 'bin_code', 'batch_number', 'mfg_date', 'exp_date', 'qty'],
    sample: [
      { material_code: 'FG-0001', bin_code: 'A-01-01-1', batch_number: 'B2608A', mfg_date: '01.08.2026', exp_date: '01.08.2028', qty: 480 },
      { material_code: 'FG-0002', bin_code: 'A-01-02-1', batch_number: 'B2608B', mfg_date: '05.08.2026', exp_date: '05.02.2028', qty: 240 },
      { material_code: 'SP-1001', bin_code: 'STG-01', batch_number: '', mfg_date: '', exp_date: '', qty: 1000 },
    ],
    note: 'Master material & bin harus sudah ada. Tanggal format dd.mm.yyyy atau date Excel. Mengisi Stock IM + Stock WM + status Bin + log 561.',
  },
  'safety-stock': {
    id: 'safety-stock',
    title: '5. Update Safety Stock (replace)',
    endpoint: '/api/upload/safety-stock',
    file: 'safety_stock.xlsx',
    Icon: ShieldAlert,
    columns: ['material_code', 'min_safety_stock'],
    sample: [
      { material_code: 'FG-0001', min_safety_stock: 150 },
      { material_code: 'FG-0002', min_safety_stock: 80 },
      { material_code: 'SP-1001', min_safety_stock: 250 },
    ],
    note: 'REPLACE nilai safety stock untuk material yang tercantum di file. Material yang tidak ada di file tidak diubah. Bisa dipakai untuk mengubah banyak baris sekaligus.',
  },
  'delete-materials': {
    id: 'delete-materials',
    title: '6. Hapus Master Material (pembersih salah unggah)',
    endpoint: '/api/upload/delete-materials',
    file: 'delete_materials.xlsx',
    Icon: Trash2,
    columns: ['material_code'],
    sample: [
      { material_code: 'FG-9001' },
      { material_code: 'FG-9002' },
      { material_code: 'SP-9001' },
    ],
    note:
      'HANYA ADMIN. Menghapus material yang tercantum di file beserta master palletization-nya — tidak bisa dibatalkan. ' +
      'Baris ditolak bila material masih punya stok, masih punya dokumen di MB51, atau masih dipakai transfer requirement. ' +
      'Penolakan berlaku per baris: material lain di file yang sama tetap terhapus. Unduh dulu daftar material dari MM01 untuk memastikan kode yang akan dihapus.',
    destructive: true,
  },
};

interface RowResult {
  row: number;
  key: string;
  status: string;
  message?: string;
  document_number?: string;
}

/* ------------------------------------------------------------------ */

export default function ZuploadPage() {
  const { setStatus } = useStatus();
  const fileRef = useRef<HTMLInputElement>(null);

  const [kind, setKind] = useState<UploadKind>('materials');
  const [chunkSize, setChunkSize] = useState(50);
  const [mode, setMode] = useState<'ADD' | 'SET'>('ADD');
  const [fileName, setFileName] = useState('');
  const [rows, setRows] = useState<Record<string, any>[]>([]);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [results, setResults] = useState<RowResult[]>([]);

  const def = KINDS[kind];

  /* ---------------- Download template ---------------- */
  function downloadTemplate(k: UploadKind) {
    const d = KINDS[k];
    const ws = XLSX.utils.json_to_sheet(d.sample, { header: d.columns });
    ws['!cols'] = d.columns.map((c) => ({ wch: Math.max(16, c.length + 4) }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'DATA');
    XLSX.writeFile(wb, d.file);
    setStatus(`Template ${d.file} downloaded`, 'S');
  }

  /* ---------------- Baca file di FRONTEND (SheetJS) ---------------- */
  async function readFile(f: File) {
    setResults([]);
    setProgress({ done: 0, total: 0 });
    try {
      const buf = await f.arrayBuffer();
      const wb = XLSX.read(buf, { cellDates: true });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const json = XLSX.utils.sheet_to_json<Record<string, any>>(ws, { defval: '', raw: false });

      // normalisasi nama kolom -> lowercase snake
      const norm = json.map((r) => {
        const o: Record<string, any> = {};
        Object.entries(r).forEach(([k, v]) => {
          o[String(k).trim().toLowerCase().replace(/\s+/g, '_')] = v;
        });
        return o;
      });

      const clean = norm.filter((r) => Object.values(r).some((v) => String(v ?? '').trim() !== ''));
      setRows(clean);
      setFileName(f.name);
      setStatus(`File ${f.name} read successfully — ${clean.length} data row(s) found`, clean.length ? 'S' : 'W');
    } catch (e) {
      setStatus(`Cannot read file: ${e instanceof Error ? e.message : 'unknown error'}`, 'E');
      setRows([]);
      setFileName('');
    }
  }

  /* ---------------- Kirim ke backend per chunk ---------------- */
  async function execute() {
    if (rows.length === 0) return setStatus('No data to upload. Please choose a file first.', 'E');

    setRunning(true);
    setResults([]);
    setProgress({ done: 0, total: rows.length });

    const all: RowResult[] = [];
    let aborted = false;

    for (let i = 0; i < rows.length; i += chunkSize) {
      const chunk = rows.slice(i, i + chunkSize);
      const r = await post(def.endpoint, {
        rows: chunk,
        offset: i,
        ...(kind === 'initial-stock' ? { mode } : {}),
      });

      if (!r.ok) {
        setStatus(`Upload stopped at row ${i + 1}: ${r.message}`, 'E');
        aborted = true;
        break;
      }

      all.push(...((r.data?.results ?? []) as RowResult[]));
      setResults([...all]);
      setProgress({ done: Math.min(i + chunkSize, rows.length), total: rows.length });
    }

    setRunning(false);
    invalidateMasterData();

    if (!aborted) {
      const err = all.filter((x) => x.status === 'ERROR').length;
      setStatus(
        err === 0
          ? `Upload completed successfully — ${all.length} row(s) processed`
          : `Upload completed with ${err} error(s) out of ${all.length} row(s)`,
        err === 0 ? 'S' : 'W'
      );
    }
  }

  const okCount = results.filter((r) => r.status !== 'ERROR').length;
  const errCount = results.filter((r) => r.status === 'ERROR').length;
  const pct = progress.total ? Math.round((progress.done / progress.total) * 100) : 0;

  return (
    <div className="space-y-3">
      {/* PILIH TIPE */}
      <Panel title="ZUPLOAD — Master Data & Initial Stock Upload Center" icon={<Upload size={13} className="text-sap-blue" />}>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2">
          {(Object.keys(KINDS) as UploadKind[]).map((k) => {
            const d = KINDS[k];
            const active = k === kind;
            return (
              <button
                key={k}
                type="button"
                onClick={() => {
                  setKind(k);
                  setRows([]);
                  setFileName('');
                  setResults([]);
                  if (fileRef.current) fileRef.current.value = '';
                }}
                className={`flex items-start gap-2.5 p-3 rounded-[3px] border text-left transition-colors
                  ${
                    // Menu penghapus diberi warna merah supaya tidak pernah
                    // terpilih hanya karena posisinya bersebelahan.
                    d.destructive
                      ? active
                        ? 'border-sap-errborder bg-sap-errbg'
                        : 'border-sap-errborder/60 bg-sap-panelalt hover:border-sap-errborder'
                      : active
                        ? 'border-sap-blue bg-sap-blue/12'
                        : 'border-sap-border bg-sap-panelalt hover:border-sap-blue/50'
                  }`}
              >
                <d.Icon
                  size={17}
                  className={
                    d.destructive ? 'text-sap-errtext' : active ? 'text-sap-blue' : 'text-sap-muted'
                  }
                />
                <div className="min-w-0">
                  <p className="text-2xs font-semibold">{d.title}</p>
                  <p className="text-xxs text-sap-muted font-mono truncate">{d.file}</p>
                </div>
              </button>
            );
          })}
        </div>
      </Panel>

      {/* LANGKAH UPLOAD */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-3">
        <Panel title="Step 1 — Template & File" icon={<FileSpreadsheet size={13} className="text-sap-blue" />} className="xl:col-span-1">
          <div className="space-y-3">
            <Button onClick={() => downloadTemplate(kind)} className="w-full justify-center">
              <Download size={13} /> Download Sample Excel Template
            </Button>

            <div>
              <label className="sap-field-label">Pilih file .xlsx / .xls / .csv</label>
              <input
                ref={fileRef}
                type="file"
                accept=".xlsx,.xls,.csv"
                onChange={(e) => e.target.files?.[0] && readFile(e.target.files[0])}
                className="block w-full text-2xs text-sap-muted file:mr-2 file:py-[5px] file:px-3
                           file:rounded-[2px] file:border file:border-sap-border file:text-2xs
                           file:bg-sap-btn file:text-sap-text hover:file:bg-sap-btnhover cursor-pointer"
              />
            </div>

            {fileName && (
              <div className="text-xxs font-mono text-sap-muted border border-sap-border rounded-[2px] p-2 bg-sap-field">
                <p className="text-sap-text truncate">{fileName}</p>
                <p>{rows.length} data row(s) siap dikirim</p>
              </div>
            )}

            <div className="border-t border-sap-border pt-2">
              <p className="text-xxs uppercase tracking-wide text-sap-muted mb-1">Kolom wajib</p>
              <div className="flex flex-wrap gap-1">
                {def.columns.map((c) => (
                  <span key={c} className="sap-badge border-sap-neutralborder bg-sap-neutralbg text-sap-muted">
                    {c}
                  </span>
                ))}
              </div>
              <p className="mt-2 text-xxs text-sap-muted/80 leading-relaxed">{def.note}</p>
            </div>
          </div>
        </Panel>

        <Panel title="Step 2 — Parameter & Eksekusi" icon={<Play size={13} className="text-sap-blue" />} className="xl:col-span-2">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-start">
            <Field label="Chunk Size (baris per request)" hint="50–100 disarankan agar aman dari timeout Vercel">
              <Select value={chunkSize} onChange={(e) => setChunkSize(Number(e.target.value))}>
                {[25, 50, 75, 100].map((n) => (
                  <option key={n} value={n}>
                    {n} baris
                  </option>
                ))}
              </Select>
            </Field>

            {kind === 'initial-stock' && (
              <Field label="Mode Posting" hint="ADD = tambah, SET = samakan dengan nilai di file">
                <Select value={mode} onChange={(e) => setMode(e.target.value as 'ADD' | 'SET')}>
                  <option value="ADD">ADD — tambahkan ke stok existing</option>
                  <option value="SET">SET — set stok = nilai file (posting selisih)</option>
                </Select>
              </Field>
            )}

            <ActionField
              hint={
                def.destructive
                  ? 'Penghapusan tidak bisa dibatalkan. Pastikan daftar kodenya sudah benar.'
                  : undefined
              }
            >
              <Button
                variant={def.destructive ? 'danger' : 'primary'}
                onClick={execute}
                loading={running}
                disabled={rows.length === 0}
              >
                {def.destructive ? <Trash2 size={13} /> : <Play size={13} />}
                {def.destructive ? `Hapus ${rows.length} material` : 'Execute Upload'}
              </Button>
            </ActionField>
          </div>

          {/* PROGRESS */}
          {progress.total > 0 && (
            <div className="mt-4">
              <div className="flex justify-between text-xxs font-mono text-sap-muted mb-1">
                <span>
                  Processing {progress.done} / {progress.total} rows
                </span>
                <span>{pct}%</span>
              </div>
              <div className="h-[6px] bg-sap-field border border-sap-border rounded-[2px] overflow-hidden">
                <div className="h-full bg-sap-blue transition-all duration-200" style={{ width: `${pct}%` }} />
              </div>
              <div className="flex gap-3 mt-2 text-xxs font-mono">
                <span className="text-sap-oktext flex items-center gap-1">
                  <CheckCircle2 size={11} /> {okCount} success
                </span>
                <span className="text-sap-errtext flex items-center gap-1">
                  <XCircle size={11} /> {errCount} error
                </span>
              </div>
            </div>
          )}
        </Panel>
      </div>

      {/* PREVIEW DATA */}
      {rows.length > 0 && results.length === 0 && (
        <Panel title={`Preview Data (${Math.min(rows.length, 20)} dari ${rows.length} baris)`} bodyClassName="p-0">
          <div className="overflow-auto max-h-[280px]">
            <table className="sap-grid">
              <thead>
                <tr>
                  <th className="w-[46px] text-center">#</th>
                  {def.columns.map((c) => (
                    <th key={c}>{c}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, 20).map((r, i) => (
                  <tr key={i}>
                    <td className="text-center font-mono text-sap-muted/60">{i + 1}</td>
                    {def.columns.map((c) => (
                      <td key={c} className="font-mono">
                        {String(r[c] ?? '')}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}

      {/* LOG HASIL */}
      {results.length > 0 && (
        <Panel
          title={`Upload Log (${results.length} baris)`}
          icon={<FileWarning size={13} className="text-sap-blue" />}
          bodyClassName="p-0"
          actions={
            <Button
              onClick={() => {
                const ws = XLSX.utils.json_to_sheet(results);
                const wb = XLSX.utils.book_new();
                XLSX.utils.book_append_sheet(wb, ws, 'LOG');
                XLSX.writeFile(wb, `zupload_log_${kind}.xlsx`);
              }}
            >
              <Download size={12} /> Export Log
            </Button>
          }
        >
          <div className="overflow-auto max-h-[340px]">
            <table className="sap-grid">
              <thead>
                <tr>
                  <th className="w-[70px] text-right">Row</th>
                  <th className="w-[220px]">Key</th>
                  <th className="w-[110px]">Status</th>
                  <th className="w-[150px]">Document</th>
                  <th>Message</th>
                </tr>
              </thead>
              <tbody>
                {results.map((r, i) => (
                  <tr key={i}>
                    <td className="text-right font-mono text-sap-muted">{r.row}</td>
                    <td className="font-mono">{r.key}</td>
                    <td>
                      {r.status === 'ERROR' ? (
                        <span className="sap-badge border-sap-errborder bg-sap-errbg text-sap-errtext">ERROR</span>
                      ) : (
                        <span className="sap-badge border-sap-okborder bg-sap-okbg text-sap-oktext">{r.status}</span>
                      )}
                    </td>
                    <td className="font-mono text-sap-muted">{r.document_number ?? ''}</td>
                    <td className="text-sap-errtext">{r.message ?? ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}

      <Toolbar>
        <span className="text-xxs text-sap-muted">
          Pembacaan file Excel dilakukan sepenuhnya di browser menggunakan SheetJS, lalu dikirim ke API secara
          ter-chunk sehingga tidak terkena batas waktu eksekusi Serverless Function.
        </span>
        <Separator />
        <span className="text-xxs text-sap-muted font-mono">
          Urutan yang benar: Material → Pallet → Storage Bin → Initial Stock → Safety Stock
        </span>
      </Toolbar>
    </div>
  );
}
