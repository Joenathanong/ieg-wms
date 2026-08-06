'use client';

import { useCallback, useEffect, useState } from 'react';
import { FileClock, Search, Download, ChevronLeft, ChevronRight, Eraser } from 'lucide-react';
import { Panel, Field, Input, Select, Button, Toolbar, Grid, exportCsv, type Column } from '@/components/sap/ui';
import { useStatus } from '@/components/sap/StatusBar';
import { api, qs, fmtDate, fmtDateTime } from '@/lib/client';

interface Row {
  document_number: string;
  movement_code: string;
  movement_type: string;
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
  { v: '', l: 'All movement types' },
  { v: '101', l: '101 — Goods Receipt' },
  { v: '201', l: '201 — Goods Issue' },
  { v: '301', l: '301 — Bin Transfer' },
  { v: '551', l: '551 — Scrapping' },
  { v: '561', l: '561 — Initial Stock' },
  { v: '701', l: '701 — Phys. Inv. (+)' },
  { v: '702', l: '702 — Phys. Inv. (−)' },
];

const SIGN: Record<string, number> = { '101': 1, '561': 1, '701': 1, '201': -1, '551': -1, '702': -1, '301': 0 };

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

  const cols: Column<Row>[] = [
    { key: 'document_number', header: 'Mat. Doc.', mono: true, width: '120px' },
    {
      key: 'movement_code',
      header: 'MvT',
      mono: true,
      width: '58px',
      align: 'center',
      render: (r) => {
        const s = SIGN[r.movement_code] ?? 0;
        const cls = s > 0 ? 'text-[#8FE0A4]' : s < 0 ? 'text-[#FF9CA0]' : 'text-[#9DC0FF]';
        return <span className={`font-mono font-semibold ${cls}`}>{r.movement_code}</span>;
      },
    },
    { key: 'doc_date', header: 'Doc. Date', mono: true, width: '95px', render: (r) => fmtDate(r.doc_date) },
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
      render: (r) => {
        const s = SIGN[r.movement_code] ?? 0;
        const cls = s > 0 ? 'text-[#8FE0A4]' : s < 0 ? 'text-[#FF9CA0]' : '';
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
    { key: 'user_id', header: 'User', mono: true, width: '95px' },
    { key: 'created_at', header: 'Entered On', mono: true, width: '150px', render: (r) => fmtDateTime(r.created_at) },
  ];

  return (
    <div className="space-y-3">
      <Panel title="MB51 — Material Document List · Selection Criteria" icon={<FileClock size={13} className="text-sap-blue" />}>
        <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-7 gap-3">
          <Field label="Material">
            <Input className="uppercase" value={material} onChange={(e) => setMaterial(e.target.value)} />
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
            <Input className="uppercase" value={bin} onChange={(e) => setBin(e.target.value)} />
          </Field>
          <Field label="Batch">
            <Input className="uppercase" value={batch} onChange={(e) => setBatch(e.target.value)} />
          </Field>
          <Field label="User">
            <Input className="uppercase" value={user} onChange={(e) => setUser(e.target.value)} />
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
        <Button onClick={() => exportCsv('MB51_material_documents.csv', cols, rows)} disabled={rows.length === 0}>
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

      <Grid columns={cols} rows={rows} loading={loading} rowKey={(r) => r.document_number} maxHeight="calc(100vh - 330px)" />
    </div>
  );
}
