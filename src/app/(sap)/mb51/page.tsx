'use client';

import { useCallback, useEffect, useState } from 'react';
import { FileClock, Search, Download, ChevronLeft, ChevronRight, Eraser } from 'lucide-react';
import { Panel, Field, Input, Select, Button, Toolbar, Grid, exportCsv, type Column } from '@/components/sap/ui';
import { useStatus } from '@/components/sap/StatusBar';
import { useExecuteKey } from '@/components/sap/keynav';
import { api, qs, fmtDate, fmtDateTime } from '@/lib/client';
import { WILDCARD_HINT } from '@/lib/like';

interface Row {
  document_number: string;
  line_no: number;
  cost_center: string;
  movement_code: string;
  movement_type: string;
  movement_desc: string;
  reversal_of: string;
  reversal_of_line: number | null;
  reversed_by: string;
  reversed_by_line: number | null;
  material_code: string;
  description: string;
  batch_number: string;
  source_bin: string;
  target_bin: string;
  qty: number;
  uom: string;
  reference: string;
  remarks: string;
  doc_date: string;
  created_at: string;
  user_id: string;
}

const MOVES = [
  { v: '', l: 'Semua movement IM' },
  { v: '101', l: '101 — Goods Receipt (Pembelian)' },
  { v: '102', l: '102 — Cancel Goods Receipt' },
  { v: '122', l: '122 — Retur ke Vendor' },
  { v: '123', l: '123 — Cancel Retur ke Vendor' },
  { v: '501', l: '501 — Goods Receipt Lain-lain' },
  { v: '502', l: '502 — Cancel GR Lain-lain' },
  { v: '201', l: '201 — Goods Issue' },
  { v: '202', l: '202 — Cancel Goods Issue' },
  { v: '601', l: '601 — Goods Issue (Penjualan)' },
  { v: '602', l: '602 — Cancel GI Penjualan' },
  { v: '551', l: '551 — Scrapping' },
  { v: '552', l: '552 — Cancel Scrapping' },
  { v: '561', l: '561 — Initial Stock' },
  { v: '562', l: '562 — Cancel Initial Stock' },
  { v: '701', l: '701 — Phys. Inv. (+)' },
  { v: '702', l: '702 — Phys. Inv. (−)' },
  { v: '711', l: '711 — Cancel Phys. Inv. (+)' },
  { v: '712', l: '712 — Cancel Phys. Inv. (−)' },
];

/**
 * Arah pergerakan tiap movement, untuk menampilkan tanda + / − di laporan.
 *
 * Wajib memuat SETIAP movement yang bisa muncul di MigoLog. Kode yang
 * tertinggal di sini tidak menghasilkan galat — angkanya hanya tampil tanpa
 * tanda, dan itu jauh lebih berbahaya daripada gagal terang-terangan: laporan
 * terlihat wajar sementara arah stoknya salah baca.
 */
const SIGN: Record<string, number> = {
  '101': 1, '501': 1, '561': 1, '701': 1, '202': 1, '552': 1, '712': 1, '602': 1, '123': 1,
  '201': -1, '601': -1, '122': -1, '551': -1, '702': -1, '102': -1, '502': -1, '562': -1, '711': -1,
  '301': 0,
};

