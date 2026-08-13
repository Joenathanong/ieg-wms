'use client';

import { useCallback, useEffect, useState } from 'react';
import { ArrowLeftRight, Search, Download, ChevronLeft, ChevronRight, Eraser, Smartphone } from 'lucide-react';
import { Panel, Field, Input, Select, Button, Toolbar, Grid, exportCsv, type Column } from '@/components/sap/ui';
import { useStatus } from '@/components/sap/StatusBar';
import { useExecuteKey } from '@/components/sap/keynav';
import { api, qs, fmtDate, fmtDateTime } from '@/lib/client';
import { WILDCARD_HINT } from '@/lib/like';

interface Row {
  document_number: string;
  movement_code: string;
  kind: 'PUT-AWAY' | 'PICKING' | 'BIN TRANSFER';
  material_code: string;
  description: string;
  batch_number: string;
  source_bin: string;
  target_bin: string;
  qty: number;
  uom: string;
  tr_number: string;
  remarks: string;
  via_pdt: boolean;
  doc_date: string;
  created_at: string;
  user_id: string;
}

const KIND_STYLE: Record<string, string> = {
  'PUT-AWAY': 'border-sap-okborder bg-sap-okbg text-sap-oktext',
  PICKING: 'border-sap-warnborder bg-sap-warnbg text-sap-warntext',
  'BIN TRANSFER': 'border-sap-infoborder bg-sap-infobg text-sap-infotext',
};

export default function Lt22Page() {
  const { setStatus } = useStatus();

  const today = new Date().toISOString().slice(0, 10);
  const monthAgo = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);

  const [material, setMaterial] = useState('');
  const [bin, setBin] = useState('');
  const [batch, setBatch] = useState('');
  const [user, setUser] = useState('');
  const [tr, setTr] = useState('');
  const [via, setVia] = useState('');
  const [from, setFrom] = useState(monthAgo);
  const [to, setTo] = useState(today);
  const [page, setPage] = useState(1);
  const [size] = useState(200);

  const [rows, setRows] = useState<Row[]>([]);
  const [view, setView] = useState<Row[]>([]);
  const [total, setTotal] = useState(0);
  const [pages, setPages] = useState(1);
  const [movedQty, setMovedQty] = useState(0);
  const [loading, setLoading] = useState(false);

  const run = useCallback(
    async (p = page) => {
      setLoading(true);
      const r = await api<{ rows: Row[]; total: number; pages: number; moved_qty: number }>(
        '/api/reports/lt22' + qs({ material, bin, batch, user, tr, via, from, to, page: p, size })
      );
      setLoading(false);
      if (!r.ok) return setStatus(r.message, 'E');
      setRows(r.data?.rows ?? []);
      setTotal(r.data?.total ?? 0);
      setPages(r.data?.pages ?? 1);
      setMovedQty(r.data?.moved_qty ?? 0);
      setStatus(r.message, (r.data?.total ?? 0) > 0 ? 'S' : 'W');
    },
    [material, bin, batch, user, tr, via, from, to, size, page, setStatus]
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
    { key: 'document_number', header: 'Transfer Order', mono: true, width: '130px' },
    {
      key: 'kind',
      header: 'Jenis',
      width: '120px',
      exportValue: (r) => r.kind,
      render: (r) => <span className={`sap-badge ${KIND_STYLE[r.kind]}`}>{r.kind}</span>,
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
    { key: 'source_bin', header: 'From Bin', mono: true, width: '120px' },
    { key: 'target_bin', header: 'To Bin', mono: true, width: '120px' },
    {
      key: 'qty',
      header: 'Quantity',
      align: 'right',
      width: '95px',
      render: (r) => r.qty.toLocaleString('de-DE'),
    },
    { key: 'uom', header: 'UoM', mono: true, width: '55px' },
    { key: 'tr_number', header: 'Transfer Req.', mono: true, width: '125px' },
    {
      key: 'via_pdt',
      header: 'Sumber',
      width: '90px',
      align: 'center',
      value: (r) => (r.via_pdt ? 'PDT' : 'GUI'),
      exportValue: (r) => (r.via_pdt ? 'PDT' : 'GUI'),
      render: (r) =>
        r.via_pdt ? (
          <span className="sap-badge border-sap-infoborder bg-sap-infobg text-sap-infotext gap-1">
            <Smartphone size={10} /> PDT
          </span>
        ) : (
          <span className="text-sap-muted">GUI</span>
        ),
    },
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
      <Panel
        title="LT22 — Display Transfer Order (riwayat pemindahan bin) · Selection Criteria"
        icon={<ArrowLeftRight size={13} className="text-sap-blue" />}
      >
        <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-7 gap-3 items-start">
          <Field label="Material / Description" hint={WILDCARD_HINT}>
            <Input
              className="uppercase"
              placeholder="kode atau deskripsi"
              value={material}
              onChange={(e) => setMaterial(e.target.value)}
            />
          </Field>
          <Field label="Storage Bin (asal / tujuan)">
            <Input
              className="uppercase"
              placeholder="mis. GB-*"
              value={bin}
              onChange={(e) => setBin(e.target.value)}
            />
          </Field>
          <Field label="Batch">
            <Input className="uppercase" value={batch} onChange={(e) => setBatch(e.target.value)} />
          </Field>
          <Field label="Transfer Requirement">
            <Input className="uppercase" placeholder="TR*" value={tr} onChange={(e) => setTr(e.target.value)} />
          </Field>
          <Field label="Sumber Posting">
            <Select value={via} onChange={(e) => setVia(e.target.value)}>
              <option value="">Semua</option>
              <option value="PDT">Terminal PDT (ZRF)</option>
              <option value="GUI">Desktop (LB12 / LT01 / LT10)</option>
            </Select>
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
            setBin('');
            setBatch('');
            setUser('');
            setTr('');
            setVia('');
            setFrom(monthAgo);
            setTo(today);
            setStatus('Selection criteria cleared', 'I');
          }}
        >
          <Eraser size={13} /> Clear
        </Button>
        <Button onClick={() => exportCsv('LT22_transfer_orders.csv', cols, view)} disabled={view.length === 0}>
          <Download size={13} /> Export CSV
        </Button>

        <div className="ml-auto flex items-center gap-1.5 font-mono text-xxs text-sap-muted">
          <span className="hidden md:inline">
            Total dipindah: <b className="text-sap-text">{movedQty.toLocaleString('de-DE')}</b> unit ·
          </span>
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
        rowKey={(r) => r.document_number}
        maxHeight="calc(100vh - 360px)"
        onViewChange={setView}
        footer={<span>Movement 301 — Stock IM tidak berubah, hanya lokasi bin</span>}
      />
    </div>
  );
}