export default function Mb51Page() {
  const { setStatus } = useStatus();

  const today = new Date().toISOString().slice(0, 10);
  const monthAgo = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);

  const [material, setMaterial] = useState('');
  const [movement, setMovement] = useState('');
  const [bin, setBin] = useState('');
  const [batch, setBatch] = useState('');
  const [user, setUser] = useState('');
  const [from, setFrom] = useState(monthAgo);
  const [to, setTo] = useState(today);
  const [page, setPage] = useState(1);
  const [size] = useState(200);

  const [rows, setRows] = useState<Row[]>([]);
  const [view, setView] = useState<Row[]>([]);
  const [total, setTotal] = useState(0);
  const [pages, setPages] = useState(1);
  const [loading, setLoading] = useState(false);

  const run = useCallback(
    async (p = page) => {
      setLoading(true);
      const r = await api<{ rows: Row[]; total: number; pages: number }>(
        '/api/reports/mb51' + qs({ material, movement, bin, batch, user, from, to, page: p, size })
      );
      setLoading(false);
      if (!r.ok) return setStatus(r.message, 'E');
      setRows(r.data?.rows ?? []);
      setTotal(r.data?.total ?? 0);
      setPages(r.data?.pages ?? 1);
      setStatus(r.message, (r.data?.total ?? 0) > 0 ? 'S' : 'W');
    },
    [material, movement, bin, batch, user, from, to, size, page, setStatus]
  );

  useEffect(() => {
    run(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Enter / F8 = Execute
  useExecuteKey(
    useCallback(() => {
      setPage(1);
      run(1);
    }, [run])
  );

  const cols: Column<Row>[] = [
    {
      key: 'document_number',
      header: 'Mat. Doc.',
      mono: true,
      width: '150px',
      // Satu dokumen kini bisa berisi banyak baris, jadi nomor barisnya ikut
      // ditampilkan — tanpa itu lima baris satu kedatangan terlihat identik.
      // CSV ikut membawa penanda pembatalan.
      exportValue: (r) =>
        `${r.document_number}/${r.line_no}` +
        (r.reversed_by ? ` (DIBATALKAN oleh ${r.reversed_by}/${r.reversed_by_line ?? 1})` : ''),
      render: (r) => (
        <span className="inline-flex items-center gap-1.5">
          <span className={r.reversed_by ? 'line-through text-sap-muted' : ''}>
            {r.document_number}
            <span className="text-sap-muted">/{r.line_no}</span>
          </span>
          {r.reversed_by && (
            <span
              className="sap-badge border-sap-errborder bg-sap-errbg text-sap-errtext"
              title={`Dibatalkan oleh ${r.reversed_by} baris ${r.reversed_by_line ?? 1}`}
            >
              CANC
            </span>
          )}
        </span>
      ),
    },
    {
      key: 'movement_code',
      header: 'MvT',
      mono: true,
      width: '58px',
      align: 'center',
      render: (r) => {
        const s = SIGN[r.movement_code] ?? 0;
        const cls = s > 0 ? 'text-sap-oktext' : s < 0 ? 'text-sap-errtext' : 'text-sap-infotext';
        return <span className={`font-mono font-semibold ${cls}`}>{r.movement_code}</span>;
      },
    },
    {
      key: 'movement_desc',
      header: 'MvT Description',
      width: '175px',
      exportValue: (r) =>
        r.reversal_of
          ? `${r.movement_desc} — pembatalan dari dok. ${r.reversal_of}/${r.reversal_of_line ?? 1}`
          : r.reversed_by
            ? `${r.movement_desc} — dibatalkan oleh dok. ${r.reversed_by}/${r.reversed_by_line ?? 1}`
            : r.movement_desc,
      render: (r) => (
        <span className="text-sap-muted">
          {r.movement_desc}
          {r.reversal_of && (
            <span className="font-mono text-xxs">
              {' '}(dok. {r.reversal_of}/{r.reversal_of_line ?? 1})
            </span>
          )}
        </span>
      ),
    },
    {
      key: 'doc_date',
      header: 'Doc. Date',
      mono: true,
      width: '95px',
      value: (r) => new Date(r.doc_date),
      exportValue: (r) => fmtDate(r.doc_date),
      render: (r) => fmtDate(r.doc_date),
    },
    { key: 'material_code', header: 'Material', mono: true, width: '140px' },
    { key: 'description', header: 'Description', width: '210px' },
    { key: 'batch_number', header: 'Batch', mono: true, width: '120px' },
    { key: 'source_bin', header: 'From Bin', mono: true, width: '110px' },
    { key: 'target_bin', header: 'To Bin', mono: true, width: '110px' },
    {
      key: 'qty',
      header: 'Quantity',
      align: 'right',
      width: '90px',
      // nilai bertanda: movement pengurang & pembatalan (102/562/711/201/551/702) menjadi negatif
      value: (r) => ((SIGN[r.movement_code] ?? 0) < 0 ? -r.qty : r.qty),
      exportValue: (r) => ((SIGN[r.movement_code] ?? 0) < 0 ? -r.qty : r.qty),
      render: (r) => {
        const s = SIGN[r.movement_code] ?? 0;
        const cls = s > 0 ? 'text-sap-oktext' : s < 0 ? 'text-sap-errtext' : '';
        return (
          <span className={cls}>
            {s > 0 ? '+' : s < 0 ? '−' : ''}
            {r.qty.toLocaleString('de-DE')}
          </span>
        );
      },
    },
    { key: 'uom', header: 'UoM', mono: true, width: '55px' },
    { key: 'reference', header: 'Reference', width: '130px' },
    { key: 'cost_center', header: 'Cost Center', mono: true, width: '130px' },
    { key: 'user_id', header: 'User', mono: true, width: '95px' },
    {
      key: 'created_at',
      header: 'Entered On',
      mono: true,
      width: '150px',
      value: (r) => new Date(r.created_at),
      exportValue: (r) => fmtDateTime(r.created_at),
      render: (r) => fmtDateTime(r.created_at),
    },
  ];

  return (
    <div className="space-y-3">
      <Panel title="MB51 — Material Document List · Selection Criteria" icon={<FileClock size={13} className="text-sap-blue" />}>
        <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-7 gap-3 items-start">
          <Field label="Material / Description" hint={WILDCARD_HINT}>
            <Input
              className="uppercase"
              placeholder="kode atau deskripsi"
              value={material}
              onChange={(e) => setMaterial(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && run(1)}
            />
          </Field>
          <Field label="Movement Type">
            <Select value={movement} onChange={(e) => setMovement(e.target.value)}>
              {MOVES.map((m) => (
                <option key={m.v} value={m.v}>
                  {m.l}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Storage Bin">
            <Input
              className="uppercase"
              placeholder="mis. GB-*"
              value={bin}
              onChange={(e) => setBin(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && run(1)}
            />
          </Field>
          <Field label="Batch">
            <Input
              className="uppercase"
              value={batch}
              onChange={(e) => setBatch(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && run(1)}
            />
          </Field>
          <Field label="User">
            <Input
              className="uppercase"
              value={user}
              onChange={(e) => setUser(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && run(1)}
            />
          </Field>
          <Field label="Posting Date From">
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </Field>
          <Field label="Posting Date To">
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </Field>
        </div>
      </Panel>

      <Toolbar>
        <Button
          variant="primary"
          onClick={() => {
            setPage(1);
            run(1);
          }}
          loading={loading}
        >
          <Search size={13} /> Execute (F8)
        </Button>
        <Button
          onClick={() => {
            setMaterial('');
            setMovement('');
            setBin('');
            setBatch('');
            setUser('');
            setFrom(monthAgo);
            setTo(today);
            setStatus('Selection criteria cleared', 'I');
          }}
        >
          <Eraser size={13} /> Clear
        </Button>
        <Button onClick={() => exportCsv('MB51_material_documents.csv', cols, view)} disabled={view.length === 0}>
          <Download size={13} /> Export CSV
        </Button>

        <div className="ml-auto flex items-center gap-1.5 font-mono text-xxs text-sap-muted">
          <Button
            className="!px-1.5"
            disabled={page <= 1}
            onClick={() => {
              const p = page - 1;
              setPage(p);
              run(p);
            }}
          >
            <ChevronLeft size={13} />
          </Button>
          <span>
            Page {page} / {pages} · {total.toLocaleString('de-DE')} docs
          </span>
          <Button
            className="!px-1.5"
            disabled={page >= pages}
            onClick={() => {
              const p = page + 1;
              setPage(p);
              run(p);
            }}
          >
            <ChevronRight size={13} />
          </Button>
        </div>
      </Toolbar>

      <Grid
        columns={cols}
        rows={rows}
        loading={loading}
        rowKey={(r) => `${r.document_number}/${r.line_no}`}
        maxHeight="calc(100vh - 360px)"
        onViewChange={setView}
        footer={<span>Qty bertanda − ikut terbawa ke Export CSV</span>}
      />
    </div>
  );
}
